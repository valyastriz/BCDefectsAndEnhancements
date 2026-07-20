"use strict";

/**
 * STARTER STUB — agentic runner for a grounded AI assistant.
 *
 * A bounded plan → call tools → aggregate → self-verify loop over the read-only
 * tool registry. Grounded (tool data is the ONLY source of truth), self-checking
 * (a final verification pass), and honest (asks to clarify or says it can't
 * determine, rather than guessing). Writes are PROPOSED, never executed here.
 *
 * Replace `getProvider()` with your own provider abstraction. The provider must
 * expose `chat({ systemPrompt, messages, tools, toolChoice, maxTokens })` (and
 * optionally `stream(...)`) returning { content, toolCalls, finishReason, raw, usage }.
 */
const { toolSchemas, runTool, previewTool, isWriteTool } = require("./tools");

const MAX_STEPS = 6;     // tool-call rounds before forcing an answer
const MAX_TOKENS = 1500;

// TODO: wire to your provider layer.
function getProvider() {
    throw new Error("Wire getProvider() to your AI provider abstraction.");
}

function todayIso() {
    return new Date().toISOString().slice(0, 10); // so the model never guesses "now"
}

// Render the page context the screen passed (key on-screen figures) into one line.
function renderDetails(details) {
    if (!details) return "";
    if (typeof details === "string") return details.trim().slice(0, 600);
    return Object.entries(details)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .slice(0, 12)
        .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
        .join("; ")
        .slice(0, 600);
}

function buildSystemPrompt({ appName, tenantName, role, pageContext }) {
    const detailLine = renderDetails(pageContext?.details);
    const ctxLine = pageContext?.summary
        ? `The user is currently viewing: ${pageContext.summary}${
              pageContext.entity ? ` (${pageContext.entity.type} #${pageContext.entity.id})` : ""
          }.${detailLine ? ` On screen right now: ${detailLine}.` : ""} When they say "this", "here", "right now", or "my", assume they mean what's on screen unless they say otherwise. These on-screen figures are for CONTEXT ONLY — still call tools to get authoritative numbers before stating them.`
        : "The user has not indicated a specific screen; ask which record they mean if it matters.";

    return [
        `You are the built-in assistant for ${appName || "this app"} (account: ${tenantName || "this account"}).`,
        `You are helping a ${role || "user"}. Today is ${todayIso()}.`,
        ctxLine,
        "",
        "YOU DO TWO THINGS:",
        "1. ANSWER QUESTIONS ABOUT THEIR DATA by calling the read tools, which return real, account-scoped data.",
        "2. TEACH THEM HOW TO USE THE APP using the help tools (list_help_topics / search_help / get_help_topic).",
        "",
        "GROUNDING RULES:",
        "- Tool data is the ONLY source of truth. NEVER invent or estimate numbers, dates, names, or statuses a tool did not return. Do not answer from prior/general knowledge.",
        "- Do arithmetic ONLY over numbers the tools returned. Totals/rollups are already computed — prefer those.",
        "- If a question is ambiguous or the needed data is missing, ASK ONE short clarifying question, or say 'I can't determine that because…'. Never guess.",
        "- Answer how-to questions ONLY from what the help tools return — give concrete steps and exact button/menu names. Do NOT invent UI. If no guide covers it, say so.",
        "- Before your final answer, double-check every number/date/name against the tool results and fix anything unsupported.",
        "",
        "MAKING CHANGES:",
        "- Write actions are PROPOSED only — when you call one it is previewed and the user must confirm. Never claim a change is done. Propose only ONE at a time.",
        "- For anything you can't change, tell the user exactly where in the app to do it.",
        "",
        "STYLE: concise, practical, plain prose for a small chat panel. When you state a figure, name the record it came from so the user can verify it.",
    ].join("\n");
}

/**
 * Answer a question with the agentic loop.
 * @returns {Promise<{ answer, steps, sources, usage, pendingAction }>}
 */
async function answerQuestion({ db, user, question, pageContext, history = [], disabledFeatures = [] }) {
    const disabledSet = new Set(disabledFeatures);
    const provider = getProvider();
    const ctx = { db, user };
    const systemPrompt = buildSystemPrompt({ appName: user.app_name, tenantName: user.tenant_name, role: user.role, pageContext });

    const messages = [];
    for (const turn of (history || []).slice(-6)) {
        if (turn?.text) messages.push({ role: turn.role === "assistant" ? "assistant" : "user", content: String(turn.text).slice(0, 4000) });
    }
    messages.push({ role: "user", content: String(question || "").slice(0, 4000) });

    const tools = toolSchemas(disabledSet);
    const steps = [];
    const sources = [];
    const usage = { input_tokens: 0, output_tokens: 0 };
    let finalText = "";
    let pendingAction = null; // a proposed WRITE awaiting user confirmation

    const callModel = async () => {
        const resp = await provider.chat({ systemPrompt, messages, tools, toolChoice: "auto", maxTokens: MAX_TOKENS });
        usage.input_tokens += resp.usage?.prompt_tokens || 0;
        usage.output_tokens += resp.usage?.completion_tokens || 0;
        return resp;
    };

    try {
        // --- tool loop ---
        for (let step = 0; step < MAX_STEPS; step += 1) {
            const resp = await callModel();
            const calls = resp.toolCalls || [];
            if (resp.finishReason === "tool_use" && calls.length) {
                messages.push({ role: "assistant", content: resp.raw });
                const resultBlocks = [];
                for (const call of calls) {
                    const toolName = call.function?.name;
                    let args = {};
                    try { args = JSON.parse(call.function?.arguments || "{}"); } catch { args = {}; }

                    let result;
                    if (isWriteTool(toolName)) {
                        // WRITE tools are PREVIEWED, never executed in the loop.
                        const preview = await previewTool(toolName, ctx, args, disabledSet);
                        if (preview?.error || preview?.available === false) {
                            result = preview; // let the model see why & clarify
                        } else if (pendingAction) {
                            result = { proposed: false, note: "Another action is already awaiting confirmation. Only one at a time." };
                        } else {
                            pendingAction = { tool: toolName, args, summary: preview?.data?.summary || "Proposed change", details: preview?.data?.details || null };
                            result = { proposed: true, summary: pendingAction.summary, note: "PROPOSED ONLY — NOT done. Tell the user what will be created and that they must confirm; do not claim it is done." };
                        }
                    } else {
                        result = await runTool(toolName, ctx, args, disabledSet);
                    }
                    steps.push({ tool: toolName, ok: !result?.error, proposed: isWriteTool(toolName) && Boolean(result?.proposed) });
                    if (Array.isArray(result?.sources)) sources.push(...result.sources);
                    resultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result).slice(0, 12000) });
                }
                messages.push({ role: "user", content: resultBlocks });
                continue;
            }
            finalText = resp.content || "";
            break;
        }

        // --- self-verification pass (skipped for a proposed write) ---
        if (finalText && steps.length && !pendingAction) {
            messages.push({ role: "assistant", content: finalText });
            messages.push({
                role: "user",
                content:
                    "Silently verify your answer above against the tool results in this conversation: (1) re-sum any breakdowns; (2) confirm every number, date, and name appears in a tool result and isn't guessed; (3) check for internal contradictions; (4) confirm you used the right figure for what was asked. For how-to answers, confirm every step and button/menu name appears in a help tool result. If anything is wrong or unsupported, call the right tool again and fix it, or ask for what you need. Then reply with ONLY the clean final answer — do not mention that you verified anything.",
            });
            const verifyResp = await provider.chat({ systemPrompt, messages, tools, toolChoice: "auto", maxTokens: MAX_TOKENS });
            usage.input_tokens += verifyResp.usage?.prompt_tokens || 0;
            usage.output_tokens += verifyResp.usage?.completion_tokens || 0;
            if (verifyResp.content) finalText = verifyResp.content;
        }
    } catch (error) {
        return { answer: "Something went wrong while looking that up. Please try again.", steps, sources, usage, error: error.message };
    }

    // De-dup sources by type+id.
    const seen = new Set();
    const dedupSources = sources.filter((s) => {
        const k = `${s.type}:${s.id}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });

    return { answer: finalText || "I couldn't find an answer to that.", steps, sources: dedupSources, usage, pendingAction };
}

module.exports = { answerQuestion, buildSystemPrompt };

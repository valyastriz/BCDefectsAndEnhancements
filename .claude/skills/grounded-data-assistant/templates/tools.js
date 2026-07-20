"use strict";

/**
 * STARTER STUB — read-only, tenant-scoped tool registry for a grounded AI assistant.
 *
 * Copy into your backend (e.g. functions/assistant/tools.js) and adapt names to
 * your ORM/models. Every tool:
 *   - is ALWAYS scoped to ctx.user.tenant_id (multi-tenant isolation),
 *   - returns deterministic, ALREADY-COMPUTED data (the model never does math),
 *   - returns `sources` so the answer can cite / deep-link the records it used,
 *   - returns a structured "unavailable + reason" (never throws) when not found.
 *
 * This registry is the cross-cutting layer that "knows how the systems tie
 * together". When a new feature lands, add its read tool(s) here so the assistant
 * can answer about it across the whole app.
 */

// Help/how-to tools derived from your single-source docs (see helpKnowledge.js).
const { HELP_TOPICS } = require("./helpKnowledge");

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
};
const ok = (data, sources = []) => ({ data, sources });
const unavailable = (reason) => ({ available: false, reason });

// Keyword scorer for the help corpus (no external deps).
function scoreTopic(topic, terms) {
    const hay = `${topic.title} ${topic.summary} ${topic.text}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
        if (!term) continue;
        if (topic.title.toLowerCase().includes(term)) score += 5;
        if ((topic.summary || "").toLowerCase().includes(term)) score += 2;
        let from = 0;
        let n = 0;
        while ((from = hay.indexOf(term, from)) !== -1 && n < 10) {
            score += 1;
            from += term.length;
            n += 1;
        }
    }
    return score;
}
const STOP_WORDS = new Set(["the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "is", "how", "what", "do", "i", "my", "can"]);

// ---------------------------------------------------------------------------
// The registry. Add one entry per QUESTION users ask (not per database table).
// ---------------------------------------------------------------------------
const TOOLS = [
    // ----- Example READ tool: list a tenant's records -----------------------
    {
        name: "list_items",
        description:
            "List this account's items (newest first). Optional status filter. Use for 'what items do we have / show my items'.",
        input_schema: {
            type: "object",
            properties: {
                status: { type: "string", description: "Optional status to filter by." },
                limit: { type: "number", description: "Max rows (default 25)." },
            },
        },
        run: async (ctx, args) => {
            const where = { tenant_id: ctx.user.tenant_id, retired: false };
            if (typeof args?.status === "string" && args.status) where.status = args.status;
            const rows = await ctx.db.Item.findAll({
                where,
                order: [["updated_at", "DESC"]],
                limit: Math.min(Number(args?.limit) || 25, 100),
            });
            return ok(
                rows.map((r) => ({ id: r.id, title: r.title, status: r.status, total: toNum(r.total) })),
                rows.map((r) => ({ type: "item", id: r.id, label: r.title || `Item #${r.id}`, url: `/items/${r.id}` })),
            );
        },
    },

    // ----- Example READ tool: one record, with COMPUTED rollups -------------
    {
        name: "get_item",
        description:
            "Full breakdown of one item with its computed totals. Pass item_id.",
        input_schema: {
            type: "object",
            properties: { item_id: { type: "number" } },
            required: ["item_id"],
        },
        run: async (ctx, args) => {
            const row = await ctx.db.Item.findByPk(args.item_id, {
                include: [{ model: ctx.db.Line_Item, as: "Lines", required: false, where: { retired: false } }],
            });
            // ALWAYS re-check tenant ownership — never trust an id to cross the boundary.
            if (!row || row.retired || Number(row.tenant_id) !== Number(ctx.user.tenant_id)) {
                return unavailable("Item not found in this account.");
            }
            const lines = (row.Lines || []).filter((l) => !l.retired);
            // Do the math HERE, in code — never in the prompt.
            const total = toNum(lines.reduce((s, l) => s + Number(l.amount || 0), 0));
            return ok(
                {
                    id: row.id,
                    title: row.title,
                    status: row.status,
                    total,
                    line_items: lines.map((l) => ({ description: l.description, amount: toNum(l.amount) })),
                },
                [{ type: "item", id: row.id, label: row.title || `Item #${row.id}`, url: `/items/${row.id}` }],
            );
        },
    },

    // ----- HELP tools: teach how to use the app from the single-source docs --
    {
        name: "list_help_topics",
        description:
            "The full directory of the app's features/pages with a one-line summary. Call FIRST for open-ended 'what can I do / help me get started / what's on this page' questions, or to find which topic to open with get_help_topic.",
        input_schema: { type: "object", properties: {} },
        run: async () =>
            ok(HELP_TOPICS.map((t) => ({ id: t.id, title: t.title, summary: t.summary, where_to_find: t.where_to_find }))),
    },
    {
        name: "get_help_topic",
        description:
            "The full step-by-step guide for one feature/page. Use to walk a user through how to do something. topic_id comes from list_help_topics or search_help.",
        input_schema: {
            type: "object",
            properties: { topic_id: { type: "string" } },
            required: ["topic_id"],
        },
        run: async (ctx, args) => {
            const t = HELP_TOPICS.find((x) => x.id === args?.topic_id);
            if (!t) return unavailable(`No help topic '${args?.topic_id}'. Call list_help_topics for valid ids.`);
            return ok({ id: t.id, title: t.title, where_to_find: t.where_to_find, text: t.text });
        },
    },
    {
        name: "search_help",
        description:
            "Keyword-search the how-to docs for a 'how do I…' question. Returns best-matching topics with a snippet; open the most relevant with get_help_topic.",
        input_schema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
        },
        run: async (ctx, args) => {
            const terms = String(args?.query || "").toLowerCase().split(/\W+/).filter((w) => w && !STOP_WORDS.has(w));
            const ranked = HELP_TOPICS.map((t) => ({ t, score: scoreTopic(t, terms) }))
                .filter((r) => r.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 5);
            if (!ranked.length) return ok({ matches: [], hint: "No direct match — call list_help_topics to browse." });
            return ok({ matches: ranked.map((r) => ({ id: r.t.id, title: r.t.title, summary: r.t.summary })) });
        },
    },

    // ----- Example WRITE tool: PROPOSE only, never executed in the loop ------
    {
        name: "create_item",
        write: true, // marks this as a write tool — the runner PREVIEWS it for confirmation
        description:
            "Propose creating a DRAFT item. NEVER happens automatically — the user must confirm. Gather title (and any required fields) first.",
        input_schema: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
        },
        // `preview` builds the confirmation summary WITHOUT mutating anything.
        preview: async (ctx, args) => {
            if (!args?.title) return unavailable("A title is required to create an item.");
            return ok({ summary: `Create a draft item titled "${args.title}"`, details: { title: args.title } });
        },
        // `run` is only invoked AFTER the user confirms, via your normal validated path.
        run: async (ctx, args) => {
            const row = await ctx.db.Item.create({ tenant_id: ctx.user.tenant_id, title: args.title, status: "draft" });
            return ok({ created_id: row.id }, [{ type: "item", id: row.id, label: row.title, url: `/items/${row.id}` }]);
        },
    },
];

// ---------------------------------------------------------------------------
// Registry helpers consumed by the runner.
// ---------------------------------------------------------------------------
const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

// Optional: map a tool to a feature flag so disabled features hide their tools.
const TOOL_FEATURE = {
    // create_item: "items",
};

function toolSchemas(disabled = new Set()) {
    return TOOLS
        .filter((t) => !(TOOL_FEATURE[t.name] && disabled.has(TOOL_FEATURE[t.name])))
        .map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}

const isWriteTool = (name) => Boolean(TOOL_MAP.get(name)?.write);

async function runTool(name, ctx, args, disabled = new Set()) {
    const t = TOOL_MAP.get(name);
    if (!t) return { error: `Unknown tool: ${name}` };
    if (TOOL_FEATURE[name] && disabled.has(TOOL_FEATURE[name])) return unavailable("That feature is turned off for this account.");
    try {
        return await t.run(ctx, args || {});
    } catch (err) {
        return { error: err.message };
    }
}

async function previewTool(name, ctx, args, disabled = new Set()) {
    const t = TOOL_MAP.get(name);
    if (!t || !t.write) return { error: `Not a write tool: ${name}` };
    if (TOOL_FEATURE[name] && disabled.has(TOOL_FEATURE[name])) return unavailable("That feature is turned off for this account.");
    try {
        return await (t.preview || t.run)(ctx, args || {});
    } catch (err) {
        return { error: err.message };
    }
}

module.exports = { TOOLS, toolSchemas, runTool, previewTool, isWriteTool, TOOL_FEATURE };

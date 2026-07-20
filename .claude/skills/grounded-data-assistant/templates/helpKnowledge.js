"use strict";

/**
 * STARTER STUB — derive the assistant's how-to knowledge from the SAME in-app
 * documentation users read on the Help page. ONE single source of truth
 * (docContent.js below), flattened for the model at load time. Do NOT keep a
 * second hand-written copy of how-to text for the AI — it will drift.
 *
 * Pair this with the guided-onboarding-walkthroughs skill: the same docs render
 * the Help page and seed product tours.
 */
// Adjust the path to the project's shared docContent module (its location is
// recorded in the project's CLAUDE.md; it is CommonJS so this require works).
const { DOC_SECTIONS } = require("./docContent");

// Flatten one typed content block to plain instructional text.
function blockToText(block) {
    switch (block?.type) {
        case "heading":
        case "subheading":
            return `\n## ${block.text}`;
        case "paragraph":
            return block.text;
        case "steps":
            return (block.items || []).map((s, i) => `${i + 1}. ${s}`).join("\n");
        case "list":
            return (block.items || []).map((s) => `- ${s}`).join("\n");
        case "fields":
            return (block.items || []).map((f) => `- ${f.name}: ${f.desc}`).join("\n");
        case "tip":
            return `Tip: ${block.text}`;
        case "note":
            return `Note: ${block.text}`;
        case "warning":
            return `Warning: ${block.text}`;
        default:
            return ""; // image / screenshot placeholders are skipped
    }
}

// Pull the "Where to find it" paragraph that follows that subheading, if any.
function extractWhereToFind(blocks) {
    const idx = blocks.findIndex(
        (b) => (b?.type === "subheading" || b?.type === "heading") && /where to find/i.test(b.text || ""),
    );
    if (idx >= 0) {
        const next = blocks.slice(idx + 1).find((b) => b?.type === "paragraph");
        if (next?.text) return next.text;
    }
    return null;
}

const HELP_TOPICS = (DOC_SECTIONS || []).map((s) => {
    const blocks = s.blocks || [];
    const text = blocks.map(blockToText).filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    const firstPara = blocks.find((b) => b?.type === "paragraph");
    return {
        id: s.id,
        title: s.title,
        summary: firstPara?.text ? String(firstPara.text).slice(0, 220) : "",
        where_to_find: extractWhereToFind(blocks),
        text,
    };
});

module.exports = { HELP_TOPICS };

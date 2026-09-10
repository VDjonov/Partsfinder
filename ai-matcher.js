/**
 * The judgement calls, handed to Claude as plain text.
 *
 * Everything the catalog needs *done* — logging in, entering a VIN,
 * clicking — stays scripted, because that's deterministic and cheap.
 * Everything that needs *deciding* comes here: which category holds an
 * EGR valve, which of thirty rows is the part itself rather than its
 * cooler or its gasket. That's the part no amount of per-brand
 * configuration scales to, and the part a model is actually good at.
 *
 * These are text-only calls with small inputs, so a lookup costs a
 * fraction of a cent and takes a second or two.
 */

const Anthropic = require("@anthropic-ai/sdk");
const { z } = require("zod");
const { zodOutputFormat } = require("@anthropic-ai/sdk/helpers/zod");

const MODEL = "claude-opus-5";

// Returned when nothing on offer fits, rather than forcing a bad pick.
const NONE = "NONE";

const client = new Anthropic();

const ChoiceSchema = z.object({
  choice: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string(),
});

const PartChoiceSchema = z.object({
  partNo: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string(),
  alternativePartNos: z.array(z.string()),
});

/**
 * Pick one label from a catalog column.
 *
 * @param {string} partQuery   what the user typed, e.g. "egr valve"
 * @param {string} columnName  which column is being chosen from
 * @param {string[]} options   the labels actually on screen
 * @returns {Promise<{choice: string|null, confidence: string, reasoning: string}>}
 */
async function chooseCategory(partQuery, columnName, options) {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system:
      "You navigate manufacturer parts catalogs. Given a part a mechanic is looking for and the " +
      "options in one column of the catalog's category tree, pick the single option most likely to " +
      "lead to that part. Catalog wording varies by manufacturer and is often translated, " +
      "abbreviated or archaic, so match on meaning rather than exact words. " +
      `If no option plausibly leads to the part, answer exactly "${NONE}".`,
    messages: [
      {
        role: "user",
        content:
          `Part wanted: ${partQuery}\n\n` +
          `Column: ${columnName}\n` +
          `Options:\n${options.map((option) => `- ${option}`).join("\n")}\n\n` +
          "Answer with the option text exactly as written above.",
      },
    ],
    output_config: { format: zodOutputFormat(ChoiceSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed || parsed.choice === NONE) {
    return { choice: null, confidence: parsed?.confidence ?? "low", reasoning: parsed?.reasoning ?? "" };
  }
  return parsed;
}

/**
 * Pick the actual part from an assembly's parts list.
 *
 * The neighbours matter as much as the target here: an EGR valve sits
 * beside its cooler, pipes and gaskets, and a brake disc beside its pads
 * and caliper. Getting a neighbour back looks like a plausible answer
 * and is completely wrong, so the model is told to say so rather than
 * settle for a near miss.
 *
 * @param {string} partQuery
 * @param {Array<{partNo: string, description: string, remark: string|null}>} parts
 */
async function choosePart(partQuery, parts) {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system:
      "You identify parts in manufacturer catalogs. Given a part a mechanic wants and the contents " +
      "of one catalog assembly, pick the row that IS that part. Assemblies list neighbouring parts " +
      "too — a valve's cooler, pipes and gaskets, a disc's pads and caliper — and returning one of " +
      "those instead of the part itself is a costly error, so prefer answering " +
      `"${NONE}" over a near miss. Catalog wording is often abbreviated, translated or archaic ` +
      "(\"DISKS\" for discs, \"E.G.R.\" for EGR), so match on meaning. Where several rows are " +
      "genuinely the same part in different specifications, pick the most likely and list the rest " +
      "as alternatives.",
    messages: [
      {
        role: "user",
        content:
          `Part wanted: ${partQuery}\n\n` +
          "Assembly contents:\n" +
          parts
            .map((part) => `- ${part.partNo} | ${part.description}${part.remark ? ` | ${part.remark}` : ""}`)
            .join("\n") +
          "\n\nAnswer with the part number exactly as written above.",
      },
    ],
    output_config: { format: zodOutputFormat(PartChoiceSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed || parsed.partNo === NONE) {
    return { partNo: null, confidence: parsed?.confidence ?? "low", reasoning: parsed?.reasoning ?? "", alternativePartNos: [] };
  }
  return parsed;
}

module.exports = { chooseCategory, choosePart };

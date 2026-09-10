/**
 * Vocabulary per part TYPE — not per brand, not per model.
 *
 * This is the only thing that grows as coverage expands, and it grows
 * when a new kind of part appears, never when a new car does. Catalog
 * navigation is discovered at runtime instead of being configured here.
 *
 * Fields:
 *   searchTerms  Fed to the catalog's own parts search, purely to find
 *                which assemblies are worth opening. The search's own
 *                top hits are unreliable as answers — it word-matches
 *                loosely — so it's used as an index, not an oracle.
 *   must         Groups of synonyms. A part must match at least one term
 *                from EVERY group, so [["disc","disk"],["front"]] means
 *                "something disc-ish AND front".
 *   exclude      Terms that rule a part out. Manufacturers list related
 *                parts in the same assembly (pads next to discs, coolers
 *                next to EGR valves), so this is what keeps a neighbour
 *                from being returned as the answer.
 *
 * Matching ignores punctuation and case, so "E.G.R." matches "egr".
 */
const PART_VOCABULARY = {
  front_brake_disc: {
    searchTerms: ["front brake disc", "brake disc"],
    must: [
      ["disc", "disk", "rotor"],
      ["front"],
    ],
    exclude: ["pad", "caliper", "hose", "hub", "protector", "shield", "rear", "sensor"],
  },

  rear_brake_disc: {
    searchTerms: ["rear brake disc", "brake disc"],
    must: [
      ["disc", "disk", "rotor"],
      ["rear"],
    ],
    exclude: ["pad", "caliper", "hose", "hub", "protector", "shield", "front", "sensor"],
  },

  egr_valve: {
    searchTerms: ["egr valve", "exhaust gas recirculation", "egr"],
    must: [
      ["egr", "exhaust gas recirculation", "recirculation"],
      ["valve"],
    ],
    // An EGR valve usually shares its assembly with the cooler, pipes
    // and gaskets, which is exactly what would otherwise come back.
    exclude: ["cooler", "pipe", "gasket", "seal", "bracket", "support", "hose", "sensor"],
  },
};

/** Lowercased, punctuation stripped, so "E.G.R." and "EGR" compare equal. */
const squash = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

function textContains(haystack, needle) {
  return haystack.toLowerCase().includes(needle.toLowerCase()) || squash(haystack).includes(squash(needle));
}

/**
 * Does this catalog part description describe the part we're after?
 * Pure text logic, deliberately kept free of any browser dependency so
 * it can be reasoned about and tested on its own.
 */
function matchesVocabulary(description, vocabulary) {
  if (textContains(description, "eurorepar")) return false; // alternate brand, not the OE number
  if (vocabulary.exclude.some((term) => textContains(description, term))) return false;
  return vocabulary.must.every((synonyms) => synonyms.some((term) => textContains(description, term)));
}

module.exports = { PART_VOCABULARY, matchesVocabulary };

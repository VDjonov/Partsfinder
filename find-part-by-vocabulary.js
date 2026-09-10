/**
 * Vocabulary-driven part lookup (experimental).
 *
 * The difference from partslink24-worker.js's category-tree lookup: this
 * one is told nothing about where a part lives. It searches, opens
 * whichever assemblies the results point at, reads each one's full parts
 * table, and matches descriptions against the part type's vocabulary.
 * That makes it brand- and model-agnostic — the tree path for brakes on
 * a Peugeot is not the tree path for brakes on a BMW, but "something
 * disc-ish and front, not a pad or a caliper" holds everywhere.
 *
 * Kept separate from the working category-tree lookup until it has
 * proven itself on a part it was never configured for.
 */

const {
  openVehicleCatalog,
  launchCatalogBrowser,
  closeVehiclePanel,
  readRowField,
  politeDelay,
  credentialsConfigured,
} = require("./partslink24-worker");

const { matchesVocabulary } = require("./part-vocabulary");

const SEARCH_PARTS_INPUT_SELECTOR = 'input[placeholder="Search for parts"]';

// How many distinct assemblies to open before giving up. The right one
// is usually the first or second; beyond a handful we're guessing.
const MAX_ASSEMBLIES_TO_OPEN = 4;

/** Type a term into the parts search and wait for the result list. */
async function searchParts(page, term) {
  const box = page.locator(SEARCH_PARTS_INPUT_SELECTOR);
  await box.click();
  await box.fill("");
  await box.pressSequentially(term, { delay: 50 });
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle");
}

/**
 * Identify which assembly is currently open, so the same one isn't read
 * twice. The breadcrumb's trailing entries name it.
 */
async function currentAssemblyId(page) {
  return (await page.locator('[data-testid="breadcrumbs"]').innerText().catch(() => "")).trim();
}

/** Read every part row of the currently open assembly. */
async function readAssemblyParts(page) {
  await closeVehiclePanel(page);
  await page.locator('[data-testid="row"]').first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});

  const byPartNo = new Map();
  for (const row of await page.locator('[data-testid="row"]').all()) {
    const partNo = await readRowField(row, "partnoValue");
    const description = await readRowField(row, "descriptionValue");
    if (!partNo || !description || byPartNo.has(partNo)) continue;

    byPartNo.set(partNo, {
      partNo,
      description,
      remark: (await readRowField(row, "remarkValue")) || null,
      restrictions: (await readRowField(row, "restrictionValue")) || null,
    });
  }
  return [...byPartNo.values()];
}

/**
 * @returns {Promise<{
 *   success: boolean,
 *   oeNumber?: string,
 *   candidates?: Array<object>,
 *   ambiguous?: boolean,
 *   assembliesOpened?: string[],
 *   error?: string,
 * }>}
 */
async function findPart(vin, make, partKey, vocabulary) {
  if (!credentialsConfigured()) {
    throw new Error("Partslink24 credentials not configured");
  }

  await politeDelay();
  const { browser, page } = await launchCatalogBrowser();
  const assembliesOpened = [];
  const matches = new Map();

  try {
    await openVehicleCatalog(page, vin, make);

    for (const term of vocabulary.searchTerms) {
      if (assembliesOpened.length >= MAX_ASSEMBLIES_TO_OPEN) break;

      await searchParts(page, term);
      const resultCount = await page.locator('[data-testid="row"]').count();
      console.log(`Searched "${term}" — ${resultCount} results`);

      // Open results one at a time. Re-running the search between them
      // is slower than going back, but the result list is rebuilt
      // cleanly each time rather than depending on history behaviour.
      for (let index = 0; index < Math.min(resultCount, MAX_ASSEMBLIES_TO_OPEN * 2); index++) {
        if (assembliesOpened.length >= MAX_ASSEMBLIES_TO_OPEN) break;

        if (index > 0) await searchParts(page, term);
        const result = page.locator('[data-testid="row"]').nth(index);
        await result.click({ timeout: 5000 }).catch(() => result.dispatchEvent("click").catch(() => {}));
        await page.waitForLoadState("networkidle");

        const assemblyId = await currentAssemblyId(page);
        if (!assemblyId || assembliesOpened.includes(assemblyId)) continue;
        assembliesOpened.push(assemblyId);

        const parts = await readAssemblyParts(page);
        const hits = parts.filter((part) => matchesVocabulary(part.description, vocabulary));
        console.log(`  opened assembly ${assembliesOpened.length}: ${parts.length} parts, ${hits.length} matching`);
        for (const hit of hits) matches.set(hit.partNo, hit);
      }

      if (matches.size > 0) break; // a search term that works is enough
    }

    const candidates = [...matches.values()];

    if (candidates.length === 1) {
      return { success: true, oeNumber: candidates[0].partNo, candidates, assembliesOpened };
    }
    if (candidates.length > 1) {
      return {
        success: false,
        ambiguous: true,
        error: `Found ${candidates.length} possible OE numbers for "${partKey}" — needs human review to pick the right one for this vehicle.`,
        candidates,
        assembliesOpened,
      };
    }
    return {
      success: false,
      error: `No part matching "${partKey}" found in the ${assembliesOpened.length} assemblies the search pointed at.`,
      assembliesOpened,
    };
  } catch (err) {
    console.error("Partslink24 lookup failed:", err);
    await page.screenshot({ path: "debug-failure.png", fullPage: true }).catch(() => {});
    console.error("Saved a screenshot of the failing page to debug-failure.png");
    return { success: false, error: "Partslink24 lookup failed — see logs and debug-failure.png." };
  } finally {
    await browser.close();
  }
}

module.exports = { findPart };

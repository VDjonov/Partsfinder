/**
 * AI-guided part lookup.
 *
 * The catalog is navigated deterministically — login, VIN, clicks — and
 * every *decision* along the way is Claude's: which scope, which main
 * group, which assembly, and finally which row is the part. Nothing here
 * is specific to a brand, a model or a part, so adding coverage means
 * typing a different search phrase, not writing configuration.
 *
 * Why not the catalog's own search: it word-matches. Searching "egr
 * valve" on a Peugeot walks into MECHANICAL > ENGINE > VALVES GUIDE
 * ROCKER GEAR — the engine's valvetrain, which shares the word "valve"
 * and nothing else. Reading the tree and letting a model judge the
 * labels avoids that whole class of error.
 */

const {
  openVehicleCatalog,
  launchCatalogBrowser,
  closeVehiclePanel,
  readAssemblyParts,
  politeDelay,
  credentialsConfigured,
} = require("./partslink24-worker");
const { chooseCategory, choosePart } = require("./ai-matcher");

/**
 * Everything on screen that looks selectable. Deliberately over-collects
 * — the model can ignore noise, and being generous here is what keeps
 * this working on catalogs whose markup we've never seen.
 */
async function readOptions(page) {
  return page.evaluate(() => {
    const seen = new Set();
    for (const element of document.querySelectorAll('[aria-label], [tabindex], [data-testid="row"]')) {
      const text = (element.getAttribute("aria-label") || element.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length >= 2 && text.length <= 100) seen.add(text);
    }
    return [...seen].slice(0, 300);
  });
}

/** Click an option by its exact label, however the catalog exposes it. */
async function clickOption(page, label) {
  const attempts = [
    page.getByText(label, { exact: true }).first(),
    page.locator(`[aria-label="${label.replace(/"/g, '\\"')}"]`).first(),
  ];

  for (const target of attempts) {
    if ((await target.count()) === 0) continue;
    try {
      await target.click({ timeout: 5000 });
    } catch {
      // Transparent overlays sit over these labels; dispatching the
      // event still reaches the handler on the ancestor.
      await target.dispatchEvent("click").catch(() => {});
    }
    await page.waitForLoadState("networkidle");
    return true;
  }
  return false;
}

/**
 * @param {string} vin
 * @param {string} make
 * @param {string} partQuery  free text, e.g. "egr valve" or "front brake disc"
 */
async function findPart(vin, make, partQuery) {
  if (!credentialsConfigured()) throw new Error("Partslink24 credentials not configured");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");

  await politeDelay();
  const { browser, page } = await launchCatalogBrowser();
  const path = [];

  try {
    await openVehicleCatalog(page, vin, make);
    await closeVehiclePanel(page);

    // Walk down the tree, one column at a time. Three levels is what
    // this catalog uses (scope, main group, assembly); the loop stops
    // early if a level turns out to be the parts list already.
    for (const column of ["scope", "main group", "assembly"]) {
      const options = await readOptions(page);
      const decision = await chooseCategory(partQuery, column, options);

      if (!decision.choice) {
        return {
          success: false,
          error: `Claude found nothing in the ${column} column that leads to "${partQuery}".`,
          reasoning: decision.reasoning,
          path,
        };
      }

      const clicked = await clickOption(page, decision.choice);
      if (!clicked) {
        return {
          success: false,
          error: `Could not click "${decision.choice}" in the ${column} column.`,
          path,
        };
      }

      path.push({ column, chose: decision.choice, confidence: decision.confidence, why: decision.reasoning });
      console.log(`${column}: ${decision.choice} (${decision.confidence})`);
    }

    const parts = await readAssemblyParts(page);
    if (parts.length === 0) {
      return { success: false, error: "Reached an assembly with no readable parts.", path };
    }
    console.log(`assembly holds ${parts.length} parts`);

    const decision = await choosePart(partQuery, parts);
    if (!decision.partNo) {
      return {
        success: false,
        error: `None of the ${parts.length} parts in this assembly is a "${partQuery}".`,
        reasoning: decision.reasoning,
        path,
        partsSeen: parts,
      };
    }

    const chosen = parts.find((part) => part.partNo === decision.partNo);
    return {
      success: true,
      oeNumber: decision.partNo,
      part: chosen ?? { partNo: decision.partNo },
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      alternatives: parts.filter((part) => decision.alternativePartNos.includes(part.partNo)),
      path,
    };
  } catch (err) {
    console.error("Lookup failed:", err.message);
    await page.screenshot({ path: "debug-failure.png", fullPage: true }).catch(() => {});
    // Errors raised deliberately (a bad API key, a missing option) already
    // say what to do; only browser-level failures need the screenshot.
    return { success: false, error: err.message || "Lookup failed — see debug-failure.png.", path };
  } finally {
    await browser.close();
  }
}

module.exports = { findPart };

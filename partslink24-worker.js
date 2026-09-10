/**
 * Partslink24 OE part number lookup worker (browser automation)
 *
 * Context: Partslink24 has no API. Per their written confirmation (Marc,
 * partslink24 support), automating lookups through the existing portal
 * login is permitted under our current license. This worker logs in,
 * searches by VIN, and extracts OE part number candidates for a
 * requested category.
 *
 * How the real site actually behaves (found by interactively inspecting
 * the live, logged-in portal):
 *   - Typing a category term (e.g. "front brake disc") into the parts
 *     search box returns a list of loosely word-matched parts, not one
 *     precise hit — e.g. searching "front brake disc" can return a
 *     "REAR BRAKE DISC PROTECTOR" as the top result.
 *   - Clicking into any result opens the full assembly diagram/category
 *     it belongs to (e.g. "Front Brakes Disc Caliper Friction Pad"),
 *     which lists every part in that assembly — this is where the
 *     correct part actually lives.
 *   - Within that assembly's list, some rows are the genuine OE part
 *     and others are alternate-brand duplicates explicitly suffixed
 *     "(Eurorepar)" in their description.
 *   - There is no reliable per-row signal for "front" vs "rear" beyond
 *     the assembly category itself and the description text — so we
 *     never guess a single winner when more than one non-Eurorepar row
 *     matches the requested part keyword. We return every candidate and
 *     let a human pick, since only someone with the vehicle/engine in
 *     front of them can safely resolve remaining ambiguity.
 *
 * Uses Playwright: npm install playwright
 */

const { chromium } = require("playwright");

const PARTSLINK_COMPANY_ID = process.env.PARTSLINK_COMPANY_ID;
const PARTSLINK_USERNAME = process.env.PARTSLINK_USERNAME;
const PARTSLINK_PASSWORD = process.env.PARTSLINK_PASSWORD;
const PARTSLINK_LOGIN_URL = "https://www.partslink24.com/en/index.html";

// Simple in-process delay so we're not hammering their servers between calls.
const MIN_DELAY_MS = 3000;
let lastRequestAt = 0;

async function politeDelay() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_DELAY_MS) {
    await new Promise((r) => setTimeout(r, MIN_DELAY_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

/**
 * page.fill() sets a field's value directly and fires one bulk input/
 * change event — it skips the real per-character key events an actual
 * person typing produces. Confirmed live: the VIN field (and, it turned
 * out, other fields) behaved differently for fill()'d automation vs.
 * manually-typed input in the exact same browser. Use this everywhere
 * text needs to go into the real site instead of page.fill().
 */
async function typeRealistically(page, selector, text) {
  const locator = page.locator(selector);
  await locator.click();
  await locator.pressSequentially(text, { delay: 50 });
}

/**
 * One entry per internal category key. `searchTerms` are tried in turn
 * against the parts search box. `resultKeyword` is used to pick which
 * search-result row to click into (opening its assembly category) — it
 * should be a word that's reliably in the right assembly's results but
 * not in unrelated ones (e.g. "front"). `descriptionInclude` /
 * `descriptionExclude` filter the assembly's row descriptions down to
 * the specific part we want (e.g. "disc" but not "caliper"/"pad"/"hose").
 *
 * Only front_brake_disc has been verified against the real site so far.
 * Start small and grow this from real staff use: whenever a lookup
 * needs more than one candidate resolved by hand, or fails outright,
 * that's a signal to inspect the real result/assembly pages for that
 * category (same process used for front_brake_disc) and refine its entry.
 */
const CATEGORY_SYNONYMS = {
  front_brake_disc: {
    searchTerms: ["front brake disc", "brake disc front", "front disc"],
    resultKeyword: "front",
    descriptionInclude: ["disc"],
    descriptionExclude: ["caliper", "pad", "hose", "hub"],
  },
  window_regulator: {
    // REPLACE ME: not yet verified against the real site. Search for
    // one of these terms, inspect the real result list and the assembly
    // it opens (same process as front_brake_disc above), then fill in
    // resultKeyword / descriptionInclude / descriptionExclude for real.
    searchTerms: ["window regulator", "window lifter", "window winder"],
    resultKeyword: "",
    descriptionInclude: [],
    descriptionExclude: [],
  },
};

// Real selectors, found by inspecting the live portal.
//
// Login lands you on partslink24.com/portal-ui — a brand-selection
// dashboard, NOT a specific vehicle's catalog. Clicking a brand tile
// there opens that brand's own catalog page, which shows a "Demo"
// watermark and its own VIN box (placeholder "Direct entry" — a
// different element from the dashboard's "Chassis number" box, and the
// only one we actually need since we always select the brand first).
// Once a real VIN is searched there, the Demo watermark disappears and
// it becomes the real vehicle-specific catalog — that's where the
// "Search for parts" box below lives.
const VIN_INPUT_SELECTOR = 'input[placeholder="Direct entry"]';
const SEARCH_PARTS_INPUT_XPATH =
  "xpath=/html/body/div[1]/div/div[3]/header/div/div/div/div[1]/div/div[2]/div/div/div/input";

/**
 * Search the category term and click into the result matching
 * `resultKeyword`, landing on that part's full assembly diagram/table.
 * Returns true if a matching result was found and clicked, false if the
 * search returned nothing usable for this term.
 */
async function openAssemblyForTerm(page, searchTerm, resultKeyword) {
  await typeRealistically(page, SEARCH_PARTS_INPUT_XPATH, searchTerm);
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle");

  if (!resultKeyword) {
    throw new Error("No resultKeyword configured for this category — cannot pick a result to open.");
  }

  // Click a result whose visible text contains the keyword (e.g. "front").
  // NOTE: this is the least-validated selector in this file — it matches
  // by page text rather than a stable attribute, since the plain
  // search-results list didn't expose a clean data-testid the way the
  // assembly table did (see below). If lookups start opening the wrong
  // assembly, re-inspect the real result-list rows for a firmer selector.
  const result = page.getByText(new RegExp(resultKeyword, "i")).first();
  if ((await result.count()) === 0) {
    return false;
  }
  await result.click();
  await page.waitForLoadState("networkidle");
  return true;
}

/**
 * Scrape every row of the currently open assembly table and return the
 * ones matching descriptionInclude/descriptionExclude, excluding any
 * "(Eurorepar)" alternate-brand duplicates — we only want genuine OE
 * numbers. Uses the real data-testid attributes found on the live site.
 */
async function extractMatchingCandidates(page, descriptionInclude, descriptionExclude) {
  const rows = await page.locator('[data-testid="row"]').all();
  const candidates = [];

  for (const row of rows) {
    const partNo = (await row.locator('[data-testid="partnoValue"]').textContent().catch(() => null))?.trim();
    const description = (await row.locator('[data-testid="descriptionValue"]').textContent().catch(() => null))?.trim();
    const restrictions = (await row.locator('[data-testid="restrictionValue"]').textContent().catch(() => null))?.trim();

    if (!partNo || !description) continue;

    const descLower = description.toLowerCase();
    const isOE = !descLower.includes("eurorepar");
    const matchesInclude =
      descriptionInclude.length === 0 || descriptionInclude.some((kw) => descLower.includes(kw.toLowerCase()));
    const matchesExclude = descriptionExclude.some((kw) => descLower.includes(kw.toLowerCase()));

    if (isOE && matchesInclude && !matchesExclude) {
      candidates.push({ partNo, description, restrictions: restrictions || null });
    }
  }

  return candidates;
}

/**
 * Look up OE part number candidates for a given VIN and category on
 * Partslink24, trying each known synonym term in turn until one opens an
 * assembly with usable matches.
 *
 * @param {string} vin
 * @param {string} make - vehicle make, e.g. "Peugeot" — used to pick the right brand catalog
 * @param {string} categoryKey - key into CATEGORY_SYNONYMS, e.g. "front_brake_disc"
 * @returns {Promise<{
 *   success: boolean,
 *   oeNumber?: string,
 *   candidates?: Array<{ partNo: string, description: string, restrictions: string|null }>,
 *   ambiguous?: boolean,
 *   matchedTerm?: string,
 *   triedTerms?: string[],
 *   error?: string,
 * }>}
 *   `success: true` with a single `oeNumber` means exactly one genuine OE
 *   match was found. If more than one non-Eurorepar candidate matches
 *   (e.g. different engine/trim variants), `success` is false and
 *   `ambiguous` is true — `candidates` lists all of them for a human to
 *   resolve using the vehicle/engine in front of them.
 */
async function lookupOePartNumber(vin, make, categoryKey) {
  if (!PARTSLINK_COMPANY_ID || !PARTSLINK_USERNAME || !PARTSLINK_PASSWORD) {
    throw new Error("Partslink24 credentials not configured");
  }

  const category = CATEGORY_SYNONYMS[categoryKey];
  if (!category || category.searchTerms.length === 0) {
    return {
      success: false,
      error: `No known search terms configured for category "${categoryKey}". Add some to CATEGORY_SYNONYMS.`,
    };
  }

  await politeDelay();

  const browser = await chromium.launch({ headless: false }); // TEMP: visible for selector discovery — revert to true when done
  // Playwright's default browser window is smaller than a typical desktop
  // window. The real site appends a "desktop=true" URL param once it's
  // decided it's looking at a real desktop browser, and the VIN field
  // stayed disabled specifically in Playwright's default-sized window —
  // set a realistic desktop viewport to match a normal browser window.
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const triedTerms = [];

  try {
    // --- LOGIN (once per session) ---
    await page.goto(PARTSLINK_LOGIN_URL, { waitUntil: "networkidle" });

    // Playwright launches a fresh browser profile every run, so the
    // Usercentrics cookie-consent overlay appears on every run too and
    // sits on top of the login form. Dismiss it before touching the form.
    // If it doesn't appear (e.g. consent already granted in this context),
    // this just times out quickly and we move on.
    //
    // This banner is very likely rendered inside a shadow DOM (typical
    // for Usercentrics), which a plain XPath cannot see into no matter
    // how long you wait — that's why an XPath-based click on it never
    // worked here even with a generous timeout. Playwright's role/text
    // locators pierce shadow roots automatically, so use one of those
    // instead of XPath for this specific element.
    await page
      .getByRole("button", { name: "Accept All", exact: true })
      .click({ timeout: 15000 })
      .catch(() => {});

    // Real selectors, found by inspecting the live login form (a custom
    // <pl24-login-ui> element with three fields: Company ID, User name,
    // Password). These are absolute XPaths, so they'll break if
    // partslink24 changes the page's DOM structure — if login starts
    // failing here again, re-inspect and update these.
    const LOGIN_COMPANY_ID_XPATH =
      "xpath=/html/body/div[1]/main/div/section[1]/div[2]/div/pl24-login-ui/div/form/div[1]/div/input";
    const LOGIN_USERNAME_XPATH =
      "xpath=/html/body/div[1]/main/div/section[1]/div[2]/div/pl24-login-ui/div/form/div[2]/div/input";
    const LOGIN_PASSWORD_XPATH =
      "xpath=/html/body/div[1]/main/div/section[1]/div[2]/div/pl24-login-ui/div/form/div[3]/div/input";
    const LOGIN_SUBMIT_XPATH =
      "xpath=/html/body/div[1]/main/div/section[1]/div[2]/div/pl24-login-ui/div/form/button[2]";

    await typeRealistically(page, LOGIN_COMPANY_ID_XPATH, PARTSLINK_COMPANY_ID);
    await typeRealistically(page, LOGIN_USERNAME_XPATH, PARTSLINK_USERNAME);
    await typeRealistically(page, LOGIN_PASSWORD_XPATH, PARTSLINK_PASSWORD);
    await page.click(LOGIN_SUBMIT_XPATH);
    await page.waitForLoadState("networkidle");

    // Login is a two-step flow: submitting credentials reveals a second
    // confirmation button ("end current session and log in again?") that
    // must also be clicked to complete login.
    const LOGIN_CONFIRM_XPATH =
      "xpath=/html/body/div[1]/main/div/section[1]/div[2]/div/pl24-login-ui/div/div/div/button[2]";
    await page.click(LOGIN_CONFIRM_XPATH);
    await page.waitForLoadState("networkidle");

    console.log(`[debug] URL right after login+confirm: ${page.url()}`);

    // --- OPEN THE VEHICLE'S BRAND CATALOG ---
    // Neither a direct page.goto() to a brand URL nor trusting login's
    // own redirect reliably reaches the real (non-Demo) catalog — both
    // were confirmed live to land on a broken, permanently-disabled
    // Demo version. The one flow confirmed to work is: land on the real
    // portal-ui dashboard, then click the brand tile from within that
    // already-loaded page (an in-app navigation), same as manual use.
    // Force navigation to the dashboard and verify we actually land
    // there — if login bounces us back to the login page instead, that
    // itself is useful diagnostic information.
    await page.goto("https://www.partslink24.com/portal-ui", { waitUntil: "networkidle" });
    console.log(`[debug] URL after navigating to portal-ui: ${page.url()}`);
    if (!page.url().includes("/portal-ui")) {
      throw new Error(`Expected to land on portal-ui but got redirected to: ${page.url()}`);
    }

    const brandNamePattern = new RegExp(make, "i");
    let brandTile = page.getByRole("img", { name: brandNamePattern }).first();
    if ((await brandTile.count()) === 0) {
      brandTile = page.getByText(brandNamePattern, { exact: false }).first();
    }
    if ((await brandTile.count()) === 0) {
      throw new Error(`Could not find a brand catalog tile matching "${make}" on the portal-ui dashboard.`);
    }
    await brandTile.click();
    await page.waitForLoadState("networkidle");
    console.log(`[debug] URL after clicking the ${make} brand tile: ${page.url()}`);

    // --- SEARCH THE VIN (once per session) ---
    await typeRealistically(page, VIN_INPUT_SELECTOR, vin);
    await page.keyboard.press("Enter");
    await page.waitForLoadState("networkidle");

    // --- TRY EACH SYNONYM TERM IN TURN ---
    for (const term of category.searchTerms) {
      triedTerms.push(term);
      await politeDelay(); // be polite between attempts too, not just between calls

      const opened = await openAssemblyForTerm(page, term, category.resultKeyword).catch((err) => {
        console.error(`Partslink24 search failed for term "${term}":`, err);
        return false;
      });
      if (!opened) continue;

      const candidates = await extractMatchingCandidates(
        page,
        category.descriptionInclude,
        category.descriptionExclude,
      );

      if (candidates.length === 1) {
        if (triedTerms.length > 1) {
          // Worth logging: this term wasn't first in the list but worked.
          // A real system should feed this back into CATEGORY_SYNONYMS
          // ordering, or at minimum flag it for review.
          console.log(`Note: "${term}" matched on attempt ${triedTerms.length} for category "${categoryKey}" — consider promoting it in the synonym list.`);
        }
        return {
          success: true,
          oeNumber: candidates[0].partNo,
          matchedTerm: term,
          candidates,
          triedTerms,
        };
      }

      if (candidates.length > 1) {
        return {
          success: false,
          ambiguous: true,
          error: `Found ${candidates.length} possible OE numbers for category "${categoryKey}" — needs human review to pick the right one for this vehicle.`,
          matchedTerm: term,
          candidates,
          triedTerms,
        };
      }
      // candidates.length === 0: fall through and try the next term.
    }

    return {
      success: false,
      error: `No OE part found on Partslink24 after trying: ${triedTerms.join(", ")}`,
      triedTerms,
    };
  } catch (err) {
    console.error("Partslink24 lookup failed:", err);
    return {
      success: false,
      error: "Partslink24 lookup failed — see server logs for details.",
      triedTerms,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { lookupOePartNumber, CATEGORY_SYNONYMS };

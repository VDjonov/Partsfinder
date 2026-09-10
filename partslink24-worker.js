/**
 * Partslink24 OE part number lookup worker — SKELETON (browser automation)
 *
 * Context: Partslink24 has no API. Per their written confirmation (Marc,
 * partslink24 support), automating lookups through the existing portal
 * login is permitted under our current license. This worker logs in,
 * searches by VIN, and extracts the OE part number for a requested
 * position/category.
 *
 * IMPORTANT: the login selectors are now real (found by inspecting the
 * live portal). The VIN search box, category search box, and OE-number
 * result selectors below are still PLACEHOLDERS — every spot marked
 * "REPLACE ME" needs the real selector from the logged-in vehicle/search
 * view. This is easiest done interactively with Claude Code while
 * watching the live site.
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
 * Synonym table: one canonical internal category maps to several terms
 * that might actually appear in Partslink24's own manufacturer-specific
 * navigation/search (this is the same "window lifter" vs "window
 * regulator" problem discussed for the counter tool — different brands,
 * different names for the same part).
 *
 * Start small and grow this from real staff use: whenever a lookup only
 * succeeds on the 2nd or 3rd term, that's a signal to log and expand
 * this table so future lookups for that category succeed on the first try.
 */
const CATEGORY_SYNONYMS = {
  window_regulator: ["window regulator", "window lifter", "window winder"],
  front_brake_disc: ["front brake disc", "brake disc front", "front disc"],
  // REPLACE ME: extend as real terminology gaps are discovered
};

/**
 * Try a single search term against the already-logged-in Partslink24 page
 * and return the OE number if found, or null if this term didn't match.
 */
async function trySearchTerm(page, vin, searchTerm) {
  // REPLACE ME: real selector for the chassis/VIN search box
  await page.fill('input[placeholder="Chassis number"] /* REPLACE ME */', vin);
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle");

  // REPLACE ME: real selector for the part/category search box within the vehicle view
  const categorySearchBox = page.locator('input[name="categorySearch"] /* REPLACE ME */');
  await categorySearchBox.fill(searchTerm);
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle");

  // REPLACE ME: real selector for wherever the OE part number is displayed
  const oeNumberLocator = page.locator('.part-number /* REPLACE ME */').first();
  const oeNumber = await oeNumberLocator.textContent({ timeout: 5000 }).catch(() => null);

  return oeNumber ? oeNumber.trim() : null;
}

/**
 * Look up the OE part number for a given VIN and part category on Partslink24,
 * trying each known synonym term in turn until one returns a result.
 *
 * @param {string} vin
 * @param {string} categoryKey - key into CATEGORY_SYNONYMS, e.g. "window_regulator"
 * @returns {Promise<{ success: boolean, oeNumber?: string, matchedTerm?: string, triedTerms?: string[], error?: string }>}
 */
async function lookupOePartNumber(vin, categoryKey) {
  if (!PARTSLINK_COMPANY_ID || !PARTSLINK_USERNAME || !PARTSLINK_PASSWORD) {
    throw new Error("Partslink24 credentials not configured");
  }

  const searchTerms = CATEGORY_SYNONYMS[categoryKey];
  if (!searchTerms || searchTerms.length === 0) {
    return {
      success: false,
      error: `No known search terms configured for category "${categoryKey}". Add some to CATEGORY_SYNONYMS.`,
    };
  }

  await politeDelay();

  const browser = await chromium.launch({ headless: false }); // TEMP: visible for selector discovery — revert to true when done
  const page = await browser.newPage();
  const triedTerms = [];

  try {
    // --- LOGIN (once per session) ---
    await page.goto(PARTSLINK_LOGIN_URL, { waitUntil: "networkidle" });

    // Playwright launches a fresh browser profile every run, so the
    // Usercentrics cookie-consent overlay appears on every run too and
    // sits on top of the login form. Dismiss it before touching the form.
    // If it doesn't appear (e.g. consent already granted in this context),
    // this just times out quickly and we move on.
    const CONSENT_ACCEPT_ALL_XPATH =
      "xpath=/html/body/div[2]//div/div/div[2]/div/div[2]/div/div[2]/div/div/div[2]/div/button[3]";
    await page
      .click(CONSENT_ACCEPT_ALL_XPATH, { timeout: 5000 })
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

    await page.fill(LOGIN_COMPANY_ID_XPATH, PARTSLINK_COMPANY_ID);
    await page.fill(LOGIN_USERNAME_XPATH, PARTSLINK_USERNAME);
    await page.fill(LOGIN_PASSWORD_XPATH, PARTSLINK_PASSWORD);
    await page.click(LOGIN_SUBMIT_XPATH);
    await page.waitForLoadState("networkidle");

    // --- TRY EACH SYNONYM TERM IN TURN ---
    for (const term of searchTerms) {
      triedTerms.push(term);
      await politeDelay(); // be polite between attempts too, not just between calls

      const oeNumber = await trySearchTerm(page, vin, term).catch((err) => {
        console.error(`Partslink24 search failed for term "${term}":`, err);
        return null;
      });

      if (oeNumber) {
        if (triedTerms.length > 1) {
          // Worth logging: this term wasn't first in the list but worked.
          // A real system should feed this back into CATEGORY_SYNONYMS
          // ordering, or at minimum flag it for review.
          console.log(`Note: "${term}" matched on attempt ${triedTerms.length} for category "${categoryKey}" — consider promoting it in the synonym list.`);
        }
        return {
          success: true,
          oeNumber,
          matchedTerm: term,
          triedTerms,
        };
      }
    }

    return {
      success: false,
      error: `No match found on Partslink24 after trying: ${triedTerms.join(", ")}`,
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

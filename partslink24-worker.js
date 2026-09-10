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
 *   - Login lands on the portal-ui dashboard; clicking a brand tile from
 *     there opens that brand's catalog at a plain URL. Reaching a brand
 *     catalog any other way (login's own redirect, or a direct goto to a
 *     brand URL) lands on a "Demo" variant whose VIN field is
 *     permanently disabled.
 *   - The free-text parts search word-matches too loosely to be usable:
 *     searching "front brake disc" returns a rear disc protector, brake
 *     hoses and wheel hubs, but no front brake disc at all. So we ignore
 *     it and walk the catalog's own category tree instead
 *     (Scope > Main group > assembly), which is deterministic.
 *   - Within an assembly's parts list, some rows are the genuine OE part
 *     and others are alternate-brand duplicates explicitly suffixed
 *     "(Eurorepar)" in their description.
 *   - There is no reliable per-row signal for "front" vs "rear" beyond
 *     the assembly itself and the description text — so we never guess a
 *     single winner when more than one non-Eurorepar row matches. We
 *     return every candidate and let a human pick, since only someone
 *     with the vehicle/engine in front of them can safely resolve
 *     remaining ambiguity.
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
 * One entry per internal category key, describing how to navigate the
 * catalog's own category tree to the assembly containing that part.
 *
 * The free-text "Search for parts" box is deliberately NOT used: it
 * word-matches loosely, and confirmed live, searching "front brake disc"
 * returns a rear disc protector, brake hoses and wheel hubs — but no
 * front brake disc at all. The category tree (Scope → Main group →
 * assembly) reaches the right parts deterministically instead.
 *
 * `scope` / `mainGroup` / `assembly` are the three clicks, matched by
 * their visible labels. `descriptionInclude` / `descriptionExclude` then
 * filter that assembly's rows down to the specific part.
 *
 * Only front_brake_disc has been verified against the real site so far.
 * Start small and grow this from real staff use: whenever a lookup fails
 * or needs a candidate resolved by hand, that's a signal to walk the
 * real category tree for it (same process used for front_brake_disc).
 */
const PART_CATEGORIES = {
  front_brake_disc: {
    scope: "Mechanical",
    mainGroup: "Braking",
    // Must match the clickable row's full description ("FRONT BRAKES
    // DISC CALIPER FRICTION PAD"), not the grey "Front brakes" section
    // heading above it — that heading isn't clickable, so a looser
    // pattern matches it first and navigates nowhere.
    assembly: /front brakes disc caliper/i,
    // Note "DISKS", not "discs" — the real catalog spells it with a K
    // ("2 FRONT DISKS KIT, VENTILATED"). Match both spellings.
    descriptionInclude: ["disk", "disc"],
    descriptionExclude: ["caliper", "pad", "hose", "hub", "protector"],
  },
  window_regulator: {
    // REPLACE ME: not yet verified against the real site. Walk the
    // category tree to this part manually, note the three labels, then
    // fill them in here (same process as front_brake_disc above).
    scope: "",
    mainGroup: "",
    assembly: null,
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

/**
 * Walk the catalog's category tree (Scope → Main group → assembly) to
 * the assembly holding the requested part, e.g.
 * Mechanical → Braking → "FRONT BRAKES DISC CALIPER FRICTION PAD".
 * Each step is a click on a visibly-labelled row in the next column.
 */
async function clickCategoryItem(page, label) {
  const target =
    typeof label === "string"
      ? page.getByText(label, { exact: true }).first()
      : page.getByText(label).first();

  await target.waitFor({ state: "visible", timeout: 15000 });
  try {
    await target.click({ timeout: 5000 });
  } catch {
    // The label text sits in a <span> that a transparent sibling div
    // covers, so a real mouse click never reaches it. Dispatch the click
    // straight at the element instead — it still bubbles to whatever
    // ancestor holds the handler.
    await target.dispatchEvent("click");
  }
  await page.waitForLoadState("networkidle");
}

async function openAssembly(page, category) {
  if (!category.scope || !category.mainGroup || !category.assembly) {
    throw new Error("This category has no verified category-tree path configured yet.");
  }

  // A modal's backdrop can sit over the category columns and swallow
  // clicks — give it a chance to clear before reaching for the tree.
  await page
    .locator(".MuiBackdrop-root")
    .last()
    .waitFor({ state: "hidden", timeout: 15000 })
    .catch(() => {});

  await clickCategoryItem(page, category.scope);
  console.log(`[debug] clicked scope "${category.scope}"`);

  await clickCategoryItem(page, category.mainGroup);
  console.log(`[debug] clicked main group "${category.mainGroup}"`);

  await clickCategoryItem(page, category.assembly);
  console.log(`[debug] clicked assembly matching ${category.assembly}`);
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

  // Short timeouts: a row is already rendered by the time we get here,
  // so a missing field means it isn't there at all. Waiting the default
  // 30s per field would stall for minutes on a table of the wrong shape.
  const readField = async (row, testId) =>
    (await row.locator(`[data-testid="${testId}"]`).textContent({ timeout: 2000 }).catch(() => null))?.trim();

  for (const row of rows) {
    const partNo = await readField(row, "partnoValue");
    const description = await readField(row, "descriptionValue");
    const restrictions = await readField(row, "restrictionValue");

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
 * Partslink24 by walking the catalog's own category tree to the relevant
 * assembly and reading its parts table.
 *
 * @param {string} vin
 * @param {string} make - vehicle make, e.g. "Peugeot" — used to pick the right brand catalog
 * @param {string} categoryKey - key into PART_CATEGORIES, e.g. "front_brake_disc"
 * @returns {Promise<{
 *   success: boolean,
 *   oeNumber?: string,
 *   candidates?: Array<{ partNo: string, description: string, restrictions: string|null }>,
 *   ambiguous?: boolean,
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

  const category = PART_CATEGORIES[categoryKey];
  if (!category) {
    return {
      success: false,
      error: `Unknown category "${categoryKey}". Add it to PART_CATEGORIES.`,
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

    await typeRealistically(page, LOGIN_COMPANY_ID_XPATH, PARTSLINK_COMPANY_ID);
    await typeRealistically(page, LOGIN_USERNAME_XPATH, PARTSLINK_USERNAME);
    await typeRealistically(page, LOGIN_PASSWORD_XPATH, PARTSLINK_PASSWORD);

    // Match the buttons by their labels rather than by position in the
    // DOM. An absolute XPath ending in button[2] ("the second button in
    // the form") silently resolves to the wrong element whenever the
    // form's layout shifts, which is what left credentials filled but
    // never submitted.
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.waitForLoadState("networkidle");

    // Submitting credentials sometimes reveals a second confirmation
    // dialog ("end current session and log in again?") that must be
    // clicked to complete login — but only when a conflicting session
    // actually exists server-side. Only click it if it's really there.
    // Note: isVisible() must NOT be used to detect it — that call returns
    // the current state immediately without waiting, so it reports false
    // for a dialog that renders a moment later and the click gets
    // skipped. click() auto-waits, so it clicks the dialog when present
    // and simply times out harmlessly when there isn't one.
    await page
      .getByRole("button", { name: "Confirm", exact: true })
      .click({ timeout: 10000 })
      .catch(() => {});
    await page.waitForLoadState("networkidle");

    // Login redirects asynchronously after the above — don't just trust
    // that no click errored, actually wait until we've left the login
    // page before treating login as complete.
    await page.waitForFunction(() => !location.pathname.endsWith("/en/index.html"), null, { timeout: 15000 });

    console.log(`[debug] URL right after login: ${page.url()}`);

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

    // --- WALK THE CATEGORY TREE TO THE RIGHT ASSEMBLY ---
    await openAssembly(page, category);

    const candidates = await extractMatchingCandidates(
      page,
      category.descriptionInclude,
      category.descriptionExclude,
    );

    if (candidates.length === 1) {
      return { success: true, oeNumber: candidates[0].partNo, candidates };
    }

    if (candidates.length > 1) {
      return {
        success: false,
        ambiguous: true,
        error: `Found ${candidates.length} possible OE numbers for category "${categoryKey}" — needs human review to pick the right one for this vehicle.`,
        candidates,
      };
    }

    return {
      success: false,
      error: `No OE part matched in the "${category.scope} > ${category.mainGroup}" assembly for category "${categoryKey}".`,
    };
  } catch (err) {
    console.error("Partslink24 lookup failed:", err);
    // Capture what the page actually looked like — far more useful for
    // diagnosing a failed step than the error text alone.
    await page.screenshot({ path: "debug-failure.png", fullPage: true }).catch(() => {});
    console.error("Saved a screenshot of the failing page to debug-failure.png");
    return {
      success: false,
      error: "Partslink24 lookup failed — see server logs and debug-failure.png for details.",
    };
  } finally {
    await browser.close();
  }
}

module.exports = { lookupOePartNumber, PART_CATEGORIES };

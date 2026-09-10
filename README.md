# Partslink24 OE part number test tool

Standalone tool to test looking up an OE part number from Partslink24,
given a Motorcheck-format vehicle data dump.

## Setup (run this on your own machine, not in a sandbox)

1. Install dependencies:
   npm install

2. Install the headless browser Playwright needs:
   npx playwright install chromium

3. `front_brake_disc` selectors are filled in and verified against the
   real, logged-in Partslink24 portal. Any other category key you add to
   CATEGORY_SYNONYMS in `partslink24-worker.js` needs the same treatment:
   log in yourself, search that category, inspect the result list and
   the assembly page it opens, and fill in `resultKeyword` /
   `descriptionInclude` / `descriptionExclude` for it (see the comments
   above CATEGORY_SYNONYMS).

4. Set your credentials as environment variables (the portal login form
   has three fields — Company ID / partslink24 ID, User name, Password):
   export PARTSLINK_COMPANY_ID="your-company-id"
   export PARTSLINK_USERNAME="your-username"
   export PARTSLINK_PASSWORD="your-password"

## Running a test lookup

   node find-oe-part.js sample-vehicle.txt front_brake_disc

This will:
- Parse the vehicle data in sample-vehicle.txt (already includes the
  Peugeot 5008 / VIN VF30E9HZHAS110949 example)
- Extract the VIN
- Log into Partslink24, search that VIN, then search for a front brake
  disc, trying each synonym term in CATEGORY_SYNONYMS until one opens
  an assembly with a usable match
- Print the result as JSON

The result is one of:
- `{ success: true, oeNumber, candidates, matchedTerm, triedTerms }` —
  exactly one genuine OE part matched.
- `{ success: false, ambiguous: true, candidates, ... }` — more than one
  non-alternate-brand part matched (e.g. different engine/trim variants
  of the same position). Only a human with the actual vehicle/engine in
  front of them can safely pick the right one from `candidates` — the
  tool never guesses in this case.
- `{ success: false, error, triedTerms }` — no match found for any
  synonym term.

## Adding your own vehicle

Paste a new Motorcheck-format dump into a text file (same format as
sample-vehicle.txt) and pass that filename instead.

## Adding more part categories

Edit CATEGORY_SYNONYMS in partslink24-worker.js — add a new key with
`searchTerms`, then verify `resultKeyword`, `descriptionInclude`, and
`descriptionExclude` against the real site the same way front_brake_disc
was (search the term, inspect the result list, inspect the assembly it
opens).

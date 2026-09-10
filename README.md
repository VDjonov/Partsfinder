# Partslink24 OE part number test tool

Standalone tool to test looking up an OE part number from Partslink24,
given a Motorcheck-format vehicle data dump.

## Setup (run this on your own machine, not in a sandbox)

1. Install dependencies:
   npm install

2. Install the headless browser Playwright needs:
   npx playwright install chromium

3. Fill in the real CSS selectors in `partslink24-worker.js`.
   Every spot marked `/* REPLACE ME */` needs the actual selector from
   the real, logged-in Partslink24 portal — log in yourself, right-click
   the login fields / search box / results area, and "Inspect Element"
   to find the real ones.

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
- Log into Partslink24 and search for a front brake disc OE number,
  trying each synonym term in CATEGORY_SYNONYMS until one matches
- Print the result as JSON

## Adding your own vehicle

Paste a new Motorcheck-format dump into a text file (same format as
sample-vehicle.txt) and pass that filename instead.

## Adding more part categories

Edit CATEGORY_SYNONYMS in partslink24-worker.js — add a new key and
a list of likely search terms for that part type.

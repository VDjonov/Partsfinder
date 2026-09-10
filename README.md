# Partslink24 OE part number test tool

Standalone tool to test looking up an OE part number from Partslink24,
given a Motorcheck-format vehicle data dump.

## Setup (run this on your own machine, not in a sandbox)

1. Install dependencies:
   npm install

2. Install the headless browser Playwright needs:
   npx playwright install chromium

3. Set your credentials as environment variables (the portal login form
   has three fields — Company ID / partslink24 ID, User name, Password).

   macOS/Linux:
   export PARTSLINK_COMPANY_ID="your-company-id"
   export PARTSLINK_USERNAME="your-username"
   export PARTSLINK_PASSWORD="your-password"

   Windows PowerShell (per terminal session):
   $env:PARTSLINK_COMPANY_ID="your-company-id"
   $env:PARTSLINK_USERNAME="your-username"
   $env:PARTSLINK_PASSWORD="your-password"

`front_brake_disc` is filled in and verified against the real,
logged-in portal. Any other category you add needs the same treatment —
see "Adding more part categories" below.

## Running a test lookup

   node find-oe-part.js sample-vehicle.txt front_brake_disc

This will:
- Parse the vehicle data in sample-vehicle.txt (already includes the
  Peugeot 5008 / VIN VF30E9HZHAS110949 example)
- Extract the VIN and make
- Log into Partslink24, open that make's catalog from the dashboard,
  search the VIN, then walk the catalog's category tree to the relevant
  assembly (e.g. Mechanical > Braking > Front brakes) and read its parts
- Print the result as JSON

The result is one of:
- `{ success: true, oeNumber, candidates }` — exactly one genuine OE part
  matched.
- `{ success: false, ambiguous: true, candidates, ... }` — more than one
  non-alternate-brand part matched (e.g. different engine/trim variants
  of the same position). Only a human with the actual vehicle/engine in
  front of them can safely pick the right one from `candidates` — the
  tool never guesses in this case.
- `{ success: false, error }` — nothing matched in that assembly.

A verified example — `node find-oe-part.js sample-vehicle.txt front_brake_disc`
returns:

    {
      "success": true,
      "oeNumber": "4249 17",
      "candidates": [
        {
          "partNo": "4249 17",
          "description": "2 FRONT DISKS KIT, VENTILATED",
          "remark": "DIAM 283 EP 26",
          "restrictions": null
        }
      ]
    }

Note the tool deliberately ignores the site's own free-text parts search:
it word-matches too loosely to trust (searching "front brake disc"
returns a rear disc protector, brake hoses and wheel hubs, but no front
brake disc).

## Debugging a failed run

The browser runs headless. To watch a run, flip `headless` to `false` in
`partslink24-worker.js`. On any failure the worker also writes
`debug-failure.png`, a screenshot of the page at the moment it gave up,
which is usually enough to see what went wrong.

## Adding your own vehicle

Paste a new Motorcheck-format dump into a text file (same format as
sample-vehicle.txt) and pass that filename instead.

## Adding more part categories

Edit PART_CATEGORIES in partslink24-worker.js. Walk the catalog to that
part manually first, noting the three labels you clicked (`scope`,
`mainGroup`, `assembly` — e.g. Mechanical / Braking / "FRONT BRAKES DISC
CALIPER FRICTION PAD"), then set `descriptionInclude` and
`descriptionExclude` to isolate the specific part within that assembly's
rows. Watch the catalog's own spelling — it writes "DISKS", not "discs".

# Partslink24 OE part number finder

Look up an OE part number from Partslink24 by VIN, describing the part in
plain words. Built for a parts counter: type "egr valve" or "front brake
disc", get the number.

## Setup (run this on your own machine, not in a sandbox)

1. Install dependencies:
   npm install
   npx playwright install chromium

2. Set your credentials. The Partslink24 login has three fields (Company
   ID / partslink24 ID, User name, Password), and the AI lookup needs an
   Anthropic API key.

   Windows PowerShell (per terminal session):
   $env:PARTSLINK_COMPANY_ID="your-company-id"
   $env:PARTSLINK_USERNAME="your-username"
   $env:PARTSLINK_PASSWORD="your-password"
   $env:ANTHROPIC_API_KEY="sk-ant-..."

   macOS/Linux:
   export PARTSLINK_COMPANY_ID="your-company-id"
   export PARTSLINK_USERNAME="your-username"
   export PARTSLINK_PASSWORD="your-password"
   export ANTHROPIC_API_KEY="sk-ant-..."

## The search bar

    npm start

Then open http://localhost:3000. Paste a vehicle dump, type what you're
after, get the number back — along with the path it took through the
catalog, so you can check its working.

## Command line

    node ask.js sample-vehicle.txt "egr valve"
    node ask.js sample-vehicle.txt "front brake disc"

Same thing without the browser UI.

## How it works, and why

Getting to a part means logging in, opening the right brand's catalog,
entering the VIN, and walking a category tree. The navigation is
scripted — it's the same every time, so there's no reason to pay a model
to do it. The *decisions* are Claude's: which scope, which main group,
which assembly, and which row is the part rather than a neighbouring one.

Two approaches were tried first and rejected, both worth knowing about
before changing anything:

**The catalog's own parts search word-matches, and can't be trusted.**
Searching "front brake disc" on a Peugeot 5008 returns a rear disc
protector, brake hoses and wheel hubs — no front brake disc anywhere in
the results. Searching "egr valve" walks into MECHANICAL > ENGINE >
VALVES GUIDE ROCKER GEAR, the engine's valvetrain, which shares the word
"valve" and nothing else.

**Keyword rules per part don't scale and still get it wrong.** Every
manufacturer words and organises its catalog differently, so a rule set
that finds brakes on a Peugeot finds nothing on a BMW. Writing them by
hand means walking the tree for each part on each model — and whoever
does that walk already has the part number, so the tool has saved
nothing. It also can't tell an EGR valve from a poppet valve, which is
what sank it in testing.

Letting a model read the labels fixes both: catalog wording varies, and
judging wording is what models are good at. What you maintain is
nothing — no per-part, per-model or per-brand configuration.

## What it returns

A part number, its description and remark (e.g. "DIAM 283 EP 26" — the
disc diameter and thickness), a confidence level, the reasoning, and any
alternative versions of the same part. Where several parts genuinely fit
a position and only the engine variant in front of you decides between
them, it says so instead of guessing.

Treat anything below high confidence as needing a look. The reasoning
and the navigation trail are shown precisely so a wrong answer is
obvious rather than plausible.

## Adding your own vehicle

Paste a Motorcheck-format dump into a text file (same format as
sample-vehicle.txt) and pass that filename. The search bar also accepts a
pasted dump directly.

## Debugging a failed run

The browser runs headless. To watch it, flip `headless` to `false` in
`partslink24-worker.js`. On any failure a screenshot of the page is
written to `debug-failure.png`, which usually shows what went wrong.

Several selectors are absolute XPaths — the login fields especially — so
a Partslink24 front-end change can break them. The screenshot plus a
headed run is the fastest way to find which one.

## The other two lookups

`find-oe-part.js` and `find-part.js` are the earlier approaches, kept
because the first is fully verified and useful as a check:

    node find-oe-part.js sample-vehicle.txt front_brake_disc

walks a hardcoded category path (Mechanical > Braking > Front brakes) and
returns `4249 17` for the sample vehicle. It only knows the parts listed
in `PART_CATEGORIES`, but when it answers, it answers deterministically —
handy for confirming the catalog still behaves as expected after a
Partslink24 change.

`node test-vocabulary.js` checks the keyword rules in
`part-vocabulary.js` against real catalog descriptions. No browser or
credentials needed.

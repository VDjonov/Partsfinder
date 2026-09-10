#!/usr/bin/env node
/**
 * find-part.js — experimental CLI for the vocabulary-driven lookup.
 *
 * Usage:
 *   node find-part.js sample-vehicle.txt egr_valve
 *
 * Unlike find-oe-part.js, nothing here knows where the part lives in the
 * catalog — it's found by searching and reading assemblies. See
 * find-part-by-vocabulary.js.
 */

const fs = require("fs");
const { parseVehicleData } = require("./parse-vehicle");
const { PART_VOCABULARY } = require("./part-vocabulary");
const { findPart } = require("./find-part-by-vocabulary");

async function main() {
  const [, , filePath, partKey] = process.argv;

  if (!filePath || !partKey) {
    console.error("Usage: node find-part.js <vehicle-data-file> <part-key>");
    console.error(`Known part keys: ${Object.keys(PART_VOCABULARY).join(", ")}`);
    process.exit(1);
  }

  const vocabulary = PART_VOCABULARY[partKey];
  if (!vocabulary) {
    console.error(`Unknown part key "${partKey}".`);
    console.error(`Known part keys: ${Object.keys(PART_VOCABULARY).join(", ")}`);
    process.exit(1);
  }

  const vehicle = parseVehicleData(fs.readFileSync(filePath, "utf8"));

  if (!vehicle.chassis_no) {
    console.error("No chassis_no (VIN) found in the vehicle data — cannot proceed.");
    process.exit(1);
  }
  if (!vehicle.make) {
    console.error("No make found in the vehicle data — cannot proceed.");
    process.exit(1);
  }

  console.log(`Vehicle: ${vehicle.make} ${vehicle.model} (${vehicle.version})`);
  console.log(`VIN: ${vehicle.chassis_no}`);
  console.log(`Looking for: ${partKey}\n`);

  const result = await findPart(vehicle.chassis_no, vehicle.make, partKey, vocabulary);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

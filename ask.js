#!/usr/bin/env node
/**
 * ask.js — look up a part by describing it in plain words.
 *
 *   node ask.js sample-vehicle.txt "egr valve"
 *   node ask.js sample-vehicle.txt "front brake disc"
 *   node ask.js sample-vehicle.txt "drivers side window winder"
 *
 * Nothing is configured per part or per brand — the phrase is passed
 * straight through to Claude, which reads the catalog and decides.
 */

const fs = require("fs");
const { parseVehicleData } = require("./parse-vehicle");
const { findPart } = require("./find-part-ai");

async function main() {
  const [, , filePath, ...queryWords] = process.argv;
  const partQuery = queryWords.join(" ").trim();

  if (!filePath || !partQuery) {
    console.error('Usage: node ask.js <vehicle-data-file> "<what you are looking for>"');
    console.error('Example: node ask.js sample-vehicle.txt "egr valve"');
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
  console.log(`Looking for: ${partQuery}\n`);

  console.log(JSON.stringify(await findPart(vehicle.chassis_no, vehicle.make, partQuery), null, 2));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

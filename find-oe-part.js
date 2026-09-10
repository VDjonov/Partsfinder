#!/usr/bin/env node
/**
 * find-oe-part.js — standalone test CLI
 *
 * Usage:
 *   PARTSLINK_USERNAME=... PARTSLINK_PASSWORD=... \
 *     node find-oe-part.js sample-vehicle.txt front_brake_disc
 *
 * Reads a Motorcheck-format vehicle dump from a file, extracts the VIN,
 * and runs it through the Partslink24 lookup worker for the given category.
 *
 * NOTE: this only works once the CSS selectors in partslink24-worker.js
 * have been filled in against the real, logged-in portal — see the
 * "REPLACE ME" comments in that file.
 */

const fs = require("fs");
const { parseVehicleData } = require("./parse-vehicle");
const { lookupOePartNumber, PART_CATEGORIES } = require("./partslink24-worker");

async function main() {
  const [, , filePath, categoryKey] = process.argv;

  if (!filePath || !categoryKey) {
    console.error("Usage: node find-oe-part.js <vehicle-data-file> <category-key>");
    console.error(`Known category keys: ${Object.keys(PART_CATEGORIES).join(", ")}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const vehicle = parseVehicleData(raw);

  if (!vehicle.chassis_no) {
    console.error("No chassis_no (VIN) found in the vehicle data — cannot proceed.");
    process.exit(1);
  }
  if (!vehicle.make) {
    console.error("No make found in the vehicle data — cannot proceed (needed to pick the right Partslink24 brand catalog).");
    process.exit(1);
  }

  console.log(`Vehicle: ${vehicle.make} ${vehicle.model} (${vehicle.version})`);
  console.log(`VIN: ${vehicle.chassis_no}`);
  console.log(`TechDocCode: ${vehicle.TechDocCode || "(none)"}`);
  console.log(`Looking up category: ${categoryKey}\n`);

  const result = await lookupOePartNumber(vehicle.chassis_no, vehicle.make, categoryKey);

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

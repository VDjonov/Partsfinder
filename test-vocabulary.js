#!/usr/bin/env node
/**
 * Checks the part-matching rules against real descriptions taken from
 * the live catalog. No browser or credentials needed:
 *
 *   node test-vocabulary.js
 *
 * When adding a part to PART_VOCABULARY, add its real description here
 * plus the near-misses that share its assembly — those neighbours are
 * what the exclude list exists to reject, and they're the failure mode
 * that would hand someone the wrong part number.
 */

const { PART_VOCABULARY, matchesVocabulary } = require("./part-vocabulary");

// [description, part key, should it match?]
const CASES = [
  // Front brake disc — all seen in the Peugeot 5008 (T87) catalog.
  ["2 FRONT DISKS KIT, VENTILATED", "front_brake_disc", true],
  ["2 FRONT DISKS KIT, VENTILATED (Eurorepar)", "front_brake_disc", false],
  ["SET OF 4 FRONT BRAKE PADS", "front_brake_disc", false],
  ["REAR BRAKE DISC PROTECTOR", "front_brake_disc", false],
  ["WHEEL HUB DISC", "front_brake_disc", false],
  ["BRAKE HOSE FRONT", "front_brake_disc", false],
  ["STD EX BRAKE CALIPER CYLINDER", "front_brake_disc", false],
  // The assembly's own heading, which must not be read as a part.
  ["FRONT BRAKES DISC CALIPER FRICTION PAD", "front_brake_disc", false],
  ["REAR BRAKE DISC CALIPER FRICTION PAD", "rear_brake_disc", false],

  // EGR valve — spelling variants and the neighbours sharing its assembly.
  ["EXHAUST GAS RECIRCULATION VALVE", "egr_valve", true],
  ["E.G.R. VALVE", "egr_valve", true],
  ["EGR VALVE", "egr_valve", true],
  ["EGR COOLER", "egr_valve", false],
  ["EGR VALVE GASKET", "egr_valve", false],
  ["EXHAUST GAS RECIRCULATION PIPE", "egr_valve", false],
];

let failures = 0;
for (const [description, partKey, expected] of CASES) {
  const actual = matchesVocabulary(description, PART_VOCABULARY[partKey]);
  if (actual !== expected) {
    failures++;
    console.error(`FAIL  ${partKey}: expected ${expected} for ${JSON.stringify(description)}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} of ${CASES.length} cases failed`);
  process.exit(1);
}
console.log(`All ${CASES.length} cases pass`);

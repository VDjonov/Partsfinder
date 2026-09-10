/**
 * Parses the Motorcheck-style key\nvalue pasted text block into a
 * structured vehicle object.
 */
function parseVehicleData(raw) {
  const rawLines = raw.split("\n").map((l) => l.replace(/\r$/, "")); // strip CR only, keep tabs intact
  const data = {};

  for (const rawLine of rawLines) {
    if (rawLine.trim() === "") continue;

    if (rawLine.includes("\t")) {
      const tabIndex = rawLine.indexOf("\t");
      const key = rawLine.slice(0, tabIndex).trim();
      const value = rawLine.slice(tabIndex + 1).trim();
      if (key) data[key] = value; // value may legitimately be "" — that's fine
    } else {
      const key = rawLine.trim();
      if (!["vehicle", "technical"].includes(key.toLowerCase())) {
        // A key with no tab and no following value on the same line —
        // treat as present with an empty value rather than guessing.
        data[key] = data[key] ?? "";
      }
    }
  }
  return data;
}

module.exports = { parseVehicleData };

// --- self-test when run directly ---
if (require.main === module) {
  const fs = require("fs");
  const sample = fs.readFileSync(process.argv[2] || "/dev/stdin", "utf8");
  const parsed = parseVehicleData(sample);
  console.log(JSON.stringify(parsed, null, 2));
}

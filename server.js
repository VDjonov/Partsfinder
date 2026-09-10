#!/usr/bin/env node
/**
 * server.js — the search bar.
 *
 *   node server.js        then open http://localhost:3000
 *
 * Paste a VIN (or a whole Motorcheck dump), type what you're after in
 * plain words, get the OE number back with what the catalog was showing
 * when it decided. Deliberately dependency-free — Node's own http module
 * and one HTML page — so there's nothing to install or keep updated.
 */

const http = require("http");
const { parseVehicleData } = require("./parse-vehicle");
const { findPart } = require("./find-part-ai");

const PORT = process.env.PORT || 3000;

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Parts finder</title>
<style>
  :root { color-scheme: light; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; background: #f6f6f4; color: #1a1a1a; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-size: 20px; margin: 0 0 24px; }
  label { display: block; font-weight: 600; margin: 0 0 6px; font-size: 13px; }
  textarea, input {
    width: 100%; box-sizing: border-box; padding: 10px 12px; font: inherit;
    border: 1px solid #ccc; border-radius: 6px; background: #fff;
  }
  textarea { min-height: 90px; font-family: ui-monospace, monospace; font-size: 13px; resize: vertical; }
  .row { margin-bottom: 18px; }
  button {
    padding: 10px 20px; font: inherit; font-weight: 600; cursor: pointer;
    border: 0; border-radius: 6px; background: #f0c000; color: #1a1a1a;
  }
  button[disabled] { opacity: .55; cursor: default; }
  #out { margin-top: 28px; }
  .card { background: #fff; border: 1px solid #e2e2df; border-radius: 8px; padding: 18px; }
  .oe { font-size: 26px; font-weight: 700; font-family: ui-monospace, monospace; letter-spacing: .5px; }
  .desc { margin-top: 4px; }
  .muted { color: #666; font-size: 13px; }
  .warn { border-left: 3px solid #d08700; padding-left: 12px; }
  .err { border-left: 3px solid #c0392b; padding-left: 12px; }
  ul { margin: 8px 0 0; padding-left: 20px; }
  details { margin-top: 14px; }
  summary { cursor: pointer; font-size: 13px; color: #666; }
</style>
</head>
<body>
<main>
  <h1>Parts finder</h1>
  <form id="f">
    <div class="row">
      <label for="vehicle">Vehicle — a VIN, or paste a whole Motorcheck dump</label>
      <textarea id="vehicle" required placeholder="VF30E9HZHAS110949"></textarea>
    </div>
    <div class="row">
      <label for="q">What are you looking for?</label>
      <input id="q" required placeholder="egr valve" autocomplete="off">
    </div>
    <button id="go">Find part</button>
  </form>
  <div id="out"></div>
</main>
<script>
const form = document.getElementById('f');
const out = document.getElementById('out');
const go = document.getElementById('go');
const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

form.onsubmit = async (event) => {
  event.preventDefault();
  go.disabled = true;
  out.innerHTML = '<p class="muted">Opening the catalog… this takes about a minute.</p>';

  try {
    const res = await fetch('/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        vehicle: document.getElementById('vehicle').value,
        query: document.getElementById('q').value,
      }),
    });
    const data = await res.json();
    out.innerHTML = render(data);
  } catch (err) {
    out.innerHTML = '<div class="card err">' + esc(err.message) + '</div>';
  } finally {
    go.disabled = false;
  }
};

function render(data) {
  if (!data.success) {
    return '<div class="card err"><strong>Not found.</strong><p>' + esc(data.error) + '</p>'
      + (data.reasoning ? '<p class="muted">' + esc(data.reasoning) + '</p>' : '')
      + trail(data.path) + cost(data.cost) + '</div>';
  }

  const part = data.part || {};
  const lowConfidence = data.confidence !== 'high';
  return '<div class="card' + (lowConfidence ? ' warn' : '') + '">'
    + '<div class="oe">' + esc(data.oeNumber) + '</div>'
    + '<div class="desc">' + esc(part.description || '') + '</div>'
    + (part.remark ? '<div class="muted">' + esc(part.remark) + '</div>' : '')
    + (lowConfidence ? '<p class="muted"><strong>' + esc(data.confidence) + ' confidence</strong> — worth checking.</p>' : '')
    + (data.reasoning ? '<p class="muted">' + esc(data.reasoning) + '</p>' : '')
    + (data.alternatives && data.alternatives.length
        ? '<p class="muted">Other versions of this part:</p><ul>'
          + data.alternatives.map(a => '<li>' + esc(a.partNo) + ' — ' + esc(a.description) + '</li>').join('')
          + '</ul>'
        : '')
    + trail(data.path)
    + cost(data.cost)
    + '</div>';
}

function cost(c) {
  if (!c) return '';
  return '<p class="muted">Lookup cost $' + c.costUsd.toFixed(4) + '</p>';
}

function trail(path) {
  if (!path || !path.length) return '';
  return '<details><summary>How it got there</summary><ul>'
    + path.map(step => '<li>' + esc(step.column) + ': <strong>' + esc(step.chose) + '</strong>'
        + ' <span class="muted">' + esc(step.why) + '</span></li>').join('')
    + '</ul></details>';
}
</script>
</body>
</html>`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) reject(new Error("Request body too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(PAGE);
  }

  if (req.method === "POST" && req.url === "/lookup") {
    try {
      const { vehicle: vehicleText, query } = JSON.parse(await readBody(req));

      // Accept either a bare VIN or a full Motorcheck dump.
      const parsed = parseVehicleData(vehicleText || "");
      const vin = parsed.chassis_no || (vehicleText || "").trim();
      const make = parsed.make;

      if (!vin) throw new Error("No VIN found in what you pasted.");
      if (!make) throw new Error("No make found — paste the full vehicle dump, not just the VIN, so the right brand catalog can be opened.");
      if (!query || !query.trim()) throw new Error("Say what part you're looking for.");

      const result = await findPart(vin, make, query.trim());
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Parts finder running at http://localhost:${PORT}`);
});

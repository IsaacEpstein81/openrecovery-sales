import fs from "node:fs";

const SHEET_ID = process.env.SHEET_ID;
if (!SHEET_ID) throw new Error("Missing SHEET_ID (set it as a GitHub Actions secret)");

/**
 * IMPORTANT:
 * Use the gviz CSV export. The /export?format=csv endpoint often returns ONLY the first tab,
 * even when you pass &sheet=... — which results in Problems / Company Solutions being wrong.
 */
const csvUrl = (sheetName) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;

async function loadCSV(sheetName) {
  const res = await fetch(csvUrl(sheetName), { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load sheet "${sheetName}" (${res.status})`);
  const text = await res.text();
  const rows = parseCSV(text);

  // Guardrails to catch “wrong tab returned” issues early
  if (!rows.length) throw new Error(`Sheet "${sheetName}" returned 0 rows (check sharing + sheet name).`);
  return rows;
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];

    if (c === '"' && inQuotes && n === '"') {
      cur += '"';
      i++;
    } else if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      row.push(cur);
      cur = "";
    } else if ((c === "\n" || c === "\r") && !inQuotes) {
      if (c === "\r" && n === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else {
      cur += c;
    }
  }

  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }

  const headers = (rows.shift() || []).map((h) => (h || "").trim());
  return rows.map((r) => {
    const o = {};
    headers.forEach((h, i) => {
      if (!h) return;
      o[h] = (r[i] || "").trim();
    });
    return o;
  });
}

const pick = (obj, keys) => {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && String(obj[k] || "").trim()) return String(obj[k]).trim();
  }
  return "";
};

const norm = (x) => (x || "").toString().trim().toLowerCase();
const slug = (x) =>
  norm(x)
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// ---- Load sheets ----
const companies = await loadCSV("Companies");
const problems = await loadCSV("Problems");
const companySolutions = await loadCSV("Company Solutions");

// ---- Validate headers (helps diagnose “wrong tab returned”) ----
function assertHas(sheetName, rows, required) {
  const present = new Set(Object.keys(rows[0] || {}));
  const missing = required.filter((h) => !present.has(h));
  if (missing.length) {
    throw new Error(
      `Sheet "${sheetName}" is missing required columns: ${missing.join(", ")}.\n` +
        `Columns found: ${[...present].join(", ") || "(none)"}\n` +
        `This usually means the CSV export returned the wrong tab, or the tab name changed.`
    );
  }
}

assertHas("Companies", companies, ["Company Name"]);
assertHas("Problems", problems, ["Problem", "Solution", "Feature"]);
assertHas("Company Solutions", companySolutions, ["Company Name", "Problem"]);

// ---- Build Problem lookup (normalized) ----
const problemMap = new Map();
problems.forEach((p) => {
  const prob = pick(p, ["Problem"]);
  if (!prob) return;
  problemMap.set(norm(prob), {
    problem: prob,
    solution: pick(p, ["Solution"]),
    feature: pick(p, ["Feature", "OpenRecovery Feature"]),
  });
});

// ---- Build Companies ----
const companyMap = new Map();
companies.forEach((c) => {
  const name = pick(c, ["Company Name", "Company"]);
  if (!name) return;

  const key = norm(name);
  companyMap.set(key, {
    id: pick(c, ["Company ID"]) || slug(name) || key.replace(/\s+/g, "-"),
    name,
    website: pick(c, ["Website", "URL"]),
    location: pick(c, ["Location"]),
    target: pick(c, ["Target", "Target Audience"]),
    org_types: (pick(c, ["Org Types", "Org Type", "Category"]) || "")
      .split("|")
      .map((x) => x.trim())
      .filter(Boolean),
    solutions: [],
    problems: [],
  });
});

// ---- Attach Solutions (dedup per company by problem) ----
let missingCompany = 0;
let missingProblem = 0;

companySolutions.forEach((s) => {
  const cname = norm(pick(s, ["Company Name", "Company"]));
  const probRaw = pick(s, ["Problem", "Common Problem"]);

  if (!cname || !probRaw) return;

  const company = companyMap.get(cname);
  if (!company) {
    missingCompany++;
    return;
  }

  const p = problemMap.get(norm(probRaw));
  if (!p) {
    missingProblem++;
    return;
  }

  // dedup by problem within the company
  if (company.solutions.some((x) => norm(x.problem) === norm(p.problem))) return;

  company.solutions.push(p);
});

// Derive company.problems list (for convenience)
for (const c of companyMap.values()) {
  c.problems = c.solutions.map((s) => s.problem);
}

// Write output
const output = { companies: [...companyMap.values()] };
fs.writeFileSync("data.json", JSON.stringify(output, null, 2));

console.log(`✅ Wrote data.json with ${output.companies.length} companies`);
console.log(`   Companies missing from "Company Solutions": ${missingCompany}`);
console.log(`   Problems missing from "Problems": ${missingProblem}`);

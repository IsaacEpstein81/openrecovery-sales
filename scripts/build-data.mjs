import fs from "fs";

const SHEET_ID = process.env.SHEET_ID;
if (!SHEET_ID) throw new Error("Missing SHEET_ID");

const csv = (sheet) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&sheet=${encodeURIComponent(sheet)}`;

async function loadCSV(sheetName) {
  const res = await fetch(csv(sheetName));
  if (!res.ok) throw new Error(`Failed to load ${sheetName} (HTTP ${res.status})`);
  const text = await res.text();
  return parseCSV(text);
}

function parseCSV(text) {
  const rows = [];
  let row = [], cur = "", inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' && inQuotes && n === '"') { cur += '"'; i++; }
    else if (c === '"') inQuotes = !inQuotes;
    else if (c === "," && !inQuotes) { row.push(cur); cur = ""; }
    else if ((c === "\n" || c === "\r") && !inQuotes) {
      if (c === "\r" && n === "\n") i++;
      row.push(cur); cur = "";
      if (row.some(v => v.trim())) rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }

  const headers = (rows.shift() || []).map(h => (h || "").trim());
  return rows
    .filter(r => r.some(v => (v || "").trim()))
    .map(r => {
      const o = {};
      headers.forEach((h, i) => o[h] = (r[i] || "").trim());
      return o;
    });
}

// ---------- Helpers ----------
function norm(x) {
  return (x || "").toString().trim().toLowerCase();
}

// Used for matching “Problem” strings even if punctuation / extra spaces differ.
function keyify(x) {
  return norm(x)
    .replace(/\u00a0/g, " ")          // non‑breaking spaces -> spaces
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9\s-]/g, "")     // drop punctuation
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Pick first non-empty value from a list of possible column names.
// Also supports case-insensitive header matching.
function pick(row, keys) {
  if (!row) return "";
  const map = row.__keyMap || (row.__keyMap = Object.fromEntries(
    Object.keys(row).map(k => [k.trim().toLowerCase(), k])
  ));

  for (const k of keys) {
    const direct = row[k];
    if (direct !== undefined && String(direct).trim() !== "") return String(direct).trim();

    const real = map[k.trim().toLowerCase()];
    if (real && row[real] !== undefined && String(row[real]).trim() !== "") return String(row[real]).trim();
  }
  return "";
}

// ---------- Load sheets ----------
const companiesRows = await loadCSV("Companies");
const problemsRows  = await loadCSV("Problems");
const linksRows     = await loadCSV("Company Solutions");

// ---------- Build problem lookup ----------
// IMPORTANT: Your Problems tab must have a “Problem” column (or “Common Problem”),
// plus “Solution” and “OpenRecovery Feature” (or “Feature”).
const problemMap = {};
let problemsCount = 0;

problemsRows.forEach(r => {
  const problem = pick(r, ["Problem", "Common Problem", "Common Problem "]);
  if (!problem) return;

  const solution = pick(r, ["Solution", "Our Solution"]);
  const feature  = pick(r, ["OpenRecovery Feature", "Open Recovery Feature", "Feature"]);

  problemMap[keyify(problem)] = {
    problem,
    solution,
    feature
  };
  problemsCount++;
});

// ---------- Build companies ----------
const companyMap = {};
companiesRows.forEach(r => {
  const id   = pick(r, ["Company ID", "ID"]);
  const name = pick(r, ["Company Name", "Name"]);
  if (!id || !name) return;

  const idKey = norm(id);

  companyMap[idKey] = {
    id,
    name,
    website: pick(r, ["Website", "URL"]),
    location: pick(r, ["Location"]),
    target: pick(r, ["Target"]),
    org_types: (pick(r, ["Org Types", "Org Types "]) || "")
      .split("|")
      .map(x => x.trim())
      .filter(Boolean),
    solutions: []
  };
});

// ---------- Attach problem/solution/feature to each company ----------
let matchedLinks = 0;
let unmatchedCompanies = 0;
const unmatchedProblems = new Set();

linksRows.forEach(r => {
  const cidKey = norm(pick(r, ["Company ID", "ID"]));
  const cname  = norm(pick(r, ["Company Name", "Company"]));

  let company =
    (cidKey && companyMap[cidKey]) ||
    Object.values(companyMap).find(c => norm(c.name) === cname);

  if (!company) { unmatchedCompanies++; return; }

  const problemText = pick(r, ["Problem", "Common Problem"]);
  const p = problemMap[keyify(problemText)];

  if (!p) {
    if (problemText) unmatchedProblems.add(problemText);
    return;
  }

  // Avoid duplicates
  const already = company.solutions.some(x => keyify(x.problem) === keyify(p.problem));
  if (!already) {
    company.solutions.push(p);
    matchedLinks++;
  }
});

// ---------- Output ----------
const output = { companies: Object.values(companyMap) };
fs.writeFileSync("data.json", JSON.stringify(output, null, 2));

const companiesWithSolutions = output.companies.filter(c => c.solutions.length > 0).length;

console.log("✅ Wrote data.json");
console.log(`   Companies:              ${output.companies.length}`);
console.log(`   Problem definitions:    ${problemsCount}`);
console.log(`   Company→Problem links:  ${linksRows.length}`);
console.log(`   Matched links:          ${matchedLinks}`);
console.log(`   Companies w/ solutions: ${companiesWithSolutions}`);

if (unmatchedCompanies) {
  console.warn(`⚠️  Rows in "Company Solutions" with no matching company: ${unmatchedCompanies}`);
}

if (unmatchedProblems.size) {
  console.warn(`⚠️  Problems referenced in "Company Solutions" but missing in "Problems": ${unmatchedProblems.size}`);
  console.warn("   Add these EXACT problems to the Problems tab (or rename to match):");
  console.warn("   " + Array.from(unmatchedProblems).slice(0, 25).join(" | "));
  if (unmatchedProblems.size > 25) console.warn("   (…and more)");
}

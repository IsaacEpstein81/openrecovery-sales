import fs from "fs";

const SHEET_ID = process.env.SHEET_ID;
if (!SHEET_ID) throw new Error("Missing SHEET_ID");

const csv = (sheet) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&sheet=${encodeURIComponent(sheet)}`;

async function loadCSV(sheetName) {
  const res = await fetch(csv(sheetName));
  if (!res.ok) throw new Error(`Failed to load ${sheetName}`);
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

  const headers = rows.shift().map(h => h.trim());
  return rows.map(r => {
    const o = {};
    headers.forEach((h, i) => o[h] = (r[i] || "").trim());
    return o;
  });
}

const companies = await loadCSV("Companies");
const problems = await loadCSV("Problems");
const solutions = await loadCSV("Company Solutions");

// Build problem lookup
const problemMap = {};
problems.forEach(p => {
  if (p.Problem) {
    problemMap[p.Problem] = {
      problem: p.Problem,
      solution: p.Solution,
      feature: p.Feature
    };
  }
});

// Build companies
const companyMap = {};
companies.forEach(c => {
  if (!c["Company ID"] || !c["Company Name"]) return;
  companyMap[c["Company ID"]] = {
    id: c["Company ID"],
    name: c["Company Name"],
    website: c.Website,
    location: c.Location,
    target: c.Target,
    org_types: (c["Org Types"] || "")
      .split("|")
      .map(x => x.trim())
      .filter(Boolean),
    solutions: []
  };
});

function norm(x) {
  return (x || "").toString().trim().toLowerCase();
}

solutions.forEach(s => {
  const cid = norm(s["Company ID"]);
  const cname = norm(s["Company Name"]);

  let company =
    companyMap[cid] ||
    Object.values(companyMap).find(
      c => norm(c.name) === cname
    );

  if (!company) return;

  const p = problemMap[s.Problem];
  if (p) company.solutions.push(p);
});


const output = { companies: Object.values(companyMap) };

fs.writeFileSync("data.json", JSON.stringify(output, null, 2));
console.log(`✅ Wrote data.json with ${output.companies.length} companies`);

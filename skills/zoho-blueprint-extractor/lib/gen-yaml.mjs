#!/usr/bin/env node
// gen-yaml.mjs — convertit le JSON brut (sortie de extract-blueprint.js) en YAML normalisé.
// Node only (pas de dépendance Python). Usage : node lib/gen-yaml.mjs <input.json> <output.yaml>
import { readFileSync, writeFileSync } from "node:fs";

const deHtml = (s) =>
  !s ? "" :
  s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&rsquo;/g, "’")
   .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const crit = (details) => {
  if (!details) return null;
  return details.map((x) =>
    typeof x === "string" ? x.toUpperCase()
    : `${x.api_name} ${x.comparator} ${x.value}`).join(" ");
};
const q = (s) => '"' + String(s ?? "").replace(/"/g, "'") + '"';

const [, , inp, outp] = process.argv;
if (!inp || !outp) { console.error("Usage: node lib/gen-yaml.mjs <input.json> <output.yaml>"); process.exit(1); }

const d = JSON.parse(readFileSync(inp, "utf-8"));
const p = d.process;
const L = [];
L.push("# Blueprint extrait automatiquement (agent-browser + cookies / session navigateur).");
L.push("# Source : endpoints internes ProcessFlow.do + FlowTransition.do.", "");
L.push("blueprint:");
L.push(`  name: ${q(p.Name)}`);
L.push(`  module: ${q(p.Module)}`);
L.push(`  status: ${q(p.Status)}`);
L.push(`  continuous: ${!!p.Continuous}`);
const fld = p.Field || {};
L.push(`  state_field: ${q(fld.DisplayLabel || fld.FieldName || fld.ApiName || "Status")}`);
L.push(`  entry_criteria: ${q(deHtml(p.entry_criteria))}`);
L.push(`  supported_action_types: ${JSON.stringify(p.supported_action_types || [])}`);
L.push("");
L.push("states:");
for (const name of Object.values(p.states || {})) L.push(`  - ${q(name)}`);
L.push("");
L.push("transitions:");
for (const t of d.transitions) {
  L.push(`  - name: ${q(t.name)}`);
  L.push(`    from: ${q(t.from)}`);
  L.push(`    to: ${q(t.to)}`);
  L.push(`    common: ${!!t.global}`);
  L.push(`    automatic: ${!!t.auto}`);
  const owners = (t.owners || []).map((o) => o.type || "?").join(", ");
  L.push("    before:");
  L.push(`      owners: [${owners}]`);
  if (t.criteria) L.push(`      criteria: ${q(deHtml(t.criteria))}`);
  L.push("    during:");
  const during = t.during || [];
  if (!during.length) L.push("      []");
  for (const f of during) {
    if (f.Type === "Info") L.push(`      - message: ${q(deHtml(f.Info).slice(0, 300))}`);
    else if (f.Type === "Field") {
      const c = crit(f.CriteriaDetails);
      L.push(c ? `      - field_validation: ${q(c)}` : "      - field: (requis)");
    }
  }
  L.push("    after:");
  const A = t.actions || {};
  let nz = false;
  for (const [k, v] of Object.entries(A)) {
    if (Array.isArray(v) && v.length) {
      nz = true;
      for (const item of v) {
        const label = item.Name || item.name || item.url || k;
        L.push(`      - type: ${k}`);
        L.push(`        detail: ${q(String(label).slice(0, 140))}`);
        for (const pk of ["url", "method", "dueDate", "remindBefore", "priority",
                          "status", "func_name", "scriptName", "scriptId"])
          if (pk in item) L.push(`        ${pk}: ${q(item[pk])}`);
      }
    }
  }
  if (!nz) L.push("      []");
  L.push("");
}
writeFileSync(outp, L.join("\n"));
console.log(`YAML écrit : ${outp}  (${d.transitions.length} transitions)`);

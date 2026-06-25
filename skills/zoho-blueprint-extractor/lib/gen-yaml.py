#!/usr/bin/env python3
# gen-yaml.py — convertit le JSON brut (sortie de extract-blueprint.js) en YAML normalisé.
# Usage : python3 lib/gen-yaml.py <input.json> <output.yaml>
import json, re, sys

def deHtml(s):
    if not s: return ""
    s = re.sub(r"<[^>]+>", " ", s)
    s = s.replace("&nbsp;", " ").replace("&rsquo;", "’").replace("&amp;", "&")
    return re.sub(r"\s+", " ", s).strip()

def crit(details):
    if not details: return None
    parts = []
    for x in details:
        if isinstance(x, str): parts.append(x.upper())
        elif isinstance(x, dict):
            parts.append(f"{x.get('api_name')} {x.get('comparator')} {x.get('value')}")
    return " ".join(parts)

def q(s): return '"' + str(s).replace('"', "'") + '"'

def main(inp, outp):
    d = json.load(open(inp))
    p = d["process"]; L = []
    L += ["# Blueprint extrait automatiquement (agent-browser + cookies Chrome).",
          "# Source : endpoints internes ProcessFlow.do + FlowTransition.do.", ""]
    L += ["blueprint:",
          f"  name: {q(p.get('Name'))}",
          f"  module: {q(p.get('Module'))}",
          f"  status: {q(p.get('Status'))}",
          f"  continuous: {str(bool(p.get('Continuous'))).lower()}"]
    fld = p.get("Field") or {}
    L.append(f"  state_field: {q(fld.get('DisplayLabel') or fld.get('FieldName') or fld.get('ApiName') or 'Status')}")
    L.append(f"  entry_criteria: {q(deHtml(p.get('entry_criteria')))}")
    L.append(f"  supported_action_types: {p.get('supported_action_types')}")
    L.append("")
    L.append("states:")
    for name in p.get("states", {}).values():
        L.append(f"  - {q(name)}")
    L.append("")
    L.append("transitions:")
    for t in d["transitions"]:
        L.append(f"  - name: {q(t['name'])}")
        L.append(f"    from: {q(t['from'])}")
        L.append(f"    to: {q(t['to'])}")
        L.append(f"    common: {str(bool(t.get('global'))).lower()}")
        L.append(f"    automatic: {str(bool(t.get('auto'))).lower()}")
        owners = ", ".join(o.get("type", "?") for o in (t.get("owners") or []))
        L.append("    before:")
        L.append(f"      owners: [{owners}]")
        if t.get("criteria"):
            L.append(f"      criteria: {q(deHtml(t['criteria']))}")
        L.append("    during:")
        during = t.get("during") or []
        if not during: L.append("      []")
        for f in during:
            if f.get("Type") == "Info":
                L.append(f"      - message: {q(deHtml(f.get('Info'))[:300])}")
            elif f.get("Type") == "Field":
                c = crit(f.get("CriteriaDetails"))
                L.append(f"      - field_validation: {q(c)}" if c else "      - field: (requis)")
        L.append("    after:")
        A = t.get("actions") or {}
        nz = False
        for k, v in A.items():
            if isinstance(v, list) and v:
                nz = True
                for item in v:
                    label = item.get("Name") or item.get("name") or item.get("url") or k
                    L.append(f"      - type: {k}")
                    L.append(f"        detail: {q(str(label)[:140])}")
                    for pk in ("url", "method", "dueDate", "remindBefore", "priority",
                               "status", "func_name", "scriptName", "scriptId"):
                        if pk in item: L.append(f"        {pk}: {q(item[pk])}")
        if not nz: L.append("      []")
        L.append("")
    open(outp, "w").write("\n".join(L))
    print(f"YAML écrit : {outp}  ({len(d['transitions'])} transitions)")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python3 lib/gen-yaml.py <input.json> <output.yaml>"); sys.exit(1)
    main(sys.argv[1], sys.argv[2])

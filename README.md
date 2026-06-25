# Zoho Blueprint Extractor

Extract any **Zoho CRM Blueprint** into a clean, normalized **YAML** — including everything the public API hides.

An [agent skill](https://skills.sh) (works with Claude Code, Cursor, Codex, OpenCode, and 60+ agents) that drives your **already-logged-in browser session** to read a Blueprint's full definition, then writes it as a state-machine YAML you can hand to another agent or pipeline.

```bash
npx skills add ecappa/zoho-blueprint-extractor
```

---

## Why this exists

Zoho CRM's **public REST API does not export a Blueprint's definition.** The only Blueprint endpoint is record-scoped: it returns the transitions available from *one record's current state*, and it is **blind to the automation actions** (webhooks, Deluge functions, field updates, alerts, SLA). So you cannot reconstruct a Blueprint from the public API alone.

This skill takes a different route: it reuses your **logged-in browser session** (no API keys, no Self Client) and reads two internal CRM endpoints the Blueprint editor itself uses. The result is the **complete** definition:

| | Public API | This skill |
|---|---|---|
| Full state/transition graph | partial (per record) | ✅ in one pass |
| Before / During / After of each transition | ❌ | ✅ |
| Webhooks, Deluge, field updates, alerts, SLA | ❌ never | ✅ |
| Needs API keys from the account owner | yes | **no** (just a logged-in session) |

## What you get

A normalized YAML per Blueprint:

```yaml
blueprint:
  name: "Task Process Management"
  module: "Tasks"
  state_field: "Status"
  entry_criteria: "Priority is Highest"
states:
  - "Non commencé"
  - "En cours"
  - "Terminé"
transitions:
  - name: "Started"
    from: "Non commencé"
    to: "En cours"
    before: { owners: [RecordOwner] }
    during:
      - field_validation: "Tasks.Priority equal Highest"
    after: []           # webhooks / Deluge / field updates appear here when present
```

See [`skills/zoho-blueprint-extractor/examples/`](skills/zoho-blueprint-extractor/examples/) for a full output.

## How it works

1. **Session** — reuse your browser cookies (macOS + Chrome) or log in interactively. A one-time OneAuth approval may be requested by Zoho for Setup screens.
2. **Read two internal endpoints** (same-origin `fetch`, cookies included):
   - `ProcessFlow.do?action=getProcessDetails` → states, entry criteria, SLA, full transition graph.
   - `FlowTransition.do?action=getTransitionDetails` → per-transition Before / During / After.
3. **Normalize** the JSON into YAML.

The full step-by-step (including an environment preflight) lives in the skill: [`skills/zoho-blueprint-extractor/SKILL.md`](skills/zoho-blueprint-extractor/SKILL.md).

## Install

```bash
# Install into your agent (Claude Code by default)
npx skills add ecappa/zoho-blueprint-extractor

# Or pick the target agent / global install
npx skills add ecappa/zoho-blueprint-extractor -a claude-code -g
```

Then ask your agent to *"extract a Zoho blueprint"* and it will follow the skill: run the preflight, establish the session, list your blueprints, ask which one, and write the YAML.

## Requirements

- [`agent-browser`](https://www.npmjs.com/package/agent-browser) + its Chromium backend (`agent-browser install`)
- Node ≥ 22
- A browser logged into Zoho. **Cookie reuse is macOS + Chrome**; on other setups, use interactive login.

Run the preflight any time to check your machine:

```bash
bash skills/zoho-blueprint-extractor/preflight.sh
```

## Caveats

- **Read-only.** The skill never executes a transition or writes to the CRM.
- Uses **internal, undocumented** Zoho endpoints (`ProcessFlow.do`, `FlowTransition.do`). They can change — treat this as best-effort, not a stable contract.
- Relies on a **browser session** + occasional OneAuth approval; it is not a headless 24/7 service.
- Automating access to Zoho's web UI may not align with its Terms of Service in every context. Use on accounts you own or are authorized to work on.

## License

MIT © Eric Cappannelli / Cappasoft

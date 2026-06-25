// extract-blueprint.js
// À exécuter via : agent-browser --session zoho eval --stdin < lib/extract-blueprint.js
//
// PRÉ-REQUIS : la page courante de la session DOIT être l'éditeur du Blueprint, p.ex.
//   https://crm.zoho.com/crm/org{ID}/settings/blueprint/{PROCESS_ID}?module={MODULE}
// Le script déduit orgId / processId / module depuis l'URL courante, puis appelle les
// deux endpoints internes (cookies de session inclus, même origine) et renvoie un JSON
// complet : process + toutes les transitions (Before/During/After).
//
// Retour : une string JSON (double-encodée par eval). Côté shell, faire json.loads 2x.

(async () => {
  const path = location.pathname;                       // /crm/org123/settings/blueprint/456
  const org = (path.match(/\/(org\d+)\//) || [])[1];    // org123
  const pid = (path.match(/\/blueprint\/(\d+)/) || [])[1];
  const module = new URLSearchParams(location.search).get("module")
              || (window.__BP_MODULE__ || "");
  if (!org || !pid || !module) {
    return JSON.stringify({ error: "URL non reconnue", org, pid, module, href: location.href });
  }
  const base = `/crm/${org}`;
  const j = async (u) => (await fetch(u, { credentials: "include" })).json();

  const pr = await j(`${base}/ProcessFlow.do?action=getProcessDetails&module=${module}&processId=${pid}&toolTip=${module}`);
  const layoutId = (pr.Layout && pr.Layout.Id) || "";
  const states = {};
  (pr.PicklistValues || []).forEach(s => states[s.Id] = s.DisplayValue);

  const transitions = [];
  for (const tm of (pr.TransitionsMeta || [])) {
    const tid = tm.TransitionId;
    let det = {};
    try {
      det = await j(`${base}/FlowTransition.do?Module=${module}&action=getTransitionDetails&TransitionId=${tid}&LayoutId=${layoutId}`);
    } catch (e) { det = { error: String(e) }; }
    const A = det.Actions || {};
    const actionCounts = {};
    for (const k of Object.keys(A)) if (Array.isArray(A[k])) actionCounts[k] = A[k].length;
    transitions.push({
      name: tm.Name, tid,
      from: states[tm.SourceId] || tm.SourceId,
      to: states[tm.TargetId] || tm.TargetId,
      global: tm.Global, auto: tm.AutoTrans, parallel: tm.ParallelTrans,
      owners: det.Owners || [],
      criteria: det.CriteriaString || "",
      during: det.Fields || [],
      actionCounts,
      actions: A,
    });
  }

  return JSON.stringify({
    process: {
      Name: pr.Name, Module: pr.Module, Status: pr.ProcessStatus,
      Field: pr.Field, Continuous: pr.Continuous,
      states, entry_criteria: pr.CriteriaString,
      timebox: pr.TimeBoxConfig, supported_action_types: pr.state_actions,
      Id: pr.Id, Layout: pr.Layout,
    },
    transitions,
  });
})()

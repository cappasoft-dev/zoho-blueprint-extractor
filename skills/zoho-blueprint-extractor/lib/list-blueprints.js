// list-blueprints.js
// À exécuter via : agent-browser --session zoho eval --stdin < lib/list-blueprints.js
//
// PRÉ-REQUIS : être sur la page LISTE des Blueprints du Setup CRM, p.ex.
//   https://crm.zoho.com/crm/org{ID}/settings/blueprint
// (le menu Configuration > Gestion des processus > Blueprint)
//
// Récupère les Blueprints visibles en lisant les liens de l'éditeur (href contenant
// /blueprint/{id}) + le texte associé. Best-effort : si la liste est rendue en canvas
// ou paginée, compléter à la main avec les URLs collées par l'utilisateur.

(() => {
  const org = (location.pathname.match(/\/(org\d+)\//) || [])[1] || "";
  const found = new Map();
  // 1) liens directs vers un blueprint
  for (const a of document.querySelectorAll('a[href*="/blueprint/"]')) {
    const m = a.getAttribute("href").match(/\/blueprint\/(\d+)/);
    if (!m) continue;
    const id = m[1];
    const name = (a.textContent || "").trim();
    if (!found.has(id)) found.set(id, { processId: id, name, href: a.href });
  }
  // 2) éléments avec data-* portant un id de process (variantes d'UI)
  for (const el of document.querySelectorAll("[data-processid],[data-id],[lid]")) {
    const id = el.getAttribute("data-processid") || el.getAttribute("data-id") || el.getAttribute("lid");
    if (id && /^\d{15,}$/.test(id) && !found.has(id)) {
      found.set(id, { processId: id, name: (el.textContent || "").trim().slice(0, 60), href: "" });
    }
  }
  return JSON.stringify({ org, count: found.size, blueprints: [...found.values()] });
})()

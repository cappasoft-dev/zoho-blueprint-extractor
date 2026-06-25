---
name: zoho-blueprint-extractor
description: >
  Extrait un (ou plusieurs) Blueprint Zoho CRM en YAML normalisé, en pilotant le
  navigateur avec la session connectée de l'utilisateur (agent-browser + cookies
  Chrome), SANS clés API. Récupère ce que l'API publique ne donne pas : le graphe
  complet + Before/During/After de chaque transition (webhooks, Deluge, field
  updates, tâches, alertes, SLA). À utiliser quand l'utilisateur veut « extraire un
  blueprint Zoho », « sortir mes blueprints », « transformer un blueprint en spec
  d'agent ». Interactif : aide à la connexion, liste les blueprints, demande lequel
  extraire. Skill autonome installable via `npx skills`.
---

# Extracteur de Blueprints Zoho → YAML

Pilote le navigateur dans la **session Zoho déjà connectée de l'utilisateur** et lit
deux endpoints internes du CRM. Aucune clé API, aucun Self Client. Le « pourquoi »
(limites de l'API publique, méthode) est résumé dans le `README.md` du dépôt.

## Capacités (compétences du skill)
| # | Compétence | Fichier |
|---|---|---|
| 0 | **Preflight** : vérifie OS/node/agent-browser/backend/cookies, ne présume rien | `preflight.sh` |
| 1 | **Session** : injecte les cookies Chrome (ou login interactif) + gère OneAuth | `grab-zoho-cookie.mjs` |
| 2 | **Lister** les blueprints du compte | `lib/list-blueprints.js` |
| 3 | **Extraire** un blueprint (graphe + Before/During/After) | `lib/extract-blueprint.js` |
| 4 | **Normaliser** en YAML | `lib/gen-yaml.mjs` (node) ou `lib/gen-yaml.py` (repli) |

## Étape 0 — Preflight (toujours en premier)
```bash
bash preflight.sh
```
Rapport PASS/WARN/FAIL + voie(s) de session disponible(s). **Ne pas continuer tant que
le preflight n'est pas vert** (au moins une voie). Si des FAIL apparaissent, dérouler le
**bootstrap** ci-dessous puis relancer le preflight.

### Bootstrap (machine vierge) — n'installer que ce qui manque
```bash
# Node >= 22 (via nvm, recommandé)
command -v node || { curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash; . ~/.nvm/nvm.sh; nvm install 22; }
# agent-browser + son navigateur Chromium
command -v agent-browser || npm i -g agent-browser
agent-browser install
```
- **macOS + Chrome connecté à Zoho** → voie A (cookies) dispo, rien d'autre à installer.
- **Autre OS / pas de Chrome** → voie B (login interactif headed) ; la capture de cookies
  (Trousseau macOS) ne s'applique pas.
- Le **générateur YAML est en Node** (`gen-yaml.mjs`) : **pas besoin de Python**. `gen-yaml.py`
  reste un repli si seul Python est dispo.

## Garde-fous
- **Lecture seule.** Cette procédure n'exécute AUCUNE transition, n'écrit RIEN dans le
  CRM. Elle ne fait que lire des définitions. Ne jamais ajouter d'appels d'écriture.
- Endpoints **internes non documentés** (`ProcessFlow.do`, `FlowTransition.do`) :
  best-effort, peuvent changer. Si un appel renvoie 400/HTML, re-vérifier l'URL/les
  paramètres (voir Dépannage).
- **Ne jamais afficher ni committer** le fichier d'état de session (`*-state.json`) ni
  les cookies : ils contiennent des jetons. Les supprimer en fin de course.

---

## Étape 1 — Établir la session

Variables : `SESSION=zoho`. Toujours préfixer les commandes par `--session $SESSION`.

### Variante A — réutiliser les cookies Chrome (recommandé)
```bash
# Depuis le dossier du skill
node grab-zoho-cookie.mjs        # fenêtre Trousseau macOS -> cliquer « Autoriser »
# -> écrit /tmp/zoho-real-state.json (cookies déchiffrés, valeurs jamais affichées)

agent-browser --session zoho state load /tmp/zoho-real-state.json
agent-browser --session zoho open "https://crm.zoho.com/crm"
agent-browser --session zoho wait --load networkidle
agent-browser --session zoho get url
```
> Sur un **Chrome récent** (chiffrement « App-Bound », Chrome 127+), `grab-zoho-cookie.mjs` peut ne
> renvoyer aucun cookie exploitable — il le signale explicitement. Passer alors à la **variante B**.

### Variante B — connexion interactive (si pas de Chrome connecté / cookies absents)
```bash
agent-browser --session zoho --headed open "https://crm.zoho.com/crm"
```
La fenêtre headed peut passer en arrière-plan sur macOS ; demander à l'utilisateur de
se connecter dans cette fenêtre. **Préférer la variante A** si possible.

### Vérification de session (toujours)
Regarder l'URL/titre après navigation :
- URL contient `crm.zoho.com/crm/org…` et titre « Zoho CRM » → **connecté**, continuer.
- URL contient `accounts.zoho.com/signin` → **pas connecté** → refaire variante A/B.
- URL contient `accounts.zoho.com/.../relogin` ou page « Vérifiez votre identité » →
  **étape OneAuth** : DEMANDER à l'utilisateur d'approuver la notification push sur son
  téléphone (taper le chiffre affiché). Faire un screenshot pour lui montrer le numéro :
  ```bash
  agent-browser --session zoho screenshot /tmp/zoho-verif.png
  ```
  Puis attendre son « ok », re-naviguer et re-vérifier.

> Récupérer l'**orgId** depuis l'URL une fois connecté : motif `/crm/(org\d+)/`.

---

## Étape 2 — Lister les Blueprints (interactif)

Demander d'abord à l'utilisateur le **module** visé (Deals, Leads, Tasks, Contacts,
ou un module custom) si inconnu — ou lister tous modules confondus.

```bash
# Aller sur la liste des Blueprints du Setup, puis scraper
agent-browser --session zoho open "https://crm.zoho.com/crm/<ORGID>/settings/blueprint"
agent-browser --session zoho wait --load networkidle
agent-browser --session zoho eval --stdin < lib/list-blueprints.js
```
Le retour est un JSON `{ org, count, blueprints:[{processId,name,href}] }` (double-encodé :
`json.loads` deux fois). **Présenter la liste à l'utilisateur** et lui demander lequel
extraire (numéro/nom), ou « tous ».

**Si la liste est vide** (UI canvas/pagination) → demander à l'utilisateur de **coller
l'URL** d'un blueprint depuis Setup (elle contient `…/settings/blueprint/{ID}?module={M}`).
C'est toujours suffisant pour l'étape 3.

---

## Étape 3 — Extraire le(s) Blueprint(s) choisi(s)

Pour chaque blueprint retenu, **naviguer sur son éditeur** (l'extraction lit l'URL
courante : orgId + processId + module), puis lancer l'extraction :

```bash
PID=...        # processId du blueprint
MOD=Tasks      # module
agent-browser --session zoho open "https://crm.zoho.com/crm/<ORGID>/settings/blueprint/$PID?module=$MOD"
agent-browser --session zoho wait --load networkidle
agent-browser --session zoho wait 2500

# Extraction (renvoie une string JSON double-encodée)
agent-browser --session zoho eval --stdin < lib/extract-blueprint.js > /tmp/bp-raw.txt

# Déballer le double-encodage -> JSON propre (Node, aucun Python requis)
node -e "const fs=require('fs');fs.writeFileSync('/tmp/bp.json',JSON.stringify(JSON.parse(JSON.parse(fs.readFileSync('/tmp/bp-raw.txt','utf8'))),null,2))"

# Générer le YAML normalisé (node ; repli python si node absent)
node   lib/gen-yaml.mjs /tmp/bp.json "./examples/<nom-blueprint>.blueprint.yaml" \
  || python3 lib/gen-yaml.py /tmp/bp.json "./examples/<nom-blueprint>.blueprint.yaml"
```

Vérifier rapidement le résultat : nombre de transitions, états, et que les actions
After (`Webhook`/`Deluge`/`Task`/`Fieldupdate`…) apparaissent quand elles existent.

---

## Étape 4 — Nettoyage (obligatoire)
```bash
rm -f /tmp/zoho-real-state.json /tmp/bp-raw.txt /tmp/zoho-verif.png
agent-browser --session zoho close
```
Garder les `*.json`/`*.yaml` d'extraction. ⚠ La sortie peut contenir des **URLs de webhooks**
(parfois avec jetons), du code **Deluge** ou des configs internes : traite-la comme
**confidentielle** avant tout partage.

---

## Ce qu'on récupère (mapping)
- `ProcessFlow.do?action=getProcessDetails` → `Name`, `Module`, `PicklistValues` (états,
  display↔actual), `CriteriaString` (critère d'entrée), `TimeBoxConfig` (SLA),
  `TransitionsMeta` (graphe : Source→Target, `Global`=commune, `AutoTrans`),
  `state_actions` (types **supportés**).
- `FlowTransition.do?action=getTransitionDetails&TransitionId=…&LayoutId=…` → par
  transition : `Owners` (Before), `Fields` (During : messages, champs, `CriteriaDetails`
  = validations), `Actions` (After : `Webhook`, `Deluge`, `Fieldupdate`, `Task`,
  `Alert`, `AddTags`/`RemoveTags`, `CreateRecord`).

## Dépannage
- **400 / HTML au lieu de JSON** : mauvais `action`/paramètre, ou page courante pas sur
  crm.zoho.com. Re-vérifier qu'on est bien sur l'éditeur du blueprint avant l'eval.
- **`RECORD_NOT_IN_PROCESS`** : c'est l'API *publique* (à ne pas utiliser ici) ; cette
  méthode passe par les endpoints internes et n'en dépend pas.
- **`addTransition` plante en eval** : normal hors clic ; on n'en a pas besoin, on appelle
  `FlowTransition.do` directement.
- **`state_actions` ≠ actions réelles** : `state_actions` liste les types *supportés* ;
  lire le dict `actions` de CHAQUE transition pour le réel.
- **eval « await is only valid… »** : envelopper dans `(async () => { … })()`.

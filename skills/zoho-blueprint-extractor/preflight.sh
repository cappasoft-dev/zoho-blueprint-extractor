#!/usr/bin/env bash
# preflight.sh — vérifie qu'une machine (même vierge) peut faire tourner l'extracteur.
# Ne présume RIEN : OS, node, npm, agent-browser + backend, navigateur pour la session,
# outils de cookies (macOS). Affiche un rapport PASS/WARN/FAIL avec la commande de
# remédiation, et conclut sur la/les voie(s) de session disponible(s).
#
# Usage : bash preflight.sh
# Sortie : 0 si au moins une voie d'extraction complète est possible, 1 sinon.

set -u
PASS=0; WARN=0; FAIL=0
line() { # statut, nom, detail
  local s="$1" n="$2" d="${3:-}"
  local mark; case "$s" in PASS) mark="✓";; WARN) mark="~";; *) mark="✗";; esac
  printf "  %s [%-4s] %-32s %s\n" "$mark" "$s" "$n" "$d"
  case "$s" in PASS) PASS=$((PASS+1));; WARN) WARN=$((WARN+1));; *) FAIL=$((FAIL+1));; esac
}
have() { command -v "$1" >/dev/null 2>&1; }

echo ""
echo "=== Preflight extracteur Zoho Blueprint ==="

# 0) OS
OS="$(uname -s 2>/dev/null || echo unknown)"
case "$OS" in
  Darwin) line PASS "OS macOS" "voie cookies Chrome possible" ; IS_MAC=1 ;;
  Linux)  line WARN "OS Linux" "capture cookies macOS indispo -> login interactif" ; IS_MAC=0 ;;
  *)      line WARN "OS $OS"  "non testé -> login interactif uniquement" ; IS_MAC=0 ;;
esac

# 1) node + version >= 22 (node:sqlite pour la capture de cookies ; aussi requis par les scripts)
if have node; then
  NODE_V="$(node --version 2>/dev/null)"; NMAJ="$(printf '%s' "$NODE_V" | sed 's/^v//; s/\..*//')"
  if [ "${NMAJ:-0}" -ge 22 ] 2>/dev/null; then line PASS "node" "$NODE_V"
  else line FAIL "node trop ancien" "$NODE_V ; besoin >= 22 (nvm install 22)"; fi
  HAS_NODE=1
else
  line FAIL "node absent" "installer Node >= 22 (https://nodejs.org ou nvm)"; HAS_NODE=0; NMAJ=0
fi

# 2) npm (pour installer agent-browser si absent)
have npm && line PASS "npm" "$(npm --version 2>/dev/null)" || line WARN "npm absent" "requis seulement pour installer agent-browser"

# 3) agent-browser + backend Chromium
if have agent-browser; then
  line PASS "agent-browser" "$(agent-browser --version 2>/dev/null)"
  HAS_AB=1
  # backend installé ? (heuristique : dossier de cache ms-playwright / chromium)
  if ls "$HOME/Library/Caches/ms-playwright" >/dev/null 2>&1 || ls "$HOME/.cache/ms-playwright" >/dev/null 2>&1; then
    line PASS "backend navigateur" "Chromium présent"
  else
    line WARN "backend navigateur ?" "lancer une fois : agent-browser install"
  fi
else
  line FAIL "agent-browser absent" "npm i -g agent-browser && agent-browser install"; HAS_AB=0
fi

# 4) Générateur YAML : node (préféré) ou python3 (repli)
if [ "${HAS_NODE:-0}" = 1 ]; then line PASS "générateur YAML" "lib/gen-yaml.mjs (node)"
elif have python3;            then line WARN "générateur YAML" "python3 -> lib/gen-yaml.py (repli)"
else line FAIL "générateur YAML" "ni node ni python3"; fi

# 5) Voie A (cookies Chrome) — macOS seulement
COOKIE_OK=0
if [ "${IS_MAC:-0}" = 1 ]; then
  have security && line PASS "Trousseau (security)" "déchiffrement cookies dispo" \
                || line FAIL "security absent" "outil macOS Keychain introuvable"
  CHROME_DIR="$HOME/Library/Application Support/Google/Chrome"
  if [ -d "$CHROME_DIR" ]; then
    # compter les cookies zoho sans les déchiffrer (sqlite3 si présent)
    ZN=0; DBF=""
    for d in "$CHROME_DIR/Default/Cookies" "$CHROME_DIR"/Profile*/Cookies; do [ -f "$d" ] && DBF="$d" && break; done
    if [ -n "$DBF" ] && have sqlite3; then
      TMP="$(mktemp)"; cp "$DBF" "$TMP" 2>/dev/null
      ZN="$(sqlite3 "$TMP" "SELECT COUNT(*) FROM cookies WHERE host_key LIKE '%zoho%';" 2>/dev/null || echo 0)"
      rm -f "$TMP"
    fi
    if [ "${ZN:-0}" -gt 0 ] 2>/dev/null; then line PASS "cookies Zoho (Chrome)" "$ZN cookie(s)"; COOKIE_OK=1
    elif [ -n "$DBF" ]; then line WARN "cookies Zoho" "0 trouvé -> connecte-toi à Zoho dans Chrome"
    else line WARN "base cookies Chrome" "introuvable (Chrome jamais utilisé ?)"; fi
  else
    line WARN "Chrome non installé" "voie cookies indispo -> login interactif"
  fi
fi

# 6) Conclusion : au moins une voie de session complète ?
echo ""
PATHS=""
[ "${HAS_AB:-0}" = 1 ] && [ "${COOKIE_OK:-0}" = 1 ] && [ "${HAS_NODE:-0}" = 1 ] && PATHS="A(cookies Chrome)"
[ "${HAS_AB:-0}" = 1 ] && PATHS="${PATHS:+$PATHS + }B(login interactif headed)"

# agent-browser est la seule dépendance vraiment indispensable : sans lui, aucune voie.
if [ "${HAS_AB:-0}" != 1 ]; then
  echo "✗ Bloqué : agent-browser est indispensable."
  echo "  -> npm i -g agent-browser && agent-browser install, puis relance le preflight."
  exit 1
fi
echo "Bilan : $PASS PASS / $WARN WARN / $FAIL FAIL"
if [ -n "$PATHS" ]; then
  echo "✓ Voie(s) de session disponible(s) : $PATHS"
  echo "  -> Étape 1 du SKILL.md (préférer A si dispo, sinon B)."
  exit 0
else
  echo "✗ Aucune voie de session possible. Installe au minimum : node>=22 + agent-browser (+ Chrome connecté pour la voie A)."
  exit 1
fi

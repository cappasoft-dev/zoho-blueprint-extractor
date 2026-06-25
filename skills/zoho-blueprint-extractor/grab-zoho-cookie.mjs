// Récupère la session Zoho depuis Chrome (ce Mac), sans extension ni login.
// Lit la base Cookies de Chrome (SQLite), déchiffre via le Trousseau macOS,
// et écrit un fichier d'état agent-browser : { cookies:[...], origins:[] }.
//
//   1) (idéalement) quitte Chrome, sinon on copie la base pour éviter le verrou.
//   2) node grab-zoho-cookie.mjs
//   3) Clique « Autoriser » sur la fenêtre du Trousseau (Chrome Safe Storage).
//
// Les VALEURS de cookies ne s'affichent jamais. Node pur, zéro dépendance.

import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { pbkdf2Sync, createDecipheriv } from "node:crypto";
import { copyFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, chmodSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const OUT = "/tmp/zoho-real-state.json";
const CHROME = join(homedir(), "Library", "Application Support", "Google", "Chrome");
const YEAR = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;

// 1) Clé de chiffrement depuis le Trousseau (déclenche la fenêtre macOS).
let safeStoragePw;
try {
  safeStoragePw = execFileSync(
    "security",
    ["find-generic-password", "-w", "-s", "Chrome Safe Storage"],
    { encoding: "utf-8" }
  ).trim();
} catch {
  console.error("✗ Impossible de lire la clé du Trousseau (Chrome Safe Storage). Autorise la fenêtre macOS ('Toujours autoriser').");
  process.exit(1);
}
const aesKey = pbkdf2Sync(safeStoragePw, "saltysalt", 1003, 16, "sha1");
const hasControlChars = (s) => /[\x00-\x1f]/.test(s);

let appBoundCount = 0; // cookies « App-Bound » (Chrome 127+) : non déchiffrables via le Trousseau seul
let undecryptable = 0; // déchiffrement AES ayant produit des octets illisibles

function decrypt(enc) {
  if (!enc || enc.length === 0) return null;
  const buf = Buffer.from(enc);
  const prefix = buf.subarray(0, 3).toString("latin1");
  // Chrome 127+ : chiffrement « App-Bound » (préfixe v20). La clé n'est plus dérivable
  // hors du processus Chrome via le Trousseau seul -> indéchiffrable ici.
  if (prefix === "v20") { appBoundCount++; return null; }
  const payload = prefix === "v10" || prefix === "v11" ? buf.subarray(3) : buf;
  if (payload.length === 0 || payload.length % 16 !== 0) return null;
  const iv = Buffer.alloc(16, 0x20);
  const decipher = createDecipheriv("aes-128-cbc", aesKey, iv);
  decipher.setAutoPadding(false);
  let out;
  try {
    out = Buffer.concat([decipher.update(payload), decipher.final()]);
  } catch {
    undecryptable++;
    return null;
  }
  const pad = out[out.length - 1];
  if (pad > 0 && pad <= 16) out = out.subarray(0, out.length - pad);
  // macOS récents : 32 octets de hash de domaine préfixent la valeur.
  if (out.length > 32) {
    const stripped = out.subarray(32).toString("utf8");
    if (!hasControlChars(stripped)) return stripped;
  }
  const plain = out.toString("utf8");
  // Ne JAMAIS écrire un cookie corrompu : si illisible, on le compte et on l'ignore.
  if (hasControlChars(plain)) { undecryptable++; return null; }
  return plain;
}

// 2) Parcourt les profils Chrome, ramasse tous les cookies *zoho*.
const profiles = readdirSync(CHROME, { withFileTypes: true })
  .filter((d) => d.isDirectory() && (d.name === "Default" || d.name.startsWith("Profile")))
  .map((d) => join(CHROME, d.name, "Cookies"))
  .filter((p) => existsSync(p));

const byKey = new Map();
let profilesWithZoho = 0;
for (const dbPath of profiles) {
  const tmp = join(tmpdir(), `zcookies-${Buffer.from(dbPath).toString("hex").slice(0, 10)}.sqlite`);
  try {
    copyFileSync(dbPath, tmp);
    try {
      const db = new DatabaseSync(tmp, { readOnly: true });
      const rows = db
        .prepare("SELECT name, host_key, path, is_secure, is_httponly, encrypted_value, value FROM cookies WHERE host_key LIKE '%zoho%'")
        .all();
      db.close();
      if (rows.length) profilesWithZoho++;
      for (const r of rows) {
        const value = r.encrypted_value && r.encrypted_value.length ? decrypt(r.encrypted_value) : r.value;
        if (value == null || value === "") continue;
        const domain = r.host_key;
        const key = `${r.name}|${domain}|${r.path}`;
        byKey.set(key, {
          name: r.name,
          value,
          domain,
          path: r.path || "/",
          expires: YEAR,
          httpOnly: !!r.is_httponly,
          secure: !!r.is_secure,
          sameSite: "Lax",
        });
      }
    } finally {
      // Toujours supprimer la copie SQLite temporaire (contient des cookies chiffrés).
      try { unlinkSync(tmp); } catch {}
    }
  } catch (e) {
    // profil verrouillé ou illisible -> on saute
  }
}

const cookies = [...byKey.values()];

if (appBoundCount > 0)
  console.error(`~ ${appBoundCount} cookie(s) Zoho en chiffrement « App-Bound » (Chrome 127+) : non déchiffrables via le Trousseau seul.`);
if (undecryptable > 0)
  console.error(`~ ${undecryptable} cookie(s) Zoho illisibles après déchiffrement : ignorés.`);

if (cookies.length === 0) {
  console.error("✗ Aucun cookie zoho exploitable.");
  if (appBoundCount > 0)
    console.error("  Cause probable : Chrome récent (App-Bound Encryption). Utilise la connexion interactive (variante B du SKILL.md).");
  else
    console.error("  Es-tu connecté à Zoho dans Chrome ? Quitte Chrome et réessaie, ou utilise la variante B.");
  process.exit(2);
}

if (profilesWithZoho > 1)
  console.error(`~ Cookies Zoho présents dans ${profilesWithZoho} profils Chrome : en cas de doublon (même nom/domaine/chemin) le dernier profil l'emporte — vérifie que c'est le bon compte.`);

// Cookies de session DÉCHIFFRÉS : restreindre l'accès (0600) dès l'écriture, et
// re-forcer les perms au cas où le fichier existait déjà avec des perms plus larges.
writeFileSync(OUT, JSON.stringify({ cookies, origins: [] }, null, 2), { mode: 0o600 });
try { chmodSync(OUT, 0o600); } catch {}

// Rapport SANS valeurs.
const domains = [...new Set(cookies.map((c) => c.domain))].sort();
console.log(`✓ ${cookies.length} cookies zoho extraits (${profilesWithZoho} profil(s)).`);
console.log(`  Domaines : ${domains.join(", ")}`);
console.log(`  Écrit dans : ${OUT} (perms 0600)`);
if (appBoundCount > 0 || undecryptable > 0)
  console.log(`  ⚠ Si la session échoue ensuite, bascule sur la variante B (login interactif).`);
console.error(`⚠ SÉCURITÉ : ${OUT} contient une session Zoho EN CLAIR (cookies d'auth valides).`);
console.error(`  Supprime-le dès la fin de l'extraction :  rm -f ${OUT}`);

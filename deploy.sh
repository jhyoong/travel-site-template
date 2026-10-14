#!/usr/bin/env bash
# Deploy the itinerary site to Cloudflare.
# Safe to run more than once: each step skips work that is already done.
#
# Usage: bash deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

DB_NAME="itinerary-db"
WRANGLER="npx --yes wrangler"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install it from https://nodejs.org/ and try again." >&2
  exit 1
fi

# 1. Log in, if needed.
if ! $WRANGLER whoami 2>/dev/null | grep -q "You are logged in"; then
  echo "== Logging in to Cloudflare"
  $WRANGLER login
fi

# 2. Choose the Worker name. It sets the URL: <name>.<your-subdomain>.workers.dev
CURRENT_NAME="$(sed -n 's/^name = "\(.*\)"$/\1/p' wrangler.toml)"
while true; do
  read -r -p "Worker name, used in the URL [$CURRENT_NAME]: " WORKER_NAME
  WORKER_NAME="${WORKER_NAME:-$CURRENT_NAME}"
  if [[ "$WORKER_NAME" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
    break
  fi
  echo "Use only lowercase letters, digits and dashes (max 63, no dash at the start or end)."
done
if [ "$WORKER_NAME" != "$CURRENT_NAME" ]; then
  node -e '
    const fs = require("fs");
    const t = fs.readFileSync("wrangler.toml", "utf8");
    fs.writeFileSync("wrangler.toml", t.replace(/^name = ".*"$/m, `name = "${process.argv[1]}"`));' "$WORKER_NAME"
  echo "   Set name = \"$WORKER_NAME\" in wrangler.toml"
  echo "   Note: the Worker \"$CURRENT_NAME\" is not deleted. Remove it in the Cloudflare dashboard if you no longer need it."
fi

# 3. Choose a custom domain (optional). The domain must be active in your
#    Cloudflare account. Cloudflare creates the DNS record and certificate.
CURRENT_DOMAIN="$(sed -n 's/^routes = \[{ pattern = "\(.*\)", custom_domain = true }\]$/\1/p' wrangler.toml)"
while true; do
  if [ -n "$CURRENT_DOMAIN" ]; then
    read -r -p "Custom domain, or \"none\" to remove it [$CURRENT_DOMAIN]: " DOMAIN
    DOMAIN="${DOMAIN:-$CURRENT_DOMAIN}"
  else
    read -r -p "Custom domain, e.g. trip.example.com (leave blank to skip): " DOMAIN
  fi
  DOMAIN="$(echo "$DOMAIN" | tr '[:upper:]' '[:lower:]')"
  [ "$DOMAIN" = "none" ] && DOMAIN=""
  if [ -z "$DOMAIN" ] || [[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]]; then
    break
  fi
  echo "Enter a hostname like trip.example.com, without https:// or a path."
done
if [ "$DOMAIN" != "$CURRENT_DOMAIN" ]; then
  # Remove any routes line, then add the new one right after compatibility_date,
  # so it stays above the first [section] header.
  node -e '
    const fs = require("fs");
    let t = fs.readFileSync("wrangler.toml", "utf8").replace(/^routes = .*\n/m, "");
    const d = process.argv[1];
    if (d) t = t.replace(/^(compatibility_date = .*\n)/m,
      `$1routes = [{ pattern = "${d}", custom_domain = true }]\n`);
    fs.writeFileSync("wrangler.toml", t);' "$DOMAIN"
  if [ -n "$DOMAIN" ]; then
    echo "   Set custom domain $DOMAIN in wrangler.toml"
  else
    echo "   Removed custom domain from wrangler.toml"
  fi
fi

# 4. Choose the colour theme. It is stored in data-theme on the <html> line of
#    public/index.html. Pictures of each theme are in sample_themes/.
THEMES="coastal autumn matcha lantern midnight"
CURRENT_THEME="$(sed -n "s/^<html lang=\"en\" data-theme=\"\(.*\)\">$/\1/p" public/index.html)"
CURRENT_THEME="${CURRENT_THEME:-coastal}"
echo "Colour themes: coastal, autumn, matcha (light); lantern, midnight (dark)."
while true; do
  read -r -p "Theme [$CURRENT_THEME]: " THEME
  THEME="$(echo "${THEME:-$CURRENT_THEME}" | tr "[:upper:]" "[:lower:]")"
  if [[ " $THEMES " == *" $THEME "* ]]; then
    break
  fi
  echo "Pick one of: $THEMES"
done
if [ "$THEME" != "$CURRENT_THEME" ]; then
  node -e '
    const fs = require("fs");
    const t = fs.readFileSync("public/index.html", "utf8");
    fs.writeFileSync("public/index.html", t.replace(/^<html lang="en"[^>]*>$/m, `<html lang="en" data-theme="${process.argv[1]}">`));' "$THEME"
  echo "   Set theme $THEME in public/index.html"
fi

# 5. Create the database, if needed, and write its id into wrangler.toml.
if grep -q "REPLACE_WITH_YOUR_D1_DATABASE_ID" wrangler.toml; then
  db_id_of() {
    $WRANGLER d1 list --json 2>/dev/null | node -e '
      let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
        const db = JSON.parse(s).find(d => d.name === process.argv[1]);
        if (db) console.log(db.uuid);
      });' "$DB_NAME"
  }
  DB_ID="$(db_id_of)"
  if [ -z "$DB_ID" ]; then
    echo "== Creating database $DB_NAME"
    $WRANGLER d1 create "$DB_NAME" >/dev/null
    DB_ID="$(db_id_of)"
  else
    echo "== Using existing database $DB_NAME"
  fi
  if [ -z "$DB_ID" ]; then
    echo "Could not find the id of database $DB_NAME." >&2
    exit 1
  fi
  node -e '
    const fs = require("fs");
    const t = fs.readFileSync("wrangler.toml", "utf8");
    fs.writeFileSync("wrangler.toml", t.replace("REPLACE_WITH_YOUR_D1_DATABASE_ID", process.argv[1]));' "$DB_ID"
  echo "   Wrote database_id $DB_ID to wrangler.toml"
fi

# 6. Create the tables. schema.sql only creates what is missing.
echo "== Applying schema.sql"
$WRANGLER d1 execute "$DB_NAME" --remote --file=schema.sql --yes

# schema.sql does not add new columns to a table that already exists.
HAS_LATE_OK="$($WRANGLER d1 execute "$DB_NAME" --remote --json --yes \
  --command "SELECT COUNT(*) AS n FROM pragma_table_info('stops') WHERE name = 'late_ok'" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].results[0].n))')"
if [ "$HAS_LATE_OK" = "0" ]; then
  echo "== Adding the stops.late_ok column"
  $WRANGLER d1 execute "$DB_NAME" --remote --yes \
    --command "ALTER TABLE stops ADD COLUMN late_ok INTEGER NOT NULL DEFAULT 0 CHECK (late_ok IN (0, 1))"
fi

# 7. Deploy the Worker.
echo "== Deploying"
$WRANGLER deploy

# 8. Set the keys. Cloudflare can't show a secret once it is set, so to
#    change existing keys you paste the current ones in first.
# keys_tool <op> <keys json> [name]: prints the new keys JSON.
#   parse: reads pasted text on stdin (JSON, or "name: key" lines)
#   new:   makes keys for the comma-separated names in [name]
#   add, update, delete: change one key
#   names: prints the names
#   show:  prints the keys for the names (one per line) in [name], or all keys
keys_tool() {
  node -e '
    const crypto = require("crypto");
    const [op, json, arg = ""] = process.argv.slice(1);
    const fail = (m) => { console.error(m); process.exit(1); };
    const gen = () => "k_" + crypto.randomBytes(24).toString("hex");
    const keys = json ? JSON.parse(json) : {};
    const out = (k) => console.log(JSON.stringify(k));
    if (op === "parse") {
      let s = ""; process.stdin.on("data", (d) => s += d).on("end", () => {
        let k;
        try { k = JSON.parse(s); } catch {
          k = {};
          for (const line of s.split("\n").map((l) => l.trim()).filter(Boolean)) {
            const i = line.indexOf(":");
            if (i < 1) fail("Could not read this line: " + line);
            k[line.slice(0, i).trim()] = line.slice(i + 1).trim();
          }
        }
        if (!k || typeof k !== "object" || Array.isArray(k)) fail("Expected a JSON object or name: key lines.");
        const e = Object.entries(k);
        if (!e.length) fail("No keys found.");
        if (e.some(([n, v]) => !n || typeof v !== "string" || !v)) fail("Every key needs a name and a value.");
        out(k);
      });
    } else if (op === "new") {
      const names = arg.split(",").map((s) => s.trim()).filter(Boolean);
      if (!names.length) fail("No names given.");
      for (const n of names) keys[n] = gen();
      out(keys);
    } else if (op === "add") {
      if (!arg) fail("No name given.");
      if (arg in keys) fail(arg + " already has a key. Use update to replace it.");
      keys[arg] = gen(); out(keys);
    } else if (op === "update") {
      if (!(arg in keys)) fail("No key named " + arg + ".");
      keys[arg] = gen(); out(keys);
    } else if (op === "delete") {
      if (!(arg in keys)) fail("No key named " + arg + ".");
      if (Object.keys(keys).length === 1) fail("Can not delete the last key.");
      delete keys[arg]; out(keys);
    } else if (op === "names") {
      console.log(Object.keys(keys).join(", "));
    } else if (op === "show") {
      const names = arg ? [...new Set(arg.split("\n").filter(Boolean))] : Object.keys(keys);
      for (const n of names) if (n in keys) console.log("  " + n + ": " + keys[n]);
    }' "$@"
}

if $WRANGLER secret list 2>/dev/null | grep -q '"API_KEYS"'; then
  read -r -p "API_KEYS is already set. Add, update or delete keys? [y/N]: " CHANGE_KEYS
  if [[ "$CHANGE_KEYS" =~ ^[Yy] ]]; then
    while true; do
      echo "Paste your current keys: the JSON, or one \"name: key\" per line. Finish with an empty line."
      PASTED=""
      while IFS= read -r line && [ -n "$line" ]; do PASTED+="$line"$'\n'; done
      if KEYS_JSON="$(printf '%s' "$PASTED" | keys_tool parse "")"; then break; fi
    done
    CHANGED=""
    while true; do
      echo "Keys: $(keys_tool names "$KEYS_JSON")"
      read -r -p "[a]dd, [u]pdate (new key for a name), [d]elete, [s]ave, [q]uit without saving: " ACTION
      case "$ACTION" in
        a|u|d)
          read -r -p "Name: " NAME
          NAME="$(printf '%s' "$NAME" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
          case "$ACTION" in a) OP=add; DONE=Added;; u) OP=update; DONE=Updated;; d) OP=delete; DONE=Deleted;; esac
          if NEXT="$(keys_tool "$OP" "$KEYS_JSON" "$NAME")"; then
            KEYS_JSON="$NEXT"
            if [ "$OP" != "delete" ]; then CHANGED+="$NAME"$'\n'; fi
            echo "   $DONE $NAME (not saved yet)."
          fi
          ;;
        s)
          echo "$KEYS_JSON" | $WRANGLER secret put API_KEYS
          if [ -n "$CHANGED" ]; then
            echo
            echo "New keys (save them now, they are not shown again):"
            keys_tool show "$KEYS_JSON" "$CHANGED"
          fi
          break
          ;;
        q) echo "   Keys not changed."; break ;;
        *) echo "Type a, u, d, s or q." ;;
      esac
    done
  fi
else
  echo "== Setting API_KEYS"
  read -r -p "Key names, separated by commas (e.g. alice,bob,claude-agent): " NAMES
  KEYS_JSON="$(keys_tool new "" "$NAMES")"
  echo "$KEYS_JSON" | $WRANGLER secret put API_KEYS
  echo
  echo "Your keys (save them now, they are not shown again):"
  keys_tool show "$KEYS_JSON"
fi

echo
echo "Done. Open the workers.dev URL printed by the deploy step and sign in with one of your keys."

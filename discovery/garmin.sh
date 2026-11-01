#!/usr/bin/env bash
# Phase 0 discovery helper. Reads GARMIN_API_KEY from .dev.vars and never prints it.
# Real responses are written to discovery/raw/ (git-ignored: personal health data).
#
# Usage:
#   discovery/garmin.sh token                 # exchange API key for an access token
#   discovery/garmin.sh get <path> <name>     # GET <path>, save to discovery/raw/<name>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW="$ROOT/discovery/raw"
TOKEN_FILE="$RAW/.token"
BASE_URL="${GARMIN_BASE_URL:-https://personal.connectapi.garmin.com}"

mkdir -p "$RAW"
chmod 700 "$RAW"

read_key() {
  grep -E '^GARMIN_API_KEY=' "$ROOT/.dev.vars" | head -1 | cut -d= -f2-
}

cmd_token() {
  local key status
  key="$(read_key)"
  [ -n "$key" ] && [ "$key" != "your-key-here" ] || { echo "GARMIN_API_KEY not set in .dev.vars" >&2; exit 1; }
  umask 077
  status=$(curl -sS -o "$TOKEN_FILE" -w '%{http_code}' -X POST \
    -H 'Accept: */*' -H "Authorization: ApiKey $key" \
    "$BASE_URL/personalapitoken-service/personal-api/personal-api-key/token")
  unset key
  echo "token endpoint: HTTP $status"
  if [ "$status" != "200" ]; then
    echo "response body:"; cat "$TOKEN_FILE"; echo; rm -f "$TOKEN_FILE"; exit 1
  fi
  # Print only non-secret JWT claims (expiry, issued-at) to learn the token lifetime.
  python3 -I - "$TOKEN_FILE" <<'PY'
import base64, json, sys, time
tok = open(sys.argv[1]).read().strip()
parts = tok.split(".")
print(f"token format: {'JWT' if len(parts) == 3 else 'opaque'}, length {len(tok)}")
if len(parts) == 3:
    pad = parts[1] + "=" * (-len(parts[1]) % 4)
    claims = json.loads(base64.urlsafe_b64decode(pad))
    print("claim names:", sorted(claims))
    iat, exp = claims.get("iat"), claims.get("exp")
    if exp:
        print(f"expires in {round((exp - time.time()) / 60)} min" + (f" (lifetime {round((exp - iat) / 60)} min)" if iat else ""))
PY
}

cmd_get() {
  local path="$1" name="$2" status
  [ -f "$TOKEN_FILE" ] || cmd_token >/dev/null
  status=$(curl -sS -o "$RAW/$name" -w '%{http_code}' \
    -H "Accept: ${ACCEPT:-application/json}" -H "Authorization: Bearer $(cat "$TOKEN_FILE")" \
    "$BASE_URL$path")
  echo "$path -> HTTP $status, $(wc -c < "$RAW/$name" | tr -d ' ') bytes -> raw/$name"
}

case "${1:-}" in
  token) cmd_token ;;
  get) shift; cmd_get "$@" ;;
  *) sed -n '2,8p' "$0"; exit 1 ;;
esac

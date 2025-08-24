# ListenMode Backend (Cloudflare Workers + Hono)

Edge API for the ListenMode Obsidian plugin. Proxies TTS to Azure, issues short‑lived JWTs, enforces monthly quotas in D1, and caches voices in KV.

Endpoints
- POST /v1/auth/validate → License‑Key → short‑lived JWT (15 min)
- GET  /v1/auth/usage → current period usage (Bearer JWT)
- POST /v1/tts → streaming proxy to Azure TTS (Bearer JWT)
- GET  /v1/voices → voices list with 24h KV cache

Bindings
- D1: listenmode-db (licenses, usage_monthly, events)
- KV: VOICES_CACHE (voices cache)
- Secrets/vars: AZURE_TTS_API_KEY, AZURE_TTS_REGION, JWT_SECRET, ENVIRONMENT

Requirements
- Bun (bun.sh)
- Wrangler (bunx wrangler …)
- jq (optional for CLI JSON)

Project layout
- wrangler.toml — bindings/config
- .dev.vars — local-only env vars (JWT secret, Azure region, optional Azure key)
- migrations/0001_initial.sql — D1 schema
- src/
  - index.ts — app entry, CORS, routes
  - types.ts — types and bindings
  - auth/ — jwt helpers + routes
  - db/ — D1 queries
  - tts/ — TTS proxy route
  - voices/ — voices route

Local development
1) Configure local env
- Edit ./.dev.vars:
  JWT_SECRET="development-secret"
  AZURE_TTS_REGION="westeurope"
  # Optional (required for /v1/voices and /v1/tts)
  # AZURE_TTS_API_KEY=your_azure_key_here

2) Apply D1 migration (local DB)
- From the repository root:
  bunx --bun wrangler d1 execute listenmode-db --local \
    --config="$(pwd)/listenmode-backend/wrangler.toml" \
    --file="$(pwd)/listenmode-backend/migrations/0001_initial.sql"

3) Seed a test license (plan=basic, active)
- Choose a key:
  LICENSE=LM-TEST-123
- Hash it (macOS):
  HASH=$(printf "%s" "$LICENSE" | shasum -a 256 | awk '{print $1}')
- Insert into local D1:
  bunx --bun wrangler d1 execute listenmode-db --local \
    --config="$(pwd)/listenmode-backend/wrangler.toml" \
    --command "INSERT OR IGNORE INTO licenses (license_key_hash, plan, status) VALUES ('$HASH','basic','active');"

4) Run the worker (local dev)
- From repo root or this folder:
  bunx --bun wrangler dev --local --config="$(pwd)/listenmode-backend/wrangler.toml"
- API: http://localhost:8787

Smoke tests
- Health:
  curl -s http://localhost:8787/health | jq .
- Validate license → JWT:
  curl -s -X POST http://localhost:8787/v1/auth/validate \
    -H 'Content-Type: application/json' \
    -d '{"license_key":"LM-TEST-123"}' | jq .
- Save token:
  TOKEN=$(curl -s -X POST http://localhost:8787/v1/auth/validate -H 'Content-Type: application/json' -d '{"license_key":"LM-TEST-123"}' | jq -r '.data.token')
- Usage:
  curl -s http://localhost:8787/v1/auth/usage -H "Authorization: Bearer $TOKEN" | jq .

Optional (requires AZURE_TTS_API_KEY in .dev.vars)
- Voices:
  curl -s "http://localhost:8787/v1/voices?region=westeurope" | jq .
- TTS streaming → mp3:
  cat > body.json <<'JSON'
{"ssml":"<speak version=\"1.0\" xml:lang=\"en-US\"><voice name=\"en-US-Ava:DragonHDLatestNeural\"><prosody rate=\"+10%\">Hello from ListenMode on Cloudflare Workers.</prosody></voice></speak>","outputFormat":"audio-24khz-48kbitrate-mono-mp3","language":"en-US"}
JSON
  curl -s -X POST http://localhost:8787/v1/tts \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --data-binary @body.json -o out.mp3
  # macOS playback: afplay out.mp3

Production
1) Create resources
- D1:
  bunx --bun wrangler d1 create listenmode-db
- KV:
  bunx --bun wrangler kv:namespace create VOICES_CACHE
- Put IDs into wrangler.toml [[d1_databases]] and [[kv_namespaces]]

2) Secrets (never commit secrets)
- bunx --bun wrangler secret put AZURE_TTS_API_KEY
- bunx --bun wrangler secret put AZURE_TTS_REGION
- bunx --bun wrangler secret put JWT_SECRET
- bunx --bun wrangler secret put ADMIN_API_TOKEN

3) Migrate & deploy
- bunx --bun wrangler d1 execute listenmode-db \
    --file="$(pwd)/listenmode-backend/migrations/0001_initial.sql"
- bunx --bun wrangler deploy

CORS & security
- CORS limited to Obsidian + localhost (see src/index.ts); adjust as needed.
- JWTs are short-lived (15 min). License keys stored as SHA‑256 hashes.
- No SSML persisted; only audit metadata in D1.

Notes
- Bun-first workflow. Prefer bunx wrangler …
- If schema changes, add a new migration file and execute it locally and remotely.
- For Azure endpoints in dev, restart wrangler after editing .dev.vars.

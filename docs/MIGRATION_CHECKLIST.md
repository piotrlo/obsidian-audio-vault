# AudioVault Backend Migration Checklist

## Przed migracją

### 1. Zaktualizowane nazwy w backendzie ✅
- [x] `package.json`: `"name": "audiovault-backend"`
- [x] `wrangler.toml`: `name = "audiovault-backend"`
- [x] `wrangler.toml`: `database_name = "audiovault-db"`
- [x] `package.json`: skrypt migrations → `audiovault-db`
- [x] `README.md`: wszystkie komendy → `audiovault-backend`
- [x] `migrations/0001_initial.sql`: komentarz → AudioVault

### 2. Zaktualizowane nazwy w repo głównym ✅
- [x] `package.json`: usunięto skrypty backendowe
- [x] `.husky/pre-push`: zakomentowano backend tests
- [x] `.gitignore`: zakomentowano backend artifacts

## Migracja do nowego repo

### 1. Utwórz nowe repo `audiovault-backend`
```bash
# Na GitHub
gh repo create audiovault-backend --private --description "AudioVault backend service (Cloudflare Workers + Hono)"
```

### 2. Przenieś folder backendu
```bash
# W repo głównym
git mv listenmode-backend audiovault-backend
cd audiovault-backend
git remote set-url origin https://github.com/piotrlo/audiovault-backend.git
git push -u origin main
```

### 3. Skonfiguruj Cloudflare Git Integration
```bash
# W Cloudflare Dashboard
# 1. Workers & Pages → audiovault-backend
# 2. Settings → Git integration
# 3. Connect to Git → audiovault-backend repo
# 4. Production branch: main
# 5. Root directory: / (root)
# 6. Build command: (pusty - Cloudflare automatycznie bundluje TypeScript)
# 7. Deploy command: npx wrangler deploy
```

**Uwagi**:
- Jeśli build failuje z błędem `@hono/cookie`: usuń z `package.json` (funkcje dostępne z `hono/cookie`)
- **Build command**: zostaw puste - Cloudflare automatycznie bundluje TypeScript
- **Deploy command**: `npx wrangler deploy` - Cloudflare używa esbuild do kompilacji
- **wrangler.toml**: MUSI być w repo (bez sekcji bindings) - Cloudflare używa swoich bindings z Dashboard

### 4. Zbinduj zasoby
```bash
# Po Git integration, w Cloudflare Dashboard
# 1. Settings → Variables
# 2. Bindings → D1: audiovault-db
# 3. Bindings → KV: VOICES_CACHE
# 4. Environment Variables → wszystkie sekrety

# WAŻNE: wrangler.toml jest teraz w repo (bez sekcji bindings)
# Cloudflare używa swoich bindings z Dashboard zamiast konfiguracji z pliku
# Usuń [[d1_databases]] i [[kv_namespaces]] z wrangler.toml

# SPRAWDŹ: Po deployu testuj /health (powinno działać) i /admin (może nie działać bez bindings)
```

### 5. Ustaw sekrety w nowym repo
```bash
# W audiovault-backend repo
bunx --bun wrangler secret put AZURE_TTS_API_KEY
bunx --bun wrangler secret put AZURE_TTS_REGION
bunx --bun wrangler secret put JWT_SECRET
bunx --bun wrangler secret put ADMIN_API_TOKEN
bunx --bun wrangler secret put STRIPE_SECRET_KEY
bunx --bun wrangler secret put STRIPE_WEBHOOK_SECRET
bunx --bun wrangler secret put RESEND_API_KEY
bunx --bun wrangler secret put RESEND_FROM_EMAIL
```

## Po migracji

### 1. Usuń backend z repo głównego
```bash
# W repo głównym
git rm -rf audiovault-backend
git commit -m "Remove backend (moved to audiovault-backend repo)"
```

### 2. Zaktualizuj dokumentację
- [ ] `README.md`: link do backendu
- [ ] `docs/`: instrukcje deployu
- [ ] `pre-release-plan.md`: status PR-3

### 3. Test CI/CD
- [ ] Push do `audiovault-backend` → automatyczny deploy
- [ ] Smoke test: `/health` (powinno działać)
- [ ] Test `/admin` (może nie działać bez bindings)
- [ ] Konfiguracja bindings w Cloudflare Dashboard
- [ ] Finalny test: `/v1/voices`, `/v1/auth/validate`, `/v1/tts`

## Uwagi

- **D1 database_id**: pozostaje ten sam (e6dc4370-187b-465a-a3af-07fb8dc2e60b)
- **KV namespace**: pozostaje ten sam (abb4132622d54d239bd1c275774dd419)
- **Sekrety**: muszą być ustawione ponownie w nowym repo
- **CORS**: automatycznie zaktualizuje się na `audio-vault.app`

## Rollback

Jeśli coś pójdzie nie tak:
1. Przywróć `listenmode-backend/` w repo głównym
2. Cofnij zmiany w `package.json` i `.gitignore`
3. Przywróć skrypty backendowe
4. Zaktualizuj `wrangler.toml` z powrotem na `listenmode-backend`

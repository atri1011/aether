# AETHER

Magazine-editorial frontend + Node proxy for MissAV-class metadata (Recombee) and surrit HLS playback.

## Quick start

```bash
cd aether
npm install
pip install curl_cffi   # required for stream resolve + list scrape
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:8787

## Scripts

| Command | What |
|---------|------|
| `npm run dev` | Vite + API together |
| `npm run dev:server` | API only |
| `npm run build` | production frontend → `dist/` |
| `npm start` | serve API + `dist/` (local prod-like) |

## Production (Docker on VPS)

Host OS may be too old for Node 20 (e.g. CentOS 7 glibc). Prefer Docker:

```bash
# first-time (on server)
git clone https://github.com/atri1011/aether.git /opt/aether
cd /opt/aether
cp .env.example .env   # or create .env — see Env below
# edit SITE_PASSWORD / AUTH_SECRET
docker compose up -d --build
# nginx: copy deploy/nginx-ljl.050415.xyz.conf → /etc/nginx/conf.d/ and reload
```

### Update deployment

```bash
ssh root@YOUR_VPS
cd /opt/aether
git pull origin main
docker compose up -d --build
docker logs -f aether   # optional
```

One-liner from your laptop (after `git push`):

```bash
ssh root@YOUR_VPS 'cd /opt/aether && git pull origin main && docker compose up -d --build'
```

Notes:

- `.env` is **not** in git — keep `SITE_PASSWORD` / `AUTH_SECRET` only on the server.
- Cache volume `aether-cache` persists across rebuilds.
- Change password: edit `/opt/aether/.env` → `docker compose up -d`.

## Env

See `../docs/api-contract.md`. Optional:

```
PORT=8787
CACHE_DIR=./.cache/aether
RECOMBEE_PUBLIC_TOKEN=...
MISS_DETAIL_BASES=https://missav.ai,https://missav.ws
MISS_LANG=zh

# Access gate (recommended on public VPS)
SITE_PASSWORD=your-strong-passphrase
AUTH_SECRET=long-random-string          # optional but recommended; HMAC key for session cookies
AUTH_TTL_HOURS=168                      # session lifetime, default 7 days
AUTH_SECURE_COOKIE=1                    # set Secure cookie flag (use behind HTTPS)
```

### Access gate

- Leave `SITE_PASSWORD` empty → site is open (local dev default).
- Set `SITE_PASSWORD` → full-screen passphrase wall; **all `/api/*` routes** (except health/auth) require a server-signed **HttpOnly** session cookie.
- Password never ships to the frontend. Deleting the gate UI / flipping React state cannot unlock APIs.
- Login is rate-limited per IP (6 tries / 15 min → temporary lock).

## Notes

- List/search use signed Recombee public API + real scenarios (`desktop-home-recommended`, segments).
- Stream UUID: `curl_cffi` detail parse on missav.ws.
- Playback: `/api/hls` → long-running Python media worker (`MEDIA_PORT=18790`) with curl_cffi session reuse; one-shot fallback if worker down.
- Watch page still accepts manual UUID/m3u8 (auto-proxied).
- Cache is last-success on disk; cold start needs network.
- VPS needs: Node 20+, Python 3.10+, `pip install curl_cffi`.

# AETHER

Magazine-editorial frontend + Node proxy for MissAV-class metadata (Recombee), surrit HLS playback, and a Huangguo-only AI short-drama library.

## Docs

| Doc | Audience |
|-----|----------|
| **[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)** | Local setup, architecture, conventions, debug, deploy checklist |
| **[docs/OPTIMIZATION.md](./docs/OPTIMIZATION.md)** | Backlog of perf/security/structure work — phases, steps, acceptance |
| [CLAUDE.md](./CLAUDE.md) | Short map for AI assistants |
| `../docs/api-contract.md` | Upstream + DTO contract (sibling of this repo) |
| `src/styles/tokens.css`, `design-system/aether-search/` | Current UI tokens and search design notes |

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
| `npm test` | offline Node contracts, pagination and player checks |
| `npm run test:python` | offline Python parser, media and Huangguo checks |

## AI short dramas

- Open **AI 短剧 / AI Dramas** in the navigation (`/dramas`). Only Huangguo's public `ai-duanju` catalog is included, ordered by popularity, with manual 24-item pagination.
- `/dramas/:id?episode=ep-N` supports episode selection, previous/next episode, retry, theatre mode and fullscreen. Back to library preserves the originating page.
- Covers are decoded server-side via `/api/dramas/:id/cover`. HLS and native MP4 both use the existing same-origin `/api/hls` proxy and access gate.
- No upstream account, legacy API, alternate providers, downloads, or preview/neighbor-episode fallback. Paid or unavailable episodes return an error.
- Requires the existing `curl_cffi` dependency; no additional packages or credentials. Exact source hosts are allowlisted, redirects validated and connections pinned to public IPs. Source requests bypass environment proxies; if system DNS returns Fake-IP/private addresses, the adapter uses a bounded TLS-verified `dns.alidns.com` lookup. Failed validation is not bypassed.

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

- Video lists in browse, search, categories, actress works, and topic details use manual pagination. Page URLs survive refresh/back navigation; changing video filters or sort returns to page 1.
- List/search use signed Recombee public API + real scenarios (`desktop-home-recommended`, segments).
- Stream UUID: `curl_cffi` detail parse on missav.ws.
- Playback: `/api/hls` → long-running Python media worker (`MEDIA_PORT=18790`) with curl_cffi session reuse; one-shot fallback if worker down.
- Watch page still accepts manual UUID/m3u8 (auto-proxied).
- External Chinese subtitles (SUB-01): when a video has no bundled Chinese subs, the watch page probes Xunlei oracle + SubtitleCat via `GET /api/video/:id/subtitles`; selecting a candidate loads converted WebVTT through same-origin `GET /api/subtitle?url=` (host allowlist enforced in Node and Python).
- Cache is last-success on disk; cold start needs network.
- VPS needs: Node 20+, Python 3.10+, `pip install curl_cffi`.

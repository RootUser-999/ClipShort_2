# ClipShort

Turn long YouTube videos into 1080×1920 vertical clips (max 60s) ready for TikTok, Instagram Reels, and YouTube Shorts.

## Folder Structure

- `/apps/web` — React + TypeScript + Tailwind CSS frontend (timeline editor, YouTube IFrame preview, 9:16 framing preview, SSE progress UI)
- `/apps/api` — Express + TypeScript backend (`yt-dlp` section fetching, `ffmpeg` 9:16 rendering, BullMQ + Redis queue with in-memory fallback, rate limiting, cleanup cron)
- `/packages/shared` — Shared TypeScript types, strict YouTube URL parser, millisecond timeline math, filename sanitizer, ffmpeg filter builder, and Zod schemas
- `/tests` — `node:test` unit and integration tests
- `/server.ts` — Full-stack Express + Vite server entry point

## Prerequisites

- **Local without Docker**: Node.js 22+, `ffmpeg` + `ffprobe`, `yt-dlp`, and optionally Redis 7+
- **Docker**: Docker Engine + Docker Compose v2 (`docker compose`)

## One-Command Local Start (Docker)

```bash
cp .env.example .env
docker compose up --build
```

Open `http://localhost:3000`.

## Local Development (Without Docker)

```bash
cp .env.example .env
npm install
npm run dev
```

To run the test suite:

```bash
npm test
```

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP server listen port |
| `NODE_ENV` | `development` | `development` or `production` |
| `APP_ORIGIN` | `http://localhost:3000` | Allowed CORS origin |
| `TEMP_DIR` | `/tmp/clipshort` | Ephemeral directory for downloaded slices and rendered clips |
| `REDIS_URL` | *(empty)* | Redis connection string (`redis://redis:6379`). Uses in-memory queue when unset |
| `MAX_VIDEO_DURATION` | `43200` | Maximum source video length in seconds (default 12 hours) |
| `MAX_CLIP_DURATION` | `60` | Maximum clip duration in seconds |
| `MIN_CLIP_DURATION` | `1` | Minimum clip duration in seconds |
| `JOB_TIMEOUT_MS` | `300000` | Per-job render timeout in ms (default 5 minutes) |
| `CONCURRENCY` | `2` | Maximum concurrent clip renders |
| `RETENTION_MS` | `1800000` | Temp file retention in ms before auto-expiry (default 30 minutes) |
| `MIN_FREE_DISK_MB` | `500` | Minimum free disk space required before starting a job |
| `RATE_LIMIT_INFO_PER_MIN` | `10` | Per-IP `/api/video/info` requests per minute |
| `RATE_LIMIT_CLIPS_PER_HOUR` | `5` | Per-IP `/api/clips` creations per hour |
| `YTDLP_PATH` | *(auto)* | Path to `yt-dlp` binary (auto-checks `./.bin/yt-dlp` then `PATH`) |
| `YTDLP_COOKIES_FILE` | *(empty)* | Optional path to server-side Netscape `cookies.txt` |
| `AUTO_UPDATE_YTDLP` | `false` | Enable `yt-dlp -U` on startup and every 24h |
| `TURNSTILE_ENABLED` | `false` | Enable Cloudflare Turnstile bot protection on clip creation |
| `TURNSTILE_SITE_KEY` | *(empty)* | Cloudflare Turnstile public site key |
| `TURNSTILE_SECRET_KEY` | *(empty)* | Cloudflare Turnstile secret key |
| `ALLOW_ONLY_CC_OR_OWN` | `false` | Show prominent rights/Creative Commons banner |
| `DMCA_CONTACT_EMAIL` | `dmca@clipshort.example` | Contact email displayed on the DMCA modal |

## Updating `yt-dlp`

YouTube frequently updates player signatures. ClipShort supports automatic daily updates when `AUTO_UPDATE_YTDLP=true` (enabled in the Dockerfile). To update manually:

```bash
# Inside Docker
docker compose exec app yt-dlp -U

# Or rebuild the container image
docker compose build --no-cache app && docker compose up -d
```

## Server-Side Cookies Setup (Optional)

If YouTube responds with `"Sign in to confirm you're not a bot"` on a datacenter IP:
1. Export cookies from a dedicated non-personal browser profile in Netscape `cookies.txt` format.
2. Mount the file read-only into the container (e.g., `./cookies.txt:/app/cookies.txt:ro`).
3. Set `YTDLP_COOKIES_FILE=/app/cookies.txt` in `.env`.
Never ask end users for their YouTube credentials.

## Deploying to Production (VPS + Reverse Proxy)

> **Important:** Serverless platforms (e.g., Vercel, Netlify Functions, AWS Lambda) are **not suitable** for the backend because they impose short request timeouts, lack persistent local `/tmp` scratch space for `ffmpeg`/`yt-dlp`, and cannot maintain long-lived SSE streams or BullMQ workers.

Deploy on a VPS with **at least 2 vCPU and 4 GB RAM** using Docker Compose behind **Caddy** or **Nginx** with HTTPS:

### Example Caddyfile

```caddy
clipshort.example.com {
    reverse_proxy localhost:3000 {
        flush_interval -1
    }
}
```

### Nginx Notes

- Disable proxy buffering on SSE routes (`proxy_buffering off;`) and set `proxy_read_timeout 360s;`.
- Enforce request body limits (`client_max_body_size 1m;`).

## Troubleshooting

- **`ffmpeg` or `yt-dlp` not found**: Confirm both binaries exist in `PATH` or set `FFMPEG_PATH` / `YTDLP_PATH`.
- **SSE progress stalls behind proxy**: Ensure `proxy_buffering off` (Nginx) or `flush_interval -1` (Caddy) is configured; ClipShort also automatically falls back to polling `/api/clips/:jobId`.
- **Low disk space error**: Check `/tmp/clipshort` cleanup logs or increase host disk / lower `RETENTION_MS`.

## Legal Notice

ClipShort does not host or permanently archive third-party videos. Temporary files are automatically deleted after download or within 30 minutes. Users are solely responsible for ensuring they own or have permission to clip and redistribute any processed content.

FROM node:22-bookworm-slim

# Install ffmpeg and ca-certificates / curl for yt-dlp standalone binary
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install latest standalone yt-dlp_linux binary (no Python version drift)
RUN curl -L --fail https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
ENV TEMP_DIR=/tmp/clipshort
ENV AUTO_UPDATE_YTDLP=true

RUN mkdir -p /tmp/clipshort

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD sh -c 'curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null || exit 1'

CMD ["node", "server.ts"]

# syntax=docker/dockerfile:1

############################
# 1. Build the web frontend
############################
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci && npm cache clean --force
COPY web/ ./
COPY packages/core /packages/core
RUN npm run build

############################
# 2. Build the Go binary
############################
FROM golang:1.26-alpine AS gobuild
# Work around a QEMU user-mode emulation bug (golang/go#77572) that panics
# the Go compiler with "runtime error: growslice" when cross-building
# linux/arm64 on amd64 runners (the publish workflow pins QEMU 7.0.0 to fix
# an npm SIGILL; QEMU 10.0.6+ fixes this Go bug natively).
ENV GODEBUG=madvdontneed=0
# apk can hit transient DNS/network errors fetching the Alpine index; retry a
# few times before giving up so a flaky mirror doesn't kill the whole build.
RUN set -eux; \
    for i in $(seq 1 5); do \
      apk add --no-cache git && break; \
      echo "apk add git failed (attempt $i/5), retrying in 5s..."; \
      sleep 5; \
    done; \
    test -x /usr/bin/git || { echo "apk add git failed permanently"; exit 1; }
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY migrations/ ./migrations/
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w -X github.com/nexora/nexora/internal/api.Version=${VERSION}" -o /out/nexora ./cmd/nexora

############################
# 3. Minimal runtime image
############################
FROM alpine:3.20 AS runtime

# Same retry wrapper: transient DNS errors on the Alpine mirror must not fail the build.
RUN set -eux; \
    for i in $(seq 1 5); do \
      apk add --no-cache ca-certificates tzdata wget ffmpeg && break; \
      echo "apk add runtime deps failed (attempt $i/5), retrying in 5s..."; \
      sleep 5; \
    done; \
    test -x /usr/bin/wget || { echo "apk add runtime deps failed permanently"; exit 1; }; \
    addgroup -S -g 101 nexora && adduser -S -u 100 -G nexora nexora && \
    mkdir -p /app/data/cache/thumbnails /app/web && \
    chown -R nexora:nexora /app

COPY --from=gobuild /out/nexora /app/nexora
COPY --from=web /web/dist /app/web

USER nexora
WORKDIR /app

ENV NEXORA_DATA_DIR=/app/data \
    NEXORA_DATABASE_PATH=/app/data/nexora.db \
    NEXORA_THUMBNAIL_CACHE_DIR=/app/data/cache/thumbnails \
    NEXORA_WEB_ROOT=/app/web \
    NEXORA_LISTEN_ADDR=:8080

VOLUME ["/app/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O - http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/app/nexora"]

# syntax=docker/dockerfile:1

############################
# 1. Build the web frontend
# Pinned to $BUILDPLATFORM: dist/ is arch-independent, so we build it ONCE
# natively on the runner instead of emulating node for linux/arm64.
############################
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci && npm cache clean --force
COPY web/ ./
COPY packages/core /packages/core
RUN npm run build

############################
# 2. Build the Go binary
# Pinned to $BUILDPLATFORM + explicit GOOS/GOARCH cross-compile: running the
# arm64 Go *compiler* under QEMU user-mode emulation segfaults on this package
# set ("internal/storage: compile: signal: segmentation fault"). With
# CGO_ENABLED=0 the produced binaries are identical to native builds.
############################
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS gobuild
ARG TARGETOS
ARG TARGETARCH
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
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} go build -trimpath -ldflags="-s -w -X github.com/nexora/nexora/internal/api.Version=${VERSION}" -o /out/nexora ./cmd/nexora

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

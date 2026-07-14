# syntax=docker/dockerfile:1

############################
# 1. Build the web frontend
############################
FROM node:20-alpine AS web
WORKDIR /web
# Install dependencies first for better layer caching.
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

############################
# 2. Build the Go binary
############################
FROM golang:1.26-alpine AS gobuild
RUN apk add --no-cache git
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w -X github.com/nexora/nexora/internal/api.Version=${VERSION}" -o /out/nexora ./cmd/nexora

############################
# 3. Minimal runtime image
############################
FROM alpine:3.20 AS runtime

# Runtime essentials: CA certs for outbound TLS (e.g. SMTP, OIDC later) and
# timezone data for correct log timestamps.
RUN apk add --no-cache ca-certificates tzdata wget && \
    addgroup -S nexora && adduser -S nexora -G nexora && \
    mkdir -p /app/data/cache/thumbnails /app/web && \
    chown -R nexora:nexora /app

# Copy the static binary.
COPY --from=gobuild /out/nexora /app/nexora
# Copy the built web UI (index.html + assets).
COPY --from=web /web/dist /app/web

# Run as the unprivileged user.
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

# Drop Linux capabilities for a more secure default.
ENTRYPOINT ["/app/nexora"]

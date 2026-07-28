# 🌐 Tailscale Integration

Nexora has first-class support for [Tailscale](https://tailscale.com) — a zero-config VPN that connects your devices securely. With Tailscale, you can:

- **Access Nexora from any tailnet device** without exposing ports to the public internet
- **Auto-discover the server** in the Tauri desktop app (no manual URL entry)
- **Create share links** that work across your tailnet
- **Optionally expose shares publicly** via Tailscale Funnel

## Architecture

```
┌─────────────────┐     Tailscale Mesh      ┌──────────────────┐
│  Tauri Desktop  │◄──────────────────────►│  Nexora Server   │
│  (any device)   │   MagicDNS + HTTPS     │  (this machine)  │
│                 │                        │  pms2:80         │
│  Auto-discovers │                        │  tailscale serve │
│  via MagicDNS   │                        │  → :443 HTTPS    │
└─────────────────┘                        └──────────────────┘
```

## Setup

### 1. Tailscale Serve (private — tailnet only)

Makes Nexora available via HTTPS to all devices on your tailnet:

```bash
sudo tailscale serve --bg --https 443 http://localhost:80
```

Now access: **https://pms2.tail58d7ea.ts.net**

### 2. Restart Nexora

After running `tailscale serve`, restart the Nexora container to pick up the Tailscale BaseURL:

```bash
docker compose restart nexora
```

### 3. [Optional] Tailscale Funnel (public internet)

If you want to share files with people **not** on your tailnet, enable Funnel:

```bash
sudo tailscale funnel --bg --https 443 http://localhost:80
```

**⚠️ Warning:** This makes your Nexora instance publicly accessible.

## Tauri Auto-Discovery

The Tauri desktop app automatically probes these hosts in order:

1. `https://pms2.tail58d7ea.ts.net` (MagicDNS — requires Tailscale Serve)
2. `http://100.67.251.1:80` (direct Tailscale IP — always works)
3. Manual URL entry (fallback)

When you launch the Tauri app on any tailnet device, it auto-connects — no configuration needed.

## Configuration

| File | Setting | Purpose |
|------|---------|---------|
| `.env` | `NEXORA_BASE_URL=https://pms2.tail58d7ea.ts.net` | Share links use Tailscale URL |
| `docker-compose.yml` | `NEXORA_CORS_ORIGINS` | Allows Tailscale origins for CORS |
| `web/src/api/client.ts` | `TAILSCALE_HOSTS` | Tauri auto-discovery probe list |

## HTTPS via Tailscale Serve

HTTPS is handled by Tailscale Serve with auto-provisioned Let's Encrypt certificates.
No browser warnings — fully trusted TLS.

- `https://pms2.tail58d7ea.ts.net` — HTTPS with valid cert ✅
- `http://pms2.tail58d7ea.ts.net` — HTTP fallback (redirects to HTTPS via Tailscale)

## Helper Script

```bash
# Quick status check
./scripts/setup-tailscale.sh status

# Enable Tailscale Serve (private)
./scripts/setup-tailscale.sh serve

# Enable Tailscale Funnel (public) — with confirmation prompt
./scripts/setup-tailscale.sh funnel

# Disable all Tailscale proxying
./scripts/setup-tailscale.sh stop
```

## Testing

From any tailnet device:

```bash
# Browser
curl -s https://pms2.tail58d7ea.ts.net/healthz

# Tauri app — launches and auto-connects
# (build with `cd desktop && npm run tauri build`)
```

## Troubleshooting

- **Can't reach the Tailscale URL** → ensure the device is connected to Tailscale (`tailscale status`)
- **Share links point to localhost** → check `NEXORA_BASE_URL` in `.env` and restart the container
- **Tauri app can't auto-discover** → try adding the Tailscale IP manually in the connection screen

#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# Nexora — Tailscale Setup & Management
# ======================================================================
# This script sets up Tailscale Serve / Funnel for your Nexora instance.
# Run it once to expose Nexora via your tailnet, then use the Tauri app
# which auto-discovers the server.
#
# Prerequisites:
#   - Tailscale installed and logged in
#   - Nexora running on localhost:80 (from docker-compose)
#
# Usage:
#   ./scripts/setup-tailscale.sh [serve|funnel|status|stop]
# ──────────────────────────────────────────────────────────────────────

set -euo pipefail

TAILSCALE_HOSTNAME="pms2"
TAILSCALE_DOMAIN="tail58d7ea.ts.net"
LOCAL_TARGET="http://localhost:80"
MAGICDNS_URL="https://${TAILSCALE_HOSTNAME}.${TAILSCALE_DOMAIN}"

case "${1:-status}" in
  serve)
    echo "▶ Setting up Tailscale Serve (private — tailnet only)..."
    echo "  Target: ${LOCAL_TARGET}"
    echo "  URL:    ${MAGICDNS_URL}"
    echo ""
    sudo tailscale serve --bg --https 443 "${LOCAL_TARGET}"
    echo ""
    echo "✅ Done! Nexora is now available at:"
    echo "   ${MAGICDNS_URL}"
    echo "   (only devices on your tailnet can reach it)"
    echo ""
    echo "Next step: restart Nexora container to pick up the new BASE_URL:"
    echo "  docker compose restart nexora"
    ;;

  funnel)
    echo "▶ Setting up Tailscale Funnel (public internet)..."
    echo "  Target: ${LOCAL_TARGET}"
    echo "  URL:    ${MAGICDNS_URL}"
    echo ""
    echo "WARNING: This makes your Nexora instance accessible to ANYONE"
    echo "with the link — not just your tailnet. Use with caution!"
    echo ""
    read -r -p "Continue? [y/N] " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
      echo "Aborted."
      exit 1
    fi
    sudo tailscale funnel --bg --https 443 "${LOCAL_TARGET}"
    echo ""
    echo "✅ Done! Nexora is now publicly accessible at:"
    echo "   ${MAGICDNS_URL}"
    echo ""
    echo "Share links will use this URL automatically."
    ;;

  status)
    echo "=== Tailscale Serve Status ==="
    tailscale serve status 2>&1 || echo "  Not configured"
    echo ""
    echo "=== Tailscale Funnel Status ==="
    tailscale funnel status 2>&1 || echo "  Not configured"
    echo ""
    echo "=== Tailscale IP ==="
    tailscale ip -4
    echo ""
    echo "=== MagicDNS ==="
    echo "  ${MAGICDNS_URL}"
    ;;

  stop)
    echo "▶ Stopping Tailscale Serve/Funnel..."
    sudo tailscale serve --https 443 off 2>/dev/null || true
    sudo tailscale funnel --https 443 off 2>/dev/null || true
    echo "✅ Done."
    ;;

  *)
    echo "Usage: $0 [serve|funnel|status|stop]"
    echo ""
    echo "Commands:"
    echo "  serve    Expose Nexora via Tailscale Serve (tailnet only)"
    echo "  funnel   Expose Nexora via Tailscale Funnel (public)"
    echo "  status   Show current Tailscale proxy status"
    echo "  stop     Stop all Tailscale proxying"
    exit 1
    ;;
esac

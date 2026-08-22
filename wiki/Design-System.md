# Design System

> **Source of truth:** `web/src/index.css` (`@theme` + CSS vars). This page is a readable summary — if they diverge, `index.css` wins. Full prose in [docs/design-system.md](../docs/design-system.md).

## Brand

- **Logo** `web/public/logo.svg` (SVG, clear space = logo width), `favicon.svg` (32 px min).
- **Primary accent** `#5B8CFF` (`--color-accent`) + secondary `#7A5CFF`, tertiary `#35D3FF`, glow `rgba(91,140,255,0.25)`.
- **Extended palette** `--color-accent-cyan #35D3FF`, `--color-accent-purple #A78BFA`, `--color-accent-pink #F472B6`, `--color-accent-amber #FBBF24`, `--color-accent-emerald #34D399`, etc. (`index.css:19-33`).
- **Semantics** danger `#EF4444`, warning `#F59B0B`/`#FB923C`, success `#22C55E`, info `#5B8CFF`.

## Typography

- **UI font** `Geist Variable` (primary, `--font-family-sans`) with `Inter` fallback.
- **Mono** `ui-monospace` (`SFMono-Regular`, Menlo, Consolas).
- Scale: Display 48, H1 32, H2 24, H3 20, Body 16, Body2 14, Caption 12.

## Glassmorphism & Surfaces

Tokens via `--color-glass-*` and utilities `.glass` / `.glass-strong` / `.glass-subtle` / `.glass-bar` / `.menu-surface` / `.overlay-surface` / `.scrim`. Shadows `--shadow-glass*`. Inverted for light theme — glass becomes `rgba(255,255,255,0.85-0.94)`. Background is `.nexora-bg` with 6 radial gradients + `aurora-float` 70 s animation + `feTurbulence` noise.

## Radii, Shadows, Motion

- Radii: `xs 0.375rem` → `2xl 1.25rem` (`index.css:70-75`).
- Motion: fast 150 ms (hovers), normal 250 ms (transitions), slow 400 ms (complex), easings `cubic-bezier(0.4,0,0.2,1)` / `0,0,0.2,1` / `0.4,0,1,1`.
- Z-index: `base 0, content 10, sidebar 30, player-bar 45, modal 100, toast 130`.

## Theming

- **Dark (default)** and **light** via `next-themes` (`dark`/`light`, `enableSystem:false`), plus `data-theme` accents: `midnight` (`#5B8CFF`), `amethyst` (`#A78BFA`/`#F472B6`), `aurora` (`#2DD4BF`/`#34D399`), `ember` (`#FBBF24`/`#FB7185`).
- Reduced motion (`prefers-reduced-motion: reduce`) kills animations except vinyl disc (kept slow ambient).

## Components

- **Sidebar** floating rounded `rounded-[28px]` `backdrop-blur-2xl`, motion `80↔304`, active indicator `layoutId="sidebar-active"` spring.
- **FileBrowser** grid vs list, density `compact|comfortable|spacious`, stagger `index*0.006` cap `0.24`.
- **PreviewModal** checkerboard backdrop, toolbar zoom/share/edit/download, gallery vinyl for audio, pdf dotted-grid.
- **Player/Transfer** glow `n-transfer-glow`, disc `n-disc-spin` 45 s vinyl with groove + glossy `conic-gradient`, eq bars, quota `quota-bar`.

## Tokens & Migration

- Shadcn mapped `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--border`, `--input`, `--ring`, `--sidebar*`, `--chart-5`, `--radius 0.625rem` + `@theme inline` scale.
- History: v1.4 initial, v1.4.1 colorblind fix, v1.5 doc expansion, v1.6 Phase 3 (PG/S3/WebDAV/webhooks/analytics/versioning/smart folders).

For usage, read `web/src/index.css` directly — class names like `.accent-glass`, `.gradient-border`, `.markdown-body` are defined there.

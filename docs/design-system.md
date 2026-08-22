# Design System

## Overview
Nexora follows a modern glassmorphism design language with a focus on accessibility, performance, and consistency across light and dark themes.

> **Single source of truth:** `web/src/index.css` (`@theme` + CSS variables). This document is a human-readable summary — if they diverge, `index.css` wins.

## Color Palette

### Primary Colors
- **Primary Accent**: `#5B8CFF` (both themes; `--color-accent`) with `--color-accent-secondary` `#7A5CFF` and `--color-accent-tertiary` `#35D3FF`; glow `rgba(91,140,255,0.25)`
- **Extended Accents**: `--color-accent-cyan` `#35D3FF`, `--color-accent-purple` `#A78BFA`, `--color-accent-pink` `#F472B6`, `--color-accent-amber` `#FBBF24`, `--color-accent-emerald` `#34D399`, etc. (see `index.css:19-33`)
- **Info**: `#5B8CFF` (same as accent, `--color-info`)

### Secondary Colors
- **Surface**: via `--surface` / `--color-glass-*` tokens
- **Content Text**: via `--content` / semantic tokens
- **Muted Text**: via `--content-muted`

### Semantic Colors
| Role | Token / Value | Usage |
|------|---------------|-------|
| **Danger/Red** | `#EF4444` (`--color-danger`) | Errors, deletes, warnings |
| **Warning/Orange** | `#F59B0B` / `#FB923C` | Warnings, loading states |
| **Success/Green** | `#22C55E` / `#4ADE80` | Success, completed actions |

## Typography

### Font Families
- **UI Font**: `Geist Variable` (primary, `--font-family-sans` in `index.css:66`) with `Inter` as fallback; system-ui stack after that
- **Code Font**: `ui-monospace` stack (`SFMono-Regular`, Menlo, Consolas, Liberation Mono; `--font-family-mono`)

### Font Scale
| Size | Size (px) | Usage |
|------|-----------|-------|
| Display | 48px | Major headings |
| Heading 1 | 32px | Page titles |
| Heading 2 | 24px | Section headers |
| Heading 3 | 20px | Sub-section headers |
| Body 1 | 16px | Primary content |
| Body 2 | 14px | Secondary content |
| Caption | 12px | Supporting text |

## Iconography

### Design Guidelines
- **Stroke Weight**: 2px for solid icons, 1.5px for line icons
- **Consistent Color**: All icons use `--accent` color with 80% opacity
- **Size System**: 12px, 16px, 20px, 24px, 32px, 48px based on context

### Icon Sources
- **File Type Icons**: Custom-designed with semantic colors
- **UI Icons**: Lucide React library
- **System Icons**: Standardized Heroicons pattern

## Logo Assets

### Primary Logo
- **Format**: SVG vector file
- **Dimensions**: Scalable from 32px to 256px
- **Clear Space**: Equal to logo width on all sides
- **File Name**: `logo.svg`

### Favicon
- **Format**: SVG vector file
- **Dimensions**: 32x32px minimum
- **Design**: Simplified N-shape logo with rounded corners
- **File Name**: `favicon.svg`

### Brand Colors
- **Primary Accent**: #2563EB (from logo)
- **Secondary Gradient**: Linear gradient from `#3B82F6` to `#1E40AF`

## Component System

### Glassmorphism Layers
Defined by `--color-glass-*` tokens and `.glass` / `.glass-strong` / `.glass-subtle` utilities (`index.css:54-57, 177-210`). Shadows via `--shadow-glass*` (`index.css:88-90`). The earlier 28%/42%/64% table has been superseded by these tokens — use the CSS variables, not hard-coded opacities.

### Border Radius
Via CSS variables (`index.css:70-75`):
- **xs**: `0.375rem` — subtle rounding
- **sm**: `0.5rem`
- **md**: `0.625rem` (default)
- **lg**: `0.75rem`
- **xl**: `1rem`
- **2xl**: `1.25rem`

### Shadows
- **Small**: `0 2px 8px rgba(0, 0, 0, 0.06)`
- **Medium**: `0 8px 24px rgba(0, 0, 0, 0.12)`
- **Large**: `0 16px 48px rgba(0, 0, 0, 0.24)`

## Interactive Elements

### Buttons
- **Hover State**: Lift effect + color intensity increase
- **Active State**: Press-down effect
- **Disabled State**: Reduced opacity + cursor change
- **Focus State**: 3px ring with accent color

### Cards
- **Elevation**: Glass shadow effects
- **Hover**: Lift effect + background intensity increase
- **Transition**: All transitions 150ms ease

### Forms
- **Focus**: Accent color border + subtle shadow
- **Error**: Red border with accessible messaging
- **Success**: Green border validation

## Layout

### Spacing Scale
| Scale | Value (px) | Usage |
|-------|-------------|-------|
| 0 | 0px | No spacing |
| 1 | 4px | Tight spacing |
| 2 | 8px | Comfortable spacing |
| 3 | 16px | Section spacing |
| 4 | 24px | Large section |
| 5 | 32px | Page sections |

### Grid System
- **Container Width**: 1280px maximum
- **Columns**: 12-column grid
- **Gutter**: 24px between columns

## Motion

### Duration
- **Fast**: 150ms (buttons, hovers)
- **Normal**: 250ms (transitions)
- **Slow**: 400ms (complex animations)

### Easing
- **Standard**: Cubic-bezier(0.4, 0, 0.2, 1)
- **Deceleration**: Cubic-bezier(0, 0, 0.2, 1)
- **Acceleration**: Cubic-bezier(0.4, 0, 1, 1)

## Accessibility

### Color Contrast
- All text meets WCAG AA standard (4.5:1 ratio)
- Interactive elements meet 3:1 contrast ratio
- Focus indicators are clearly visible

### Screen Reader Support
- Semantic HTML5 elements
- Proper ARIA labels and roles
- Keyboard navigation support

## Brand Usage

### Logo Attribution
- © Nexora Project
- License: MIT

### Usage Guidelines
1. Maintain minimum clear space around logo
2. Only use official logo variants
3. Do not alter logo colors or shapes
4. Do not overlay text on logo without adequate contrast

## Development

### CSS Custom Properties
All design tokens are defined as CSS custom properties in `src/index.css`:
- `--accent`: Primary color
- `--surface`: Background color
- `--content`: Text color
- `--border`: Border color

### Component Classes
Component styles are built using utility classes following Tailwind CSS conventions:
- `.glass`: Basic glass effect
- `.accent-glass`: Primary accent button style
- `.text-gradient`: Gradient text effect

### Utilities
- `.hide-scrollbar` / `.no-scrollbar`: scrollable but scrollbar-free rails (sidebar, chips, command lists)
- `.mask-edges`: horizontal edge fade for scrolling breadcrumb/chip rails
- Global `:focus-visible` baseline (`index.css`): every interactive element gets a 2px accent outline unless a component opts out with its own focus ring — do not add bare `outline-none` without providing a replacement

### Light Theme Rules
Every dark-styled utility must have a `.light` counterpart. Covered: `.glass*`, `.menu-surface`, `.overlay-surface`, `.scrim`, `.mobile-nav`, `.skeleton`, `.accent-glass`, `.player-glow`, `.quota-bar`, `.splash-screen`. When adding a new surface utility, add the light override in the same change.

### Selection & Focus Affordances
- Selected file tiles/rows: `bg-accent/10 ring-1 ring-accent/40` (grid) or `bg-accent/10 border-accent/30` (list) — never indicate selection by lowering opacity
- Keyboard focus: accent outline via global baseline; arrow keys rove focus between items (`data-file-item` markers in `FileBrowser.tsx`)

## Update History
- **v1.4**: Initial design system
- **v1.4.1**: Improved colorblind accessibility
- **v1.5**: Enhanced documentation
- **v1.6**: Phase 3 features (PostgreSQL, S3, WebDAV, webhooks, analytics, versioning, smart folders)

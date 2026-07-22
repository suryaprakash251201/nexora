# Design System

## Overview
Nexora follows a modern glassmorphism design language with a focus on accessibility, performance, and consistency across light and dark themes.

## Color Palette

### Primary Colors
- **Primary (Blue)**: `#2563EB` (Light mode) / `#3B82F6` (Dark mode)
- **Primary Variant**: Optimized for colorblind users with higher contrast

### Secondary Colors
- **Surface**: White (#FFFFFF) / Black (#000000)
- **Content Text**: Near-black (#1E1F24) / Near-white (#FAFAFA)
- **Muted Text**: Medium gray (#6B7280) / Lighter gray (#9CA3AF)

### Semantic Colors
| Role | Light Theme | Dark Theme | Usage |
|------|-------------|------------|-------|
| **Danger/Red** | `#EF4444` | `#F87171` | Errors, deletes, warnings |
| **Warning/Orange** | `#F59B0B` | `#FB923C` | Warnings, loading states |
| **Success/Green** | `#22C55E` | `#4ADE80` | Success, completed actions |

## Typography

### Font Families
- **UI Font**: Inter (Google Fonts)
  - Weights: 300, 400, 500, 600, 700, 800
- **Code Font**: JetBrains Mono
  - Weights: 400, 500, 600

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
| Layer | Opacity | Blur | Use Case |
|-------|---------|------|----------|
| **Subtle** | 28% | 11px | Background elements |
| **Base** | 42% | 20px | Cards, panels |
| **Strong** | 64% | 24px | Modals, dropdowns |

### Border Radius
- **Small**: 8px (sm)
- **Medium**: 12px (md) - Default for most components
- **Large**: 24px (xl) - For large cards, modals

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

## Update History
- **v1.4**: Initial design system
- **v1.4.1**: Improved colorblind accessibility
- **v1.5**: Enhanced documentation

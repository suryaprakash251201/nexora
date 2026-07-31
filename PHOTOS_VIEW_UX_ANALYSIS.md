# PhotosView UI/UX Analysis & Improvement Plan

## Executive Summary

The current `PhotosView.tsx` is a functional but basic photo timeline view. It renders photos grouped by month/year in a responsive grid using the existing `FileThumb` component. While functional, it lacks several modern photo gallery UX patterns that users expect from modern photo apps (Google Photos, Apple Photos, etc.).

---

## Current State Analysis

### Strengths
1. **Clean grouping by month/year** using EXIF `date_taken`
2. **Responsive grid** (2 cols mobile → 6 cols XL)
3. **Sticky month headers** with `sticky top-20` backdrop blur
4. **Hover overlays** showing date & camera info
5. **Keyboard accessible** (Enter/Space handlers)
6. **Loading, error, and empty states** handled
7. **Lazy-loaded thumbnails** via `FileThumb` with skeleton
7. **Sticky header** with gradient title + stats bar

### UX Gaps & Issues

| Area | Current State | Expected Modern UX | Severity |
|------|---------------|-------------------|----------|
| **Navigation** | Click → `onOpen`/`onPreview` | Click → fullscreen viewer with swipe/keyboard nav | 🔴 Critical |
| **Selection** | None | Multi-select mode (shift-click, cmd-click, checkbox) | 🔴 Critical |
| **Zoom/Preview** | Hover zoom only (105%) | Click → fullscreen lightbox with pinch-zoom, pan | 🔴 Critical |
| **Grouping** | Month/Year only | Year → Month → Day hierarchy; map view for geo-tagged | 🟡 High |
| **Virtualization** | Renders all 200 items | Virtualized grid/windowing for 1000+ photos | 🟡 High |
| **Infinite Scroll** | Fixed LIMIT 200 | Infinite scroll / "Load more" pagination | 🟡 High |
| **Context Menu** | None | Right-click: Download, Share, Delete, Info, Open folder | 🟡 High |
| **Keyboard Nav** | Enter/Space only | Arrow keys navigation in grid, Esc to close | 🟡 High |
| **EXIF/Metadata** | Date + Camera only | Full EXIF panel (aperture, ISO, focal, GPS map) | 🟢 Medium |
| **Search/Filter** | None | Filter by: camera, lens, date range, location, rating | 🟢 Medium |
| **Map View** | Lat/lng in data only | Interactive map cluster view for geo-tagged photos | 🟢 Medium |
| **Albums/Faces** | None | AI-powered face clustering, smart albums | 🔵 Low |
| **Animation** | Basic hover scale | Staggered entrance, FLIP animations, shared element transitions | 🟢 Medium |
| **Density Control** | Fixed grid | Compact/Comfortable/Spacious density toggle | 🟢 Medium |
| **Scroll Position** | Not restored | Restore scroll position on back navigation | 🟢 Medium |

---

## Proposed Architecture

### Component Structure

```
PhotosView/
├── PhotosView.tsx                 # Main orchestrator
├── hooks/
│   ├── usePhotos.ts               # Data fetching + infinite query
│   ├── usePhotoSelection.ts       # Multi-select state management
│   ├── usePhotoViewer.ts          # Fullscreen viewer state
│   ├── useVirtualizedGrid.ts      # Virtualization logic
│   └── useInfiniteScroll.ts       # IntersectionObserver pagination
├── components/
│   ├── PhotoGrid.tsx              # Virtualized grid (react-virtual or tanstack-virtual)
│   ├── PhotoCard.tsx              # Enhanced card with selection, context menu
│   ├── MonthSection.tsx           # Sticky header + grid section
│   ├── YearNavigator.tsx          # Year sidebar/jump list
│   ├── PhotoViewer.tsx            # Fullscreen lightbox (swipe, zoom, pan, keyboard)
│   ├── PhotoMetadataPanel.tsx     # EXIF sidebar in viewer
│   ├── PhotoMapView.tsx           # Map cluster view (MapLibre/Leaflet)
│   ├── SelectionToolbar.tsx       # Floating bar when selecting (Share, Delete, Download, Add to album)
│   ├── DensitySelector.tsx        # Compact/Comfortable/Spacious
│   ├── FilterBar.tsx              # Filter by camera, date range, location, favorites
│   ├── EmptyState.tsx             # Illustrated empty states
│   ├── LoadingSkeleton.tsx        # Grid skeleton matching density
│   └── ErrorState.tsx             # Retry + error details
├── types.ts                       # Shared types
└── index.ts                       # Barrel export
```

### Data Fetching Strategy

```typescript
// usePhotos.ts - TanStack Query with infinite scroll
interface PhotoCursor {
  cursor?: string;  // cursor-based pagination
  limit: number;
  filters?: PhotoFilters;
}

interface PhotoFilters {
  year?: number;
  month?: number;
  cameraMake?: string;
  cameraModel?: string;
  hasLocation?: boolean;
  dateRange?: [Date, Date];
  favoritesOnly?: boolean;
}

const usePhotos = (filters: PhotoFilters) => {
  return useInfiniteQuery({
    queryKey: ["photos", filters],
    queryFn: ({ pageParam }) => getPhotos({ ...filters, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined,
  });
};
```

---

## Detailed Component Specs

### 1. PhotoGrid (Virtualized)

**Library**: `@tanstack/react-virtual` (lightweight, headless, supports dynamic sizes)

```tsx
interface PhotoGridProps {
  photos: PhotoResult[];
  density: 'compact' | 'comfortable' | 'spacious';
  onPhotoClick: (photo: PhotoResult, index: number) => void;
  onPhotoContextMenu: (photo: PhotoResult, e: React.MouseEvent) => void;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  isSelecting: boolean;
}
```

**Grid Sizing by Density**:
| Density | Columns (xl) | Gap | Card Aspect | Thumbnail Quality |
|---------|--------------|-----|-------------|-------------------|
| Compact | 8 | 4px | 4:3 | Low (webp, 200w) |
| Comfortable | 6 | 8px | 4:3 | Medium (webp, 400w) |
| Spacious | 4 | 16px | 3:2 | High (webp, 600w) |

### 2. PhotoCard (Enhanced)

```tsx
interface PhotoCardProps {
  photo: PhotoResult;
  index: number;
  density: Density;
  isSelected: boolean;
  isSelecting: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSelectionToggle: (id: string) => void;
}
```

**Visual States**:
- **Default**: Subtle shadow, rounded-xl
- **Hover**: Scale 102%, stronger shadow, accent ring
- **Selected**: Primary ring (2px), checkmark badge top-right, dimmed overlay
- **Selecting mode**: Checkbox top-left always visible
- **Focus-visible**: Accent ring + offset for keyboard nav

**Overlay Badges** (shown on hover or selected):
- Date taken (formatted)
- Camera make/model
- Location pin (if GPS)
- Favorite star (if favorited)
- Video badge (if video)

### 3. PhotoViewer (Fullscreen Lightbox)

**Features**:
- **Swipe navigation** (touch) + **Arrow keys** (desktop)
- **Pinch zoom** + **Double-click zoom** + **Mouse wheel zoom**
- **Pan/drag** when zoomed
- **ESC** to close, **Space** to play/pause video
- **Thumbnail strip** at bottom (scrollable, highlights current)
- **EXIF sidebar** (toggle with `i` key or info button)
- **Map view** for geo-tagged (toggle with `m` key)
- **Download** (D key), **Share** (S key), **Delete** (Del key)
- **Background**: `rgba(0,0,0,0.95)` with backdrop blur
- **Shared element transition** from grid → viewer (FLIP animation)

**State Machine**:
```
Closed → Opening (transition) → Open → Zooming → Panning → Closing → Closed
```

### 4. YearNavigator (Sidebar)

```
┌─────────────────┐
│  2025  ▼  (247) │
│  2024     (512) │
│  2023     (389) │
│  2022     (156) │
│  2021      (89) │
└─────────────────┘
```
- Collapsible year list with photo counts
- Click year → scroll to that year's first month
- Keyboard: Up/Down to navigate, Enter to select

### 5. SelectionToolbar (Floating)

Appears at bottom when `selectedIds.size > 0`:
```
┌─────────────────────────────────────────┐
│  12 selected                    ✕ Close │
├─────────────────────────────────────────┤
│ [Share] [Download ZIP] [Add to Album]   │
│ [Move to...] [Delete] [More ▼]          │
└─────────────────────────────────────────┘
```

---

## API Extensions Needed

### Backend `/photos` endpoint enhancements:

```typescript
// GET /photos?cursor=&limit=&year=&month=&camera_make=&has_location=&favorites=&date_from=&date_to=
interface PhotosQuery {
  cursor?: string;           // opaque cursor for pagination
  limit?: number;            // default 100, max 500
  year?: number;
  month?: number;            // 1-12, requires year
  camera_make?: string;
  camera_model?: string;
  has_location?: boolean;
  favorites_only?: boolean;
  date_from?: string;        // ISO date
  date_to?: string;          // ISO date
  sort?: 'date_desc' | 'date_asc' | 'name';
}

interface PhotosResponse {
  items: PhotoResult[];
  next_cursor?: string;
  total_count: number;
  facets?: {
    years: { year: number; count: number }[];
    cameras: { make: string; model: string; count: number }[];
    locations: { lat: number; lng: number; count: number }[];
  };
}
```

### Photo Detail Endpoint (for viewer metadata panel):
```typescript
// GET /photos/:id/meta
interface PhotoMeta {
  id: string;
  exif: {
    make?: string;
    model?: string;
    lens?: string;
    aperture?: string;      // f/1.8
    shutter_speed?: string; // 1/125s
    iso?: number;
    focal_length?: string;  // 24mm
    exposure_compensation?: string;
    flash?: boolean;
    white_balance?: string;
    metering_mode?: string;
    orientation?: number;
    color_space?: string;
  };
  gps?: {
    lat: number;
    lng: number;
    altitude?: number;
    address?: string;       // reverse geocoded
  };
  file: {
    size: number;
    dimensions: { width: number; height: number };
    mime: string;
    created_at: string;
    modified_at: string;
  };
  // For video
  video?: {
    duration: number;       // seconds
    codec: string;
    bitrate: number;
    frame_rate: number;
    audio_codec?: string;
  };
}
```

---

## Migration Strategy

### Phase 1: Foundation (Week 1)
1. ✅ Create `usePhotos` hook with infinite query
2. ✅ Build `PhotoGrid` with `@tanstack/react-virtual`
3. ✅ Enhance `PhotoCard` with selection, keyboard, context menu
4. ✅ Add `DensitySelector` and persist to localStorage
5. ✅ Add `YearNavigator` sidebar (collapsible on mobile)

### Phase 2: Fullscreen Viewer (Week 2)
1. ✅ Build `PhotoViewer` component with:
   - Keyboard navigation (←/→, ESC, Space, +/- zoom)
   - Touch swipe (hammer.js or native pointer events)
   - Pinch zoom + pan (transform matrix)
   - Thumbnail strip
   - Shared element transition (FLIP)
2. ✅ Add `PhotoMetadataPanel` (EXIF sidebar)
3. ✅ Add `PhotoMapView` (MapLibre GL, cluster markers)
4. ✅ Integrate with `PhotosView` state machine

### Phase 3: Power Features (Week 3)
1. ✅ `FilterBar` with multi-select facets (camera, year, location, favorites)
2. ✅ `SelectionToolbar` with bulk actions (download zip, share, delete, album)
3. ✅ Favorites/star toggle (persist to backend)
4. ✅ Smart albums (recent, favorites, screenshots, videos, locations)
5. ✅ Map view toggle in main view (alongside grid)

### Phase 4: Polish (Week 4)
1. ✅ Scroll position restoration (URL hash `#year=2024&month=3&scroll=1234`)
2. ✅ Skeleton loading matching density
3. ✅ Staggered entrance animations (framer-motion)
4. ✅ Error boundaries per section
5. ✅ Accessibility audit (ARIA, focus management, screen reader)
6. ✅ Performance profiling (React DevTools, Lighthouse)
7. ✅ Documentation + Storybook stories

---

## CSS/Design System Extensions

Add to `index.css`:

```css
/* Photo Grid Virtualization */
.photo-grid {
  contain: layout paint size;
}
.photo-grid-item {
  contain: layout paint;
}

/* Viewer */
.photo-viewer {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.95);
  backdrop-filter: blur(20px);
}
.photo-viewer__image {
  max-width: 100%;
  max-height: 100%;
  touch-action: pinch-zoom;
  transition: transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
.photo-viewer__strip {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 100px;
  display: flex;
  gap: 8px;
  padding: 12px;
  overflow-x: auto;
  background: linear-gradient(to top, rgba(0,0,0,0.9), transparent);
}

/* Selection */
.photo-card--selected {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}
.photo-card__check {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  background: var(--color-accent);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 14px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}

/* Year Navigator */
.year-navigator {
  position: sticky;
  top: 100px;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
}
.year-navigator__item {
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.year-navigator__item:hover,
.year-navigator__item--active {
  background: rgba(91, 140, 255, 0.15);
  color: var(--color-accent);
}

/* Density */
[data-density="compact"] .photo-card { --card-gap: 4px; --card-cols: 8; }
[data-density="comfortable"] .photo-card { --card-gap: 8px; --card-cols: 6; }
[data-density="spacious"] .photo-card { --card-gap: 16px; --card-cols: 4; }
```

---

## Accessibility Checklist

- [ ] All interactive elements have `tabIndex` and `role`
- [ ] Grid uses `role="list"` / `role="listitem"` or semantic `<ul>/<li>`
- [ ] Viewer traps focus (FocusTrap)
- [ ] Arrow keys navigate grid (roving tabindex)
- [ ] Screen reader announces "X photos selected" on selection change
- [ ] Images have meaningful `alt` text (filename + date)
- [ ] Color contrast meets WCAG AA (glass surfaces on dark)
- [ ] Reduced motion respected (disable animations)
- [ ] Keyboard shortcuts documented (?) in command palette

---

## Performance Targets

| Metric | Target |
|--------|--------|
| Initial load (200 photos) | < 1.5s FCP |
| Grid scroll 60fps | ✅ Virtualized |
| Viewer open animation | < 200ms |
| Pinch zoom 60fps | ✅ GPU transform |
| 1000 photos memory | < 150MB |
| Bundle size increase | < 50KB gzipped |

---

## Testing Strategy

1. **Unit**: `usePhotos`, `usePhotoSelection`, `useVirtualizedGrid` hooks
2. **Component**: `PhotoCard` (selection, keyboard, context menu), `PhotoViewer` (zoom, pan, nav)
3. **Integration**: PhotosView with mock API (MSW)
4. **E2E**: Playwright - grid nav, viewer open/close, selection toolbar, filter bar
5. **Visual**: Chromatic/Storybook for density, states, themes
6. **Perf**: Lighthouse CI, React Scan for re-renders

---

## Dependencies to Add

```json
{
  "@tanstack/react-virtual": "^3.8.0",
  "maplibre-gl": "^4.7.0",
  "exifreader": "^4.2.0",
  "framer-motion": "^11.0.0",  // already in deps
  "zustand": "^4.5.0"          // for viewer/selection state (optional, can use React context)
}
```

---

## Quick Wins (Can Ship This Week)

1. ✅ **Add density selector** (compact/comfortable/spacious) - localStorage persisted
2. ✅ **Add year navigator sidebar** - scroll to year sections
3. ✅ **Infinite scroll** - replace fixed LIMIT 200 with cursor pagination
4. ✅ **Keyboard grid navigation** - arrow keys, Enter to open
5. ✅ **Selection mode** - Shift/Cmd click, floating toolbar
6. ✅ **Context menu** - right-click photo for actions
7. ✅ **Better empty/loading/error states** - illustrated, actionable
8. ✅ **EXIF tooltip on hover** - show aperture, ISO, focal length preview

---

## File: PhotosView.tsx - Refactored Structure (Target)

```tsx
// PhotosView.tsx - Main orchestrator (simplified)
export default function PhotosView({ roots, onOpen, onPreview }) {
  const { density, setDensity } = useDensity();
  const { filters, setFilters } = usePhotoFilters();
  const { photos, fetchNextPage, hasNextPage, isFetchingNextPage } = usePhotos(filters);
  const { selectedIds, toggleSelection, clearSelection, isSelecting } = usePhotoSelection();
  const { openPhoto, closeViewer, currentIndex } = usePhotoViewer(photos);

  return (
    <div className="photos-view" data-density={density}>
      <PhotoViewHeader 
        totalCount={totalCount} 
        density={density} 
        onDensityChange={setDensity}
        filters={filters}
        onFiltersChange={setFilters}
        selectedCount={selectedIds.size}
        onClearSelection={clearSelection}
      />
      
      <div className="flex gap-4">
        <YearNavigator 
          years={yearFacets} 
          onYearSelect={scrollToYear}
          className="hidden lg:block w-48 shrink-0"
        />
        
        <div className="flex-1 min-w-0">
          <FilterBar filters={filters} onChange={setFilters} />
          
          <PhotoGrid
            photos={photos}
            density={density}
            selectedIds={selectedIds}
            isSelecting={isSelecting}
            onPhotoClick={openPhoto}
            onPhotoContextMenu={showContextMenu}
            onSelectionToggle={toggleSelection}
            onLoadMore={fetchNextPage}
            hasMore={hasNextPage}
            isLoadingMore={isFetchingNextPage}
          />
        </div>
      </div>

      {selectedIds.size > 0 && (
        <SelectionToolbar
          count={selectedIds.size}
          onDownload={bulkDownload}
          onShare={bulkShare}
          onDelete={bulkDelete}
          onAddToAlbum={openAlbumPicker}
          onClear={clearSelection}
        />
      )}

      <PhotoViewer
        isOpen={!!openPhoto}
        onClose={closeViewer}
        photos={photos}
        initialIndex={currentIndex}
        onNavigate={setCurrentIndex}
      />
      
      <PhotoContextMenu />
    </div>
  );
}
```

---

## Next Steps

1. **Review this analysis** with the team
2. **Prioritize Phase 1** items based on user feedback
3. **Set up `@tanstack/react-virtual`** and test with 500+ photos
4. **Design `PhotoViewer` component API** (shared element transition is key)
5. **Extend backend `/photos` endpoint** with cursor pagination + facets
6. **Create Storybook stories** for PhotoCard states and densities
7. **Write integration tests** with MSW mocking the new API
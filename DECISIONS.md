DECISIONS v1.4.0

2026-02-04:
- Scope v1: mixed quiz rotation (map tap, flag match, capital MCQ).
- Country scope: all countries + territories.
- PWA: installable on iOS/Android.
- Offline: partial (data + flags cached; map online).
- UI: dark glassmorphic panels.
- Data sources: Natural Earth 10m + mledoze/countries + FlagCDN.
- REST Countries API returned 400; switched to static GitHub dataset.
- App framework: React + TypeScript (Vite).
- Mapping: MapLibre GL JS with OSM raster tiles.
- Added geography/identity datasets: Natural Earth geography regions + elevation points.
- Added geography/identity modes: landlocked/coastal, highest peak, mountain range, physical region.
- Deployment target: GitHub Pages via Actions (app/dist).

Acceptance criteria (locked):
1) PWA installs on mobile and launches full-screen with a map background.
2) Mixed quiz rotation shows map-tap, flag-match, and capital MCQ in sequence.
3) Each interaction gives immediate visual feedback on the map and in the panel.
4) Country data + flags are cached after first load and available offline.
5) Map remains online-only, with graceful offline fallback.

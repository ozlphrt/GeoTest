PROJECT_OVERVIEW v1.5.0

Project: GeoTest PWA
Goal: Massively visual, interactive geography knowledge testing for mobile.

Scope v1:
- Mixed quiz rotation: map tap, flag match, capital multiple-choice.
- Country scope: all countries + territories.
- PWA: installable on iOS/Android.
- Offline: partial (data + flags cached; map online).
- UI: dark glassmorphic panels.
- Data sources: Natural Earth 10m + mledoze/countries + FlagCDN.
- Data sources (extended): UNESCO World Heritage (whc001), World Bank GDP (NY.GDP.MKTP.CD),
  OEC trade exports (trade_i_baci_a_22), landmark imagery (in-house CC0 placeholders).
- App framework: React + TypeScript (Vite).
- Mapping: MapLibre GL JS with OSM raster tiles.

Scope v1.1 (extension):
- Geography & identity modes: landlocked/coastal, highest peak, mountain range, physical region.
- Data sources: add Natural Earth geography regions + elevation points.
- Mapping: MapLibre GL JS with dark custom style (no labels).

User Acceptance Criteria (locked):
1) User can install the PWA and launch it from the home screen.
2) Mixed rotation mode runs map-tap, flag-match, and capital MCQ in a loop.
3) Each question is answered with immediate visual feedback (correct/incorrect).
4) Country data and flags are available offline after first load.
5) The UI remains interactive and visually rich at all times on mobile.

Notes:
- Coordinate conventions and transformations must follow COORDINATE_CONVENTIONS.md.
- Sliders are disallowed unless explicitly overridden.
- Deployment: GitHub Pages (Actions build from app/dist).

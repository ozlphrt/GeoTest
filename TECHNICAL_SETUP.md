TECHNICAL_SETUP v1.4.0

Status: Stack selected.

Runtime environment:
- Node.js LTS

Build tooling:
- Vite

App framework:
- React + TypeScript

Mapping/rendering library:
- MapLibre GL JS
- Dark custom style (no labels)

Data pipeline:
- Natural Earth 10m admin-0 sovereignty (GeoJSON)
- Natural Earth 10m geography regions (polygons)
- Natural Earth 10m geography regions (elevation points)
- mledoze/countries (metadata JSON)
- FlagCDN (SVG + PNG assets, bundled locally)

PWA configuration:
- Vite PWA plugin
- Installable on iOS/Android

Deployment:
- GitHub Pages (Actions build from `app/dist`)

Offline caching strategy:
- Cache country data and flag assets after first load
- Map tiles remain online-only

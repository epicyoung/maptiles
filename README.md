# Cesium Globe Showcase

The application runs at /cesium. The root URL redirects there.

Run npm install, then npm run dev. Use npm run build and npm run start for production.

## Local map data

- Toll roads: public/data/tol.geojson (included).
- Railways and stations: public/data/railway.geojson (included; copied from rail.geojson).
- BSD boundary: lib/bsdline.ts.
- District names: lib/mapLayersData.ts.

Railway GeoJSON accepts a FeatureCollection containing LineString or MultiLineString tracks and Point stations. Station Polygons are labeled at their bounds center. A station's name property supplies its label. Coordinates use [longitude, latitude]. A missing railway file displays a message when the layer is enabled.

Overpass is no longer used. CesiumJS, base map tiles, place search, and OSRM route calculation still require internet access.

## Settings

Defaults: Esri Satellite, BSD boundary and toll roads enabled, railways and district/reference labels disabled. Existing saved preferences and pins are restored from browser storage.

Save Setting exports your starting point, map skin, place names, subtitles, logos, and pinned places as JSON. Import JSON restores those settings. Settings are also saved automatically in the current browser.

The scratch_head.tsx recovery reference is excluded from compilation. CesiumShowcase.tsx.damaged-backup preserves the damaged source before recovery.

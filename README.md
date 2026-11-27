# +P Lawn Quote

Phone-first quoting tool for **+P Services**. Enter a North Texas address, confirm the lot and house on satellite imagery, and price the mowable turf.

Mowable turf is the lot, minus the house, minus any driveway, patio, pool, or beds you trace. Areas are geodesic square feet on WGS84. Quotes stay on the phone. Nothing here needs a server or a paid API key.

Towns it is aimed at: Prosper, Celina, Frisco, McKinney, Aubrey, and Little Elm (Collin and Denton counties).

## Run it

```bash
npm install
npm test
npm run dev
```

The dev server listens on port **43123**. Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

`npm run build` writes a static site to `dist/`. `npm run preview` serves that build. The app is plain HTML, CSS, and JavaScript after the build, so it can be dropped onto any static host.

## How a quote is priced

Defaults live in one place: `DEFAULT_RATES` in `src/pricing.js`. Edits from the Rate table are stored in `localStorage` on the phone.

- Weekly mow is **$55** up to **6,000 sq ft** of mowable turf.
- Each extra **2,500 sq ft**, rounded up, adds **$10**.
- Biweekly is the weekly visit plus **$10**.
- A one-time cut starts at **$85**, then uses the same size steps.
- The minimum charge is **$55**.
- Estimated monthly totals use 4 weekly visits or 2 biweekly visits.

Copy quote writes a short customer text with the prices and this sign-off: Erik, +P Services, call or text (214) 995-3002. Save keeps the outline on the phone so it can be opened or deleted later.

## What the map uses

Checked from a browser-style request (an `Origin` header, no API key) in November 2026.

| Need | Source | Result |
| --- | --- | --- |
| Address | [ArcGIS World Geocoding](https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer) `findAddressCandidates` | Works without a token. CORS reflects the page origin. |
| Address fallback | US Census geocoder | Responds, but sends no `Access-Control-Allow-Origin`, so the browser cannot read it. Not used. |
| Imagery | Esri World Imagery, plus the Esri reference overlay for streets | Tile images, no key. |
| Collin lot outline | [Collin County interactive map, Appraisal District layer 1](https://maps.collincountytx.gov/server/rest/services/InteractiveMap/Appraisal_District/MapServer/1) | Spatial point query returns the parcel polygon. |
| Collin recorded acreage | [Collin CAD parcel layer](https://services2.arcgis.com/uXyoacYrZTPTKD3R/arcgis/rest/services/CCAD_Parcel_Feature_Set/FeatureServer/4) | Attribute query by `geoID` returns `landSizeAcres` and `landSizeSqft`. Spatial queries on this layer fail with "Unable to perform query", so the county map supplies the polygon. |
| Denton lot and acreage | [Denton CAD Parcels_Appraisal](https://geo.dentoncad.com/arcgis/rest/services/LandRecords/Parcels_Appraisal/FeatureServer/1) | Spatial query returns the polygon plus `legalAcreage` and `land_sqft`. |
| Denton backup | [Denton County parcels](https://gis.dentoncounty.gov/arcgis/rest/services/Parcels/MapServer/0) | Used when Denton CAD does not answer. |
| House footprint | OpenStreetMap building ways via Overpass | In Chrome, `maps.mail.ru` returned the roof and allowed the browser to read it. `overpass.openstreetmap.fr` answered to a command-line request but Chrome blocked it (no `Access-Control-Allow-Origin`). `overpass-api.de` was at capacity. The app tries those mirrors in that order. If every one misses, trace the roof by hand. |

If a pin lands in the street, the app snaps to the nearest parcel within about 35 meters and says so. Lot, house, and the extra areas can all be redrawn or edited by dragging corners.

## Checked against a known lot

109 W Fifth St, Prosper, Texas 75078 (Collin CAD `R-0972-002-0010-1`):

- Recorded lot: **9,748.72 sq ft** (0.2238 acres).
- Geodesic area of the county polygon: **9,752.42 sq ft** (about 0.04% higher).
- OpenStreetMap building that contains the rooftop pin: about **3,127 sq ft**.

`npm test` locks the geodesic result to GeographicLib, including a 1°×1° square whose area is 12,308,778,361.47 m².

## Install it on a phone

The production build includes `manifest.webmanifest` and a service worker. On the hosted HTTPS site, use the browser share menu and choose **Add to Home Screen**. The shell then opens without a signal. Saved quotes still open. A new address search needs a connection. The dev server does not register the service worker, so caching does not get in the way while you work.

## Host it on GitHub Pages

The asset paths are relative (`base: "./"` in `vite.config.js`), so the same `dist/` folder works at a project URL such as `https://username.github.io/plusp-lawn-quote/` or at a domain root.

1. Push the repository to GitHub.
2. In the repo, open **Settings → Pages → Build and deployment → Source**, and choose **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` installs, tests, builds, and deploys `dist/`.

To publish by hand instead, run `npm run build` and upload the contents of `dist/` as the Pages site.

## Dropping this into the estimate app

These modules do not touch the page, so they can move over as-is:

- `src/area.js` — geodesic area and mowable-turf clipping
- `src/pricing.js` — the rate table
- `src/geocode.js` — ArcGIS address search
- `src/parcels.js` — Collin and Denton lot lookup
- `src/buildings.js` — OpenStreetMap footprints
- `src/geo.js` — point-in-polygon and distances

`src/mapView.js` is the Leaflet drawing surface. The screen itself is `index.html` plus `src/main.js`.

# 7-Minute Loom Demo Script — Weather-Aware Truck Routing ("RouteGuard Freight")

> **Tip for recording:** Start the backend with `USE_MOCKS=1` (`$env:USE_MOCKS="1"; python manage.py runserver`) if you want 100% deterministic storm cells along I-80 (Nebraska 61 mph wind/snow storm) and I-70 (Kansas 50 mph wind band + tomorrow's Front Range blizzard) so every threshold and load-weight override is reproducible on cue. You can also run with `USE_MOCKS=0` to showcase live OSRM + Open-Meteo + Photon.

---

## 0:00 – 0:30 · Intro & Problem Statement (30s)
- **On screen:** App loaded at `http://localhost:5173` showing the full-screen MapLibre map, left floating control panel, and bottom 0–48h corridor heatmap dock.
- **Talk track:**
  - "Hi! I'm presenting **RouteGuard Freight**, a weather- and load-aware truck routing web application built with React 18, TypeScript, MapLibre GL, and Django 5 + DRF."
  - "Standard navigation tools optimize purely for travel time. For a commercial semi-truck, a 47 mph crosswind in Kansas or a snow band in Nebraska can turn the fastest highway into a rollover hazard—especially depending on trailer weight."
  - "RouteGuard generates 3 distinct route options, samples hourly weather at the truck's exact **estimated arrival time (ETA)** at every checkpoint, applies load-weight risk overrides, recommends the safest trade-off, and renders a 60fps 48-hour corridor heatmap."

---

## 0:30 – 1:45 · Inputs & Generating 3 Distinct Routes (1m 15s)
- **Action:**
  1. Point to the Origin (**Chicago, IL**) and Destination (**Denver, CO**) autocomplete inputs (proxied through `/api/geocode` → Photon with Nominatim fallback and 300ms debounce).
  2. Show the **Departure datetime picker** (defaults to `now + 1h`), **Load weight** stepper + presets (`Empty`, `20k`, `40k`, `80k`), and **Checkpoint interval** segmented control (`10 mi`, `25 mi`, `50 mi`, `Auto`).
  3. Select `Auto` interval (since Chicago → Denver is >800 mi, Auto resolves to 50-mile checkpoints) and `42,000 lb` load, then click **Analyze routes**.
- **Talk track:**
  - "When the router returns fewer than 3 distinct routes—which is common on long interstate corridors—our backend synthesizes perpendicular midpoint via-point detours and deduplicates any candidate that shares more than 85% geometry overlap. We always return 3 distinct corridors labeled **Fastest**, **Alternative A**, and **Alternative B**."
  - "Hovering any card highlights that corridor on the map; clicking selects it with a bright white halo while keeping alternatives clickable."

---

## 1:45 – 2:55 · ETA-Based Checkpoint Sampling (1m 10s)
- **Action:**
  1. Expand **Inspect checkpoints** or click a checkpoint marker directly on the map.
  2. Point out the **Checkpoint Popover** showing:
     - Milepost (e.g., Mile 450)
     - **Estimated Arrival Time** formatted in the checkpoint's local timezone (`America/Chicago` transitioning to `America/Denver`)
     - Sustained Wind + Gusts, Rain (in/hr), Snow (in/hr), Dominant factor, and human-readable reason.
- **Talk track:**
  - "Crucially, we do **not** assume a constant average speed, and we do **not** check the weather at departure time. In `apps/routing/checkpoints.py`, we walk the polyline and interpolate cumulative leg/step durations by distance."
  - "Then in `apps/weather/interpolate.py`, we linearly interpolate Open-Meteo's hourly forecast between the two surrounding UTC hours at that exact checkpoint ETA. If a trip extends beyond the forecast horizon, checkpoints gracefully flag `Forecast unavailable` instead of failing."

---

## 2:55 – 4:15 · Risk Classification & Live Load-Weight Override Demo (1m 20s)
- **Action:**
  1. Switch Origin to **Kansas City, MO** and Destination to **Denver, CO** (I-70 corridor, where winds peak around 47–50 mph).
  2. Click the **20k** preset (`20,000 lb`) and click **Analyze routes**. Click the Kansas checkpoint to show `Wind 47 mph → Severe`.
  3. Now click the **40k** preset (or step up to `42,000 lb`) and click **Analyze routes** again.
  4. Click the same checkpoint: it now reads **`Wind 47 mph + 42,000 lb load → No Travel`** with the purple hatched badge!
- **Talk track:**
  - "Each checkpoint first evaluates base thresholds for sustained wind, rain, and snow, taking the maximum across all three."
  - "Then we apply the load rules—which only ever raise risk:
    - Wind ≥ 55 mph is **No Travel** for any load.
    - Wind 45–54 mph with load > 30,000 lb escalates from Severe to **No Travel**.
    - Wind 35–44 mph with load > 40,000 lb escalates High to **Severe**."
  - "Notice our colorblind-safe palette uses redundant encoding: distinct symbols (`● ▲ ◆ ■ ✕`), labels, and a diagonal hatched pattern for No Travel."

---

## 4:15 – 5:05 · Recommendation Engine & Trade-Off Reasoning (50s)
- **Action:**
  1. Point to the green **Recommendation Reasoning** banner and click the **Compare** button to open the side-by-side table.
  2. Optional: Set departure +24 hours ahead on Chicago → Denver to show the purple **"Warning: All routes contain No Travel segments"** banner when the Front Range blizzard hits all corridors.
- **Talk track:**
  - "Each checkpoint owns the distance from the midpoint of its previous neighbor to the midpoint of its next neighbor, giving exact miles per risk level."
  - "Our recommendation in `apps/risk/ranking.py` uses strict lexicographic ordering with a 0.5-mile tie tolerance:
    1. Zero **No Travel** miles first (or if all routes have No Travel, warn loudly and pick the least bad)
    2. Fewest **Severe** miles
    3. Fewest **High** miles
    4. Lowest distance-weighted **average risk**
    5. Shortest **travel time**"
  - "And it explains the exact trade-off against the runner-up in plain English—for example, `+38 min vs Fastest, but avoids 150 No Travel miles`."

---

## 5:05 – 5:55 · 0–48h Corridor Heatmap Slider & Animated Truck at 60fps (50s)
- **Action:**
  1. Open the browser DevTools Network tab side-by-side.
  2. Play the slider and show the truck driving through the Severe segment, with the ring turning red (and the faint ghost trucks progressing simultaneously along the two alternate routes).
  3. Drag the bottom **0–48h Corridor Heatmap** slider rapidly back and forth, click the truck marker to open its checkpoint popover, and toggle **Follow truck** and **Ghost trucks**.
  4. Toggle Light/Dark mode in the top-left header to show MapLibre switching in-place (`<250ms`, `{ diff: true }`) between OpenFreeMap Liberty (light) and `makeDarkStyle(liberty)` (dark) with 100% identical labels, roads, parks, and terrain.
- **Talk track:**
  - "The `/api/heatmap` endpoint builds a corridor grid (~15–25 mi along all 3 routes with ±10 mi lateral offsets, capped at 300 points), fetches all 48 hours in a single batched, cached call, and returns a compact `[lat, lng, [49 ints]]` payload."
  - "Look at the Network tab while I scrub the slider: **zero network requests**. `heatmapBridge.ts` updates the MapLibre GeoJSON source inside `requestAnimationFrame` while throttling React state updates, keeping scrubbing at a smooth 60fps."

---

## 5:55 – 6:35 · Code Architecture & Unit Test Suite (40s)
- **Action:**
  1. Show the repo layout in the editor:
     - `backend/apps/{routing,weather,risk,api}`
     - `frontend/src/{features,components,lib,hooks}`
  2. Run `pytest` in the terminal (`112 passed` in ~1s) and `npm test` (`3 passed`).
- **Talk track:**
  - "All core math in `routing`, `weather`, and `risk` is written as pure functions with zero framework coupling. Our pytest suite tests every single boundary (`24.9/25`, `34.9/35`, `44.9/45`, `54.9/55 mph`, `30,000/30,001 lb`, `40,000/40,001 lb`, variable-speed ETA interpolation, midpoint ownership, and lexicographic ties)."

---

## 6:35 – 7:00 · Trade-Offs & Production Readiness (25s)
- **Talk track:**
  - "Because public OSRM, Valhalla, Photon, and Open-Meteo servers have no SLA, everything sits behind `RoutingProvider`, `WeatherProvider`, and `GeocodingProvider` interfaces with aggressive caching, 8-second timeouts, exponential backoff, per-IP DRF throttling, and a deterministic mock fallback."
  - "For production fleets, the README documents one-command self-hosted OSRM/Valhalla Docker setups and truck-costing trade-offs. Thanks for watching!"

# HydroFlow

A Sylva-inspired living water-network prototype built with Three.js.

The goal of this first prototype is to translate the organic procedural language of ThreeUI's **Sylva Living World** into a digital-twin water network: curved canal topology, animated directional flow, tracer particles, hydraulic metadata, status colors, and interactive nodes.

## What is in the prototype

- Catmull-Rom water-network geometry with organic bends
- Custom animated water ShaderMaterial
- Flow tracer particles whose speed follows `velocity`
- Width / flow / velocity / level fields per channel
- Reservoir, gate, junction, and outlet nodes
- Normal / watch / alert visual states
- Click-to-inspect node and channel metrics
- Click scan-wave interaction
- Orbit / zoom controls
- Responsive HUD with system metrics

## Run locally

```bash
npm install
npm run dev
```

Then open the local Vite URL (normally `http://localhost:5173`).

Production build:

```bash
npm run build
npm run preview
```

## Data model

The prototype data lives in [`src/network.ts`](src/network.ts). A channel is represented as a hydraulic edge plus its geometric control points:

```ts
{
  id: 'C-M1',
  from: 'J-01',
  to: 'J-03',
  width: 0.68,
  flow: 27.1,
  velocity: 1.34,
  level: 461.2,
  status: 'watch',
  points: [/* XYZ control points */]
}
```

This is intentionally separated from the renderer so a later version can replace the demo data with GeoJSON, GIS-derived centerlines, or live scheduling / IoT data.

## Architecture

```text
Hydraulic data / GeoJSON (next)
          ↓
      HydroNetwork
      nodes + links
          ↓
  CatmullRomCurve3 spine
          ↓
 procedural water ribbon
          ↓
 animated flow shader
     + tracer particles
          ↓
      Three.js scene
```

## ThreeUI / Sylva inspiration

This prototype directly adopts the core procedural idea used by ThreeUI's Sylva scene: a `CatmullRomCurve3` spine, locally transported orientation, shader-driven animation, and GPU/point-based ambient motion. HydroFlow changes the visual semantic from root / moss / pollen to canal / water / flow tracers.

ThreeUI Community: https://github.com/MengTo/threeui

ThreeUI is MIT licensed. See `THIRD_PARTY_NOTICES.md` for attribution.

## Next experiments

- GeoJSON / GIS import
- River/canal width interpolation by hydraulic section
- Flow propagation from a selected gate
- Reservoir / dam meshes
- Water-level animation
- LOD for large networks
- Real-time WebSocket data binding
- Optional terrain / DEM support

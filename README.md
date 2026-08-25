# HydroFlow

A Sylva-inspired volumetric living water-network prototype built with Three.js.

HydroFlow translates the organic procedural language of ThreeUI's **Sylva Living World** into a digital-twin water network: curved 3D canal topology, animated directional flow, tracer particles, hydraulic metadata, status colors, terrain relief, and interactive hydraulic nodes.

## What is in the prototype

- Catmull-Rom water-network spines with real XYZ elevation
- Full elliptical 3D stream sections instead of flat ribbons
- Explicit width + depth per hydraulic edge
- Sylva-style local spline framing
- Thick 3D channel beds beneath the water
- Custom animated volumetric water ShaderMaterial
- Fresnel edge lighting and upper-surface ripples
- Flow tracer particles whose speed follows `velocity`
- Reservoir, gate, junction, and outlet 3D nodes
- Terrain relief, depth lighting, fog, and shadows
- Normal / watch / alert visual states
- Click-to-inspect node and channel metrics
- 3D expanding scan pulse interaction
- Slow initial auto-orbit so depth is immediately visible
- Drag / zoom OrbitControls
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
  width: 0.76,
  depth: 0.24,
  flow: 27.1,
  velocity: 1.34,
  level: 461.2,
  status: 'watch',
  points: [/* XYZ control points with real visual elevation */]
}
```

This is intentionally separated from the renderer so a later version can replace the demo data with GeoJSON, GIS-derived centerlines, DEM elevation, or live scheduling / IoT data.

## Architecture

```text
Hydraulic data / GeoJSON / DEM
              ↓
          HydroNetwork
          nodes + links
              ↓
      CatmullRomCurve3 spine
              ↓
     stable local 3D frames
              ↓
 elliptical volumetric stream
      + channel-bed volume
              ↓
 animated water shader
     + tracer particles
              ↓
         Three.js scene
```

## Why it is now visibly 3D

The first prototype used a two-vertex ribbon and kept nearly all Y coordinates around the same elevation, so camera orbit alone could not create convincing depth. The current renderer changes both layers:

1. Network control points have a visible upstream-to-downstream elevation drop.
2. Every stream sample has a full radial cross-section with width and depth.
3. A larger dark bed volume sits beneath the translucent water.
4. Terrain relief, shadows, Fresnel lighting and slow auto-orbit make the volume readable immediately.

## ThreeUI / Sylva inspiration

This prototype directly adopts the core procedural idea used by ThreeUI's Sylva scene: a `CatmullRomCurve3` spine, locally transported orientation, shader-driven animation, and point-based ambient motion. HydroFlow changes the visual semantic from root / moss / pollen to canal / water / flow tracers.

ThreeUI Community: https://github.com/MengTo/threeui

ThreeUI is MIT licensed. See `THIRD_PARTY_NOTICES.md` for attribution.

## Next experiments

- GeoJSON / GIS centerline import
- DEM terrain binding
- Open-channel cross sections rather than fully closed water volumes
- Waterfall / drop-structure rendering for larger elevation changes
- Flow propagation from a selected gate
- Reservoir / dam meshes
- Dynamic water-level animation
- LOD for large networks
- Real-time WebSocket data binding

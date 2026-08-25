import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { network, type HydroLink, type HydroNode, type Status } from './network';

type Entity = { kind: 'node'; data: HydroNode } | { kind: 'link'; data: HydroLink };

type FlowParticles = {
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  curve: THREE.CatmullRomCurve3;
  seeds: Float32Array;
  offsets: Float32Array;
  width: number;
  depth: number;
  speed: number;
};

const UP = new THREE.Vector3(0, 1, 0);
const TMP_TANGENT = new THREE.Vector3();
const TMP_SIDE = new THREE.Vector3();
const TMP_UP = new THREE.Vector3();
const TMP_POINT = new THREE.Vector3();

function colorForStatus(status: Status) {
  if (status === 'alert') return new THREE.Color('#ff7f62');
  if (status === 'watch') return new THREE.Color('#ffd76a');
  return new THREE.Color('#69e5ff');
}

function curveFor(link: HydroLink) {
  return new THREE.CatmullRomCurve3(
    link.points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    false,
    'centripetal',
    0.5,
  );
}

/**
 * Stable local frame for a mostly-horizontal hydraulic path. This follows the
 * same idea as Sylva's transported limb frames, but keeps the stream's local
 * "up" close to world-up so a branch does not suddenly roll around its axis.
 */
function streamFrame(curve: THREE.CatmullRomCurve3, t: number, previousSide?: THREE.Vector3) {
  const tangent = curve.getTangentAt(t).normalize();
  const side = new THREE.Vector3().crossVectors(UP, tangent);

  if (side.lengthSq() < 1e-6) {
    side.copy(previousSide ?? new THREE.Vector3(0, 0, 1));
  } else {
    side.normalize();
  }

  if (previousSide && side.dot(previousSide) < 0) side.multiplyScalar(-1);

  const localUp = new THREE.Vector3().crossVectors(tangent, side).normalize();
  return { tangent, side, localUp };
}

/**
 * Build a real 3D stream volume around a Catmull-Rom spine. Unlike the first
 * prototype's two-vertex ribbon, every sample has a full elliptical section.
 * The result has a visible side wall, underside and depth from every camera
 * angle while still retaining Sylva's organic spline silhouette.
 */
function createStreamVolume(
  curve: THREE.CatmullRomCurve3,
  width: number,
  depth: number,
  segments = 180,
  radialSegments = 16,
) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let previousSide = new THREE.Vector3(0, 0, 1);

  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const point = curve.getPointAt(t);
    const { side, localUp } = streamFrame(curve, t, previousSide);
    previousSide.copy(side);

    // Subtle radius variation keeps the water network from reading as pipes.
    const organic = 1.0
      + Math.sin(t * Math.PI * 5.0 + 0.7) * 0.025
      + Math.sin(t * Math.PI * 11.0) * 0.012;
    const halfWidth = width * 0.5 * organic;
    const halfDepth = depth * 0.5 * (0.98 + Math.sin(t * 17.0) * 0.035);

    for (let j = 0; j <= radialSegments; j += 1) {
      const u = j / radialSegments;
      const theta = u * Math.PI * 2;
      const horizontal = Math.cos(theta) * halfWidth;
      const vertical = Math.sin(theta) * halfDepth;

      const p = point.clone()
        .addScaledVector(side, horizontal)
        .addScaledVector(localUp, vertical);

      positions.push(p.x, p.y, p.z);
      uvs.push(u, t);
    }
  }

  const row = radialSegments + 1;
  for (let i = 0; i < segments; i += 1) {
    for (let j = 0; j < radialSegments; j += 1) {
      const a = i * row + j;
      const b = a + row;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d, d, b, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function waterMaterial(link: HydroLink) {
  const statusColor = colorForStatus(link.status);

  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: THREE.MathUtils.clamp(link.velocity, 0.45, 2.2) },
      uFlow: { value: THREE.MathUtils.clamp(link.flow / 45, 0.2, 1.0) },
      uStatus: { value: statusColor },
      uSelected: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uSpeed;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vWorldNormal;

      void main() {
        vUv = uv;
        vec3 p = position;
        vec3 worldNormal = normalize(mat3(modelMatrix) * normal);

        // Only the upper half breathes like water; the sides retain their
        // volume so the silhouette stays strong when viewed obliquely.
        float top = smoothstep(-0.05, 0.75, worldNormal.y);
        float rippleA = sin(uv.y * 86.0 - uTime * (2.2 + uSpeed * 1.8) + uv.x * 8.0);
        float rippleB = sin(uv.y * 43.0 - uTime * (1.2 + uSpeed) - uv.x * 17.0);
        p += normal * (rippleA * 0.010 + rippleB * 0.005) * top;

        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        vWorldNormal = worldNormal;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSpeed;
      uniform float uFlow;
      uniform vec3 uStatus;
      uniform float uSelected;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vWorldNormal;

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.15);
        float top = smoothstep(-0.15, 0.72, N.y);

        float phaseA = fract(vUv.y * 14.0 - uTime * (0.42 + uSpeed * 0.31));
        float phaseB = fract(vUv.y * 30.0 - uTime * (0.68 + uSpeed * 0.43) + vUv.x * 0.45);
        float streakA = smoothstep(0.18, 0.0, abs(phaseA - 0.5));
        float streakB = smoothstep(0.09, 0.0, abs(phaseB - 0.5));
        float flowStreak = (streakA * 0.62 + streakB * 0.38) * top;

        float bands = sin((vUv.x * 5.0 + vUv.y * 1.2) * 6.2831) * 0.5 + 0.5;
        float shimmer = flowStreak * mix(0.68, 1.0, bands);

        vec3 deep = vec3(0.012, 0.095, 0.16);
        vec3 body = vec3(0.025, 0.40, 0.60);
        vec3 surface = vec3(0.22, 0.78, 0.92);
        vec3 foam = vec3(0.78, 0.97, 1.0);

        vec3 color = mix(deep, body, 0.42 + top * 0.30 + uFlow * 0.10);
        color = mix(color, surface, fresnel * 0.62 + top * 0.14);
        color = mix(color, foam, shimmer * (0.28 + uFlow * 0.34));

        float statusDelta = length(uStatus - vec3(0.411, 0.898, 1.0));
        color = mix(color, uStatus, statusDelta * 0.10 + uSelected * 0.42);
        color += vec3(0.25, 0.72, 1.0) * uSelected * (0.14 + 0.10 * sin(uTime * 5.0));

        // Sides stay more opaque than the top, making the volume legible.
        float alpha = 0.56 + (1.0 - top) * 0.18 + fresnel * 0.18 + shimmer * 0.10;
        alpha += uSelected * 0.08;
        gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.94));
      }
    `,
  });
}

function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(190,245,255,.95)');
  gradient.addColorStop(0.48, 'rgba(80,210,255,.44)');
  gradient.addColorStop(1, 'rgba(50,180,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createFlowParticles(link: HydroLink, curve: THREE.CatmullRomCurve3, texture: THREE.Texture): FlowParticles {
  const count = Math.max(12, Math.round(link.flow * 0.78));
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const offsets = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    seeds[i] = Math.random();
    offsets[i] = (Math.random() - 0.5) * link.width * 0.68;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: colorForStatus(link.status),
    size: link.status === 'alert' ? 0.13 : 0.095,
    map: texture,
    transparent: true,
    opacity: link.status === 'alert' ? 1.0 : 0.78,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geometry, material);
  points.renderOrder = 7;
  return {
    points,
    curve,
    seeds,
    offsets,
    width: link.width,
    depth: link.depth,
    speed: link.velocity,
  };
}

function labelTexture(text: string, subtext: string) {
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = 280 * scale;
  canvas.height = 74 * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(5, 16, 25, .82)';
  ctx.beginPath();
  ctx.roundRect(1, 1, 278, 72, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(126, 222, 255, .25)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = '600 14px Inter, sans-serif';
  ctx.fillStyle = '#e7f8ff';
  ctx.fillText(text, 15, 29);
  ctx.font = '500 10px Inter, sans-serif';
  ctx.fillStyle = '#7fa7bb';
  ctx.fillText(subtext, 15, 49);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function createTerrainGeometry() {
  const geometry = new THREE.PlaneGeometry(42, 28, 84, 56);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const edgeLift = Math.pow(Math.min(1, Math.abs(y) / 14), 1.7) * 0.42;
    const upstreamLift = THREE.MathUtils.clamp((-x - 2) / 16, 0, 1) * 0.32;
    const rolling = Math.sin(x * 0.42) * 0.08 + Math.cos(y * 0.53) * 0.065 + Math.sin((x + y) * 0.22) * 0.055;
    position.setZ(i, -0.58 + edgeLift + upstreamLift + rolling);
  }

  geometry.computeVertexNormals();
  return geometry;
}

export class HydroFlowScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private waterMaterials: THREE.ShaderMaterial[] = [];
  private particleSystems: FlowParticles[] = [];
  private interactive: THREE.Object3D[] = [];
  private selectedMaterial: THREE.ShaderMaterial | null = null;
  private selectedNode: THREE.Object3D | null = null;
  private scanPulse: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private scanStarted = -100;
  private ambientMotes: THREE.Points;
  private animationFrame = 0;
  private glowTexture = makeGlowTexture();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color('#06111a');
    this.scene.fog = new THREE.FogExp2('#06111a', 0.026);

    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 120);
    this.camera.position.set(9.8, 6.4, 14.8);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(0, 0.82, 0);
    this.controls.minDistance = 6.5;
    this.controls.maxDistance = 30;
    this.controls.minPolarAngle = Math.PI * 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.62;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.42;
    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false;
    });

    this.scanPulse = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({
        color: '#7cecff',
        wireframe: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.scanPulse.scale.setScalar(0.04);
    this.scanPulse.renderOrder = 20;
    this.scene.add(this.scanPulse);

    this.ambientMotes = this.createAmbientMotes();
    this.scene.add(this.ambientMotes);

    this.buildEnvironment();
    this.buildNetwork();
    this.bindEvents();
    this.populateMetrics();
    this.animate();
  }

  private buildEnvironment() {
    const ground = new THREE.Mesh(
      createTerrainGeometry(),
      new THREE.MeshStandardMaterial({
        color: '#081b23',
        roughness: 0.93,
        metalness: 0.02,
        flatShading: false,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const terrainWire = new THREE.Mesh(
      ground.geometry,
      new THREE.MeshBasicMaterial({
        color: '#163947',
        wireframe: true,
        transparent: true,
        opacity: 0.075,
        depthWrite: false,
      }),
    );
    terrainWire.rotation.copy(ground.rotation);
    terrainWire.position.y = 0.006;
    this.scene.add(terrainWire);

    const hemi = new THREE.HemisphereLight('#86ddff', '#02080c', 1.45);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight('#c9f2ff', 3.0);
    key.position.set(-5, 12, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -13;
    key.shadow.camera.right = 13;
    key.shadow.camera.top = 10;
    key.shadow.camera.bottom = -10;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    this.scene.add(key);

    const rim = new THREE.PointLight('#168dff', 26, 30, 2);
    rim.position.set(5, 4.5, -6);
    this.scene.add(rim);

    const warm = new THREE.PointLight('#36e1c2', 10, 20, 2);
    warm.position.set(-7, 3.5, 4);
    this.scene.add(warm);
  }

  private buildNetwork() {
    for (const link of network.links) {
      const curve = curveFor(link);

      // Dark bed is intentionally thicker than the water volume. At oblique
      // angles it becomes a strong visual cue for channel depth and branching.
      const bed = new THREE.Mesh(
        createStreamVolume(curve, link.width * 1.20, link.depth * 1.55, 150, 14),
        new THREE.MeshStandardMaterial({
          color: link.status === 'alert' ? '#321b21' : '#062630',
          roughness: 0.68,
          metalness: 0.08,
          transparent: true,
          opacity: 0.94,
          side: THREE.DoubleSide,
        }),
      );
      bed.position.y -= link.depth * 0.30;
      bed.castShadow = true;
      bed.receiveShadow = true;
      bed.renderOrder = 1;
      this.scene.add(bed);

      const material = waterMaterial(link);
      const water = new THREE.Mesh(
        createStreamVolume(curve, link.width, link.depth, 190, 18),
        material,
      );
      water.renderOrder = 4;
      water.userData.entity = { kind: 'link', data: link } satisfies Entity;
      this.waterMaterials.push(material);
      this.interactive.push(water);
      this.scene.add(water);

      // A thin luminous spline above the crown gives a crisp flow silhouette
      // without turning the entire volume into a glowing tube.
      const crest = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 180, Math.max(0.012, link.width * 0.018), 6, false),
        new THREE.MeshBasicMaterial({
          color: colorForStatus(link.status),
          transparent: true,
          opacity: link.status === 'alert' ? 0.62 : 0.23,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      crest.position.y += link.depth * 0.50 + 0.018;
      crest.renderOrder = 6;
      this.scene.add(crest);

      const particles = createFlowParticles(link, curve, this.glowTexture);
      this.particleSystems.push(particles);
      this.scene.add(particles.points);
    }

    for (const node of network.nodes) {
      const group = this.createNode(node);
      this.scene.add(group);
    }
  }

  private createNode(node: HydroNode) {
    const group = new THREE.Group();
    group.position.set(...node.position);
    group.userData.entity = { kind: 'node', data: node } satisfies Entity;

    const status = colorForStatus(node.status);
    const radius = node.kind === 'reservoir' ? 0.58 : node.kind === 'gate' ? 0.28 : node.kind === 'outlet' ? 0.22 : 0.24;

    if (node.kind === 'reservoir') {
      const basin = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 1.48, radius * 1.70, 0.46, 48, 1, false),
        new THREE.MeshStandardMaterial({ color: '#0a2831', roughness: 0.62, metalness: 0.14 }),
      );
      basin.position.y = -0.22;
      basin.castShadow = true;
      basin.receiveShadow = true;
      group.add(basin);

      const water = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 1.34, radius * 1.34, 0.12, 64),
        new THREE.MeshPhysicalMaterial({
          color: '#2ebee6',
          emissive: '#087ca7',
          emissiveIntensity: 0.32,
          transmission: 0.35,
          transparent: true,
          opacity: 0.82,
          roughness: 0.16,
          metalness: 0.04,
        }),
      );
      water.position.y = 0.03;
      water.userData.entity = group.userData.entity;
      group.add(water);
      this.interactive.push(water);

      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 1.46, 0.045, 10, 64),
        new THREE.MeshBasicMaterial({ color: status, transparent: true, opacity: 0.62 }),
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.10;
      group.add(rim);
    } else if (node.kind === 'gate') {
      const gateMat = new THREE.MeshStandardMaterial({
        color: '#24434d', emissive: status, emissiveIntensity: 0.25, roughness: 0.34, metalness: 0.58,
      });
      const pillarGeo = new THREE.BoxGeometry(0.13, 0.72, 0.16);
      for (const x of [-0.24, 0.24]) {
        const pillar = new THREE.Mesh(pillarGeo, gateMat);
        pillar.position.set(x, 0.18, 0);
        pillar.castShadow = true;
        pillar.userData.entity = group.userData.entity;
        group.add(pillar);
        this.interactive.push(pillar);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.18), gateMat);
      beam.position.y = 0.51;
      beam.castShadow = true;
      beam.userData.entity = group.userData.entity;
      group.add(beam);
      this.interactive.push(beam);

      const gate = new THREE.Mesh(
        new THREE.BoxGeometry(0.39, 0.38, 0.055),
        new THREE.MeshStandardMaterial({
          color: status.clone().multiplyScalar(0.5), emissive: status, emissiveIntensity: 0.9, roughness: 0.22, metalness: 0.5,
        }),
      );
      gate.position.y = 0.18;
      gate.userData.entity = group.userData.entity;
      group.add(gate);
      this.interactive.push(gate);
    } else {
      const coreGeometry = node.kind === 'outlet'
        ? new THREE.ConeGeometry(radius * 0.88, radius * 1.8, 24)
        : new THREE.IcosahedronGeometry(radius, 2);
      const coreMaterial = new THREE.MeshStandardMaterial({
        color: status.clone().multiplyScalar(0.42),
        emissive: status,
        emissiveIntensity: node.status === 'alert' ? 2.2 : 1.15,
        roughness: 0.22,
        metalness: 0.38,
      });
      const core = new THREE.Mesh(coreGeometry, coreMaterial);
      core.position.y = node.kind === 'outlet' ? 0.14 : 0.08;
      core.userData.entity = group.userData.entity;
      core.castShadow = true;
      group.add(core);
      this.interactive.push(core);
    }

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.42, Math.max(0.018, radius * 0.065), 10, 56),
      new THREE.MeshBasicMaterial({
        color: status,
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.10;
    halo.userData.entity = group.userData.entity;
    group.add(halo);
    this.interactive.push(halo);

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.58, 8),
      new THREE.MeshBasicMaterial({ color: status, transparent: true, opacity: 0.22 }),
    );
    stem.position.y = 0.45;
    group.add(stem);

    if (node.kind === 'reservoir' || node.kind === 'outlet') {
      const texture = labelTexture(node.label, `${node.level.toFixed(1)} m · ${node.status.toUpperCase()}`);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
      sprite.scale.set(2.25, 0.595, 1);
      sprite.position.set(0, 1.12, 0);
      group.add(sprite);
    }

    return group;
  }

  private createAmbientMotes() {
    const count = 220;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 25;
      positions[i * 3 + 1] = -0.1 + Math.random() * 5.6;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 18;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: '#8fdcff',
        size: 0.048,
        map: this.glowTexture,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
  }

  private bindEvents() {
    window.addEventListener('resize', this.onResize);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  };

  private setPointer(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private hitTest() {
    const hits = this.raycaster.intersectObjects(this.interactive, false);
    return hits.find((hit) => hit.object.userData.entity)?.object ?? null;
  }

  private onPointerMove = (event: PointerEvent) => {
    this.setPointer(event);
    this.canvas.style.cursor = this.hitTest() ? 'pointer' : 'grab';
  };

  private onPointerDown = (event: PointerEvent) => {
    this.setPointer(event);
    const object = this.hitTest();
    if (!object) return;

    const entity = object.userData.entity as Entity;
    this.selectEntity(entity, object);
  };

  private selectEntity(entity: Entity, object: THREE.Object3D) {
    if (this.selectedMaterial) this.selectedMaterial.uniforms.uSelected.value = 0;
    if (this.selectedNode) this.selectedNode.scale.setScalar(1);
    this.selectedMaterial = null;
    this.selectedNode = null;

    if (entity.kind === 'link') {
      const material = object instanceof THREE.Mesh && object.material instanceof THREE.ShaderMaterial
        ? object.material
        : null;
      if (material) {
        material.uniforms.uSelected.value = 1;
        this.selectedMaterial = material;
      }

      const curve = curveFor(entity.data);
      const point = curve.getPointAt(0.55);
      this.triggerScan(point);
      this.showLink(entity.data);
    } else {
      let group: THREE.Object3D = object;
      while (group.parent && group.parent !== this.scene && !group.userData.entity) group = group.parent;
      if (object.parent?.userData.entity) group = object.parent;
      group.scale.setScalar(1.18);
      this.selectedNode = group;
      this.triggerScan(new THREE.Vector3(...entity.data.position));
      this.showNode(entity.data);
    }
  }

  private triggerScan(point: THREE.Vector3) {
    this.scanPulse.position.copy(point);
    this.scanPulse.scale.setScalar(0.04);
    this.scanPulse.material.opacity = 0.82;
    this.scanStarted = this.clock.elapsedTime;
  }

  private showLink(link: HydroLink) {
    const card = document.querySelector<HTMLDivElement>('#selection-card')!;
    card.hidden = false;
    card.innerHTML = `
      <div class="eyebrow">Channel · ${link.status}</div>
      <h3>${link.label}</h3>
      <dl>
        <dt>流量</dt><dd>${link.flow.toFixed(1)} m³/s</dd>
        <dt>流速</dt><dd>${link.velocity.toFixed(2)} m/s</dd>
        <dt>水深</dt><dd>${link.depth.toFixed(2)} m</dd>
        <dt>水位</dt><dd>${link.level.toFixed(1)} m</dd>
        <dt>上游 / 下游</dt><dd>${link.from} → ${link.to}</dd>
      </dl>`;
  }

  private showNode(node: HydroNode) {
    const card = document.querySelector<HTMLDivElement>('#selection-card')!;
    card.hidden = false;
    card.innerHTML = `
      <div class="eyebrow">${node.kind} · ${node.status}</div>
      <h3>${node.label}</h3>
      <dl>
        <dt>节点编号</dt><dd>${node.id}</dd>
        <dt>水位</dt><dd>${node.level.toFixed(1)} m</dd>
        <dt>运行状态</dt><dd>${node.status.toUpperCase()}</dd>
      </dl>`;
  }

  private populateMetrics() {
    const metrics = document.querySelector<HTMLDivElement>('#metrics')!;
    const alerts = network.nodes.filter((node) => node.status === 'alert').length
      + network.links.filter((link) => link.status === 'alert').length;
    const total = network.links[0]?.flow ?? 0;
    metrics.innerHTML = `
      <div class="metric"><span>System inflow</span><strong>${total.toFixed(1)} m³/s</strong></div>
      <div class="metric"><span>Channels</span><strong>${network.links.length}</strong></div>
      <div class="metric"><span>Nodes</span><strong>${network.nodes.length}</strong></div>
      <div class="metric"><span>Alerts</span><strong>${alerts}</strong></div>`;
  }

  private updateFlowParticles(elapsed: number) {
    for (const system of this.particleSystems) {
      const attribute = system.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      let previousSide = new THREE.Vector3(0, 0, 1);

      for (let i = 0; i < system.seeds.length; i += 1) {
        const t = (system.seeds[i] + elapsed * (0.027 + system.speed * 0.018)) % 1;
        system.curve.getPointAt(t, TMP_POINT);
        system.curve.getTangentAt(t, TMP_TANGENT).normalize();
        TMP_SIDE.crossVectors(UP, TMP_TANGENT);

        if (TMP_SIDE.lengthSq() < 1e-6) TMP_SIDE.copy(previousSide);
        else TMP_SIDE.normalize();
        if (TMP_SIDE.dot(previousSide) < 0) TMP_SIDE.multiplyScalar(-1);
        previousSide.copy(TMP_SIDE);

        TMP_UP.crossVectors(TMP_TANGENT, TMP_SIDE).normalize();
        TMP_POINT.addScaledVector(TMP_SIDE, system.offsets[i]);
        TMP_POINT.addScaledVector(TMP_UP, system.depth * 0.54 + 0.035);
        attribute.setXYZ(i, TMP_POINT.x, TMP_POINT.y, TMP_POINT.z);
      }
      attribute.needsUpdate = true;
    }
  }

  private updateScan(elapsed: number) {
    const age = elapsed - this.scanStarted;
    if (age < 0 || age > 1.35) {
      this.scanPulse.material.opacity = 0;
      return;
    }
    const t = age / 1.35;
    const eased = 1 - Math.pow(1 - t, 3);
    const scale = 0.04 + eased * 2.8;
    this.scanPulse.scale.setScalar(scale);
    this.scanPulse.rotation.y = elapsed * 0.8;
    this.scanPulse.rotation.x = elapsed * 0.37;
    this.scanPulse.material.opacity = (1 - t) * 0.72;
  }

  private animate = () => {
    this.animationFrame = requestAnimationFrame(this.animate);
    const elapsed = this.clock.getElapsedTime();

    for (const material of this.waterMaterials) material.uniforms.uTime.value = elapsed;
    this.updateFlowParticles(elapsed);
    this.updateScan(elapsed);

    this.ambientMotes.rotation.y = elapsed * 0.008;
    this.ambientMotes.position.y = Math.sin(elapsed * 0.18) * 0.08;

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener('resize', this.onResize);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.controls.dispose();
    this.renderer.dispose();
    this.glowTexture.dispose();
  }
}

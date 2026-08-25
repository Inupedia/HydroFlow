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
  speed: number;
};

const UP = new THREE.Vector3(0, 1, 0);
const TMP_TANGENT = new THREE.Vector3();
const TMP_SIDE = new THREE.Vector3();
const TMP_POINT = new THREE.Vector3();

function colorForStatus(status: Status) {
  if (status === 'alert') return new THREE.Color('#ff8f66');
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
 * The geometry follows the same central idea as Sylva's procedural limbs:
 * sample a Catmull-Rom spine, transport a local frame, then build the visible
 * surface around that frame. For HydroFlow we flatten the frame into a ribbon
 * so it reads as open water instead of bark/root volume.
 */
function createWaterRibbon(
  curve: THREE.CatmullRomCurve3,
  width: number,
  segments = 160,
  yOffset = 0,
) {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  let previousSide = new THREE.Vector3(0, 0, 1);

  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();

    const side = new THREE.Vector3().crossVectors(UP, tangent);
    if (side.lengthSq() < 1e-5) side.copy(previousSide);
    else side.normalize();

    // Keep the transported side from suddenly flipping at sharp bends.
    if (side.dot(previousSide) < 0) side.multiplyScalar(-1);
    previousSide = side.clone();

    const organic = 0.96 + Math.sin(t * Math.PI * 5.0 + 0.7) * 0.025 + Math.sin(t * Math.PI * 11.0) * 0.012;
    const halfWidth = width * 0.5 * organic;

    const left = point.clone().addScaledVector(side, halfWidth);
    const right = point.clone().addScaledVector(side, -halfWidth);
    left.y += yOffset;
    right.y += yOffset;

    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    normals.push(0, 1, 0, 0, 1, 0);
    uvs.push(0, t, 1, t);

    if (i < segments) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
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

      void main() {
        vUv = uv;
        vec3 p = position;
        float bank = 1.0 - abs(uv.x - 0.5) * 2.0;
        float ripple = sin(uv.y * 92.0 - uTime * (2.4 + uSpeed * 1.9) + sin(uv.x * 12.0) * 0.6);
        p.y += ripple * 0.008 * bank;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
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

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      void main() {
        float edge = smoothstep(0.0, 0.13, vUv.x) * smoothstep(1.0, 0.87, vUv.x);
        float center = 1.0 - abs(vUv.x - 0.5) * 2.0;

        float phaseA = fract(vUv.y * 15.0 - uTime * (0.42 + uSpeed * 0.31));
        float phaseB = fract(vUv.y * 31.0 - uTime * (0.68 + uSpeed * 0.43) + vUv.x * 0.65);
        float streakA = smoothstep(0.18, 0.0, abs(phaseA - 0.5));
        float streakB = smoothstep(0.10, 0.0, abs(phaseB - 0.5));

        float laneNoise = hash21(vec2(floor(vUv.x * 10.0), floor(vUv.y * 24.0)));
        float lanes = smoothstep(0.70, 0.98, sin((vUv.x * 7.0 + vUv.y * 0.8) * 6.2831) * 0.5 + 0.5);
        float shimmer = (streakA * 0.55 + streakB * 0.42) * (0.55 + lanes * 0.45) * (0.75 + laneNoise * 0.25);

        vec3 deep = vec3(0.018, 0.16, 0.24);
        vec3 aqua = vec3(0.12, 0.63, 0.78);
        vec3 foam = vec3(0.70, 0.96, 1.0);
        vec3 color = mix(deep, aqua, 0.38 + center * 0.30 + uFlow * 0.12);
        color = mix(color, foam, shimmer * (0.34 + uFlow * 0.32));
        color = mix(color, uStatus, (uSelected * 0.44) + (length(uStatus - vec3(0.411, 0.898, 1.0)) * 0.12));

        float glow = uSelected * (0.18 + 0.14 * sin(uTime * 5.0));
        color += vec3(0.35, 0.85, 1.0) * glow;

        float alpha = edge * (0.72 + shimmer * 0.20 + uSelected * 0.08);
        gl_FragColor = vec4(color, alpha);
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
  const count = Math.max(10, Math.round(link.flow * 0.65));
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const offsets = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    seeds[i] = Math.random();
    offsets[i] = (Math.random() - 0.5) * link.width * 0.64;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: colorForStatus(link.status),
    size: link.status === 'alert' ? 0.115 : 0.088,
    map: texture,
    transparent: true,
    opacity: link.status === 'alert' ? 0.95 : 0.72,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geometry, material);
  points.renderOrder = 5;
  points.userData.entity = { kind: 'link', data: link } satisfies Entity;

  return { points, curve, seeds, offsets, width: link.width, speed: link.velocity };
}

function labelTexture(text: string, subtext: string) {
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = 280 * scale;
  canvas.height = 74 * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(5, 16, 25, .78)';
  ctx.beginPath();
  ctx.roundRect(1, 1, 278, 72, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(126, 222, 255, .22)';
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
  private scanRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
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
    this.renderer.toneMappingExposure = 1.12;

    this.scene.background = new THREE.Color('#07111b');
    this.scene.fog = new THREE.FogExp2('#07111b', 0.034);

    this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 120);
    this.camera.position.set(0.4, 10.8, 15.8);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.target.set(0, 0, 0.1);
    this.controls.minDistance = 7;
    this.controls.maxDistance = 30;
    this.controls.maxPolarAngle = Math.PI * 0.48;

    this.scanRing = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 96),
      new THREE.MeshBasicMaterial({ color: '#7cecff', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.scanRing.rotation.x = -Math.PI / 2;
    this.scanRing.position.y = 0.24;
    this.scene.add(this.scanRing);

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
      new THREE.PlaneGeometry(42, 28, 1, 1),
      new THREE.MeshStandardMaterial({ color: '#07141d', roughness: 0.94, metalness: 0.02 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.075;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(38, 38, '#163443', '#102633');
    grid.position.y = -0.055;
    const materials = Array.isArray(grid.material) ? grid.material : [grid.material];
    materials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.22;
    });
    this.scene.add(grid);

    const hemi = new THREE.HemisphereLight('#8bdfff', '#021017', 1.5);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight('#bfefff', 2.3);
    key.position.set(-5, 12, 7);
    this.scene.add(key);

    const rim = new THREE.PointLight('#1b8dff', 16, 30, 2);
    rim.position.set(5, 4, -6);
    this.scene.add(rim);
  }

  private buildNetwork() {
    for (const link of network.links) {
      const curve = curveFor(link);

      const bed = new THREE.Mesh(
        createWaterRibbon(curve, link.width * 1.22, 160, -0.028),
        new THREE.MeshStandardMaterial({
          color: link.status === 'alert' ? '#351c20' : '#082533',
          roughness: 0.72,
          metalness: 0.04,
          transparent: true,
          opacity: 0.92,
          side: THREE.DoubleSide,
        }),
      );
      bed.renderOrder = 1;
      this.scene.add(bed);

      const material = waterMaterial(link);
      const water = new THREE.Mesh(createWaterRibbon(curve, link.width, 180, 0.014), material);
      water.renderOrder = 3;
      water.userData.entity = { kind: 'link', data: link } satisfies Entity;
      this.waterMaterials.push(material);
      this.interactive.push(water);
      this.scene.add(water);

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
    group.position.y += 0.12;
    group.userData.entity = { kind: 'node', data: node } satisfies Entity;

    const status = colorForStatus(node.status);
    const radius = node.kind === 'reservoir' ? 0.47 : node.kind === 'gate' ? 0.25 : node.kind === 'outlet' ? 0.19 : 0.22;

    const coreGeometry = node.kind === 'reservoir'
      ? new THREE.CylinderGeometry(radius * 1.25, radius * 1.42, 0.11, 48)
      : node.kind === 'gate'
        ? new THREE.BoxGeometry(0.34, 0.18, 0.34)
        : new THREE.SphereGeometry(radius, 28, 18);

    const coreMaterial = new THREE.MeshStandardMaterial({
      color: status.clone().multiplyScalar(0.46),
      emissive: status,
      emissiveIntensity: node.status === 'alert' ? 1.9 : 1.0,
      roughness: 0.25,
      metalness: 0.32,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.userData.entity = group.userData.entity;
    core.renderOrder = 8;
    group.add(core);
    this.interactive.push(core);

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(radius * 1.35, radius * 1.52, 64),
      new THREE.MeshBasicMaterial({ color: status, transparent: true, opacity: 0.52, side: THREE.DoubleSide, depthWrite: false }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.015;
    halo.userData.entity = group.userData.entity;
    group.add(halo);
    this.interactive.push(halo);

    if (node.kind === 'reservoir' || node.kind === 'outlet') {
      const texture = labelTexture(node.label, `${node.level.toFixed(1)} m · ${node.status.toUpperCase()}`);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
      sprite.scale.set(2.25, 0.595, 1);
      sprite.position.set(0, 0.74, 0);
      group.add(sprite);
    }

    return group;
  }

  private createAmbientMotes() {
    const count = 180;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 24;
      positions[i * 3 + 1] = 0.35 + Math.random() * 4.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 17;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: '#8fdcff',
        size: 0.045,
        map: this.glowTexture,
        transparent: true,
        opacity: 0.22,
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
      const group = object.parent ?? object;
      group.scale.setScalar(1.22);
      this.selectedNode = group;
      this.triggerScan(new THREE.Vector3(...entity.data.position));
      this.showNode(entity.data);
    }
  }

  private triggerScan(point: THREE.Vector3) {
    this.scanRing.position.set(point.x, 0.23, point.z);
    this.scanRing.scale.setScalar(0.08);
    this.scanRing.material.opacity = 0.8;
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
    const alerts = network.nodes.filter((node) => node.status === 'alert').length + network.links.filter((link) => link.status === 'alert').length;
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
      for (let i = 0; i < system.seeds.length; i += 1) {
        const t = (system.seeds[i] + elapsed * (0.027 + system.speed * 0.018)) % 1;
        system.curve.getPointAt(t, TMP_POINT);
        system.curve.getTangentAt(t, TMP_TANGENT).normalize();
        TMP_SIDE.crossVectors(UP, TMP_TANGENT).normalize();
        TMP_POINT.addScaledVector(TMP_SIDE, system.offsets[i]);
        TMP_POINT.y += 0.07;
        attribute.setXYZ(i, TMP_POINT.x, TMP_POINT.y, TMP_POINT.z);
      }
      attribute.needsUpdate = true;
    }
  }

  private updateScan(elapsed: number) {
    const age = elapsed - this.scanStarted;
    if (age < 0 || age > 1.45) {
      this.scanRing.material.opacity = 0;
      return;
    }
    const t = age / 1.45;
    const eased = 1 - Math.pow(1 - t, 3);
    const scale = 0.08 + eased * 4.8;
    this.scanRing.scale.setScalar(scale);
    this.scanRing.material.opacity = (1 - t) * 0.72;
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

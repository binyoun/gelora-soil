import * as THREE from 'three';
import type { FlowerDNA, GrowthState } from '../types';
import { mulberry32 } from '../util/rng';
import { patchGlitch, type GlitchUniforms } from './glitchMaterial';

const PETAL_LEN_PER_HAND = 2.5; // petal length as a multiple of hand span (bigger bloom)
const LIFT_PER_HAND = 2.0; // flower head height above the palm
const MAX_PARTICLES = 320;
const PARTICLE_LIFETIME_S = 2.4;

const DEG = Math.PI / 180;

interface LayerDef {
  frac: number; // share of total petals
  rMax: number; // photo radius sampled (center .. edge)
  scale: number;
  tiltBias: number; // extra tilt (more upright inward)
  z: number; // forward offset for depth stacking
}

const LAYERS: LayerDef[] = [
  { frac: 0.4, rMax: 0.44, scale: 1.0, tiltBias: 0, z: 0.0 },
  { frac: 0.34, rMax: 0.3, scale: 0.72, tiltBias: 16 * DEG, z: 0.06 },
  { frac: 0.26, rMax: 0.18, scale: 0.48, tiltBias: 32 * DEG, z: 0.11 },
];

interface PetalParam {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  angle: number;
  scale: number;
  tiltBias: number;
  z: number;
  swayPhase: number;
}

/**
 * A DNA-driven flower model that wears the captured flower photo. Many thin
 * petals in three depth layers make a delicate, full bloom; each petal is its
 * own mesh whose UVs sample a radial wedge of the photo, so the assembled bloom
 * reconstructs the real flower's image in 3D. An organic curved, tapered stalk
 * extends down toward the hand. Grows/wilts/pours with GrowthState, and glitches
 * its surface (uncanny-garden ModelGlitch idiom) on mediated-touch mutation.
 */
export class Flower {
  readonly group: THREE.Group;
  readonly particles: THREE.InstancedMesh;

  private petals: PetalParam[] = [];
  private center: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>;
  private stem: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private mat: THREE.MeshStandardMaterial;
  private glitch: GlitchUniforms;

  private particlePos: Float32Array;
  private particleVelocities: Float32Array;
  private particleAges: Float32Array;
  private particleSize: Float32Array;
  private particleAlphaAttr: THREE.InstancedBufferAttribute;
  private particleMaterial: THREE.ShaderMaterial;
  private particleDummy = new THREE.Object3D();
  private nextParticle = 0;
  private wasDetached: boolean[];

  constructor(dna: FlowerDNA, photo: THREE.Texture) {
    this.group = new THREE.Group();
    const rand = mulberry32(dna.seed);
    const tintColor = new THREE.Color().setHSL(dna.hueCenter / 360, Math.max(0.4, dna.saturation), 0.55);

    this.mat = new THREE.MeshStandardMaterial({
      map: photo,
      color: 0xffffff,
      roughness: 0.62,
      metalness: 0.0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.85,
      alphaTest: 0.35,
    });
    this.glitch = patchGlitch(this.mat, tintColor.getHex(), 0.05);

    // more petals than DNA count for a full, delicate bloom, across three layers
    const total = Math.max(12, Math.min(32, Math.round(dna.petalCount * 2.4)));
    const sharp = 0.6 + dna.edgeComplexity * 1.6;

    for (const layer of LAYERS) {
      const count = Math.max(3, Math.round(total * layer.frac));
      const wedge = ((Math.PI * 2) / count) * 1.2;
      const angleOffset = rand() * Math.PI * 2;
      for (let k = 0; k < count; k++) {
        const jitter = (rand() - 0.5) * 0.2;
        const angle = (k / count) * Math.PI * 2 + angleOffset + jitter;
        const geo = buildPetalGeometry(sharp, angle, wedge, layer.rMax, rand);
        const mesh = new THREE.Mesh(geo, this.mat);
        mesh.frustumCulled = false;
        this.group.add(mesh);
        this.petals.push({
          mesh,
          angle,
          scale: layer.scale * (0.88 + rand() * 0.28),
          tiltBias: layer.tiltBias + (rand() - 0.5) * 14 * DEG,
          z: layer.z,
          swayPhase: rand() * Math.PI * 2,
        });
      }
    }

    const centerGeo = new THREE.CircleGeometry(1, 28);
    remapCircleUvToPhotoCenter(centerGeo, 0.12);
    this.center = new THREE.Mesh(centerGeo, this.mat);
    this.center.frustumCulled = false;
    this.group.add(this.center);

    // organic curved, tapered stalk toward the hand (not a rigid cylinder)
    this.stem = new THREE.Mesh(
      buildStemGeometry(rand),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(0x5c6a3c), roughness: 0.85, side: THREE.DoubleSide }),
    );
    this.group.add(this.stem);

    this.group.visible = false;

    this.wasDetached = new Array(this.petals.length).fill(false);
    this.particlePos = new Float32Array(MAX_PARTICLES * 3);
    this.particleVelocities = new Float32Array(MAX_PARTICLES * 3);
    this.particleAges = new Float32Array(MAX_PARTICLES).fill(Infinity);
    this.particleSize = new Float32Array(MAX_PARTICLES);

    // soft glowing billboard quads (additive) that fade like droplets of light,
    // instead of hard square points. Real triangles, so no gl_PointSize limits.
    const quad = new THREE.PlaneGeometry(1, 1);
    this.particleAlphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES), 1);
    quad.setAttribute('aAlpha', this.particleAlphaAttr);
    this.particleMaterial = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0x5cc4e8) } }, // water blue
      vertexShader: `
        attribute float aAlpha;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vUv = uv;
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision mediump float;
        uniform vec3 uColor;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          float d = length(vUv - 0.5);
          float glow = smoothstep(0.5, 0.0, d);
          vec3 col = mix(uColor, vec3(1.0), glow * glow * 0.7);
          gl_FragColor = vec4(col, glow * vAlpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.particles = new THREE.InstancedMesh(quad, this.particleMaterial, MAX_PARTICLES);
    this.particles.frustumCulled = false;
    this.particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // start all hidden (zero scale)
    this.particleDummy.scale.setScalar(0);
    this.particleDummy.updateMatrix();
    for (let i = 0; i < MAX_PARTICLES; i++) this.particles.setMatrixAt(i, this.particleDummy.matrix);
  }

  update(
    _dna: FlowerDNA,
    growth: GrowthState,
    originWorld: THREE.Vector3,
    handScale: number,
    present: boolean,
    time: number,
    dt: number,
  ): void {
    // glitch: a small living baseline once bloomed, spiking hard and lingering on
    // a mediated-touch mutation
    const lastTouchAge = growth.mutations.length ? growth.age - growth.mutations[growth.mutations.length - 1]!.at : 999;
    const touchSurge = Math.max(0, 1 - lastTouchAge / 1.2);
    const base = 0.08 * smoothstep(0.25, 0.55, growth.maturity);
    this.glitch.uGlitch.value = Math.min(1, base + touchSurge * 1.1);
    this.glitch.uTime.value = time;

    if (!present || growth.maturity <= 0.04) {
      this.group.visible = false;
      this.updateParticles(dt);
      return;
    }
    this.group.visible = true;

    const emerge = 0.2 + 0.8 * smoothstep(0, 0.5, growth.maturity);
    const unfold = smoothstep(0.1, 0.7, growth.maturity);
    const wilt = growth.wiltAmount;
    const petalLen = handScale * PETAL_LEN_PER_HAND * emerge;
    const lift = handScale * LIFT_PER_HAND * emerge;

    // touch glitch also jitters the whole head slightly, for a stronger hit
    const jitterAmp = touchSurge * handScale * 0.05;
    this.group.position.set(
      originWorld.x + (Math.random() - 0.5) * jitterAmp,
      originWorld.y + lift + (Math.random() - 0.5) * jitterAmp,
      originWorld.z,
    );
    this.group.rotation.set(wilt * 0.7 + Math.sin(time * 0.5) * 0.02, Math.sin(time * 0.35) * 0.03, Math.sin(time * 0.6) * 0.03);

    this.stem.scale.set(handScale, lift, handScale);
    this.stem.visible = lift > 0.001;

    const centerScale = petalLen * 0.34;
    this.center.position.set(0, 0, 0.02);
    this.center.scale.set(centerScale, centerScale, 1);

    const nState = growth.petals.length;
    for (let i = 0; i < this.petals.length; i++) {
      const p = this.petals[i]!;
      const petal = growth.petals[i % nState]!; // more visual petals than DNA state: share cyclically
      const tilt = 58 * DEG * (1 - unfold) + 26 * DEG + p.tiltBias + wilt * 40 * DEG;
      const sway = Math.sin(time * 1.2 + p.swayPhase) * 0.06 * unfold;
      const fallShrink = petal.detached ? Math.max(0, 1 - petal.fallProgress) : 1;
      const scale = petalLen * p.scale * fallShrink;

      const m = p.mesh;
      m.position.set(0, 0, p.z * petalLen);
      if (petal.detached) m.position.y -= petal.fallProgress * petalLen * 2.5;
      m.rotation.set(0, 0, 0);
      m.rotateZ(p.angle + sway * 0.5);
      m.rotateX(tilt + sway);
      m.scale.setScalar(scale);
      m.visible = scale > 1e-4;

      if (petal.detached && !this.wasDetached[i]) this.spawnBurst(this.group.position, handScale);
      this.wasDetached[i] = petal.detached;
    }

    this.updateParticles(dt);
  }

  private spawnBurst(origin: THREE.Vector3, handScale: number): void {
    for (let k = 0; k < 18; k++) {
      const idx = this.nextParticle;
      this.nextParticle = (this.nextParticle + 1) % MAX_PARTICLES;
      this.particlePos[idx * 3] = origin.x + (Math.random() - 0.5) * handScale;
      this.particlePos[idx * 3 + 1] = origin.y + (Math.random() - 0.5) * handScale;
      this.particlePos[idx * 3 + 2] = origin.z + (Math.random() - 0.5) * handScale * 0.5;
      // gentle spill: soft outward drift, then gravity carries it down like water
      this.particleVelocities[idx * 3] = (Math.random() - 0.5) * 0.1;
      this.particleVelocities[idx * 3 + 1] = Math.random() * 0.04;
      this.particleVelocities[idx * 3 + 2] = (Math.random() - 0.5) * 0.06;
      this.particleAges[idx] = 0;
      this.particleSize[idx] = handScale * (0.2 + Math.random() * 0.26); // world-space glow radius (smaller)
    }
  }

  private updateParticles(dt: number): void {
    let anyAlive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.particleAges[i]! === Infinity) continue;
      this.particleAges[i]! += dt;
      const age = this.particleAges[i]!;
      if (age > PARTICLE_LIFETIME_S) {
        this.particleAges[i] = Infinity;
        this.particleAlphaAttr.setX(i, 0);
        this.particleDummy.scale.setScalar(0);
        this.particleDummy.position.set(0, 0, 0);
        this.particleDummy.updateMatrix();
        this.particles.setMatrixAt(i, this.particleDummy.matrix);
        anyAlive = true;
        continue;
      }
      anyAlive = true;
      this.particleVelocities[i * 3 + 1]! -= 9.8 * dt * 0.04; // gravity, fluid fall
      this.particleVelocities[i * 3]! *= 0.98; // drag, so it flows rather than shoots
      this.particleVelocities[i * 3 + 2]! *= 0.98;
      this.particlePos[i * 3]! += this.particleVelocities[i * 3]! * dt;
      this.particlePos[i * 3 + 1]! += this.particleVelocities[i * 3 + 1]! * dt;
      this.particlePos[i * 3 + 2]! += this.particleVelocities[i * 3 + 2]! * dt;

      // fade in fast, ebb out slowly (a droplet of light), swell slightly as it goes
      const life = age / PARTICLE_LIFETIME_S;
      this.particleAlphaAttr.setX(i, Math.min(1, age / 0.15) * (1 - life) * (1 - life));
      const size = this.particleSize[i]! * (0.7 + life * 0.6);
      this.particleDummy.position.set(this.particlePos[i * 3]!, this.particlePos[i * 3 + 1]!, this.particlePos[i * 3 + 2]!);
      this.particleDummy.scale.setScalar(size);
      this.particleDummy.rotation.set(0, 0, 0);
      this.particleDummy.updateMatrix();
      this.particles.setMatrixAt(i, this.particleDummy.matrix);
    }
    if (anyAlive) {
      this.particles.instanceMatrix.needsUpdate = true;
      this.particleAlphaAttr.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const p of this.petals) p.mesh.geometry.dispose();
    this.mat.dispose();
    this.center.geometry.dispose();
    this.stem.geometry.dispose();
    this.stem.material.dispose();
    this.particles.geometry.dispose();
    this.particleMaterial.dispose();
  }
}

/** A thin, curved, slightly irregular petal; UVs sample a radial wedge of the photo. */
function buildPetalGeometry(
  sharp: number,
  angle: number,
  wedge: number,
  rMax: number,
  rand: () => number,
): THREE.BufferGeometry {
  const SU = 14;
  const SV = 8;
  const wavePhase = rand() * Math.PI * 2;
  const waveAmp = 0.08 + rand() * 0.1;
  const curlAmt = 0.3 + (rand() - 0.5) * 0.18;
  const twist = (rand() - 0.5) * 0.14;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= SU; i++) {
    const u = i / SU;
    const wave = 1 + waveAmp * Math.sin(u * 7 + wavePhase);
    const width = Math.pow(Math.sin(Math.PI * u), sharp) * wave;
    for (let j = 0; j <= SV; j++) {
      const v = j / SV;
      const vv = v * 2 - 1;
      const x = vv * 0.3 * width + twist * u; // thinner (0.3) for delicacy
      const y = u;
      const curlTip = curlAmt * u * u;
      const cup = 0.3 * vv * vv * width;
      positions.push(x, y, curlTip + cup);

      const r = rMax * u;
      const a = angle + (v - 0.5) * wedge;
      uvs.push(0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r);
    }
  }
  for (let i = 0; i < SU; i++) {
    for (let j = 0; j < SV; j++) {
      const a = i * (SV + 1) + j;
      const b = a + (SV + 1);
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A thin, irregular, twisting organic tendril from the flower base (y=0) toward
 * the hand (y=-1): a bezier spine with a tapering wiggle and a slow helical
 * twist, and slightly uneven thickness, so it reads as alive rather than a tube.
 */
function buildStemGeometry(rand: () => number): THREE.BufferGeometry {
  const N = 22;
  const M = 6;
  const bendX = (rand() - 0.5) * 0.36;
  const bendZ = (rand() - 0.5) * 0.24;
  const ctrl = new THREE.Vector3(bendX * 0.5 + (rand() - 0.5) * 0.2, -0.5, bendZ * 0.5);
  const p0 = new THREE.Vector3(0, 0, 0);
  const p1 = new THREE.Vector3(bendX, -1, bendZ);

  const wf1 = 6 + rand() * 5;
  const wf2 = 8 + rand() * 6;
  const wph1 = rand() * 6.28;
  const wph2 = rand() * 6.28;
  const wAmpX = 0.03 + rand() * 0.035;
  const wAmpZ = 0.03 + rand() * 0.035;
  const twist = (rand() - 0.5) * 5;

  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const mt = 1 - t;
    const env = Math.sin(Math.PI * t); // wiggle vanishes at both ends
    const cx = mt * mt * p0.x + 2 * mt * t * ctrl.x + t * t * p1.x + Math.sin(t * wf1 + wph1) * wAmpX * env;
    const cy = mt * mt * p0.y + 2 * mt * t * ctrl.y + t * t * p1.y;
    const cz = mt * mt * p0.z + 2 * mt * t * ctrl.z + t * t * p1.z + Math.cos(t * wf2 + wph2) * wAmpZ * env;
    const radius = (0.014 + t * 0.03) * (0.82 + Math.abs(Math.sin(t * 9 + wph1)) * 0.36); // thin at flower, uneven
    const tw = twist * t;
    for (let m = 0; m <= M; m++) {
      const ang = (m / M) * Math.PI * 2 + tw;
      positions.push(cx + Math.cos(ang) * radius, cy, cz + Math.sin(ang) * radius);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let m = 0; m < M; m++) {
      const a = i * (M + 1) + m;
      const b = a + (M + 1);
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Remap a unit CircleGeometry's UVs to a small central disc of the photo. */
function remapCircleUvToPhotoCenter(geo: THREE.CircleGeometry, radius: number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, 0.5 + pos.getX(i) * radius, 0.5 + pos.getY(i) * radius);
  }
  uv.needsUpdate = true;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

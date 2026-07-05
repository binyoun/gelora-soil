import * as THREE from 'three';
import type { FlowerDNA, GrowthState } from '../types';
import { mulberry32 } from '../util/rng';
import { patchGlitch, type GlitchUniforms } from './glitchMaterial';

const MAX_PETALS = 16;
const PETAL_LEN_PER_HAND = 2.0; // petal length as a multiple of hand span (bigger)
const LIFT_PER_HAND = 1.8; // flower head height above the palm
const MAX_PARTICLES = 300;
const PARTICLE_LIFETIME_S = 2.4;

const DEG = Math.PI / 180;

interface PetalParam {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  angle: number;
  layer: number;
  scale: number;
  tiltBias: number;
  swayPhase: number;
}

/**
 * A DNA-driven flower model that wears the captured flower photo: each petal is
 * its own curved, slightly irregular mesh whose UVs sample a radial wedge of the
 * photo, so the assembled bloom reconstructs the real flower's image in 3D.
 * MeshStandardMaterial lit by the scene environment (PMREM). FlowerDNA drives
 * petal count, shape, size and organic variation. Grows open + scales with
 * maturity, droops with wilt, sheds petals on pour, glitches on mutation.
 */
export class Flower {
  readonly group: THREE.Group;
  readonly particles: THREE.Points;

  private petals: PetalParam[] = [];
  private center: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>;
  private stem: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
  private mat: THREE.MeshStandardMaterial;
  private glitch: GlitchUniforms;

  private petalCount: number;

  private particlePositions: Float32Array;
  private particleVelocities: Float32Array;
  private particleAges: Float32Array;
  private particleGeometry: THREE.BufferGeometry;
  private particleMaterial: THREE.PointsMaterial;
  private nextParticle = 0;
  private wasDetached: boolean[];

  constructor(dna: FlowerDNA, photo: THREE.Texture) {
    this.group = new THREE.Group();
    this.petalCount = Math.max(5, Math.min(MAX_PETALS, dna.petalCount));
    const rand = mulberry32(dna.seed);
    const tintColor = new THREE.Color().setHSL(dna.hueCenter / 360, Math.max(0.4, dna.saturation), 0.55);

    // one shared material: the captured flower photo, lit by the environment
    this.mat = new THREE.MeshStandardMaterial({
      map: photo,
      color: 0xffffff,
      roughness: 0.62,
      metalness: 0.0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.85,
      // discard where the photo has no flower (matte alpha), so petals that
      // sample past the flower are cleanly cut, not black; gives ragged organic tips
      alphaTest: 0.35,
    });
    this.glitch = patchGlitch(this.mat, tintColor.getHex(), 0.06);

    const outer = this.petalCount <= 8 ? this.petalCount : Math.ceil(this.petalCount * 0.62);
    const inner = this.petalCount - outer;
    const sharp = 0.5 + dna.edgeComplexity * 1.4;

    for (let i = 0; i < this.petalCount; i++) {
      const isOuter = i < outer;
      const layer = isOuter ? 0 : 1;
      const count = isOuter ? outer : Math.max(1, inner);
      const idx = isOuter ? i : i - outer;
      const jitter = (rand() - 0.5) * 0.22; // organic angular jitter
      const angle = (idx / count) * Math.PI * 2 + (layer === 1 ? Math.PI / count : 0) + jitter;
      const wedge = (Math.PI * 2) / count * 1.15;
      const rMax = layer === 1 ? 0.3 : 0.42;

      const geo = buildPetalGeometry(sharp, angle, wedge, rMax, rand);
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.petals.push({
        mesh,
        angle,
        layer,
        scale: (layer === 1 ? 0.72 : 1) * (0.9 + rand() * 0.25), // organic size variance
        tiltBias: (layer === 1 ? 20 : 0) * DEG + (rand() - 0.5) * 16 * DEG,
        swayPhase: rand() * Math.PI * 2,
      });
    }

    // center: a small disc of the photo's middle, hiding where petals converge
    const centerGeo = new THREE.CircleGeometry(1, 28);
    remapCircleUvToPhotoCenter(centerGeo, 0.14);
    this.center = new THREE.Mesh(centerGeo, this.mat);
    this.center.frustumCulled = false;
    this.group.add(this.center);

    const stemGeo = new THREE.CylinderGeometry(0.03, 0.05, 1, 7, 1, true);
    stemGeo.translate(0, -0.5, 0);
    this.stem = new THREE.Mesh(
      stemGeo,
      new THREE.MeshStandardMaterial({ color: new THREE.Color(0x4c6a34), roughness: 0.8, side: THREE.DoubleSide }),
    );
    this.group.add(this.stem);

    this.group.visible = false;

    this.wasDetached = new Array(this.petalCount).fill(false);
    this.particlePositions = new Float32Array(MAX_PARTICLES * 3);
    this.particleVelocities = new Float32Array(MAX_PARTICLES * 3);
    this.particleAges = new Float32Array(MAX_PARTICLES).fill(Infinity);
    this.particleGeometry = new THREE.BufferGeometry();
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    this.particleMaterial = new THREE.PointsMaterial({ color: tintColor, size: 0.016, transparent: true, opacity: 0.9 });
    this.particles = new THREE.Points(this.particleGeometry, this.particleMaterial);
    this.particles.frustumCulled = false;
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
    const lastTouchAge = growth.mutations.length ? growth.age - growth.mutations[growth.mutations.length - 1]!.at : 999;
    const touchSurge = Math.max(0, 1 - lastTouchAge / 0.8);
    this.glitch.uGlitch.value = Math.min(0.9, touchSurge * 0.9) * smoothstep(0.1, 0.4, growth.maturity);
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

    this.group.position.set(originWorld.x, originWorld.y + lift, originWorld.z);
    this.group.rotation.set(wilt * 0.7 + Math.sin(time * 0.5) * 0.02, Math.sin(time * 0.35) * 0.03, Math.sin(time * 0.6) * 0.03);

    this.stem.scale.set(handScale, lift, handScale);
    this.stem.visible = lift > 0.001;

    const centerScale = petalLen * 0.55;
    this.center.position.set(0, 0, 0.01);
    this.center.scale.set(centerScale, centerScale, 1);

    for (let i = 0; i < this.petals.length; i++) {
      const p = this.petals[i]!;
      const petal = growth.petals[i]!;
      // closed ~82deg (tips toward camera) -> open ~24deg (stays cupped); wilt folds down
      const tilt = 58 * DEG * (1 - unfold) + 24 * DEG + p.tiltBias + wilt * 40 * DEG;
      const sway = Math.sin(time * 1.2 + p.swayPhase) * 0.06 * unfold;
      const fallShrink = petal.detached ? Math.max(0, 1 - petal.fallProgress) : 1;
      const scale = petalLen * p.scale * fallShrink;

      const m = p.mesh;
      m.position.set(0, 0, 0);
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
    for (let k = 0; k < 12; k++) {
      const idx = this.nextParticle;
      this.nextParticle = (this.nextParticle + 1) % MAX_PARTICLES;
      this.particlePositions[idx * 3] = origin.x + (Math.random() - 0.5) * handScale;
      this.particlePositions[idx * 3 + 1] = origin.y + (Math.random() - 0.5) * handScale;
      this.particlePositions[idx * 3 + 2] = origin.z;
      this.particleVelocities[idx * 3] = (Math.random() - 0.5) * 0.16;
      this.particleVelocities[idx * 3 + 1] = Math.random() * 0.08;
      this.particleVelocities[idx * 3 + 2] = (Math.random() - 0.5) * 0.1;
      this.particleAges[idx] = 0;
    }
  }

  private updateParticles(dt: number): void {
    const positions = this.particleGeometry.attributes.position as THREE.BufferAttribute;
    let anyAlive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.particleAges[i]! === Infinity) continue;
      this.particleAges[i]! += dt;
      if (this.particleAges[i]! > PARTICLE_LIFETIME_S) {
        this.particleAges[i] = Infinity;
        continue;
      }
      anyAlive = true;
      this.particleVelocities[i * 3 + 1]! -= 9.8 * dt * 0.05;
      this.particlePositions[i * 3]! += this.particleVelocities[i * 3]! * dt;
      this.particlePositions[i * 3 + 1]! += this.particleVelocities[i * 3 + 1]! * dt;
      this.particlePositions[i * 3 + 2]! += this.particleVelocities[i * 3 + 2]! * dt;
    }
    if (anyAlive) positions.needsUpdate = true;
  }

  dispose(): void {
    for (const p of this.petals) p.mesh.geometry.dispose();
    this.mat.dispose();
    this.center.geometry.dispose();
    this.stem.geometry.dispose();
    this.stem.material.dispose();
    this.particleGeometry.dispose();
    this.particleMaterial.dispose();
  }
}

/**
 * A curved, slightly irregular petal whose UVs sample a radial wedge of the
 * flower photo (base = photo center, tip = photo edge at `rMax`), so petals
 * assembled around the head reconstruct the photo.
 */
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
  const waveAmp = 0.08 + rand() * 0.1; // organic edge waviness
  const curlAmt = 0.28 + (rand() - 0.5) * 0.16;
  const twist = (rand() - 0.5) * 0.12;
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
      const x = vv * 0.4 * width + twist * u;
      const y = u;
      const curlTip = curlAmt * u * u;
      const cup = 0.26 * vv * vv * width;
      positions.push(x, y, curlTip + cup);

      // radial UV: base -> photo center, tip -> photo edge, across -> wedge angle
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

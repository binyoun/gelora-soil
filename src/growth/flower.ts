import * as THREE from 'three';
import type { FlowerDNA, GrowthState } from '../types';
import { patchGlitch, type GlitchUniforms } from './glitchMaterial';

const MAX_PETALS = 16;
const PETAL_LEN_PER_HAND = 1.25; // petal length as a multiple of hand span
const LIFT_PER_HAND = 1.5; // flower head height above the palm
const MAX_PARTICLES = 300;
const PARTICLE_LIFETIME_S = 2.4;

const DEG = Math.PI / 180;

/**
 * A DNA-driven procedural flower: real curved petal geometry (not flat planes),
 * layered rings, a domed center, and a stem, all MeshStandardMaterial lit by the
 * scene environment (PMREM). FlowerDNA sets petal count, shape, colour and size.
 * Grows open + scales with maturity, droops with wilt, sheds petals on pour, and
 * glitches its own surface (uncanny-garden ModelGlitch idiom) on mutation.
 */
export class Flower {
  readonly group: THREE.Group;
  readonly particles: THREE.Points;

  private petals: THREE.InstancedMesh;
  private center: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private stem: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
  private petalMat: THREE.MeshStandardMaterial;
  private glitch: GlitchUniforms;
  private dummy = new THREE.Object3D();

  private petalCount: number;
  private baseHue: number;
  private baseSat: number;
  private layerOf: number[] = [];
  private idxInLayer: number[] = [];
  private layerSize: number[] = [];
  private jitter: number[] = [];

  private particlePositions: Float32Array;
  private particleVelocities: Float32Array;
  private particleAges: Float32Array;
  private particleGeometry: THREE.BufferGeometry;
  private particleMaterial: THREE.PointsMaterial;
  private nextParticle = 0;
  private wasDetached: boolean[];

  constructor(dna: FlowerDNA) {
    this.group = new THREE.Group();
    this.petalCount = Math.max(5, Math.min(MAX_PETALS, dna.petalCount));
    this.baseHue = dna.hueCenter / 360;
    this.baseSat = Math.max(0.45, Math.min(0.95, dna.saturation));

    const baseColor = new THREE.Color().setHSL(this.baseHue, this.baseSat, 0.55);

    const petalGeo = buildPetalGeometry(dna.edgeComplexity);
    this.petalMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.5,
      metalness: 0.0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.9,
    });
    this.glitch = patchGlitch(this.petalMat, baseColor.getHex(), 0.06);
    this.petals = new THREE.InstancedMesh(petalGeo, this.petalMat, MAX_PETALS);
    this.petals.count = this.petalCount;
    this.petals.frustumCulled = false;
    this.group.add(this.petals);

    // two layers for fuller flowers so petals overlap instead of splaying flat
    const outer = this.petalCount <= 8 ? this.petalCount : Math.ceil(this.petalCount * 0.62);
    const inner = this.petalCount - outer;
    for (let i = 0; i < this.petalCount; i++) {
      const isOuter = i < outer;
      this.layerOf.push(isOuter ? 0 : 1);
      this.idxInLayer.push(isOuter ? i : i - outer);
      this.layerSize.push(isOuter ? outer : Math.max(1, inner));
      this.jitter.push((((dna.seed >> (i % 24)) & 0xff) / 255 - 0.5) * 0.18);
    }

    const centerColor = new THREE.Color().setHSL((this.baseHue + 0.5) % 1, 0.5, 0.5);
    this.center = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 22, 16),
      new THREE.MeshStandardMaterial({ color: centerColor, roughness: 0.65, metalness: 0.0 }),
    );
    this.center.scale.set(1, 1, 0.6);
    this.group.add(this.center);

    const stemGeo = new THREE.CylinderGeometry(0.03, 0.05, 1, 7, 1, true);
    stemGeo.translate(0, -0.5, 0); // top at y=0, extends down
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
    this.particleMaterial = new THREE.PointsMaterial({ color: baseColor, size: 0.016, transparent: true, opacity: 0.9 });
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
    // mutation-driven surface glitch + hue drift
    let hueSum = 0;
    for (const p of growth.petals) hueSum += p.hueShift;
    const n = Math.max(1, growth.petals.length);
    const lastTouchAge = growth.mutations.length ? growth.age - growth.mutations[growth.mutations.length - 1]!.at : 999;
    const touchSurge = Math.max(0, 1 - lastTouchAge / 0.8);
    this.glitch.uGlitch.value = Math.min(0.9, touchSurge * 0.9) * smoothstep(0.1, 0.4, growth.maturity);
    this.glitch.uTime.value = time;
    this.petalMat.color.setHSL(mod1(this.baseHue + hueSum / n / 360), this.baseSat, 0.55);

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

    // flower head floats above the palm, facing the camera (local +Z = toward camera)
    this.group.position.set(originWorld.x, originWorld.y + lift, originWorld.z);
    this.group.rotation.set(wilt * 0.7 + Math.sin(time * 0.5) * 0.02, Math.sin(time * 0.35) * 0.03, Math.sin(time * 0.6) * 0.03);

    // stem down to the palm
    this.stem.scale.set(handScale, lift, handScale);
    this.stem.visible = lift > 0.001;

    // domed center, sized to read against the petals
    const centerScale = petalLen * 1.5;
    this.center.scale.set(centerScale, centerScale, centerScale * 0.6);

    // petals: distribute around the head, tilt from closed bud to open bloom
    for (let i = 0; i < this.petalCount; i++) {
      const petal = growth.petals[i]!;
      const layer = this.layerOf[i]!;
      const count = this.layerSize[i]!;
      const theta = (this.idxInLayer[i]! / count) * Math.PI * 2 + (layer === 1 ? Math.PI / count : 0) + this.jitter[i]!;

      // open angle: closed ~82deg (tips toward camera), open ~22deg (stays cupped,
      // not flat); inner petals open less; wilt folds them back down
      const layerBias = layer === 1 ? 20 * DEG : 0;
      const tilt = (60 * DEG) * (1 - unfold) + 22 * DEG + layerBias + wilt * 40 * DEG;

      const sway = Math.sin(time * 1.3 + i) * 0.05 * unfold;
      const layerScale = layer === 1 ? 0.7 : 1;
      const fallShrink = petal.detached ? Math.max(0, 1 - petal.fallProgress) : 1;
      const scale = petalLen * layerScale * (1 + this.jitter[i]! * 0.3) * fallShrink;

      this.dummy.position.set(0, 0, 0);
      if (petal.detached) this.dummy.position.y -= petal.fallProgress * petalLen * 2.5;
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.rotateZ(theta);
      this.dummy.rotateX(tilt + sway);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.petals.setMatrixAt(i, this.dummy.matrix);

      if (petal.detached && !this.wasDetached[i]) this.spawnBurst(this.group.position, handScale);
      this.wasDetached[i] = petal.detached;
    }
    this.petals.instanceMatrix.needsUpdate = true;
    this.petals.count = this.petalCount;

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
    this.petals.geometry.dispose();
    this.petalMat.dispose();
    this.center.geometry.dispose();
    this.center.material.dispose();
    this.stem.geometry.dispose();
    this.stem.material.dispose();
    this.particleGeometry.dispose();
    this.particleMaterial.dispose();
  }
}

/** A curved, tapered petal: narrow at base and tip, widest mid-length, cupped and tip-curled toward +Z. */
function buildPetalGeometry(edgeComplexity: number): THREE.BufferGeometry {
  const SU = 12;
  const SV = 8;
  const sharp = 0.5 + edgeComplexity * 1.2; // higher = pointier petal
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= SU; i++) {
    const u = i / SU; // base(0) -> tip(1)
    const width = Math.pow(Math.sin(Math.PI * u), sharp);
    for (let j = 0; j <= SV; j++) {
      const v = j / SV;
      const vv = v * 2 - 1; // -1..1 across
      const x = vv * 0.4 * width;
      const y = u;
      const curlTip = 0.32 * u * u; // tip curls toward +Z
      const cup = 0.28 * vv * vv * width; // edges lift toward +Z
      positions.push(x, y, curlTip + cup);
      uvs.push(v, u);
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

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mod1(x: number): number {
  return x - Math.floor(x);
}

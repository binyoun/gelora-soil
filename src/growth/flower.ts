import * as THREE from 'three';
import type { FlowerDNA, GrowthState } from '../types';
import { mulberry32 } from '../util/rng';
import { patchGlitch, type GlitchUniforms } from './glitchMaterial';
import type { FlowerTemplate, PetalShape } from './flowerTemplates';

const PETAL_LEN_PER_HAND = 2.5;
const LIFT_PER_HAND = 2.0;
const MAX_PARTICLES = 320;
const PARTICLE_LIFETIME_S = 2.4;
const DEG = Math.PI / 180;

interface PetalParam {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  angle: number;
  scale: number;
  tiltBias: number;
  z: number;
  swayPhase: number;
  swayAmp?: number; // bilateral parts: how much this part drifts (tails > sepals)
  rest?: { pos: THREE.Vector3; rotZ: number }; // bilateral parts (ghost orchid)
}

/**
 * A DNA-driven flower that wears the captured selfie, built from a FlowerTemplate
 * (one of four vanitas flowers). Radial flowers assemble layered petals whose
 * UVs sample a radial wedge of the selfie; the ghost orchid is bilateral. Grows,
 * wilts, pours, and glitches via GrowthState; pour residue is glowing motes.
 */
export class Flower {
  readonly group: THREE.Group;
  readonly particles: THREE.InstancedMesh;

  private petals: PetalParam[] = [];
  private center: THREE.Object3D | null = null;
  private centerMat: THREE.Material | null = null;
  private stem: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null = null;
  private mat: THREE.MeshStandardMaterial;
  private glitch: GlitchUniforms;
  private openBase: number;
  private closeExtra: number;
  private centerScaleFactor: number;

  private particlePos: Float32Array;
  private particleVelocities: Float32Array;
  private particleAges: Float32Array;
  private particleSize: Float32Array;
  private particleAlphaAttr: THREE.InstancedBufferAttribute;
  private particleMaterial: THREE.ShaderMaterial;
  private particleDummy = new THREE.Object3D();
  private nextParticle = 0;
  private wasDetached: boolean[];

  constructor(dna: FlowerDNA, photo: THREE.Texture, template: FlowerTemplate) {
    this.group = new THREE.Group();
    const rand = mulberry32(dna.seed);
    const tintColor = new THREE.Color().setHSL(dna.hueCenter / 360, Math.max(0.4, dna.saturation), 0.55);
    this.openBase = template.openBaseDeg;
    this.closeExtra = template.closeExtraDeg;
    this.centerScaleFactor = template.centerScale;

    this.mat = new THREE.MeshStandardMaterial({
      map: photo,
      color: 0xffffff,
      roughness: template.roughness,
      metalness: 0.0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.85,
      alphaTest: 0.35,
      emissive: new THREE.Color(template.emissive),
      emissiveIntensity: template.emissiveIntensity,
    });
    this.glitch = patchGlitch(this.mat, tintColor.getHex(), 0.05);

    if (template.symmetry === 'bilateral') {
      this.buildGhostOrchid(template, rand);
    } else {
      this.buildRadial(template, rand);
    }

    this.buildCenter(template, rand);

    if (template.stem) {
      this.stem = new THREE.Mesh(
        buildStemGeometry(rand),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(0x5c6a3c), roughness: 0.85, side: THREE.DoubleSide }),
      );
      this.group.add(this.stem);
    }

    this.group.visible = false;

    this.wasDetached = new Array(this.petals.length).fill(false);
    this.particlePos = new Float32Array(MAX_PARTICLES * 3);
    this.particleVelocities = new Float32Array(MAX_PARTICLES * 3);
    this.particleAges = new Float32Array(MAX_PARTICLES).fill(Infinity);
    this.particleSize = new Float32Array(MAX_PARTICLES);

    const quad = new THREE.PlaneGeometry(1, 1);
    this.particleAlphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES), 1);
    quad.setAttribute('aAlpha', this.particleAlphaAttr);
    this.particleMaterial = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(template.glowTint) } },
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
    this.particleDummy.scale.setScalar(0);
    this.particleDummy.updateMatrix();
    for (let i = 0; i < MAX_PARTICLES; i++) this.particles.setMatrixAt(i, this.particleDummy.matrix);
  }

  private buildRadial(template: FlowerTemplate, rand: () => number): void {
    for (const layer of template.layers) {
      const wedge = ((Math.PI * 2) / layer.count) * 1.2;
      const angleOffset = rand() * Math.PI * 2;
      for (let k = 0; k < layer.count; k++) {
        const jitter = (rand() - 0.5) * 0.2;
        const angle = (k / layer.count) * Math.PI * 2 + angleOffset + jitter;
        const geo = buildPetalGeometry(template.petal, angle, wedge, layer.rMax, rand);
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
  }

  private buildGhostOrchid(template: FlowerTemplate, rand: () => number): void {
    const b = template.petal;
    const parts: Array<{ shape: PetalShape; angleDeg: number; rotZDeg: number; pos: [number, number, number]; scale: number; sway: number }> = [
      // slender upper sepals, gently curved outward
      { shape: { ...b, width: 0.075, sharp: 2.0, curl: 0.12 }, angleDeg: 90, rotZDeg: 0, pos: [0, 0.0, 0.04], scale: 0.9, sway: 0.1 }, // dorsal (up)
      { shape: { ...b, width: 0.07, sharp: 2.1, strap: 0.15, bend: 0.28 }, angleDeg: 150, rotZDeg: 60, pos: [0, 0.03, 0.03], scale: 1.0, sway: 0.13 }, // lateral (up-left)
      { shape: { ...b, width: 0.07, sharp: 2.1, strap: 0.15, bend: -0.28 }, angleDeg: 30, rotZDeg: -60, pos: [0, 0.03, 0.03], scale: 1.0, sway: 0.13 }, // lateral (up-right)
      // the lip (labellum): two cupped, voluminous lobes with a cleft down the middle
      { shape: { ...b, width: 0.27, sharp: 0.95, cup: 0.74, waveAmp: 0.06, waveFreq: 6, curl: 0.2, bulge: 0.44 }, angleDeg: 258, rotZDeg: 180 + 14, pos: [-0.02, -0.03, 0.05], scale: 1.1, sway: 0.07 }, // lip lobe (left)
      { shape: { ...b, width: 0.27, sharp: 0.95, cup: 0.74, waveAmp: 0.06, waveFreq: 6, curl: 0.2, bulge: 0.44 }, angleDeg: 282, rotZDeg: 180 - 14, pos: [0.02, -0.03, 0.05], scale: 1.1, sway: 0.07 }, // lip lobe (right)
      // the two long curling tails ("frog legs"), the signature of the ghost orchid
      { shape: { ...b, width: 0.032, sharp: 1.0, strap: 0.85, curl: 0.04, bend: -0.55 }, angleDeg: 250, rotZDeg: 180 - 20, pos: [-0.02, -0.14, 0.0], scale: 1.85, sway: 0.28 }, // tail (left)
      { shape: { ...b, width: 0.032, sharp: 1.0, strap: 0.85, curl: 0.04, bend: 0.55 }, angleDeg: 290, rotZDeg: 180 + 20, pos: [0.02, -0.14, 0.0], scale: 1.85, sway: 0.28 }, // tail (right)
    ];
    // a little whorl of small petals at the heart, radiating forward (a rosette)
    const little = 5;
    for (let i = 0; i < little; i++) {
      const aDeg = (i / little) * 360 + 18;
      parts.push({
        shape: { ...b, width: 0.06, sharp: 1.7, cup: 0.28, curl: 0.22 },
        angleDeg: aDeg,
        rotZDeg: aDeg - 90, // radiate outward from centre
        pos: [0, 0, 0.09],
        scale: 0.36,
        sway: 0.16,
      });
    }
    for (const part of parts) {
      const wedge = 60 * DEG;
      const geo = buildPetalGeometry(part.shape, part.angleDeg * DEG, wedge, 0.42, rand);
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.petals.push({
        mesh,
        angle: part.angleDeg * DEG,
        scale: part.scale,
        tiltBias: 0,
        z: part.pos[2],
        swayPhase: rand() * Math.PI * 2,
        swayAmp: part.sway,
        rest: { pos: new THREE.Vector3(part.pos[0], part.pos[1], part.pos[2]), rotZ: part.rotZDeg * DEG },
      });
    }
  }

  private buildCenter(template: FlowerTemplate, rand: () => number): void {
    if (template.center === 'disc') {
      const geo = new THREE.CircleGeometry(1, 28);
      remapCircleUvToPhotoCenter(geo, 0.12);
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.frustumCulled = false;
      this.center = mesh;
      this.group.add(mesh);
    } else if (template.center === 'tuft') {
      const cone = new THREE.ConeGeometry(0.06, 1, 5);
      cone.translate(0, 0.5, 0);
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(template.centerColor), roughness: 0.6 });
      this.centerMat = mat;
      const n = 16;
      const inst = new THREE.InstancedMesh(cone, mat, n);
      inst.frustumCulled = false;
      const d = new THREE.Object3D();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand();
        const r = 0.12 + rand() * 0.16;
        d.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        d.rotation.set((rand() - 0.5) * 0.5, 0, (rand() - 0.5) * 0.5);
        d.scale.set(1, 0.7 + rand() * 0.6, 1);
        d.updateMatrix();
        inst.setMatrixAt(i, d.matrix);
      }
      this.center = inst;
      this.group.add(inst);
    }
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
    const touchSurge = Math.max(0, 1 - lastTouchAge / 1.6);
    const base = 0.08 * smoothstep(0.25, 0.55, growth.maturity);
    this.glitch.uGlitch.value = Math.min(1, base + touchSurge * 1.5);
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

    const jitterAmp = touchSurge * handScale * 0.1;
    this.group.position.set(
      originWorld.x + (Math.random() - 0.5) * jitterAmp,
      originWorld.y + lift + (Math.random() - 0.5) * jitterAmp,
      originWorld.z,
    );
    this.group.rotation.set(wilt * 0.7 + Math.sin(time * 0.5) * 0.02, Math.sin(time * 0.35) * 0.03, Math.sin(time * 0.6) * 0.03);

    if (this.stem) {
      this.stem.scale.set(handScale, lift, handScale);
      this.stem.visible = lift > 0.001;
    }
    if (this.center) {
      const cs = petalLen * this.centerScaleFactor;
      this.center.position.set(0, 0, 0.02);
      this.center.scale.set(cs, cs, cs);
    }

    const nState = growth.petals.length;
    for (let i = 0; i < this.petals.length; i++) {
      const p = this.petals[i]!;
      const petal = growth.petals[i % nState]!;
      const sway = Math.sin(time * 1.2 + p.swayPhase) * 0.06 * unfold;
      const fallShrink = petal.detached ? Math.max(0, 1 - petal.fallProgress) : 1;
      const scale = petalLen * p.scale * fallShrink;
      const m = p.mesh;

      if (p.rest) {
        // bilateral part (ghost orchid): floats, the long tails drifting from
        // their base like it hangs in still air
        const amp = p.swayAmp ?? 0.1;
        const swingZ = (Math.sin(time * 0.9 + p.swayPhase) + 0.4 * Math.sin(time * 1.9 + p.swayPhase * 1.7)) * amp;
        const swingX = Math.sin(time * 0.7 + p.swayPhase * 0.6) * amp * 0.8;
        const bob = Math.sin(time * 0.8 + p.swayPhase) * amp * 0.06;
        m.position.set(p.rest.pos.x * petalLen, p.rest.pos.y * petalLen + bob * petalLen, p.rest.pos.z * petalLen);
        if (petal.detached) m.position.y -= petal.fallProgress * petalLen * 2.5;
        m.rotation.set(swingX, 0, p.rest.rotZ + swingZ);
      } else {
        // radial petal: distribute around the head, tilt from bud to open
        const tilt = this.closeExtra * DEG * (1 - unfold) + this.openBase * DEG + p.tiltBias + wilt * 40 * DEG;
        m.position.set(0, 0, p.z * petalLen);
        if (petal.detached) m.position.y -= petal.fallProgress * petalLen * 2.5;
        m.rotation.set(0, 0, 0);
        m.rotateZ(p.angle + sway * 0.5);
        m.rotateX(tilt + sway);
      }
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
      this.particleVelocities[idx * 3] = (Math.random() - 0.5) * 0.1;
      this.particleVelocities[idx * 3 + 1] = Math.random() * 0.04;
      this.particleVelocities[idx * 3 + 2] = (Math.random() - 0.5) * 0.06;
      this.particleAges[idx] = 0;
      this.particleSize[idx] = handScale * (0.2 + Math.random() * 0.26);
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
      this.particleVelocities[i * 3 + 1]! -= 9.8 * dt * 0.04;
      this.particleVelocities[i * 3]! *= 0.98;
      this.particleVelocities[i * 3 + 2]! *= 0.98;
      this.particlePos[i * 3]! += this.particleVelocities[i * 3]! * dt;
      this.particlePos[i * 3 + 1]! += this.particleVelocities[i * 3 + 1]! * dt;
      this.particlePos[i * 3 + 2]! += this.particleVelocities[i * 3 + 2]! * dt;

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
    if (this.center) {
      const anyCenter = this.center as unknown as { geometry?: THREE.BufferGeometry };
      anyCenter.geometry?.dispose();
    }
    this.centerMat?.dispose();
    if (this.stem) {
      this.stem.geometry.dispose();
      this.stem.material.dispose();
    }
    this.particles.geometry.dispose();
    this.particleMaterial.dispose();
  }
}

/** A curved petal from a PetalShape; UVs sample a radial wedge of the selfie. */
function buildPetalGeometry(
  shape: PetalShape,
  angle: number,
  wedge: number,
  rMax: number,
  rand: () => number,
): THREE.BufferGeometry {
  const SU = 18;
  const SV = 8;
  const wavePhase = rand() * Math.PI * 2;
  const twist = (rand() - 0.5) * 0.14;
  const bend = shape.bend ?? 0;
  const bulge = shape.bulge ?? 0;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= SU; i++) {
    const u = i / SU;
    const taper = Math.pow(Math.sin(Math.PI * u), shape.sharp);
    const strapW = smoothstep(0, 0.12, u) * (1 - smoothstep(0.72, 1.0, u));
    const profile = taper * (1 - shape.strap) + strapW * shape.strap;
    const wave = 1 + shape.waveAmp * Math.sin(u * shape.waveFreq + wavePhase);
    const width = profile * wave;
    const spine = twist * u + bend * u * u; // sideways curl of the whole petal along its length
    for (let j = 0; j <= SV; j++) {
      const v = j / SV;
      const vv = v * 2 - 1;
      const x = vv * shape.width * width + spine;
      const y = u;
      const curlTip = shape.curl * u * u;
      const cup = shape.cup * vv * vv * width;
      const puff = bulge * Math.sin(Math.PI * u) * (1 - vv * vv); // dome outward at centre for volume
      positions.push(x, y, curlTip + cup + puff);

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

/** A thin, irregular, twisting organic tendril from the flower base toward the hand. */
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
    const env = Math.sin(Math.PI * t);
    const cx = mt * mt * p0.x + 2 * mt * t * ctrl.x + t * t * p1.x + Math.sin(t * wf1 + wph1) * wAmpX * env;
    const cy = mt * mt * p0.y + 2 * mt * t * ctrl.y + t * t * p1.y;
    const cz = mt * mt * p0.z + 2 * mt * t * ctrl.z + t * t * p1.z + Math.cos(t * wf2 + wph2) * wAmpZ * env;
    const radius = (0.014 + t * 0.03) * (0.82 + Math.abs(Math.sin(t * 9 + wph1)) * 0.36);
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

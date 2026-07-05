import * as THREE from 'three';
import type { FlowerDNA, GrowthState } from '../types';
import petalFrag from './shaders/petal.frag.glsl?raw';
import petalVert from './shaders/petal.vert.glsl?raw';

const MAX_PETALS = 16;
const ORBIT_PER_HAND = 1.5; // orbit radius as a multiple of hand span
const PETAL_SIZE_PER_HAND = 1.1; // petal size as a multiple of hand span
const ORBIT_SPEED = 0.35;
const MAX_PARTICLES = 400;
const PARTICLES_PER_DETACH = 12;
const PARTICLE_LIFETIME_S = 2.5;

/** Single InstancedMesh sampling FlowerDNA.textureRegions, plus a capped Points cloud for pour-detached petals. */
export class Petals {
  readonly instancedMesh: THREE.InstancedMesh;
  readonly particles: THREE.Points;

  private material: THREE.ShaderMaterial;
  private hueShiftAttr: THREE.InstancedBufferAttribute;
  private warpAttr: THREE.InstancedBufferAttribute;
  private fallAttr: THREE.InstancedBufferAttribute;
  private regionAttr: THREE.InstancedBufferAttribute;

  private particlePositions: Float32Array;
  private particleVelocities: Float32Array;
  private particleAges: Float32Array;
  private particleGeometry: THREE.BufferGeometry;
  private particleMaterial: THREE.PointsMaterial;
  private nextParticleIndex = 0;
  private wasDetached: boolean[];

  private dummy = new THREE.Object3D();

  constructor(dna: FlowerDNA) {
    // unit petal (pivot at base); actual size comes from per-instance scale = handScale * bloom
    const geometry = new THREE.PlaneGeometry(0.6, 1.0, 4, 8);
    geometry.translate(0, 0.5, 0);

    this.hueShiftAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PETALS), 1);
    this.warpAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PETALS), 1);
    this.fallAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PETALS), 1);
    this.regionAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PETALS * 4), 4);
    geometry.setAttribute('aHueShift', this.hueShiftAttr);
    geometry.setAttribute('aWarp', this.warpAttr);
    geometry.setAttribute('aFall', this.fallAttr);
    geometry.setAttribute('aRegion', this.regionAttr);

    for (let i = 0; i < dna.petalCount; i++) {
      const region = dna.textureRegions[i] ?? { u: 0, v: 0, w: 1, h: 1 };
      this.regionAttr.setXYZW(i, region.u, region.v, region.w, region.h);
    }

    this.material = new THREE.ShaderMaterial({
      vertexShader: petalVert,
      fragmentShader: petalFrag,
      uniforms: {
        uTexture: { value: null },
        uWilt: { value: 0 },
        uTime: { value: 0 },
        uGlitch: { value: 0 },
        uTint: { value: new THREE.Color().setHSL(dna.hueCenter / 360, Math.max(0.5, dna.saturation), 0.55) },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.instancedMesh = new THREE.InstancedMesh(geometry, this.material, MAX_PETALS);
    this.instancedMesh.count = dna.petalCount;
    this.instancedMesh.frustumCulled = false;
    this.instancedMesh.visible = false;

    this.particlePositions = new Float32Array(MAX_PARTICLES * 3);
    this.particleVelocities = new Float32Array(MAX_PARTICLES * 3);
    this.particleAges = new Float32Array(MAX_PARTICLES).fill(Infinity);
    this.particleGeometry = new THREE.BufferGeometry();
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    const particleColor = new THREE.Color().setHSL(dna.hueCenter / 360, Math.max(0.4, dna.saturation), 0.6);
    this.particleMaterial = new THREE.PointsMaterial({ color: particleColor, size: 0.012, transparent: true, opacity: 0.85 });
    this.particles = new THREE.Points(this.particleGeometry, this.particleMaterial);
    this.particles.frustumCulled = false;

    this.wasDetached = new Array(dna.petalCount).fill(false);
  }

  setTexture(texture: THREE.Texture): void {
    this.material.uniforms.uTexture!.value = texture;
  }

  update(
    dna: FlowerDNA,
    growth: GrowthState,
    originWorld: THREE.Vector3,
    handScale: number,
    present: boolean,
    time: number,
    dt: number,
  ): void {
    this.material.uniforms.uTime!.value = time;
    this.material.uniforms.uWilt!.value = growth.wiltAmount;

    // glitch level: a living baseline that surges with the strongest active
    // mutation and with recent mediated-touch events (uncanny-garden aesthetic)
    let maxWarp = 0;
    for (const p of growth.petals) maxWarp = Math.max(maxWarp, p.warp);
    const lastTouchAge = growth.mutations.length ? growth.age - growth.mutations[growth.mutations.length - 1]!.at : 999;
    const touchSurge = Math.max(0, 1 - lastTouchAge / 0.6);
    const glitch = Math.min(1, 0.12 + maxWarp * 0.5 + touchSurge * 0.8) * smoothstep(0.1, 0.4, growth.maturity);
    this.material.uniforms.uGlitch!.value = glitch;

    if (!present || growth.maturity <= 0.1) {
      this.instancedMesh.visible = false;
    } else {
      this.instancedMesh.visible = true;
      const origin = originWorld;
      const unfold = smoothstep(0.1, 0.6, growth.maturity);
      const petalScale = handScale * PETAL_SIZE_PER_HAND;
      const orbit = handScale * ORBIT_PER_HAND * unfold;

      for (let i = 0; i < growth.petals.length; i++) {
        const petal = growth.petals[i]!;
        const angle = (i / dna.petalCount) * Math.PI * 2 + growth.age * ORBIT_SPEED;
        // per-petal continuous life: a bob and a breathing pulse so the bloom never sits still
        const bob = Math.sin(time * 1.6 + i * 1.3) * orbit * 0.12;
        const breathe = 1 + Math.sin(time * 2.2 + i * 0.9) * 0.14 * unfold;

        this.dummy.position.set(
          origin.x + Math.cos(angle) * orbit,
          origin.y + Math.sin(angle) * orbit * 0.6 + unfold * handScale * 0.6 + bob,
          origin.z + Math.sin(time * 1.1 + i) * orbit * 0.15,
        );
        // spin in-plane, and tilt outward as the petals open into a 3D bloom
        this.dummy.rotation.set(unfold * 0.9, 0, angle);
        const bloomScale = petalScale * (0.5 + 0.9 * unfold) * breathe * (petal.detached ? Math.max(0, 1 - petal.fallProgress) : 1);
        this.dummy.scale.setScalar(bloomScale);
        this.dummy.updateMatrix();
        this.instancedMesh.setMatrixAt(i, this.dummy.matrix);

        this.hueShiftAttr.setX(i, petal.hueShift);
        this.warpAttr.setX(i, petal.warp);
        this.fallAttr.setX(i, petal.detached ? petal.fallProgress : 0);

        if (petal.detached && !this.wasDetached[i]) {
          this.spawnBurst(this.dummy.position);
        }
        this.wasDetached[i] = petal.detached;
      }

      this.instancedMesh.instanceMatrix.needsUpdate = true;
      this.hueShiftAttr.needsUpdate = true;
      this.warpAttr.needsUpdate = true;
      this.fallAttr.needsUpdate = true;
    }

    this.updateParticles(dt);
  }

  private spawnBurst(origin: THREE.Vector3): void {
    for (let n = 0; n < PARTICLES_PER_DETACH; n++) {
      const idx = this.nextParticleIndex;
      this.nextParticleIndex = (this.nextParticleIndex + 1) % MAX_PARTICLES;
      this.particlePositions[idx * 3] = origin.x;
      this.particlePositions[idx * 3 + 1] = origin.y;
      this.particlePositions[idx * 3 + 2] = origin.z;
      this.particleVelocities[idx * 3] = (Math.random() - 0.5) * 0.15;
      this.particleVelocities[idx * 3 + 1] = Math.random() * 0.1;
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
    this.instancedMesh.geometry.dispose();
    this.material.dispose();
    this.particleGeometry.dispose();
    this.particleMaterial.dispose();
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

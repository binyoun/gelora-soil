import * as THREE from 'three';
import type { FlowerDNA, GrowthState } from '../types';
import type { Relief } from '../capture/relief';
import bloomFrag from './shaders/bloom.frag.glsl?raw';
import bloomVert from './shaders/bloom.vert.glsl?raw';

const BLOOM_SIZE_PER_HAND = 2.2; // flower size as a multiple of hand span
const DISPLACE = 0.34; // relief depth in local plane units
const MAX_PARTICLES = 400;
const PARTICLE_LIFETIME_S = 2.6;

/**
 * The captured flower as a single high-subdivision plane displaced into a lit
 * relief by its height map, carrying growth/wilt/glitch/hue-drift/pour. Replaces
 * the old chopped-plane petals. Same update() shape so main.ts and engine.ts
 * are unchanged.
 */
export class Bloom {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly particles: THREE.Points;

  private material: THREE.ShaderMaterial;
  private aspect: number;

  private particlePositions: Float32Array;
  private particleVelocities: Float32Array;
  private particleAges: Float32Array;
  private particleGeometry: THREE.BufferGeometry;
  private particleMaterial: THREE.PointsMaterial;
  private nextParticleIndex = 0;
  private lastDetached = 0;

  constructor(dna: FlowerDNA, relief: Relief) {
    this.aspect = relief.aspect;
    const geometry = new THREE.PlaneGeometry(1, 1, 160, 160);

    this.material = new THREE.ShaderMaterial({
      vertexShader: bloomVert,
      fragmentShader: bloomFrag,
      uniforms: {
        uTexture: { value: null },
        uHeight: { value: relief.heightTex },
        uTime: { value: 0 },
        uUnfold: { value: 0 },
        uWilt: { value: 0 },
        uGlitch: { value: 0 },
        uHueDrift: { value: 0 },
        uWarp: { value: 0 },
        uPour: { value: 0 },
        uDisplace: { value: DISPLACE },
        uTint: { value: new THREE.Color().setHSL(dna.hueCenter / 360, Math.max(0.5, dna.saturation), 0.6) },
        uLightDir: { value: new THREE.Vector3(0.4, 0.7, 0.8).normalize() },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;

    this.particlePositions = new Float32Array(MAX_PARTICLES * 3);
    this.particleVelocities = new Float32Array(MAX_PARTICLES * 3);
    this.particleAges = new Float32Array(MAX_PARTICLES).fill(Infinity);
    this.particleGeometry = new THREE.BufferGeometry();
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    const pColor = new THREE.Color().setHSL(dna.hueCenter / 360, Math.max(0.4, dna.saturation), 0.6);
    this.particleMaterial = new THREE.PointsMaterial({ color: pColor, size: 0.014, transparent: true, opacity: 0.85 });
    this.particles = new THREE.Points(this.particleGeometry, this.particleMaterial);
    this.particles.frustumCulled = false;
  }

  setTexture(texture: THREE.Texture): void {
    this.material.uniforms.uTexture!.value = texture;
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
    const u = this.material.uniforms;
    u.uTime!.value = time;
    u.uWilt!.value = growth.wiltAmount;

    // scalars derived from the per-petal growth state
    let hueSum = 0;
    let warpSum = 0;
    let maxWarp = 0;
    let detached = 0;
    for (const p of growth.petals) {
      hueSum += p.hueShift;
      warpSum += p.warp;
      maxWarp = Math.max(maxWarp, p.warp);
      if (p.detached) detached++;
    }
    const n = Math.max(1, growth.petals.length);
    const detachedRatio = detached / n;

    u.uHueDrift!.value = hueSum / n;
    u.uWarp!.value = warpSum / n;
    u.uPour!.value = detachedRatio;

    const lastTouchAge = growth.mutations.length ? growth.age - growth.mutations[growth.mutations.length - 1]!.at : 999;
    const touchSurge = Math.max(0, 1 - lastTouchAge / 0.6);
    u.uGlitch!.value = Math.min(1, 0.1 + maxWarp * 0.5 + touchSurge * 0.8) * smoothstep(0.1, 0.4, growth.maturity);

    const unfold = smoothstep(0.1, 0.6, growth.maturity);
    u.uUnfold!.value = unfold;

    if (!present || growth.maturity <= 0.08) {
      this.mesh.visible = false;
    } else {
      this.mesh.visible = true;
      const emerge = 0.2 + 0.8 * smoothstep(0, 0.5, growth.maturity);
      const size = handScale * BLOOM_SIZE_PER_HAND * emerge;
      this.mesh.position.set(
        originWorld.x,
        originWorld.y + size * 0.42 * unfold,
        originWorld.z,
      );
      this.mesh.scale.set(size * this.aspect, size, size);
      // gentle living sway
      this.mesh.rotation.set(Math.sin(time * 0.7) * 0.04, Math.sin(time * 0.5) * 0.05, Math.sin(time * 0.9) * 0.03);
    }

    // photographic dispersal on pour
    if (detachedRatio > this.lastDetached + 0.04) {
      this.spawnBurst(this.mesh.position, handScale);
    }
    this.lastDetached = detachedRatio;
    this.updateParticles(dt);
  }

  private spawnBurst(origin: THREE.Vector3, handScale: number): void {
    for (let k = 0; k < 14; k++) {
      const idx = this.nextParticleIndex;
      this.nextParticleIndex = (this.nextParticleIndex + 1) % MAX_PARTICLES;
      this.particlePositions[idx * 3] = origin.x + (Math.random() - 0.5) * handScale;
      this.particlePositions[idx * 3 + 1] = origin.y + (Math.random() - 0.5) * handScale;
      this.particlePositions[idx * 3 + 2] = origin.z;
      this.particleVelocities[idx * 3] = (Math.random() - 0.5) * 0.18;
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
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.particleGeometry.dispose();
    this.particleMaterial.dispose();
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

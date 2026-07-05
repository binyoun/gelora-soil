import * as THREE from 'three';
import type { FlowerDNA, GrowthState, HandState } from '../types';
import { landmarkToWorld, type AnchorMapping } from '../render/anchor';
import petalFrag from './shaders/petal.frag.glsl?raw';
import petalVert from './shaders/petal.vert.glsl?raw';

const MAX_PETALS = 16;
const ORBIT_RADIUS = 0.14;
const ORBIT_SPEED = 0.15;
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
    const geometry = new THREE.PlaneGeometry(0.05, 0.08, 4, 6);
    geometry.translate(0, 0.04, 0);

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

  update(dna: FlowerDNA, growth: GrowthState, hand: HandState, map: AnchorMapping, time: number, dt: number): void {
    this.material.uniforms.uTime!.value = time;
    this.material.uniforms.uWilt!.value = growth.wiltAmount;

    if (!hand.present || growth.maturity <= 0.1) {
      this.instancedMesh.visible = false;
    } else {
      this.instancedMesh.visible = true;
      const origin = landmarkToWorld(hand.palmOrigin, map);
      const unfold = smoothstep(0.1, 0.6, growth.maturity);

      for (let i = 0; i < growth.petals.length; i++) {
        const petal = growth.petals[i]!;
        const angle = (i / dna.petalCount) * Math.PI * 2 + growth.age * ORBIT_SPEED;
        const radius = ORBIT_RADIUS * unfold;

        this.dummy.position.set(
          origin.x + Math.cos(angle) * radius,
          origin.y + Math.sin(angle) * radius * 0.6 + unfold * 0.05,
          origin.z,
        );
        this.dummy.rotation.set(0, 0, angle);
        const bloomScale = (0.4 + 0.6 * unfold) * (petal.detached ? Math.max(0, 1 - petal.fallProgress) : 1);
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

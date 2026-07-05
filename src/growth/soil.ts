import * as THREE from 'three';
import type { Relief } from '../capture/relief';
import bloomVert from './shaders/bloom.vert.glsl?raw';
import soilFrag from './shaders/soil.frag.glsl?raw';

const SOIL_SIZE_PER_HAND = 3.4; // hand-ground size as a multiple of hand span
const SOIL_DISPLACE = 0.16; // gentler relief than the flower

/**
 * The participant's own open palm, captured and shown as a dimensional, lit
 * ground the flower grows from ("the body becomes the soil"). Reuses the bloom
 * relief vertex shader with a soft-oval-masked hand fragment; persists through
 * the experience, glitching subtly in sync with the flower.
 */
export class Soil {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private material: THREE.ShaderMaterial;
  private aspect: number;

  constructor(handTexture: THREE.Texture, relief: Relief) {
    this.aspect = relief.aspect;
    const geometry = new THREE.PlaneGeometry(1, 1, 120, 120);

    this.material = new THREE.ShaderMaterial({
      vertexShader: bloomVert,
      fragmentShader: soilFrag,
      uniforms: {
        uTexture: { value: handTexture },
        uHeight: { value: relief.heightTex },
        uTime: { value: 0 },
        uUnfold: { value: 1 },
        uWilt: { value: 0 },
        uGlitch: { value: 0 },
        uPour: { value: 0 },
        uDisplace: { value: SOIL_DISPLACE },
        uLightDir: { value: new THREE.Vector3(0.4, 0.7, 0.8).normalize() },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1; // draw before the flower so the bloom sits in front
    this.mesh.visible = false;
  }

  update(originWorld: THREE.Vector3, handScale: number, present: boolean, glitch: number, time: number): void {
    const u = this.material.uniforms;
    u.uTime!.value = time;
    u.uGlitch!.value = glitch;

    if (!present) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const size = handScale * SOIL_SIZE_PER_HAND;
    this.mesh.position.copy(originWorld);
    this.mesh.scale.set(size * this.aspect, size, size);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

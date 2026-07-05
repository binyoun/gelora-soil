import * as THREE from 'three';
import type { FlowerDNA } from '../types';
import stemFrag from './shaders/stem.frag.glsl?raw';
import stemVert from './shaders/stem.vert.glsl?raw';

const STEM_HEIGHT_PER_HAND = 3.2; // stem height as a multiple of hand span
const STEM_RADIUS_PER_HAND = 0.11;

const UP = new THREE.Vector3(0, 1, 0);
const tmpDir = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();

/** Rises from the palm along screen-up, scaled to the hand. Droops with wilt. */
export class Stem {
  readonly mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;

  constructor(dna: FlowerDNA) {
    const geometry = new THREE.CylinderGeometry(0.4, 1, 1, 8, 12, true);
    geometry.translate(0, 0.5, 0); // pivot at base

    const baseColor = new THREE.Color().setHSL(dna.hueCenter / 360, Math.max(0.3, dna.saturation * 0.6), 0.3);

    const material = new THREE.ShaderMaterial({
      vertexShader: stemVert,
      fragmentShader: stemFrag,
      uniforms: {
        uTime: { value: 0 },
        uMaturity: { value: 0 },
        uBaseColor: { value: baseColor },
        uWilt: { value: 0 },
      },
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.visible = false;
  }

  update(
    originWorld: THREE.Vector3,
    handScale: number,
    present: boolean,
    maturity: number,
    wiltAmount: number,
    time: number,
  ): void {
    if (!present || maturity <= 0) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    this.mesh.position.copy(originWorld);
    const height = STEM_HEIGHT_PER_HAND * handScale * smoothstep(0, 0.3, maturity);
    const radius = STEM_RADIUS_PER_HAND * handScale;
    this.mesh.scale.set(radius, Math.max(0.001, height), radius);

    // rise along screen-up, drooping toward the side as care recedes (wilt)
    tmpDir.set(wiltAmount * 0.8, 1 - wiltAmount * 0.5, 0).normalize();
    tmpQuat.setFromUnitVectors(UP, tmpDir);
    this.mesh.quaternion.copy(tmpQuat);

    this.mesh.material.uniforms.uTime!.value = time;
    this.mesh.material.uniforms.uMaturity!.value = maturity;
    this.mesh.material.uniforms.uWilt!.value = wiltAmount;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

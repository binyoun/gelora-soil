import * as THREE from 'three';
import type { FlowerDNA, HandState } from '../types';
import { landmarkDirectionToWorld, landmarkToWorld, type AnchorMapping } from '../render/anchor';
import stemFrag from './shaders/stem.frag.glsl?raw';
import stemVert from './shaders/stem.vert.glsl?raw';

const MAX_STEM_HEIGHT = 0.72;
const STEM_RADIUS = 0.018;

/** Curve extrusion along the palm normal. Rises with maturity, droops with wilt. */
export class Stem {
  readonly mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;

  constructor(dna: FlowerDNA) {
    const geometry = new THREE.CylinderGeometry(STEM_RADIUS * 0.4, STEM_RADIUS, 1, 8, 12, true);
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

  update(hand: HandState, map: AnchorMapping, maturity: number, wiltAmount: number, time: number): void {
    if (!hand.present || maturity <= 0) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    const origin = landmarkToWorld(hand.palmOrigin, map);
    const normal = landmarkDirectionToWorld(hand.palmNormal, map);

    this.mesh.position.copy(origin);
    const height = MAX_STEM_HEIGHT * smoothstep(0, 0.3, maturity);
    this.mesh.scale.set(1, Math.max(0.001, height), 1);

    const droopTarget = new THREE.Vector3(normal.x, normal.y - 1, normal.z).normalize();
    const drooped = normal.clone().lerp(droopTarget, wiltAmount * 0.6).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), drooped);
    this.mesh.quaternion.copy(quat);

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

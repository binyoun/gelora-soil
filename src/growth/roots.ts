import * as THREE from 'three';
import type { RawLandmark } from '../hand/palm';
import { landmarkToWorld, type AnchorContext } from '../render/anchor';

const FINGER_CHAINS: number[][] = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16],
  [0, 17, 18, 19, 20],
];

const MAX_VERTICES = 200;
const ROOTS_STAGE_END = 0.08;
const GROUNDED_OPACITY = 0.35;

/** Tendril lines along finger landmark chains, plus a contact shadow at the palm. */
export class Roots {
  readonly group: THREE.Group;
  private lineGeometry: THREE.BufferGeometry;
  private lineMaterial: THREE.LineBasicMaterial;
  private lines: THREE.LineSegments;
  private shadow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;

  constructor() {
    this.group = new THREE.Group();

    this.lineGeometry = new THREE.BufferGeometry();
    this.lineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_VERTICES * 3), 3));
    this.lineMaterial = new THREE.LineBasicMaterial({ color: 0x9a6a33, transparent: true, opacity: 0 });
    this.lines = new THREE.LineSegments(this.lineGeometry, this.lineMaterial);
    this.group.add(this.lines);

    const shadowGeo = new THREE.CircleGeometry(1, 24);
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0 });
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.group.add(this.shadow);
  }

  update(landmarks: RawLandmark[] | null, ctx: AnchorContext, maturity: number): void {
    const rootsProgress = clamp01(maturity / ROOTS_STAGE_END);
    const opacity = landmarks ? Math.max(rootsProgress, maturity > 0 ? GROUNDED_OPACITY : 0) : 0;
    this.lineMaterial.opacity = opacity * 0.9;
    this.shadow.material.opacity = opacity * 0.4;

    if (!landmarks) return;

    const positions = this.lineGeometry.attributes.position as THREE.BufferAttribute;
    let vertexIndex = 0;
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();

    outer: for (const chain of FINGER_CHAINS) {
      for (let i = 0; i < chain.length - 1; i++) {
        if (vertexIndex + 2 > MAX_VERTICES) break outer;
        const a = landmarks[chain[i]!]!;
        const b = landmarks[chain[i + 1]!]!;
        landmarkToWorld(a, ctx, tmpA);
        landmarkToWorld(b, ctx, tmpB);
        positions.setXYZ(vertexIndex++, tmpA.x, tmpA.y, tmpA.z);
        positions.setXYZ(vertexIndex++, tmpB.x, tmpB.y, tmpB.z);
      }
    }
    positions.needsUpdate = true;
    this.lineGeometry.setDrawRange(0, vertexIndex);

    const palm = landmarkToWorld(landmarks[9]!, ctx, new THREE.Vector3());
    this.shadow.position.set(palm.x, palm.y, palm.z + 0.001);
    const scale = 0.1 * (1 + maturity * 0.4);
    this.shadow.scale.set(scale, scale, scale);
  }

  dispose(): void {
    this.lineGeometry.dispose();
    this.lineMaterial.dispose();
    this.shadow.geometry.dispose();
    this.shadow.material.dispose();
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

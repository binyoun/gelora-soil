import * as THREE from 'three';
import type { Vec3 } from '../types';

/**
 * Anchors landmark-space points into the transparent WebGL layer that sits over
 * the fullscreen DOM camera video (same layering as the uncanny-garden work).
 *
 * Landmarks arrive in raw video-frame coordinates (x,y in [0,1] of the sensor
 * frame). The video is shown with object-fit: cover, so only a centered crop is
 * on screen; we correct for that crop (and front-camera mirroring) to get true
 * on-screen coordinates, then unproject through the camera to a fixed distance.
 * Depth comes from that fixed distance, never from MediaPipe's unreliable
 * pseudo-z, so the being always renders exactly where the hand appears.
 */
export interface AnchorContext {
  camera: THREE.PerspectiveCamera;
  distance: number;
  videoAspect: number;
  viewportAspect: number;
  mirror: boolean;
}

/** Raw video-frame landmark coords -> on-screen normalized display coords [0,1]. */
function landmarkToDisplay(x: number, y: number, ctx: AnchorContext): { x: number; y: number } {
  let dx = x;
  let dy = y;
  if (ctx.viewportAspect > ctx.videoAspect) {
    // viewport wider than video: video fills width, crops top/bottom
    const frac = ctx.videoAspect / ctx.viewportAspect;
    dy = (y - (1 - frac) / 2) / frac;
  } else {
    // viewport taller/narrower than video: video fills height, crops left/right
    const frac = ctx.viewportAspect / ctx.videoAspect;
    dx = (x - (1 - frac) / 2) / frac;
  }
  if (ctx.mirror) dx = 1 - dx;
  return { x: dx, y: dy };
}

/** Landmark -> world position on the plane `distance` in front of the camera. */
export function landmarkToWorld(point: Vec3, ctx: AnchorContext, out = new THREE.Vector3()): THREE.Vector3 {
  const d = landmarkToDisplay(point.x, point.y, ctx);
  const ndcX = d.x * 2 - 1;
  const ndcY = -(d.y * 2 - 1);
  out.set(ndcX, ndcY, 0.5).unproject(ctx.camera);
  out.sub(ctx.camera.position).normalize().multiplyScalar(ctx.distance).add(ctx.camera.position);
  return out;
}

/** World-space distance between two landmarks once anchored: a hand-sized scale unit. */
export function landmarkSpan(a: Vec3, b: Vec3, ctx: AnchorContext): number {
  const wa = landmarkToWorld(a, ctx, new THREE.Vector3());
  const wb = landmarkToWorld(b, ctx, new THREE.Vector3());
  return wa.distanceTo(wb);
}

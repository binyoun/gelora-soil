import * as THREE from 'three';
import type { Vec3 } from '../types';

/**
 * Maps normalized landmark-space points (x,y in [0,1] raw video-frame space,
 * z MediaPipe pseudo-depth relative to the wrist) onto world space, so a
 * Three.js object anchored here tracks the hand under the camera background
 * plane. The background plane always fills the viewport ("object-fit: cover"),
 * so the video is cropped relative to its raw frame; landmark coordinates are
 * corrected by the same crop before projecting into world space.
 */
export interface AnchorMapping {
  planeWidth: number;
  planeHeight: number;
  planeDistance: number;
  mirrorX: boolean;
  depthScale: number;
  cropOffsetX: number;
  cropOffsetY: number;
  cropRepeatX: number;
  cropRepeatY: number;
}

export function computeAnchorMapping(
  camera: THREE.PerspectiveCamera,
  planeDistance: number,
  viewportAspect: number,
  videoAspect: number,
  mirrorX: boolean,
): AnchorMapping {
  const vFov = (camera.fov * Math.PI) / 180;
  const planeHeight = 2 * Math.tan(vFov / 2) * planeDistance;
  const planeWidth = planeHeight * viewportAspect;

  let cropRepeatX = 1;
  let cropRepeatY = 1;
  if (viewportAspect > videoAspect) {
    cropRepeatY = videoAspect / viewportAspect;
  } else {
    cropRepeatX = viewportAspect / videoAspect;
  }
  const cropOffsetX = (1 - cropRepeatX) / 2;
  const cropOffsetY = (1 - cropRepeatY) / 2;

  return {
    planeWidth,
    planeHeight,
    planeDistance,
    mirrorX,
    depthScale: planeHeight,
    cropOffsetX,
    cropOffsetY,
    cropRepeatX,
    cropRepeatY,
  };
}

export function landmarkToWorld(point: Vec3, map: AnchorMapping, out = new THREE.Vector3()): THREE.Vector3 {
  const displayX = (point.x - map.cropOffsetX) / map.cropRepeatX;
  const displayY = (point.y - map.cropOffsetY) / map.cropRepeatY;
  const nx = map.mirrorX ? 1 - displayX : displayX;

  out.x = (nx - 0.5) * map.planeWidth;
  out.y = (0.5 - displayY) * map.planeHeight;
  out.z = -map.planeDistance - point.z * map.depthScale;
  return out;
}

export function landmarkDirectionToWorld(dir: Vec3, map: AnchorMapping, out = new THREE.Vector3()): THREE.Vector3 {
  const nx = map.mirrorX ? -dir.x : dir.x;
  out.set(nx, -dir.y, -dir.z);
  if (out.lengthSq() < 1e-10) out.set(0, 0, 1);
  return out.normalize();
}

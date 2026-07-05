import * as THREE from 'three';
import type { AnchorContext } from './anchor';

const ANCHOR_DISTANCE = 1.2;

/**
 * Transparent WebGL layer over the fullscreen DOM camera video. The renderer
 * clears to full transparency so the video shows through; all 3D is drawn on
 * top. This mirrors the uncanny-garden setup (alpha renderer + object-fit cover
 * background video), which is far more robust than texturing the feed onto a
 * plane inside the scene.
 */
export class ARScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly overlayGroup: THREE.Group;

  private revealPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private videoAspect = 16 / 9;
  private mirror = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 20);
    this.camera.position.set(0, 0, 0);

    this.overlayGroup = new THREE.Group();
    this.scene.add(this.overlayGroup);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1005, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 0.7);
    key.position.set(0.5, 1, 1);
    this.scene.add(key);

    // "this is who will grow": the captured flower floats in front of the feed
    // for a moment after capture, then fades as the being takes root.
    const revealMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    this.revealPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), revealMat);
    this.revealPlane.position.z = -ANCHOR_DISTANCE;
    this.revealPlane.visible = false;
    this.scene.add(this.revealPlane);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setVideoMetrics(videoAspect: number, mirror: boolean): void {
    if (videoAspect > 0) this.videoAspect = videoAspect;
    this.mirror = mirror;
  }

  anchorContext(): AnchorContext {
    return {
      camera: this.camera,
      distance: ANCHOR_DISTANCE,
      videoAspect: this.videoAspect,
      viewportAspect: window.innerWidth / window.innerHeight,
      mirror: this.mirror,
    };
  }

  beginReveal(texture: THREE.Texture, captureAspect: number): void {
    this.revealPlane.material.map = texture;
    this.revealPlane.material.needsUpdate = true;
    const maxSide = 0.45;
    const w = captureAspect >= 1 ? maxSide : maxSide * captureAspect;
    const h = captureAspect >= 1 ? maxSide / captureAspect : maxSide;
    this.revealPlane.scale.set(w, h, 1);
    this.revealPlane.material.opacity = 1;
    this.revealPlane.visible = true;
  }

  setRevealOpacity(opacity: number): void {
    this.revealPlane.material.opacity = opacity;
    this.revealPlane.visible = opacity > 0.001;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
  }

  setPixelRatio(ratio: number): void {
    this.renderer.setPixelRatio(ratio);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

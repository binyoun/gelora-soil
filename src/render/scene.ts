import * as THREE from 'three';
import { computeAnchorMapping, type AnchorMapping } from './anchor';

const PLANE_DISTANCE = 2;

export class ARScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly overlayGroup: THREE.Group;

  private backgroundPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private videoTexture: THREE.VideoTexture | null = null;
  private mapping: AnchorMapping;
  private lastVideoAspect = 16 / 9;
  private lastMirror = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 20);
    this.camera.position.set(0, 0, 0);

    this.overlayGroup = new THREE.Group();
    this.scene.add(this.overlayGroup);

    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.backgroundPlane = new THREE.Mesh(geometry, material);
    this.backgroundPlane.position.z = -PLANE_DISTANCE;
    this.scene.add(this.backgroundPlane);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1005, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 0.6);
    key.position.set(0.5, 1, 1);
    this.scene.add(key);

    this.mapping = computeAnchorMapping(this.camera, PLANE_DISTANCE, window.innerWidth / window.innerHeight, this.lastVideoAspect, this.lastMirror);
    this.applyMapping();

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  attachVideo(video: HTMLVideoElement, mirrorX: boolean): void {
    this.videoTexture?.dispose();
    this.videoTexture = new THREE.VideoTexture(video);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    this.backgroundPlane.material.map = this.videoTexture;
    this.backgroundPlane.material.needsUpdate = true;
    this.updateVideoAspect(video, mirrorX);
  }

  updateVideoAspect(video: HTMLVideoElement, mirrorX: boolean): void {
    this.lastVideoAspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : this.lastVideoAspect;
    this.lastMirror = mirrorX;
    this.recomputeMapping();
  }

  private recomputeMapping(): void {
    this.mapping = computeAnchorMapping(
      this.camera,
      PLANE_DISTANCE,
      window.innerWidth / window.innerHeight,
      this.lastVideoAspect,
      this.lastMirror,
    );
    this.applyMapping();
  }

  private applyMapping(): void {
    this.backgroundPlane.scale.set(this.mapping.planeWidth, this.mapping.planeHeight, 1);
    if (this.videoTexture) {
      this.videoTexture.wrapS = THREE.ClampToEdgeWrapping;
      this.videoTexture.wrapT = THREE.ClampToEdgeWrapping;
      this.videoTexture.repeat.set(this.mapping.cropRepeatX, this.mapping.cropRepeatY);
      this.videoTexture.offset.set(
        this.lastMirror ? 1 - this.mapping.cropOffsetX - this.mapping.cropRepeatX : this.mapping.cropOffsetX,
        this.mapping.cropOffsetY,
      );
      this.videoTexture.center.set(0.5, 0.5);
      this.backgroundPlane.scale.x *= this.lastMirror ? -1 : 1;
    }
  }

  getMapping(): AnchorMapping {
    return this.mapping;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.recomputeMapping();
  }

  setPixelRatio(ratio: number): void {
    this.renderer.setPixelRatio(ratio);
  }

  render(): void {
    if (this.videoTexture) this.videoTexture.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }
}

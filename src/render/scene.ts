import * as THREE from 'three';
import { computeAnchorMapping, type AnchorMapping } from './anchor';

const PLANE_DISTANCE = 2;

export class ARScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly overlayGroup: THREE.Group;

  private backgroundPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private revealPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
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

    // "this is who will grow": the captured flower floated in front of the feed
    // for a moment after capture, then fading as the being takes root.
    const revealMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    this.revealPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), revealMat);
    this.revealPlane.position.z = -1.2;
    this.revealPlane.visible = false;
    this.scene.add(this.revealPlane);

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
    // MeshBasicMaterial renders as map * color; the base color starts black so
    // the plane is dark before the feed loads. Once the video map is attached,
    // reset to white or every frame is multiplied to black.
    this.backgroundPlane.material.color.setHex(0xffffff);
    this.backgroundPlane.material.needsUpdate = true;
    this.updateVideoAspect(video, mirrorX);
  }

  beginReveal(texture: THREE.Texture, captureAspect: number): void {
    this.revealPlane.material.map = texture;
    this.revealPlane.material.needsUpdate = true;
    // Fit the longer side to a fraction of the view so it never overflows a
    // narrow portrait phone screen, preserving the capture's aspect.
    const maxSide = 0.55;
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

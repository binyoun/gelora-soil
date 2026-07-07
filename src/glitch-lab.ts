import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Flower, type FlowerFx } from './growth/flower';
import { TEMPLATES, templateById } from './growth/flowerTemplates';
import { GrowthEngine } from './growth/engine';
import type { FlowerDNA } from './types';

// Standalone glitch lab: a rotating flower whose glitch effects can be toggled
// and layered independently, so each can actually be seen. No camera needed.

const EFFECTS: Array<{ key: keyof FlowerFx; label: string }> = [
  { key: 'rgb', label: 'RGB blocks' },
  { key: 'wobble', label: 'wobble' },
  { key: 'mosh', label: 'datamosh' },
  { key: 'bar', label: 'signal bar' },
  { key: 'posterize', label: 'bit-crush' },
  { key: 'negative', label: 'negative' },
  { key: 'wireframe', label: 'wireframe' },
  { key: 'shatter', label: 'shatter' },
  { key: 'melt', label: 'melt' },
  { key: 'flakes', label: 'flakes' },
];

// A face-like portrait stand-in so effects read over a "selfie".
function makePhoto(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(S / 2, S * 0.42, 20, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, '#ffe8cf');
  g.addColorStop(0.6, '#e3b79f');
  g.addColorStop(1, '#7c6a63');
  x.fillStyle = g;
  x.beginPath();
  x.arc(S / 2, S / 2, S * 0.49, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = 'rgba(60,40,35,0.5)';
  x.beginPath();
  x.arc(S * 0.4, S * 0.44, 18, 0, 7);
  x.arc(S * 0.6, S * 0.44, 18, 0, 7);
  x.fill();
  x.beginPath();
  x.ellipse(S / 2, S * 0.62, 26, 14, 0, 0, 7);
  x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1005, 0.85));
const key = new THREE.DirectionalLight(0xffffff, 1.1);
key.position.set(0.5, 1, 0.8);
scene.add(key);

const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 20);
function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
camera.position.set(0, 0.1, 2.3);
camera.lookAt(0, 0.05, 0);
window.addEventListener('resize', resize);
resize();

const dna: FlowerDNA = { seed: 7, hueCenter: 20, hueSpread: 0.2, saturation: 0.4, luminance: 0.7, edgeComplexity: 0.5, aspect: 1, petalCount: 11, textureRegions: [] };
const photo = makePhoto();
const growth = new GrowthEngine(dna).getState();
growth.maturity = 0.92;
growth.age = 100;
const origin = new THREE.Vector3(0, -0.28, 0);

let flower: Flower | null = null;
function buildFlower(id: string): void {
  if (flower) {
    scene.remove(flower.group, flower.particles);
    flower.dispose();
  }
  flower = new Flower(dna, photo, templateById(id));
  flower.autoGlitch = false; // the lab drives fx directly
  scene.add(flower.group, flower.particles);
}

// --- UI ---
const flowerSel = document.getElementById('flower') as HTMLSelectElement;
for (const t of TEMPLATES) {
  const o = document.createElement('option');
  o.value = t.id;
  o.textContent = t.name;
  flowerSel.appendChild(o);
}
flowerSel.value = 'kadupul';
flowerSel.addEventListener('change', () => buildFlower(flowerSel.value));

const intensityEl = document.getElementById('intensity') as HTMLInputElement;

const enabled: Partial<Record<keyof FlowerFx, boolean>> = {};
const fxEl = document.getElementById('fx')!;
for (const e of EFFECTS) {
  const label = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.dataset.fx = e.key;
  cb.addEventListener('change', () => {
    enabled[e.key] = cb.checked;
    label.classList.toggle('on', cb.checked);
  });
  label.appendChild(cb);
  label.appendChild(document.createTextNode(e.label));
  fxEl.appendChild(label);
}

document.getElementById('none')!.addEventListener('click', () => {
  for (const key of Object.keys(enabled) as Array<keyof FlowerFx>) enabled[key] = false;
  fxEl.querySelectorAll('input').forEach((cb) => { (cb as HTMLInputElement).checked = false; });
  fxEl.querySelectorAll('label').forEach((l) => l.classList.remove('on'));
});

let touchAt = -10;
document.getElementById('touch')!.addEventListener('click', () => { touchAt = clock; });

buildFlower('kadupul');

// --- loop ---
let clock = 0;
let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock += dt;

  const master = parseFloat(intensityEl.value);
  const surge = 1 + Math.max(0, 1 - (clock - touchAt) / 0.9) * 1.6; // pulse-touch spike

  if (flower) {
    for (const e of EFFECTS) {
      flower.fx[e.key] = enabled[e.key] ? Math.min(1, master * surge) : 0;
    }
    flower.group.rotation.y = Math.sin(clock * 0.4) * 0.5;
    flower.update(dna, growth, origin, 0.32, true, clock, dt, null);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

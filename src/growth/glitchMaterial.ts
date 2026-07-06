import * as THREE from 'three';

// Patches a MeshStandardMaterial to glitch its own surface: block RGB
// corruption + per-vertex wobble, driven by uGlitch. Adapted from the
// uncanny-garden ModelGlitch onBeforeCompile technique so the flower keeps its
// PBR lighting/environment reflections while glitching on mutation.

export interface GlitchUniforms {
  uGlitch: { value: number };
  uTime: { value: number };
  uWobble: { value: number };
  uTint: { value: THREE.Color };
}

const VERT_HEADER = `
varying vec2 vGlitchUv;
uniform float uGlitch;
uniform float uWobble;
uniform float uTime;
float glitchHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

const VERT_PATCH = `
#include <begin_vertex>
vGlitchUv = uv;
{
  float n = sin(position.x * 22.0 + uTime * 5.0)
          * sin(position.y * 18.0 - uTime * 4.0)
          * sin(position.z * 26.0 + uTime * 6.0);
  transformed += normal * n * uGlitch * uWobble;
  vec2 gb = floor(vGlitchUv * 5.0);
  float gt = floor(uTime * 12.0);
  float gj = step(0.72, glitchHash(gb + gt)) * uGlitch;
  transformed.x += (glitchHash(gb + gt + 3.0) - 0.5) * gj * 0.12;
  transformed.y += (glitchHash(gb + gt + 7.0) - 0.5) * gj * 0.065;
}
`;

const FRAG_HEADER = `
varying vec2 vGlitchUv;
uniform float uGlitch;
uniform float uTime;
uniform vec3 uTint;
float glitchHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

const FRAG_PATCH = `
#include <dithering_fragment>
if (uGlitch > 0.001) {
  vec2 block = floor(vGlitchUv * 24.0);
  float t = floor(uTime * 14.0);
  float hr = glitchHash(block + t + 11.1);
  float hg = glitchHash(block + t + 37.7);
  float hb = glitchHash(block + t + 71.3);
  float h  = glitchHash(block + t);
  vec3 shifted = gl_FragColor.rgb + (vec3(hr, hg, hb) - 0.5) * 0.45;
  float dropout = step(1.0 - uGlitch * 0.22, h);
  shifted = mix(shifted, uTint, dropout);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, shifted, uGlitch * 0.7);
}
`;

export function patchGlitch(material: THREE.Material, tintHex: number, wobble = 0.05): GlitchUniforms {
  const uniforms: GlitchUniforms = {
    uGlitch: { value: 0 },
    uTime: { value: 0 },
    uWobble: { value: wobble },
    uTint: { value: new THREE.Color(tintHex) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERT_HEADER + shader.vertexShader.replace('#include <begin_vertex>', VERT_PATCH);
    shader.fragmentShader = FRAG_HEADER + shader.fragmentShader.replace('#include <dithering_fragment>', FRAG_PATCH);
  };
  material.needsUpdate = true;
  return uniforms;
}

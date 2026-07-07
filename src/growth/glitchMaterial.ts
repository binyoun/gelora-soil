import * as THREE from 'three';

// Patches a MeshStandardMaterial to glitch its own surface while keeping its PBR
// lighting. Composable: each effect has its own strength uniform (0..1) so they
// can be toggled and layered independently (see the glitch lab and Flower.fx).
//
// Fragment safety: the RGB-block corruption keeps its exact known-working shape
// (only its strength uniform is renamed); posterize and negative are numeric-only
// operations on gl_FragColor. The vertex stage is free to extend (wobble,
// datamosh block-jump, rolling signal bar).

export interface GlitchUniforms {
  uTime: { value: number };
  uTint: { value: THREE.Color };
  uRgb: { value: number }; // RGB block corruption + colour dropout (fragment)
  uWob: { value: number }; // per-vertex wobble (vertex)
  uMosh: { value: number }; // datamosh block-jump (vertex)
  uBar: { value: number }; // rolling signal bar (vertex)
  uSlice: { value: number }; // multiple horizontal slice displacement (vertex)
  uSpike: { value: number }; // sharp corruption spikes (vertex)
  uPost: { value: number }; // posterize / bit-crush (fragment)
  uNeg: { value: number }; // negative strobe (fragment)
  uScan: { value: number }; // scanlines (fragment)
  uChroma: { value: number }; // channel-cycle chroma corruption (fragment)
}

const VERT_HEADER = `
varying vec2 vGlitchUv;
uniform float uWob;
uniform float uMosh;
uniform float uBar;
uniform float uSlice;
uniform float uSpike;
uniform float uTime;
float glitchHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

const VERT_PATCH = `
#include <begin_vertex>
vGlitchUv = uv;
{
  // wobble
  float n = sin(position.x * 22.0 + uTime * 5.0)
          * sin(position.y * 18.0 - uTime * 4.0)
          * sin(position.z * 26.0 + uTime * 6.0);
  transformed += normal * n * uWob * 0.06;
  // datamosh: petals jump in image-blocks
  vec2 gb = floor(vGlitchUv * 5.0);
  float gt = floor(uTime * 12.0);
  float gj = step(0.72, glitchHash(gb + gt)) * uMosh;
  transformed.x += (glitchHash(gb + gt + 3.0) - 0.5) * gj * 0.12;
  transformed.y += (glitchHash(gb + gt + 7.0) - 0.5) * gj * 0.065;
  // rolling signal bar: a band sweeps the bloom in world Y, ripping rows sideways
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float sweep = fract(uTime * 0.35);
  float d = abs(fract(wp.y * 0.6 + 0.5) - sweep);
  float bar = smoothstep(0.05, 0.0, d) * uBar;
  transformed.x += (glitchHash(gb + gt + 13.0) - 0.5) * bar * 0.28;
  transformed.z += (glitchHash(gb + gt + 19.0) - 0.5) * bar * 0.16;
  // slice displacement: many horizontal bands jump sideways
  float sy = floor(wp.y * 12.0);
  float st = floor(uTime * 8.0);
  float sjit = step(0.6, glitchHash(vec2(sy, st)));
  transformed.x += (glitchHash(vec2(sy, st + 5.0)) - 0.5) * sjit * uSlice * 0.3;
  // sharp corruption spikes on scattered vertices
  float sp = step(0.85, glitchHash(floor(position.xy * 30.0) + floor(uTime * 10.0)));
  transformed += normal * sp * uSpike * 0.4;
}
`;

const FRAG_HEADER = `
varying vec2 vGlitchUv;
uniform float uRgb;
uniform float uPost;
uniform float uNeg;
uniform float uScan;
uniform float uChroma;
uniform float uTime;
uniform vec3 uTint;
float glitchHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

const FRAG_PATCH = `
#include <dithering_fragment>
if (uRgb > 0.001) {
  vec2 block = floor(vGlitchUv * 24.0);
  float t = floor(uTime * 14.0);
  float hr = glitchHash(block + t + 11.1);
  float hg = glitchHash(block + t + 37.7);
  float hb = glitchHash(block + t + 71.3);
  float h  = glitchHash(block + t);
  vec3 shifted = gl_FragColor.rgb + (vec3(hr, hg, hb) - 0.5) * 0.45;
  float dropout = step(1.0 - uRgb * 0.22, h);
  shifted = mix(shifted, uTint, dropout);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, shifted, uRgb * 0.7);
}
gl_FragColor.rgb = mix(gl_FragColor.rgb, floor(gl_FragColor.rgb * 4.0) / 4.0, uPost);
gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0) - gl_FragColor.rgb, uNeg);
gl_FragColor.rgb *= 1.0 - uScan * 0.55 * step(0.5, fract(vGlitchUv.y * 90.0));
gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.gbr, uChroma);
`;

export function patchGlitch(material: THREE.Material, tintHex: number): GlitchUniforms {
  const uniforms: GlitchUniforms = {
    uTime: { value: 0 },
    uTint: { value: new THREE.Color(tintHex) },
    uRgb: { value: 0 },
    uWob: { value: 0 },
    uMosh: { value: 0 },
    uBar: { value: 0 },
    uSlice: { value: 0 },
    uSpike: { value: 0 },
    uPost: { value: 0 },
    uNeg: { value: 0 },
    uScan: { value: 0 },
    uChroma: { value: 0 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERT_HEADER + shader.vertexShader.replace('#include <begin_vertex>', VERT_PATCH);
    shader.fragmentShader = FRAG_HEADER + shader.fragmentShader.replace('#include <dithering_fragment>', FRAG_PATCH);
  };
  material.needsUpdate = true;
  return uniforms;
}

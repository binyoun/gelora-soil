uniform float uTime;
uniform float uMaturity;

varying vec2 vUv;
varying float vHeight;

void main() {
  vUv = uv;
  vHeight = uv.y;

  vec3 pos = position;

  // organic sway, more pronounced toward the tip
  float sway = sin(uTime * 0.9 + uv.y * 4.0) * 0.025 * uv.y;
  pos.x += sway;
  pos.z += cos(uTime * 0.7 + uv.y * 3.0) * 0.018 * uv.y;

  // sprout-stage surface displacement: small bumps rising with the stem
  float bump = sin(uv.y * 20.0 + uTime * 1.5) * 0.004 * (1.0 - uv.y) * uMaturity;
  pos += normal * bump;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}

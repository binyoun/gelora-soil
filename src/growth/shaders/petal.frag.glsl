precision mediump float;

uniform sampler2D uTexture;
uniform float uWilt;
uniform float uTime;
uniform float uGlitch;
uniform vec3 uTint;

varying vec2 vRegionUv;
varying vec2 vPetalUv;
varying float vHueShift;
varying float vWarp;
varying float vFall;

float glitchHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec4 texel = texture2D(uTexture, vRegionUv);

  vec3 hsv = rgb2hsv(texel.rgb);
  hsv.x = fract(hsv.x + vHueShift / 360.0);
  hsv.y = clamp(hsv.y + vWarp * 0.1, 0.0, 1.0);
  vec3 shifted = hsv2rgb(hsv);

  vec3 wiltedColor = mix(shifted, vec3(0.29, 0.22, 0.12), uWilt * 0.5);

  // glitch: block-based RGB corruption and colored dropout across the petal
  // surface, driven by uGlitch (uncanny-garden aesthetic)
  if (uGlitch > 0.001) {
    vec2 block = floor(vPetalUv * 12.0);
    float t = floor(uTime * 12.0);
    float hr = glitchHash(block + t + 11.1);
    float hg = glitchHash(block + t + 37.7);
    float hb = glitchHash(block + t + 71.3);
    float h  = glitchHash(block + t);

    vec3 corrupt = wiltedColor;
    corrupt.r += (hr - 0.5) * 0.9;
    corrupt.g += (hg - 0.5) * 0.9;
    corrupt.b += (hb - 0.5) * 0.9;

    float dropout = step(1.0 - uGlitch * 0.5, h);
    corrupt = mix(corrupt, uTint, dropout);
    wiltedColor = mix(wiltedColor, corrupt, uGlitch);
  }

  float fallFade = 1.0 - smoothstep(0.6, 1.0, vFall);

  gl_FragColor = vec4(wiltedColor, texel.a * fallFade);
  if (gl_FragColor.a < 0.02) discard;
}

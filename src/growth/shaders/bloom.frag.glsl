precision mediump float;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uWilt;
uniform float uGlitch;
uniform float uHueDrift;
uniform float uWarp;
uniform vec3 uTint;
uniform vec3 uLightDir;

varying vec2 vUv;
varying float vHeight;
varying vec3 vViewNormal;
varying vec3 vViewPos;
varying float vFall;

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

float glitchHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  // warp the sampling slightly for a living surface
  vec2 uv = vUv + vec2(sin(vUv.y * 10.0 + uTime) , cos(vUv.x * 10.0 - uTime)) * uWarp * 0.01;
  vec4 texel = texture2D(uTexture, uv);
  if (texel.a < 0.03) discard;

  // continuous hue drift (mutation)
  vec3 hsv = rgb2hsv(texel.rgb);
  hsv.x = fract(hsv.x + uHueDrift / 360.0);
  hsv.y = clamp(hsv.y + uWarp * 0.08, 0.0, 1.0);
  vec3 base = hsv2rgb(hsv);

  // lighting from the relief normal: lambert + ambient + rim/fresnel
  vec3 N = normalize(vViewNormal);
  vec3 V = normalize(-vViewPos);
  float lambert = max(dot(N, normalize(uLightDir)), 0.0);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);
  vec3 lit = base * (0.45 + 0.75 * lambert) + uTint * rim * 0.7;

  // wilt tint toward dry soil
  lit = mix(lit, vec3(0.29, 0.22, 0.12), uWilt * 0.5);

  // glitch: block RGB corruption + colored dropout
  if (uGlitch > 0.001) {
    vec2 block = floor(vUv * 16.0);
    float t = floor(uTime * 12.0);
    float hr = glitchHash(block + t + 11.1);
    float hg = glitchHash(block + t + 37.7);
    float hb = glitchHash(block + t + 71.3);
    float h = glitchHash(block + t);
    vec3 corrupt = lit + (vec3(hr, hg, hb) - 0.5) * 0.9;
    float dropout = step(1.0 - uGlitch * 0.5, h);
    corrupt = mix(corrupt, uTint, dropout);
    lit = mix(lit, corrupt, uGlitch);
  }

  float fallFade = 1.0 - smoothstep(0.55, 1.0, vFall);
  gl_FragColor = vec4(lit, texel.a * fallFade);
  if (gl_FragColor.a < 0.02) discard;
}

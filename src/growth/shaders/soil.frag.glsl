precision mediump float;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uGlitch;
uniform vec3 uLightDir;

varying vec2 vUv;
varying float vHeight;
varying vec3 vViewNormal;
varying vec3 vViewPos;
varying float vFall;

float glitchHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec4 texel = texture2D(uTexture, vUv);

  // lighting from the relief normal
  vec3 N = normalize(vViewNormal);
  vec3 lit = texel.rgb * (0.5 + 0.7 * max(dot(N, normalize(uLightDir)), 0.0));

  // subtle glitch synced with the flower
  if (uGlitch > 0.001) {
    vec2 block = floor(vUv * 12.0);
    float t = floor(uTime * 10.0);
    float hr = glitchHash(block + t + 3.1);
    float hg = glitchHash(block + t + 9.7);
    float hb = glitchHash(block + t + 21.3);
    vec3 corrupt = lit + (vec3(hr, hg, hb) - 0.5) * 0.7;
    lit = mix(lit, corrupt, uGlitch * 0.5);
  }

  // soft-oval seed mask so the hand fades out instead of a hard plane edge
  vec2 c = vUv - 0.5;
  c.y *= 0.9;
  float mask = 1.0 - smoothstep(0.30, 0.48, length(c));

  gl_FragColor = vec4(lit, texel.a * mask);
  if (gl_FragColor.a < 0.02) discard;
}

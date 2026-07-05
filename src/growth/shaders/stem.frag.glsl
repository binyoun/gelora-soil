precision mediump float;

uniform vec3 uBaseColor;
uniform float uWilt;

varying vec2 vUv;
varying float vHeight;

void main() {
  vec3 tipColor = mix(uBaseColor, vec3(1.0), 0.15);
  vec3 color = mix(uBaseColor, tipColor, vHeight);
  color = mix(color, vec3(0.24, 0.2, 0.1), uWilt * 0.4);
  gl_FragColor = vec4(color, 1.0);
}

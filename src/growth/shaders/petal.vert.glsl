uniform float uWilt;
uniform float uTime;
uniform float uGlitch;

attribute float aHueShift;
attribute float aWarp;
attribute float aFall;
attribute vec4 aRegion; // u, v, w, h into the capture texture

varying vec2 vRegionUv;
varying vec2 vPetalUv;
varying float vHueShift;
varying float vWarp;
varying float vFall;

void main() {
  vRegionUv = aRegion.xy + uv * aRegion.zw;
  vPetalUv = uv;
  vHueShift = aHueShift;
  vWarp = aWarp;
  vFall = aFall;

  vec3 pos = position;

  // glitch wobble: jittery per-vertex displacement when the being is mutating
  if (uGlitch > 0.001) {
    float n = sin(pos.x * 9.0 + uTime * 5.0) * sin(pos.y * 7.0 - uTime * 4.0);
    pos += normal * n * uGlitch * 0.08;
  }

  // wilt: curl the petal tip down and inward as care recedes
  float curl = uWilt * smoothstep(0.0, 1.0, uv.y);
  pos.z -= curl * 0.08;
  pos.y -= curl * 0.05;

  // warp: DNA-seeded asymmetric bulge plus a living, time-driven ripple so the
  // petal surface visibly mutates as it is held
  pos += normal * sin(uv.x * 6.2831 + aHueShift * 0.05) * aWarp * 0.06;
  pos += normal * sin(uv.y * 8.0 + uTime * 2.0 + aHueShift * 0.1) * aWarp * 0.035;
  // elongate/curl the tip with warp for a more creature-like silhouette
  pos.y += sin(uv.y * 3.1416) * aWarp * 0.04;

  vec4 localPosition = instanceMatrix * vec4(pos, 1.0);
  vec4 viewPosition = modelViewMatrix * localPosition;

  // petal-fall: parabolic gravity in view space once detached (pour)
  if (aFall > 0.0) {
    viewPosition.y -= 0.5 * 9.8 * 0.2 * aFall * aFall;
    viewPosition.x += sin(aHueShift + uTime) * 0.15 * aFall;
  }

  gl_Position = projectionMatrix * viewPosition;
}

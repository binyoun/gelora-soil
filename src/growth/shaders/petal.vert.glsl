uniform float uWilt;
uniform float uTime;

attribute float aHueShift;
attribute float aWarp;
attribute float aFall;
attribute vec4 aRegion; // u, v, w, h into the capture texture

varying vec2 vRegionUv;
varying float vHueShift;
varying float vWarp;
varying float vFall;

void main() {
  vRegionUv = aRegion.xy + uv * aRegion.zw;
  vHueShift = aHueShift;
  vWarp = aWarp;
  vFall = aFall;

  vec3 pos = position;

  // wilt: curl the petal tip down and inward as care recedes
  float curl = uWilt * smoothstep(0.0, 1.0, uv.y);
  pos.z -= curl * 0.08;
  pos.y -= curl * 0.05;

  // warp: gentle DNA-seeded asymmetric bulge
  pos += normal * sin(uv.x * 6.2831 + aHueShift * 0.05) * aWarp * 0.02;

  vec4 localPosition = instanceMatrix * vec4(pos, 1.0);
  vec4 viewPosition = modelViewMatrix * localPosition;

  // petal-fall: parabolic gravity in view space once detached (pour)
  if (aFall > 0.0) {
    viewPosition.y -= 0.5 * 9.8 * 0.2 * aFall * aFall;
    viewPosition.x += sin(aHueShift + uTime) * 0.15 * aFall;
  }

  gl_Position = projectionMatrix * viewPosition;
}

uniform sampler2D uHeight;
uniform float uTime;
uniform float uUnfold;
uniform float uWilt;
uniform float uGlitch;
uniform float uPour;
uniform float uDisplace;

varying vec2 vUv;
varying float vHeight;
varying vec3 vViewNormal;
varying vec3 vViewPos;
varying float vFall;

float sampleHeight(vec2 uv) {
  return texture2D(uHeight, clamp(uv, 0.0, 1.0)).r;
}

void main() {
  vUv = uv;
  float hgt = sampleHeight(uv);
  vHeight = hgt;

  // distance from the flower center, for cupping / wilt curl
  vec2 c = uv - 0.5;
  float rc = length(c);

  vec3 pos = position;

  // relief displacement toward the viewer, scaled in as the flower unfolds
  float relief = hgt * uDisplace * mix(0.25, 1.0, uUnfold);
  pos.z += relief;

  // bud -> open: cupped (edges lifted toward viewer) when closed, flat when open
  pos.z += (1.0 - uUnfold) * rc * rc * 0.9 * uDisplace;

  // wilt: curl the outer edges down and back
  pos.z -= uWilt * rc * 0.5;
  pos.y -= uWilt * rc * 0.4;

  // pour: low/edge regions (low height) dissolve and fall first as uPour rises
  float fall = uPour > 0.001 ? clamp((uPour - hgt) / 0.25, 0.0, 1.0) : 0.0;
  vFall = fall;

  // normal from the height gradient, so lighting reads the relief
  float e = 1.0 / 128.0;
  float hL = sampleHeight(uv - vec2(e, 0.0));
  float hR = sampleHeight(uv + vec2(e, 0.0));
  float hD = sampleHeight(uv - vec2(0.0, e));
  float hU = sampleHeight(uv + vec2(0.0, e));
  float dzx = (hR - hL) * uDisplace * mix(0.25, 1.0, uUnfold);
  float dzy = (hU - hD) * uDisplace * mix(0.25, 1.0, uUnfold);
  vec3 nrm = normalize(vec3(-dzx / (2.0 * e), -dzy / (2.0 * e), 1.0));

  // glitch wobble
  if (uGlitch > 0.001) {
    float n = sin(pos.x * 30.0 + uTime * 5.0) * sin(pos.y * 24.0 - uTime * 4.0);
    pos += nrm * n * uGlitch * 0.03;
  }

  vec4 viewPos = modelViewMatrix * vec4(pos, 1.0);

  if (fall > 0.0) {
    viewPos.y -= 0.5 * 9.8 * 0.12 * fall * fall;
    viewPos.x += sin(uv.x * 20.0 + uTime) * 0.12 * fall;
  }

  vViewNormal = normalize(normalMatrix * nrm);
  vViewPos = viewPos.xyz;

  gl_Position = projectionMatrix * viewPos;
}

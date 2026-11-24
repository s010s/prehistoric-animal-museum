import { Matrix4 } from '../vendor/tidewater/src/engine/index.js';
import { REFRACTION_GUARD } from '../vendor/tidewater/src/ocean/RefractionPass.js';

const _guard = new Matrix4().set(
  1 / REFRACTION_GUARD.sx, 0, 0, -REFRACTION_GUARD.cx / REFRACTION_GUARD.sx,
  0, 1 / REFRACTION_GUARD.sy, 0, -REFRACTION_GUARD.cy / REFRACTION_GUARD.sy,
  0, 0, 1, 0,
  0, 0, 0, 1,
);
const _proj = new Matrix4();

export function refractionProjection(camera, out = new Matrix4()) {
  return out.multiplyMatrices(_guard, camera.projectionMatrix);
}

// Build the exact frustum used by RefractionPass (left +15%, right +15%,
// bottom +60%) so underwater and bed systems do not cull geometry needed by
// refracted water rays near the screen edges.
export function setRefractionFrustum(frustum, camera, vp = new Matrix4()) {
  _proj.multiplyMatrices(_guard, camera.projectionMatrix);
  vp.multiplyMatrices(_proj, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(vp, camera.coordinateSystem, camera.reversedDepth);
  return frustum;
}

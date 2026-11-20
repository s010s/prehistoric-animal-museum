import { Matrix4, Quaternion, Vector3 } from '../../vendor/tidewater/src/engine/index.js';

// The native glTF jaw hinges run along skull X. The added Dilophosaurus
// hinge uses model -Z, the lateral axis of its generated skull.
const settings = {
  'allosaurus-pandras': { closure: 26.6, axis: [1, 0, 0] },
  // The idle morph expands the back of the mouth near the cheek.
  dilophosaurus: { closure: 15.7, idleRelief: 1.25, axis: [0, 0, -1] },
  spinosaurus: { closure: 7.35, axis: [1, 0, 0] },
  gigantoraptor: { closure: 27, axis: [1, 0, 0], tongue: ['tongue1_014_4_38', 12] },
};

export function createRestingMandible(id, pose, head, jaw, rotate, get) {
  const setting = settings[id];
  if (!setting) return null;
  const axis = new Vector3(...setting.axis);
  const side = new Vector3(), position = new Vector3(), scale = new Vector3();
  const matrix = new Matrix4();
  const skull = new Quaternion(), relative = new Quaternion(), delta = new Quaternion();
  const degree = Math.PI / 180;
  const angle = -setting.closure * degree;
  const relief = (setting.idleRelief ?? 0) * degree;
  const tongue = setting.tongue && get(setting.tongue[0]);
  const curl = tongue && setting.tongue[1] * degree;
  const read = (index, rotation) => matrix.fromArray(pose.world, index * 16).decompose(position, rotation, scale);
  function relativePose() {
    read(head.i, skull);
    read(jaw.i, relative);
    relative.premultiply(delta.copy(skull).invert());
  }
  relativePose();
  const inverseReference = relative.clone().invert();
  return (breath, quiet) => {
    relativePose();
    delta.copy(relative).multiply(inverseReference);
    const twist = 2 * Math.atan2(delta.x * axis.x + delta.y * axis.y + delta.z * axis.z, delta.w);
    const current = Math.atan2(Math.sin(twist), Math.cos(twist));
    const target = angle + (relief + (.5 + .5 * breath) * .007) * quiet;
    side.copy(axis).applyQuaternion(skull).normalize();
    rotate(jaw, target - current, side);
    if (tongue) rotate(tongue, curl, side);
  };
}

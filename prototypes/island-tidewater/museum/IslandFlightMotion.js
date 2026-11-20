import { addIslandMorphClip, islandMotionRig, positive } from './IslandMotionClips.js';

const { sin, cos, PI } = Math;

function flightStroke(phase) {
  return sin(phase) + .19 * sin(2 * phase - .65);
}

function wingPairs(rotate, sides, profile, { tilt = 0, glide = false } = {}) {
  for (const [i, side] of [1, -1].entries()) {
    for (const [section, node] of sides[i].entries()) {
      const [lift, sweep, twist, lag] = profile[section];
      rotate(node, t => ({
        roll: side * (section === 0 ? tilt : 0) + side * lift * (glide ? sin(t + lag + side * .42) : flightStroke(t - lag)),
        yaw: side * sweep * cos(t - lag),
        pitch: twist * sin(t - lag + .65),
      }));
    }
  }
}

function anurognathus(rig) {
  const wings = ['L', 'R'].map(side => ['Shoulder', 'Elbow', 'Wrist', 'Tip'].map(section => 'Wing' + section + '_' + side));
  rig.add('Fly', .55, ({ rotate }) => {
    wingPairs(rotate, wings, [[.55, .092, .042, 0], [.14, .092, .068, .38],
      [.18, .13, .07, .71], [.14, .06, .055, .98]], { tilt: -.26 });
    rotate('Head', t => ({ pitch: -.027 * sin(t + .64), yaw: .046 * sin(t + .5) }));
    for (const side of ['L', 'R']) rotate('Foot_' + side, t => ({ pitch: .045 * cos(t - .55) }));
  }, t => {
    const recovery = (.5 + .5 * cos(t - .35)) ** 2;
    return [.33 + .32 * (1 - recovery), .15 + .62 * recovery, .82 + .14 * cos(t)];
  });
}

function sordes(rig) {
  const wings = [['Bone.007_15', 'Bone.008_14', 'Bone.009_13', 'Bone.010_12'],
    ['Bone.011_19', 'Bone.012_18', 'Bone.013_17', 'Bone.014_16']];
  function write(name, duration, gliding) {
    rig.add(name, duration, ({ rotate }) => {
      const power = gliding ? .18 : 1;
      wingPairs(rotate, wings, [[.36, .116, .062, 0], [.14, .06, .048, .4],
        [.12, .10, .052, .8], [.09, .08, .033, 1.1]].map(joint =>
        joint.map((value, i) => i === 3 ? value : value * power)), { glide: gliding, tilt: .038 });
      rotate('Bone.002_4', t => ({ pitch: (.022 + .016 * power) * sin(t - .49), yaw: .055 * sin(t + .43) }));
      rotate('Bone.003_3', t => ({ pitch: .04 * power * sin(t - .87), yaw: .076 * sin(t - .12) }));
    });
  }
  write('Fly', .94, false);
  write('Glide', 3.2, true);
}

function archaeopteryx(rig) {
  const wings = ['L', 'R'].map(side => ['Shoulder', 'Arm', 'ForeArm', 'Wrist'].map(section => side + '_' + section));
  rig.add('Fly', .64, ({ rotate }) => {
    // Broad shoulder drive with forearm recovery and a late wrist turn.
    // Source feathers already have separate bones and inherit these branches.
    wingPairs(rotate, wings, [[.51, .105, .034, 0], [.12, .05, .047, .38],
      [.18, .081, .047, .68], [.24, .12, .14, .85]], { tilt: -.61 });
    rotate('Neck_01', t => ({ pitch: -.07 + .024 * cos(t + .43) }));
    rotate('Tail_01', t => ({ pitch: -.045 * sin(t - .62), yaw: .025 * cos(t) }));
    rotate('Tail_06', t => ({ pitch: -.045 * sin(t - 1.2) }));
  });
}

function quetzalcoatlus(rig) {
  const wings = [['Bone.001_L_03', 'Bone.001_L.001_04', 'Bone.001_L.002_05', 'Bone.001_L.003_06', 'Bone.001_L.004_07'],
    ['Bone.001_R_09', 'Bone.001_R.001_010', 'Bone.001_R.002_011', 'Bone.001_R.003_012', 'Bone.001_R.004_013']];
  function write(name, duration, gliding) {
    rig.add(name, duration, ({ rotate }) => {
      const power = gliding ? .15 : .87;
      wingPairs(rotate, wings, [[.31, .088, .025, 0], [.106, .041, .032, .35],
        [.133, .052, .048, .58], [.14, .064, .058, .88], [.112, .083, .048, 1.12]].map(joint =>
        joint.map((value, i) => i === 3 ? value : value * power)), { glide: gliding, tilt: -.018 });
      rotate('Bone.002_015', t => ({ pitch: .10 + .026 * power * cos(t - .6) }));
      rotate('Bone.003_016', t => ({ pitch: .062 + .016 * power * cos(t - .85) }));
      rotate('Bone.005_018', t => ({ pitch: -.03 + .019 * power * sin(t + .42) }));
      rotate('Bone.006_019', t => ({ pitch: -.08 + .016 * power * sin(t) }));
    });
  }
  write('Fly', 1.62, false);
  write('Glide', 5.5, true);
}

function meganeura(gltf) {
  addIslandMorphClip(gltf, 'Fly', 1.15, t => {
    // Seven short beats per loop with a continuous envelope. The native
    // wing shapes leave the abdomen and legs rigid.
    const power = .73 + .13 * sin(t - .5) + .07 * sin(2 * t + .4);
    const stroke = sin(7 * t + .18 * sin(t));
    return [power * positive(stroke), power * positive(-stroke)];
  }, 168);
}

function rhamphorhynchus(gltf) {
  addIslandMorphClip(gltf, 'Fly', 2.62, t => {
    const stroke = flightStroke(3 * t);
    // Three wingbeats followed in the same cycle by a brief extended coast.
    const power = 1 - .94 * (.5 + .5 * cos(t + .17)) ** 10;
    return [.87 * power * positive(stroke), .74 * power * positive(-stroke)];
  }, 72);
  addIslandMorphClip(gltf, 'Glide', 3.25, t => [.095 + .03 * cos(t), .01 * positive(sin(t))]);
}

function tupandactylus(gltf) {
  addIslandMorphClip(gltf, 'Fly', 1.2, t => {
    const stroke = flightStroke(t);
    return [.89 + .07 * cos(t - .65), .80 * positive(stroke), .68 * positive(-stroke)];
  });
  addIslandMorphClip(gltf, 'Glide', 3.9, t => [.96 + .025 * cos(t), .078 + .031 * cos(t + PI / 4), .012 * positive(sin(t))]);
}

const skeletal = { anurognathus, sordes, archaeopteryx, quetzalcoatlus };
const morphs = { meganeura, rhamphorhynchus, tupandactylus };

export function prepareIslandFlightMotion(gltf, id, metadata) {
  // Pteranodon's existing flap-and-soar performance is already authored.
  if (Object.hasOwn(skeletal, id)) skeletal[id](islandMotionRig(gltf, metadata));
  else if (Object.hasOwn(morphs, id)) morphs[id](gltf);
}

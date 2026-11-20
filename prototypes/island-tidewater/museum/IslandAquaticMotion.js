import { addIslandMorphClip, islandMotionRig, positive, retimeIslandClip, TAU } from './IslandMotionClips.js';

const { sin, cos, PI } = Math;
const flank = (left, right) => [[left, 1], [right, -1]];

function tail(rotate, joints, { strength, lag }) {
  joints.forEach((joint, i) => rotate(joint, t => ({ yaw: strength[i] * sin(t - i * lag) })));
}

function pairedFins(rotate, left, right, lift, sweep, offset = 0, spacing = 0) {
  for (const [joint, side] of flank(left, right)) {
    rotate(joint, t => {
      const phase = t + offset + side * spacing;
      return { roll: side * lift * (sin(phase) + .14 * sin(2 * phase)),
        yaw: side * sweep * cos(phase), pitch: -.1 * lift * sin(phase + .55) };
    });
  }
}

function anomalocaris(rig) {
  const write = (name, duration, power) => rig.add(name, duration, ({ rotate }) => {
    // The posterior and anterior lobes are separately weighted. Start each
    // stroke at the head and pass it toward the tail, on both sides.
    for (const [joint, node] of rig.names) {
      const flap = /^Flap_(\d+)\.(L|R)$/.exec(joint);
      if (flap) {
        const side = Math.sign(rig.rightOf(node));
        const lag = (13 - Number(flap[1])) * .53;
        rotate(node, t => ({ roll: side * power * (.34 * sin(t - lag) + .05 * sin(2 * (t - lag))),
          yaw: side * .095 * power * cos(t - lag) }));
      }
      const limb = /^Frontal_(\d+)\.(L|R)$/.exec(joint);
      if (limb && Number(limb[1]) < 8) {
        const i = Number(limb[1]), side = limb[2] === 'L' ? 1 : -1;
        rotate(node, t => ({ pitch: .047 * sin(t - .35 * i + side * .55),
          yaw: side * .024 * (1 + cos(t - .18 * i)) }));
      }
    }
  });
  write('Swim', 1.06, 1);
  write('Hover', 1.38, .58);
}

function opabinia(rig) {
  const write = (name, duration, power) => rig.add(name, duration, ({ rotate }) => {
    for (const [index, pair] of [
      ['BodyA.R_016', 'BodyA.L_015'], ['BodyB.R_014', 'BodyB.L_013'], ['BodyC.R_012', 'BodyC.L_011'],
    ].entries()) {
      pairedFins(rotate, ...pair, .29 * power, .055 * power, -index * 1.08, .08);
    }
    rotate('Body.03_09', t => ({ pitch: .035 * power * sin(t - .8) }));
    rotate('Body.04_010', t => ({ pitch: .08 * power * sin(t - 1.5) }));
    const neck = ['Probo.01_01', 'Probo.02_02', 'Probo.03_03', 'Probo.04_04'];
    for (const [i, node] of neck.entries()) {
      rotate(node, t => ({ pitch: -.10 * (.4 + .6 * cos(t - i * .26)),
        yaw: .09 * sin(t - i * .24) }));
    }
    for (const [node, side] of flank('Pincer.R_06', 'Pincer.L_05')) {
      rotate(node, t => ({ yaw: -.13 * side * (.5 + .5 * cos(t - .8)) }));
    }
  });
  write('Hover', 1.75, .75);
  write('Swim', 1.17, 1);
}

function hallucigenia(rig, gltf) {
  const legs = [...rig.names.values()].flatMap(node => {
    const parent = gltf.nodes[rig.parent[node]];
    const name = gltf.nodes[node].name;
    if (!parent || !/^(?:Body|Neck)/.test(parent.name) || !/^Bone[_.].*_[LR]/.test(name)) return [];
    const chain = [node];
    while (gltf.nodes[chain.at(-1)].children.length === 1) chain.push(gltf.nodes[chain.at(-1)].children[0]);
    if (chain.length !== 4) return [];
    return [{ chain, forward: rig.forwardOf(node), side: name.includes('_L') ? 1 : -1 }];
  });
  const fore = Math.max(...legs.map(leg => leg.forward)), aft = Math.min(...legs.map(leg => leg.forward));
  const step = phase => {
    const contact = .67;
    const cycle = (phase / TAU % 1 + 1) % 1;
    if (cycle < contact) return [-.46 + .92 * cycle / contact, 0];
    const t = (cycle - contact) / (1 - contact);
    return [.46 * cos(PI * t), sin(PI * t) ** 2];
  };
  rig.add('Crawl', .43, ({ rotate }) => {
    for (const { chain, forward, side } of legs) {
      const lag = (fore - forward) / (fore - aft) * TAU * 1.7 + (side < 0 ? PI : 0);
      // The proximal assignment includes the dorsal spines on this rig.
      // Bend the three soft leg sections below it to preserve the spines.
      rotate(chain[1], t => {
        const [reach, lift] = step(t - lag);
        return { pitch: reach + .10 * lift, roll: side * .05 * lift };
      });
      rotate(chain[2], t => ({ pitch: -.46 * step(t - lag)[1] }));
      rotate(chain[3], t => ({ pitch: -.22 * step(t - lag)[1] }));
    }
    rotate('Neck.001_012', t => ({ pitch: .03 * sin(t - .7), yaw: .045 * cos(t - .8) }));
    rotate('Head_014', t => ({ yaw: .035 * cos(t - 1.1) }));
  });
}

function tullimonstrum(rig) {
  const write = (name, duration, power) => rig.add(name, duration, ({ rotate }) => {
    rotate('Bone.002_011', t => ({ yaw: .21 * power * sin(t) }));
    rotate('Bone.001_012', t => ({ yaw: .29 * power * sin(t - .65) }));
    // The trailing edges have sockets on the peduncle rather than the tail tip.
    for (const [i, angle] of [
      [1, .08], [2, .13], [3, .15], [4, .18], [5, .055], [6, .03],
      [7, .08], [8, .13], [9, .16], [10, .18],
    ]) rotate(i, t => ({ yaw: angle * power * sin(t - .70 - .05 * i) }));
    const proboscis = ['Bone.004_02', 'Bone.005_03', 'Bone.006_04', 'Bone.007_05', 'Bone.008_06', 'Bone.009_07'];
    proboscis.forEach((joint, i) => rotate(joint, t => ({
      pitch: .035 * cos(t - .43 * i), yaw: .035 * sin(t - .30 * i),
    })));
    rotate('Bone.010_09', t => ({ pitch: .13 * positive(sin(t - 1.8)) }));
  });
  write('Hover', 1.85, .62);
  write('Swim', 1.3, 1);
}

function dakosaurus(rig) {
  const write = (name, duration, power) => rig.add(name, duration, ({ rotate }) => {
    tail(rotate, ['TailBase', 'TailTip'], { strength: [.16 * power, .27 * power], lag: .75 });
    pairedFins(rotate, 'FrontFinR', 'FrontFinL', .12 * power, .10 * power, .55, .17);
    pairedFins(rotate, 'RearFinR', 'RearFinL', .16 * power, .13 * power, -.8, .18);
    rotate('Head', t => ({ yaw: -.035 * power * sin(t + .25) }));
  });
  write('Swim', 2.15, 1);
  write('Hover', 2.8, .40);
}

function ichthyosaur(rig) {
  const write = (name, duration, power) => rig.add(name, duration, ({ rotate }) => {
    // Lateral tail beat. Both pairs trim independently behind the nose.
    tail(rotate, ['tail_01', 'tail_02', 'tail_03', 'tail_04', 'tail_05', 'tail_06'],
      { strength: [.038, .067, .123, .172, .193, .21].map(angle => angle * power), lag: .46 });
    pairedFins(rotate, 'front_fin_R', 'front_fin_L', .17 * power, .075 * power, .42, .15);
    pairedFins(rotate, 'rear_fin_R', 'rear_fin_L', .11 * power, .06 * power, -.55, .15);
    rotate('neck', t => ({ yaw: -.023 * power * sin(t) }));
    rotate('head', t => ({ yaw: -.016 * power * sin(t - .22), pitch: .017 * power * cos(t) }));
  });
  write('Swim', 1.75, 1);
  write('Hover', 2.4, .40);
}

function ammonite(rig) {
  rig.add('Hover', 3.65, ({ rotate }) => {
    // Three joints carry the fused arm crown. Leave the weighted shell alone.
    ['tentacles1_01', 'tentacles2_02', 'tentacles3_03'].forEach((name, i) => rotate(name, t => ({
      pitch: .14 * sin(t - .49 * i) + .055 * sin(2 * (t - .45 * i)),
      yaw: .075 * sin(t - .64 * i + 1.1),
    })));
  });
}

function sarcosuchus(rig) {
  rig.add('Swim', 2.5, ({ rotate }) => {
    tail(rotate, ['TailBase', 'TailMid', 'TailTip'], { strength: [.14, .26, .32], lag: .67 });
    rotate('Neck', t => ({ yaw: -.027 * sin(t + .25) }));
    rotate('Head', t => ({ pitch: .015 * cos(t - .29) }));
  });
}

function dallasaurus(rig) {
  const spine = [...rig.names.keys()].flatMap(name => {
    const match = /^j_spine_(\d+)_Bind_/.exec(name);
    return match && Number(match[1]) >= 6 ? [[name, Number(match[1])]] : [];
  }).sort((a, b) => a[1] - b[1]);
  const write = (name, duration, power) => rig.add(name, duration, ({ rotate }) => {
    tail(rotate, spine.map(([joint]) => joint), { strength: spine.map((_, i) => power * (.016 + i * .007)),
      lag: .26 });
    pairedFins(rotate, 'j_leftFrontFlipper_02_093', 'j_rightFrontFlipper_010_086', .16 * power, .12 * power, .4, .34);
  });
  write('Swim', 1.23, 1);
  write('Hover', 1.62, .36);
}

function styxosaurus(rig) {
  const write = (name, duration, power) => rig.add(name, duration, ({ rotate }) => {
    pairedFins(rotate, 'FrontFlipperR', 'FrontFlipperL', .38 * power, .21 * power, .15);
    pairedFins(rotate, 'RearFlipperR', 'RearFlipperL', .34 * power, .19 * power, -1.28);
    // Front and rear strokes are offset. The neck trim stays small so the
    // pointed head holds its bearing as the animal pulls itself forward.
    rotate('NeckBase', t => ({ pitch: .037 * power * sin(t - .65), yaw: .019 * cos(t) }));
    rotate('NeckMid', t => ({ pitch: -.024 * power * sin(t - .3) }));
    rotate('NeckTip', t => ({ pitch: -.029 * power * sin(t - .18), yaw: -.012 * cos(t) }));
    rotate('Head', t => ({ pitch: .018 * power * sin(t - .21) }));
    rotate('TailBase', t => ({ pitch: .032 * power * cos(t - 1.4) }));
    rotate('TailTip', t => ({ pitch: .043 * power * cos(t - 1.9) }));
  });
  write('Swim', 2.55, 1);
  write('Hover', 3.25, .40);
}

function megalodon(rig) {
  const write = (name, duration, power) => rig.add(name, duration, ({ rotate }) => {
    tail(rotate, ['Bone.003_Armature_5', 'Bone.002_Armature_4', 'Bone.004_Armature_3'],
      { strength: [.11, .21, .34].map(angle => power * angle), lag: .68 });
    rotate('Bone.024_Armature_1', t => ({ yaw: .09 * power * sin(t - 2) }));
    rotate('Bone.025_Armature_2', t => ({ yaw: .075 * power * sin(t - 2.12) }));
    pairedFins(rotate, 'Bone.012_Armature_25', 'Bone.011_Armature_22', .068 * power, .09 * power, .2, .26);
    rotate('Bone.001_Armature_13', t => ({ yaw: -.022 * power * sin(t + .36) }));
  });
  write('Swim', 2.65, 1);
  write('Hover', 3.2, .43);
}

const skeletal = { anomalocaris, opabinia, hallucigenia, tullimonstrum, dakosaurus, ichthyosaur,
  ammonite, sarcosuchus, dallasaurus, styxosaurus, megalodon };

function plesiosaurus(gltf) {
  const weights = (t, power) => {
    const a = (t / TAU * 4 + .23 * sin(t)) % 4;
    const i = Math.floor(a), f = a - i;
    const blend = f * f * (3 - 2 * f);
    const ordered = [0, 0, 0, 0];
    ordered[i] = power * (1 - blend);
    ordered[(i + 1) % 4] = power * blend;
    return ordered;
  };
  // Four authored phase shapes feather the front and rear flippers in order.
  addIslandMorphClip(gltf, 'Swim', 2.0, t => weights(t, 1));
  addIslandMorphClip(gltf, 'Hover', 3.25, t => weights(t, .53));
}

function mosasaurus(gltf) {
  const weights = (t, power) => {
    const stroke = sin(t), trim = sin(2 * t - .7);
    // Hold a nearly closed jaw, with a small respiratory opening.
    return [.91 - .09 * cos(t), power * positive(stroke), power * positive(-stroke),
      .66 * power * positive(trim), .66 * power * positive(-trim)];
  };
  addIslandMorphClip(gltf, 'Swim', 2.24, t => weights(t, 1));
  addIslandMorphClip(gltf, 'Hover', 3.2, t => weights(t, .40));
}

export function prepareIslandAquaticMotion(gltf, id, metadata) {
  if (Object.hasOwn(skeletal, id)) skeletal[id](islandMotionRig(gltf, metadata), gltf);
  else if (id === 'plesiosaurus') plesiosaurus(gltf);
  else if (id === 'mosasaurus') mosasaurus(gltf);
  // These clips already include measured body and fin articulation. Keep
  // the authored gill and mouth channels while bringing the beats up to pace.
  else if (id === 'xiphactinus') retimeIslandClip(gltf, 'Swim', 'Swim', 2.7);
  else if (id === 'livyatan') retimeIslandClip(gltf, 'Swim', 'Swim', 3.7);
}

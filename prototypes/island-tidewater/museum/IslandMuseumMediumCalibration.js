import aquaticRigs from './aquatic-motion/rig-calibration.json' with { type: 'json' };

// Positions and axes were measured in the displayed source pose, using
// [forward, up, lateral] model units. Masks taper at the anatomical joints.
const pitch = [0, 0, 1], yaw = [0, 1, 0], roll = [1, 0, 0];
const { cos, sin } = Math;

function ramp(from, to, value) {
  const x = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return x * x * (3 - 2 * x);
}

function aquaticCalibration(id) {
  const { forward, joints } = aquaticRigs[id];
  return {
    active: 'Swim', resting: 'Hover', forward,
    joints: joints.map(({ windows, material, ...joint }) => ({
      ...joint,
      weight: (f, y, l, sourceMaterial) => {
        if (material && material !== sourceMaterial) return 0;
        const coordinates = [f, y, l];
        let weight = 1;
        for (const [axis, from, to] of windows) weight *= ramp(from, to, coordinates[axis]);
        return weight;
      },
    })),
  };
}

function wristPair() {
  return [-1, 1].map(side => ({
    name: `wing hand ${side}`,
    pivot: [.091, -.157, side * .655],
    weight: (f, y, l, material) => material === 'Material.001' ? ramp(.56, .94, side * l) : 0,
    followMorph: true,
    motion: (t, active) => [
      [roll, side * (active ? .115 : .043) * sin(t - .72)],
      [[-.14, -.22, side * .97], side * (active ? .097 : .061) * cos(t - .65)],
    ],
  }));
}

function insectLegs() {
  // The three pairs attach at different points along the ventral thorax.
  const pairs = [
    ['rear', [.137, -.473, 0], [.060, .102, .179, .227], -.21],
    ['middle', [.273, -.525, 0], [.209, .250, .443, .473], .02],
    ['front', [.459, -.494, 0], [.410, .441, .580, .653], .21],
  ];
  return pairs.map(([name, pivot, [a, b, c, d], lag]) => ({
    name: name + ' leg pair', pivot,
    weight: (f, y, l, material) => {
      if (!['claws', 'hair', 'skin'].includes(material)) return 0;
      // The middle tarsi reach forward, beside the front pair. Their distal
      // lateral separation keeps each claw and shank with its own joint.
      const distal = ramp(-.59, -.79, y);
      const lateral = ramp(.050, .073, Math.abs(l));
      const legRegion = name === 'front' ? 1 - distal * lateral
        : name === 'middle' ? 1 - distal * (1 - lateral) : 1;
      return ramp(-.487, -.759, y) * ramp(a, b, f) * ramp(d, c, f) * legRegion;
    },
    motion: t => [[pitch, .131 + .105 * cos(t - .52 + lag)]],
  }));
}

export const islandMuseumMediumCalibration = {
  mosasaurus: aquaticCalibration('mosasaurus'),
  plesiosaurus: aquaticCalibration('plesiosaurus'),
  meganeura: { active: 'Fly', joints: [
    {
      name: 'abdomen', pivot: [.056, -.243, 0],
      weight: (f, y, l, material) => ['skin', 'sting', 'appendage'].includes(material) ? ramp(.036, -.25, f) : 0,
      motion: t => [[pitch, .045 + .125 * sin(t - .49)], [yaw, .053 * cos(t + .4)]],
    },
    {
      name: 'posterior abdomen', parent: 'abdomen', pivot: [-.509, -.281, 0],
      weight: (f, y, l, material) => ['skin', 'sting', 'appendage'].includes(material) ? ramp(-.479, -.744, f) : 0,
      motion: t => [[pitch, .089 * sin(t - 1.01)], [yaw, .047 * cos(t - .43)]],
    },
    ...insectLegs(),
  ] },
  rhamphorhynchus: { active: 'Fly', joints: [
    {
      name: 'tailstock', pivot: [-.176, .041, 0],
      weight: (f, y, l) => ramp(-.166, -.321, f) * ramp(.072, .031, Math.abs(l)),
      motion: (t, active) => [[yaw, (active ? .143 : .105) * sin(t - .56)], [pitch, (active ? .066 : .042) * cos(t - .13)]],
    },
    {
      name: 'tail vane', parent: 'tailstock', pivot: [-.828, .088, -.005], weight: f => ramp(-.74, -.883, f),
      motion: (t, active) => [[yaw, (active ? .112 : .085) * sin(t - 1.1)], [roll, .155 * cos(t - .38)]],
    },
  ] },
  tupandactylus: { active: 'Fly', joints: [
    {
      name: 'head and crest', pivot: [.166, -.188, 0],
      weight: (f, y, l) => Math.max(ramp(.116, .306, f), ramp(-.12, .035, y) * ramp(.055, .12, f))
        * ramp(.139, .085, Math.abs(l)),
      motion: (t, active) => [[yaw, (active ? .065 : .092) * sin(t - .42)], [pitch, (active ? -.054 : -.029) * cos(t - .49)]],
    },
    ...wristPair(),
  ] },
};

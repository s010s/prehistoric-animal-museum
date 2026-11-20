// Positions and axes were measured in the displayed source pose, using
// [forward, up, lateral] model units. Masks taper at the anatomical joints.
const pitch = [0, 0, 1], yaw = [0, 1, 0], roll = [1, 0, 0];
const { cos, sin } = Math;

function ramp(from, to, value) {
  const x = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return x * x * (3 - 2 * x);
}

function finPair(fore) {
  return [-1, 1].map(side => ({
    name: `${fore ? 'fore' : 'hind'} flipper ${side}`,
    pivot: fore ? [.745, -.041, side * .213] : [.005, -.069, side * .185],
    weight: (f, y, l, material) => material === 'Mosasaurus'
      ? ramp(.178, .292, l * side) * ramp(.106, .018, y)
        * (fore ? ramp(.37, .51, f) * ramp(1.0, .83, f) : ramp(.18, .08, f))
      : 0,
    followMorph: true,
    motion: (t, active) => [
      [fore ? [-.59, -.27, side * .75] : [-.70, -.17, side * .69],
        side * (active ? 1 : .58) * (fore ? .135 : .108) * sin(2 * t + (fore ? .16 : -.83))],
    ],
  }));
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
    ['middle', [.273, -.525, 0], [.209, .250, .414, .448], .02],
    ['front', [.459, -.494, 0], [.410, .452, .563, .653], .21],
  ];
  return pairs.map(([name, pivot, [a, b, c, d], lag]) => ({
    name: name + ' leg pair', pivot,
    weight: (f, y, l, material) => ['claws', 'hair', 'skin', 'material'].includes(material)
      ? ramp(-.487, -.759, y) * ramp(a, b, f) * ramp(d, c, f) : 0,
    motion: t => [[pitch, .131 + .105 * cos(t - .52 + lag)]],
  }));
}

export const islandMuseumMediumCalibration = {
  mosasaurus: { active: 'Swim', resting: 'Hover', joints: [...finPair(true), ...finPair(false)] },
  plesiosaurus: { active: 'Swim', resting: 'Hover', forward: [.394, .919], joints: [
    {
      name: 'middle neck', pivot: [215, 28, -57], weight: f => ramp(171, 302, f),
      motion: (t, active) => [[yaw, (active ? .080 : .053) * sin(t - .28)], [pitch, .042 * cos(t - .39)]],
    },
    {
      name: 'head', parent: 'middle neck', pivot: [445, 167, 99], weight: f => ramp(417, 466, f),
      motion: (t, active) => [[yaw, -(active ? .072 : .050) * sin(t - .57)], [pitch, -.037 * cos(t - .65)]],
    },
  ] },
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
  rhamphorhynchus: { active: 'Fly', resting: 'Glide', joints: [
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
  tupandactylus: { active: 'Fly', resting: 'Glide', joints: [
    {
      name: 'head and crest', pivot: [.166, -.188, 0],
      weight: (f, y, l) => Math.max(ramp(.116, .306, f), ramp(-.12, .035, y) * ramp(.055, .12, f))
        * ramp(.139, .085, Math.abs(l)),
      motion: (t, active) => [[yaw, (active ? .065 : .092) * sin(t - .42)], [pitch, (active ? -.054 : -.029) * cos(t - .49)]],
    },
    ...wristPair(),
  ] },
};

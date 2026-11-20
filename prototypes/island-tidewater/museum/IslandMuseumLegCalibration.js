// Cross-sections measured on the visible Idle frame, in forward / up / lateral
// coordinates. Outer radii describe the surface of the limb at each section.
// Joint centers are the hip, knee and ankle. The last section encloses the sole
// and the toes, including claws supplied by a separate material primitive.
// hipFeather extends the skin transition above the pivot in femur heights.
// hipHalo softens the cross-section boundary around the thigh and hip.
function leg(side, fore, attach, joints, sections, source = attach ? [attach] : []) {
  return { side, fore, attach, joints, sections, source };
}

function mirrored(fore, source, sections, attach = [null, null]) {
  return [-1, 1].map((side, i) => leg(
    side, fore, attach[i], [0, 1, 2],
    sections.map(([f, y, l, rf, rl]) => [f, y, side * l, rf, rl]),
    source ?? (attach[i] ? [attach[i]] : []),
  ));
}

export const islandMuseumLegCalibration = {
  dilophosaurus: {
    forward: [1, 0], materials: ['Body'], groundMorph: true, addedVertexBytes: 20,
    hipFeather: .28, hipHalo: .35,
    legs: mirrored(false, [], [
      [.35, .63, .12, .145, .095],
      [.449, .426, .124, .09, .074],
      [.377, .178, .127, .048, .035],
      [.465, -.008, .165, .115, .116],
    ]),
  },
  apatosaurus: {
    forward: [-1, 0], addedVertexBytes: 16,
    hipFeather: .29, hipHalo: .38,
    legs: [
      ...mirrored(true, [], [
        [.85, .49, .12, .125, .112],
        [.761, .22, .084, .112, .093],
        [.79, .074, .080, .085, .083],
        [.807, -.006, .077, .095, .09],
      ]),
      ...mirrored(false, [], [
        [.31, .51, .136, .18, .12],
        [.377, .213, .114, .102, .082],
        [.353, .080, .116, .064, .073],
        [.371, -.006, .115, .089, .092],
      ]),
    ],
  },
  sauropelta: {
    forward: [-1, 0], groundMorph: true, addedVertexBytes: 20,
    hipFeather: .30, hipHalo: .42,
    legs: [
      leg(-1, true, null, [0, 1, 2], [
        [.70, .54, -.245, .15, .125], [.625, .231, -.222, .13, .115],
        [.625, .089, -.212, .097, .092], [.647, -.012, -.205, .125, .115],
      ]),
      leg(1, true, null, [0, 1, 2], [
        [.79, .53, .267, .16, .14], [.838, .257, .24, .125, .114],
        [.92, .10, .23, .125, .112], [.996, -.011, .206, .118, .125],
      ]),
      leg(-1, false, null, [0, 1, 2], [
        [.14, .56, -.265, .188, .143], [.268, .240, -.215, .13, .102],
        [.278, .087, -.228, .13, .114], [.309, -.011, -.231, .134, .135],
      ]),
      leg(1, false, null, [0, 1, 2], [
        [.103, .56, .275, .18, .125], [.035, .254, .228, .128, .1],
        [-.018, .086, .223, .108, .108], [.018, -.01, .238, .14, .142],
      ]),
    ],
  },
  carnotaurus: {
    forward: [0, 1], materials: ['BODY', 'CLAW'], upperHalo: .23, addedVertexBytes: 16,
    hipFeather: .40, hipHalo: .54,
    // In the museum pose the trailing foot points down onto three claw tips.
    // Unroll it onto its fleshy toe pads before measuring its support patch.
    solePitch: [0, -.46],
    legs: [
      leg(-1, false, 'Object_2', [0, 1, 3], [
        [-.58, 2.68, -.79, .52, .42], [-.246, 1.53, -.906, .36, .24],
        [-.525, 1.01, -.96, .181, .173], [-.464, .457, -.993, .169, .203],
        [-.312, .28, -.97, .53, .43], [-.166, .015, -.967, .61, .49],
      ]),
      leg(1, false, 'Object_2', [0, 1, 3], [
        [-1.05, 2.62, .73, .53, .43], [-.77, 1.72, .73, .36, .30],
        [-1.33, 1.16, .76, .41, .24], [-1.946, .407, .789, .24, .30],
        [-1.838, .26, .798, .32, .39], [-1.743, .008, .795, .37, .45],
      ]),
    ],
  },
  therizinosaurus: {
    forward: [1, 0], root: 'Ground', head: 'Neck', tail: 'TailBase', addedVertexBytes: 16,
    hipFeather: .30, hipHalo: .42, blendSkinSeams: true,
    legs: [
      leg(-1, false, 'Pelvis', [0, 1, 2], [
        [.035, -.15, -.235, .25, .14], [.112, -.475, -.252, .22, .12],
        [-.16, -.801, -.265, .127, .093], [-.127, -.986, -.265, .142, .129],
        [.044, -1.064, -.268, .28, .168], [.085, -1.176, -.278, .27, .198],
      ], ['Pelvis', 'Ground']),
      leg(1, false, 'Pelvis', [0, 1, 2], [
        [.094, -.15, .215, .25, .138], [.236, -.488, .238, .23, .12],
        [.084, -.824, .212, .131, .101], [.115, -.989, .236, .145, .13],
        [.243, -1.064, .276, .29, .161], [.294, -1.176, .303, .272, .199],
      ], ['Pelvis', 'Ground']),
    ],
  },
  phorusrhacos: {
    forward: [1, 0], root: 'Root', head: 'NeckBase', tail: 'Tail', addedVertexBytes: 32,
    hipFeather: .39, hipHalo: .64,
    // The source stands mid-stride. Leave room for its broad toes when both feet are planted.
    laneOutset: .11,
    // Its thigh vertices also carry native tail weights. Keep the tail's pose out of solved legs.
    isolateGroundLegs: true,
    legs: [
      leg(-1, false, 'Body', [0, 1, 3], [
        [-.741, 1.61, -.296, .218, .183], [-.55, .919, -.21, .134, .105],
        [-.38, .424, -.118, .151, .121], [-.377, .295, -.119, .182, .194],
        [-.248, .187, -.121, .309, .342], [-.158, -.01, -.105, .349, .391],
      ], ['Body', 'Root', 'Tail']),
      leg(1, false, 'Body', [0, 1, 3], [
        [-.854, 1.61, .239, .274, .203], [-1.208, 1.025, .142, .155, .12],
        [-1.4, .51, .16, .166, .146], [-1.444, .307, .174, .174, .212],
        [-1.369, .195, .304, .33, .355], [-1.284, -.01, .291, .34, .337],
      ], ['Body', 'Root', 'Tail']),
    ],
  },
  regaliceratops: {
    forward: [1, 0], root: 'Root', head: 'Neck', tail: 'TailBase', addedVertexBytes: 16,
    hipFeather: .31, hipHalo: .36,
    legs: [
      ...mirrored(true, null, [
        [.424, .51, .23, .155, .106], [.331, .227, .216, .103, .096],
        [.355, .093, .214, .107, .101], [.398, .004, .203, .136, .137],
      ], ['FrontLegL', 'FrontLegR']),
      ...mirrored(false, null, [
        [-.482, .54, .247, .19, .117], [-.426, .255, .204, .129, .113],
        [-.398, .117, .191, .144, .114], [-.347, -.007, .198, .171, .164],
      ], ['RearLegL', 'RearLegR']),
    ],
  },
  triceratops: {
    forward: [0, 1], root: 'root', head: 'head', tail: 'tail_1',
    hipFeather: .26, hipHalo: .26, blendSkinSeams: true,
    legs: [
      ...mirrored(true, null, [
        [.433, .986, .47, .282, .214], [.334, .453, .495, .189, .195],
        [.501, .136, .508, .174, .163], [.546, -.011, .515, .222, .209],
      ], ['leg_front_left', 'leg_front_right']),
      ...mirrored(false, null, [
        [-.456, 1.025, .508, .31, .26], [-.447, .437, .504, .192, .21],
        [-.443, .112, .517, .203, .204], [-.395, -.012, .52, .254, .218],
      ], ['leg_rear_left', 'leg_rear_right']),
    ],
  },
  mammoth: {
    forward: [-1, 0], root: 'root', head: 'head', tail: 'tail_1', addedVertexBytes: 16,
    // The source labels switch inside the same feet. Follow each anatomical lane.
    laneDivider: [.445, .324], upperBlend: .63, upperHalo: .24,
    // The source switches from pelvis to tail partway across the haunch.
    hipFeather: .14, hipHalo: .24, blendSkinSeams: true, softenSkinSeams: true,
    legs: [
      leg(-1, true, 'leg_front_right', [0, 1, 2], [
        [.166, .678, .251, .27, .25], [.174, .276, .326, .132, .145],
        [.165, .073, .323, .095, .096], [.187, -.052, .322, .125, .111],
      ], ['leg_front_right', 'leg_front_left']),
      leg(1, true, 'leg_front_left', [0, 1, 2], [
        [.164, .672, .65, .27, .22], [.175, .282, .55, .128, .13],
        [.173, .074, .544, .108, .092], [.187, -.052, .545, .125, .108],
      ], ['leg_front_right', 'leg_front_left']),
      leg(-1, false, 'leg_rear_right', [0, 1, 2], [
        [-.50, .67, .162, .22, .147], [-.48, .31, .191, .177, .129],
        [-.528, .077, .201, .112, .097], [-.523, -.052, .215, .130, .094],
      ], ['leg_rear_right', 'leg_rear_left', 'root', 'tail_1']),
      leg(1, false, 'leg_rear_left', [0, 1, 2], [
        [-.493, .672, .645, .236, .148], [-.456, .305, .466, .174, .128],
        [-.461, .077, .435, .107, .099], [-.443, -.052, .435, .123, .092],
      ], ['leg_rear_right', 'leg_rear_left', 'root', 'tail_1']),
    ],
  },
};

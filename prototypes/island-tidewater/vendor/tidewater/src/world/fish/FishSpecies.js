// Anatomy of the fish species, normalized to a total length of 1 (snout tip to the tip of the
// tail fin). The geometry (FishGeometry.js) and the skin shader (FishMaterial.js) read these.
//
//  pattern: skin pattern id in the shader (see PATTERN)
//  body: fraction of the total length up to the base of the tail fin
//  top / bot / wid: dorsal height, ventral depth and half width of the body over u (0 snout ..
//    1 base of the tail fin), [ u, value ] pairs
//  sec: cross-section exponent (2 ellipse, > 2 boxier, < 2 more pointed at back and belly)
//  mouth: { corner: u of the mouth corner, y: its height, tip: height of the lips at the snout,
//    protrude: how far the lower jaw reaches beyond the upper one }
//  eye: { u, y, r }; opercle: u of the edge of the gill cover at mid-height
//  scales: scale size (0: none visible), scaleVis: how strongly they show
//  lateral: height fraction of the lateral line (0 mid-flank .. 1 back), arch: its rise at the front
//  dorsal / anal: fin segments { from, to, rays, spiny, h: [ [ t, height ], ... ] over the
//    segment, rake: [ first, last ] angle of the rays from the vertical (rad), notch: membrane
//    dip between the rays (fraction of the ray length) }
//  pectoral: { u, y, len, base, rays, shape ('rounded' | 'pointed' | 'falcate'), spread }
//  pelvic: { u, len, rays }
//  caudal: { shape: 'forked' | 'lunate' | 'rounded' | 'truncate', len, span, fork (length of the
//    middle rays relative to the lobes), rays }
//  finlets: { from, to, dorsal, ventral } (tunas)
//  iris: eye colour (sRGB hex); irid: iridescence (0 .. 1); metal: silvery guanine reflection

export const PATTERN = {
	silverside: 0, chromis: 1, grunt: 2, yellowtail: 3, tang: 4, sergeant: 5, wrasse: 6, parrot: 7,
	angel: 8, barracuda: 9, redSnapper: 10, grouper: 11, tuna: 12, mahi: 13, mullet: 14, needlefish: 15,
	jack: 16, tarpon: 17, stingray: 18, eagleRay: 19, turtle: 20,
};

const spiny = ( from, to, rays, h, rake, notch = 0.16 ) => ( { from, to, rays, spiny: true, h, rake, notch } );
const soft = ( from, to, rays, h, rake, notch = 0.015 ) => ( { from, to, rays, spiny: false, h, rake, notch } );

export const SPECIES = {

	// Atlantic silverside / hardhead: slender, big-eyed, a silver band along the flank
	silverside: {
		pattern: PATTERN.silverside, body: 0.83, sec: 2.0,
		top: [ [ 0, 0.003 ], [ 0.03, 0.016 ], [ 0.1, 0.035 ], [ 0.25, 0.058 ], [ 0.45, 0.068 ], [ 0.65, 0.056 ], [ 0.85, 0.034 ], [ 1, 0.026 ] ],
		bot: [ [ 0, 0.003 ], [ 0.03, 0.014 ], [ 0.1, 0.032 ], [ 0.25, 0.055 ], [ 0.45, 0.064 ], [ 0.65, 0.05 ], [ 0.85, 0.03 ], [ 1, 0.024 ] ],
		wid: [ [ 0, 0.003 ], [ 0.05, 0.016 ], [ 0.2, 0.032 ], [ 0.4, 0.036 ], [ 0.7, 0.026 ], [ 1, 0.013 ] ],
		mouth: { corner: 0.07, y: 0.004, tip: 0.006, protrude: 0 },
		eye: { u: 0.1, y: 0.014, r: 0.03 }, opercle: 0.22,
		scales: 0.02, scaleVis: 0.35, lateral: 0.05, arch: 0.1,
		dorsal: [ spiny( 0.47, 0.53, 5, [ [ 0, 0.035 ], [ 1, 0.02 ] ], [ 0.5, 0.7 ], 0.125 ), soft( 0.63, 0.74, 9, [ [ 0, 0.04 ], [ 1, 0.02 ] ], [ 0.6, 0.9 ] ) ],
		anal: [ soft( 0.58, 0.78, 12, [ [ 0, 0.035 ], [ 1, 0.018 ] ], [ 0.6, 0.9 ] ) ],
		pectoral: { u: 0.2, y: 0.02, len: 0.1, base: 0.018, rays: 10, shape: 'pointed', spread: 0.4 },
		pelvic: { u: 0.45, len: 0.05, rays: 5 },
		caudal: { shape: 'forked', len: 0.17, span: 0.1, fork: 0.5, rays: 13 },
		iris: 0xd8d8c0, irid: 0.8, metal: 0.65,
	},

	// blue chromis: deep oval damselfish, deeply forked tail with long lobes
	chromis: {
		pattern: PATTERN.chromis, body: 0.76, sec: 2.1,
		top: [ [ 0, 0.005 ], [ 0.03, 0.03 ], [ 0.08, 0.07 ], [ 0.16, 0.12 ], [ 0.28, 0.158 ], [ 0.42, 0.168 ], [ 0.56, 0.153 ], [ 0.7, 0.118 ], [ 0.84, 0.074 ], [ 1, 0.05 ] ],
		bot: [ [ 0, 0.005 ], [ 0.03, 0.024 ], [ 0.08, 0.054 ], [ 0.16, 0.09 ], [ 0.28, 0.123 ], [ 0.42, 0.133 ], [ 0.56, 0.123 ], [ 0.7, 0.098 ], [ 0.84, 0.064 ], [ 1, 0.045 ] ],
		wid: [ [ 0, 0.005 ], [ 0.05, 0.03 ], [ 0.15, 0.05 ], [ 0.3, 0.058 ], [ 0.5, 0.053 ], [ 0.7, 0.04 ], [ 0.9, 0.024 ], [ 1, 0.02 ] ],
		mouth: { corner: 0.06, y: 0.0, tip: 0.004, protrude: 0 },
		eye: { u: 0.15, y: 0.05, r: 0.033 }, opercle: 0.27,
		scales: 0.028, scaleVis: 0.6, lateral: 0.55, arch: 0.15,
		dorsal: [ spiny( 0.3, 0.6, 12, [ [ 0, 0.05 ], [ 0.3, 0.075 ], [ 1, 0.07 ] ], [ 0.35, 0.5 ] ), soft( 0.6, 0.87, 11, [ [ 0, 0.08 ], [ 0.5, 0.085 ], [ 1, 0.035 ] ], [ 0.6, 1.1 ] ) ],
		anal: [ spiny( 0.56, 0.62, 2, [ [ 0, 0.04 ], [ 1, 0.06 ] ], [ 0.4, 0.5 ], 0.1 ), soft( 0.62, 0.86, 11, [ [ 0, 0.08 ], [ 0.4, 0.085 ], [ 1, 0.035 ] ], [ 0.6, 1.1 ] ) ],
		pectoral: { u: 0.3, y: - 0.01, len: 0.17, base: 0.035, rays: 17, shape: 'pointed', spread: 0.45 },
		pelvic: { u: 0.33, len: 0.12, rays: 6 },
		caudal: { shape: 'forked', len: 0.24, span: 0.19, fork: 0.35, rays: 17 },
		iris: 0x4a6a98, irid: 0.15, metal: 0.15,
	},

	// French / bluestriped grunts: robust, sloping head, forked tail
	grunt: {
		pattern: PATTERN.grunt, body: 0.81, sec: 2.2,
		top: [ [ 0, 0.005 ], [ 0.03, 0.026 ], [ 0.08, 0.055 ], [ 0.16, 0.093 ], [ 0.28, 0.13 ], [ 0.42, 0.143 ], [ 0.56, 0.135 ], [ 0.7, 0.105 ], [ 0.84, 0.068 ], [ 1, 0.048 ] ],
		bot: [ [ 0, 0.005 ], [ 0.03, 0.02 ], [ 0.08, 0.042 ], [ 0.16, 0.072 ], [ 0.28, 0.1 ], [ 0.42, 0.11 ], [ 0.56, 0.103 ], [ 0.7, 0.083 ], [ 0.84, 0.058 ], [ 1, 0.045 ] ],
		wid: [ [ 0, 0.005 ], [ 0.05, 0.028 ], [ 0.15, 0.05 ], [ 0.3, 0.06 ], [ 0.5, 0.056 ], [ 0.7, 0.042 ], [ 0.9, 0.026 ], [ 1, 0.021 ] ],
		mouth: { corner: 0.1, y: - 0.012, tip: - 0.006, protrude: 0 },
		eye: { u: 0.14, y: 0.048, r: 0.026 }, opercle: 0.28,
		scales: 0.02, scaleVis: 0.5, lateral: 0.45, arch: 0.15,
		dorsal: [ spiny( 0.31, 0.6, 12, [ [ 0, 0.05 ], [ 0.25, 0.085 ], [ 1, 0.045 ] ], [ 0.3, 0.55 ], 0.175 ), soft( 0.6, 0.84, 15, [ [ 0, 0.055 ], [ 0.5, 0.06 ], [ 1, 0.03 ] ], [ 0.6, 0.95 ] ) ],
		anal: [ spiny( 0.62, 0.67, 3, [ [ 0, 0.03 ], [ 1, 0.055 ] ], [ 0.4, 0.5 ], 0.1 ), soft( 0.67, 0.84, 8, [ [ 0, 0.065 ], [ 1, 0.03 ] ], [ 0.6, 0.9 ] ) ],
		pectoral: { u: 0.31, y: - 0.02, len: 0.16, base: 0.03, rays: 16, shape: 'pointed', spread: 0.4 },
		pelvic: { u: 0.34, len: 0.1, rays: 6 },
		caudal: { shape: 'forked', len: 0.19, span: 0.14, fork: 0.55, rays: 17 },
		iris: 0xc8a040, irid: 0.25, metal: 0.25,
	},

	// yellowtail snapper: slender, fusiform, very deeply forked tail
	yellowtail: {
		pattern: PATTERN.yellowtail, body: 0.77, sec: 2.1,
		top: [ [ 0, 0.004 ], [ 0.03, 0.02 ], [ 0.08, 0.045 ], [ 0.16, 0.074 ], [ 0.28, 0.099 ], [ 0.42, 0.108 ], [ 0.56, 0.099 ], [ 0.7, 0.077 ], [ 0.85, 0.051 ], [ 1, 0.037 ] ],
		bot: [ [ 0, 0.004 ], [ 0.03, 0.016 ], [ 0.08, 0.035 ], [ 0.16, 0.058 ], [ 0.28, 0.079 ], [ 0.42, 0.089 ], [ 0.56, 0.082 ], [ 0.7, 0.063 ], [ 0.85, 0.044 ], [ 1, 0.034 ] ],
		wid: [ [ 0, 0.004 ], [ 0.05, 0.02 ], [ 0.14, 0.036 ], [ 0.28, 0.047 ], [ 0.45, 0.047 ], [ 0.65, 0.038 ], [ 0.85, 0.026 ], [ 1, 0.017 ] ],
		mouth: { corner: 0.1, y: - 0.008, tip: - 0.003, protrude: 0.003 },
		eye: { u: 0.12, y: 0.038, r: 0.022 }, opercle: 0.26,
		scales: 0.016, scaleVis: 0.45, lateral: 0.42, arch: 0.12,
		dorsal: [ spiny( 0.33, 0.6, 10, [ [ 0, 0.04 ], [ 0.3, 0.06 ], [ 1, 0.04 ] ], [ 0.35, 0.55 ], 0.15 ), soft( 0.6, 0.83, 13, [ [ 0, 0.045 ], [ 1, 0.025 ] ], [ 0.6, 0.95 ] ) ],
		anal: [ spiny( 0.62, 0.66, 3, [ [ 0, 0.025 ], [ 1, 0.04 ] ], [ 0.4, 0.5 ], 0.1 ), soft( 0.66, 0.82, 9, [ [ 0, 0.05 ], [ 1, 0.025 ] ], [ 0.6, 0.9 ] ) ],
		pectoral: { u: 0.3, y: - 0.015, len: 0.15, base: 0.025, rays: 15, shape: 'pointed', spread: 0.4 },
		pelvic: { u: 0.34, len: 0.09, rays: 6 },
		caudal: { shape: 'forked', len: 0.23, span: 0.165, fork: 0.36, rays: 17 },
		iris: 0xd8a830, irid: 0.35, metal: 0.3,
	},

	// blue tang: disc-shaped surgeonfish, small mouth, long dorsal and anal fins, lunate tail
	tang: {
		pattern: PATTERN.tang, body: 0.8, sec: 2.0,
		top: [ [ 0, 0.006 ], [ 0.03, 0.04 ], [ 0.08, 0.1 ], [ 0.16, 0.16 ], [ 0.28, 0.21 ], [ 0.42, 0.232 ], [ 0.56, 0.22 ], [ 0.7, 0.17 ], [ 0.84, 0.095 ], [ 1, 0.042 ] ],
		bot: [ [ 0, 0.006 ], [ 0.03, 0.035 ], [ 0.08, 0.085 ], [ 0.16, 0.14 ], [ 0.28, 0.19 ], [ 0.42, 0.215 ], [ 0.56, 0.205 ], [ 0.7, 0.16 ], [ 0.84, 0.09 ], [ 1, 0.04 ] ],
		wid: [ [ 0, 0.005 ], [ 0.05, 0.025 ], [ 0.15, 0.04 ], [ 0.3, 0.046 ], [ 0.5, 0.043 ], [ 0.7, 0.033 ], [ 0.9, 0.02 ], [ 1, 0.015 ] ],
		mouth: { corner: 0.04, y: 0.006, tip: 0.006, protrude: 0 },
		eye: { u: 0.17, y: 0.085, r: 0.026 }, opercle: 0.27,
		scales: 0.0, scaleVis: 0.0, lateral: 0.75, arch: 0.1,
		dorsal: [ spiny( 0.22, 0.4, 9, [ [ 0, 0.04 ], [ 1, 0.07 ] ], [ 0.4, 0.5 ], 0.125 ), soft( 0.4, 0.9, 26, [ [ 0, 0.07 ], [ 0.6, 0.085 ], [ 1, 0.045 ] ], [ 0.55, 0.95 ] ) ],
		anal: [ spiny( 0.45, 0.52, 3, [ [ 0, 0.03 ], [ 1, 0.06 ] ], [ 0.4, 0.5 ], 0.1 ), soft( 0.52, 0.9, 24, [ [ 0, 0.07 ], [ 0.6, 0.08 ], [ 1, 0.045 ] ], [ 0.55, 0.95 ] ) ],
		pectoral: { u: 0.3, y: 0.0, len: 0.15, base: 0.03, rays: 16, shape: 'pointed', spread: 0.45 },
		pelvic: { u: 0.3, len: 0.07, rays: 5 },
		caudal: { shape: 'lunate', len: 0.2, span: 0.19, fork: 0.55, rays: 16 },
		iris: 0x2a3a78, irid: 0.1, metal: 0.05,
	},

	// sergeant major: deep damselfish, forked tail
	sergeant: {
		pattern: PATTERN.sergeant, body: 0.79, sec: 2.1,
		top: [ [ 0, 0.005 ], [ 0.03, 0.032 ], [ 0.08, 0.075 ], [ 0.16, 0.13 ], [ 0.28, 0.175 ], [ 0.42, 0.19 ], [ 0.56, 0.176 ], [ 0.7, 0.138 ], [ 0.84, 0.085 ], [ 1, 0.055 ] ],
		bot: [ [ 0, 0.005 ], [ 0.03, 0.026 ], [ 0.08, 0.06 ], [ 0.16, 0.103 ], [ 0.28, 0.143 ], [ 0.42, 0.155 ], [ 0.56, 0.143 ], [ 0.7, 0.113 ], [ 0.84, 0.073 ], [ 1, 0.05 ] ],
		wid: [ [ 0, 0.005 ], [ 0.05, 0.03 ], [ 0.15, 0.05 ], [ 0.3, 0.057 ], [ 0.5, 0.052 ], [ 0.7, 0.04 ], [ 0.9, 0.024 ], [ 1, 0.02 ] ],
		mouth: { corner: 0.06, y: - 0.004, tip: 0.0, protrude: 0 },
		eye: { u: 0.15, y: 0.055, r: 0.03 }, opercle: 0.28,
		scales: 0.026, scaleVis: 0.55, lateral: 0.6, arch: 0.15,
		dorsal: [ spiny( 0.3, 0.6, 13, [ [ 0, 0.05 ], [ 0.3, 0.07 ], [ 1, 0.065 ] ], [ 0.35, 0.5 ] ), soft( 0.6, 0.86, 13, [ [ 0, 0.075 ], [ 0.5, 0.08 ], [ 1, 0.035 ] ], [ 0.6, 1.0 ] ) ],
		anal: [ spiny( 0.56, 0.62, 2, [ [ 0, 0.04 ], [ 1, 0.06 ] ], [ 0.4, 0.5 ], 0.1 ), soft( 0.62, 0.85, 12, [ [ 0, 0.075 ], [ 0.5, 0.078 ], [ 1, 0.035 ] ], [ 0.6, 1.0 ] ) ],
		pectoral: { u: 0.3, y: - 0.01, len: 0.16, base: 0.035, rays: 18, shape: 'rounded', spread: 0.45 },
		pelvic: { u: 0.33, len: 0.11, rays: 6 },
		caudal: { shape: 'forked', len: 0.21, span: 0.17, fork: 0.6, rays: 17 },
		iris: 0xc0b060, irid: 0.1, metal: 0.15,
	},

	// bluehead wrasse: slender cigar shape, continuous low dorsal fin, truncate tail
	wrasse: {
		pattern: PATTERN.wrasse, body: 0.84, sec: 2.0,
		top: [ [ 0, 0.004 ], [ 0.03, 0.02 ], [ 0.08, 0.042 ], [ 0.18, 0.07 ], [ 0.32, 0.088 ], [ 0.5, 0.09 ], [ 0.68, 0.075 ], [ 0.85, 0.05 ], [ 1, 0.042 ] ],
		bot: [ [ 0, 0.004 ], [ 0.03, 0.018 ], [ 0.08, 0.038 ], [ 0.18, 0.063 ], [ 0.32, 0.08 ], [ 0.5, 0.082 ], [ 0.68, 0.068 ], [ 0.85, 0.046 ], [ 1, 0.04 ] ],
		wid: [ [ 0, 0.004 ], [ 0.05, 0.022 ], [ 0.15, 0.038 ], [ 0.3, 0.045 ], [ 0.5, 0.043 ], [ 0.7, 0.034 ], [ 0.9, 0.022 ], [ 1, 0.018 ] ],
		mouth: { corner: 0.07, y: - 0.004, tip: 0.0, protrude: 0 },
		eye: { u: 0.13, y: 0.03, r: 0.02 }, opercle: 0.25,
		scales: 0.02, scaleVis: 0.35, lateral: 0.55, arch: 0.25,
		dorsal: [ spiny( 0.28, 0.5, 8, [ [ 0, 0.03 ], [ 1, 0.035 ] ], [ 0.5, 0.6 ], 0.075 ), soft( 0.5, 0.85, 13, [ [ 0, 0.038 ], [ 1, 0.03 ] ], [ 0.6, 0.8 ] ) ],
		anal: [ soft( 0.56, 0.84, 14, [ [ 0, 0.03 ], [ 1, 0.028 ] ], [ 0.6, 0.8 ] ) ],
		pectoral: { u: 0.24, y: 0.0, len: 0.12, base: 0.024, rays: 13, shape: 'rounded', spread: 0.5 },
		pelvic: { u: 0.28, len: 0.06, rays: 5 },
		caudal: { shape: 'truncate', len: 0.16, span: 0.1, fork: 0.88, rays: 13 },
		iris: 0xd06a40, irid: 0.15, metal: 0.1,
	},

	// stoplight / queen parrotfish: robust, blunt beaked head, large scales, lunate tail
	parrot: {
		pattern: PATTERN.parrot, body: 0.82, sec: 2.2,
		top: [ [ 0, 0.012 ], [ 0.02, 0.035 ], [ 0.06, 0.068 ], [ 0.12, 0.098 ], [ 0.22, 0.128 ], [ 0.36, 0.143 ], [ 0.5, 0.14 ], [ 0.64, 0.118 ], [ 0.78, 0.088 ], [ 0.9, 0.066 ], [ 1, 0.058 ] ],
		bot: [ [ 0, 0.012 ], [ 0.02, 0.03 ], [ 0.06, 0.055 ], [ 0.12, 0.083 ], [ 0.22, 0.108 ], [ 0.36, 0.123 ], [ 0.5, 0.12 ], [ 0.64, 0.103 ], [ 0.78, 0.078 ], [ 0.9, 0.06 ], [ 1, 0.055 ] ],
		wid: [ [ 0, 0.01 ], [ 0.04, 0.038 ], [ 0.12, 0.062 ], [ 0.25, 0.077 ], [ 0.45, 0.075 ], [ 0.65, 0.06 ], [ 0.85, 0.04 ], [ 1, 0.029 ] ],
		mouth: { corner: 0.06, y: - 0.018, tip: - 0.012, protrude: 0 },
		eye: { u: 0.13, y: 0.052, r: 0.018 }, opercle: 0.27,
		scales: 0.034, scaleVis: 0.75, lateral: 0.55, arch: 0.3,
		dorsal: [ spiny( 0.28, 0.55, 9, [ [ 0, 0.035 ], [ 1, 0.04 ] ], [ 0.5, 0.6 ], 0.075 ), soft( 0.55, 0.84, 10, [ [ 0, 0.045 ], [ 1, 0.035 ] ], [ 0.6, 0.8 ] ) ],
		anal: [ spiny( 0.6, 0.64, 2, [ [ 0, 0.025 ], [ 1, 0.035 ] ], [ 0.5, 0.6 ], 0.075 ), soft( 0.64, 0.83, 9, [ [ 0, 0.04 ], [ 1, 0.032 ] ], [ 0.6, 0.8 ] ) ],
		pectoral: { u: 0.26, y: 0.0, len: 0.13, base: 0.03, rays: 13, shape: 'rounded', spread: 0.5 },
		pelvic: { u: 0.3, len: 0.07, rays: 5 },
		caudal: { shape: 'lunate', len: 0.18, span: 0.14, fork: 0.62, rays: 15 },
		iris: 0xd09030, irid: 0.1, metal: 0.05,
	},

	// French angelfish: tall disc, trailing dorsal and anal filaments, rounded tail
	angel: {
		pattern: PATTERN.angel, body: 0.82, sec: 2.0,
		top: [ [ 0, 0.006 ], [ 0.03, 0.045 ], [ 0.08, 0.11 ], [ 0.16, 0.18 ], [ 0.28, 0.24 ], [ 0.42, 0.262 ], [ 0.56, 0.25 ], [ 0.7, 0.205 ], [ 0.84, 0.13 ], [ 1, 0.06 ] ],
		bot: [ [ 0, 0.006 ], [ 0.03, 0.04 ], [ 0.08, 0.1 ], [ 0.16, 0.165 ], [ 0.28, 0.225 ], [ 0.42, 0.25 ], [ 0.56, 0.24 ], [ 0.7, 0.198 ], [ 0.84, 0.125 ], [ 1, 0.058 ] ],
		wid: [ [ 0, 0.005 ], [ 0.05, 0.025 ], [ 0.15, 0.04 ], [ 0.3, 0.046 ], [ 0.5, 0.043 ], [ 0.7, 0.034 ], [ 0.9, 0.02 ], [ 1, 0.016 ] ],
		mouth: { corner: 0.05, y: 0.004, tip: 0.006, protrude: 0 },
		eye: { u: 0.18, y: 0.075, r: 0.026 }, opercle: 0.3,
		scales: 0.03, scaleVis: 0.9, lateral: 0.7, arch: 0.1,
		dorsal: [ spiny( 0.34, 0.5, 9, [ [ 0, 0.035 ], [ 1, 0.07 ] ], [ 0.4, 0.55 ], 0.1 ), soft( 0.5, 0.95, 20, [ [ 0, 0.09 ], [ 0.7, 0.16 ], [ 0.85, 0.2 ], [ 1, 0.06 ] ], [ 0.7, 1.2 ] ) ],
		anal: [ spiny( 0.5, 0.58, 3, [ [ 0, 0.03 ], [ 1, 0.06 ] ], [ 0.4, 0.55 ], 0.1 ), soft( 0.58, 0.95, 18, [ [ 0, 0.09 ], [ 0.7, 0.15 ], [ 0.85, 0.19 ], [ 1, 0.06 ] ], [ 0.7, 1.2 ] ) ],
		pectoral: { u: 0.33, y: 0.0, len: 0.15, base: 0.035, rays: 18, shape: 'rounded', spread: 0.4 },
		pelvic: { u: 0.32, len: 0.14, rays: 6 },
		caudal: { shape: 'rounded', len: 0.18, span: 0.14, fork: 1, rays: 17 },
		iris: 0xd0a020, irid: 0.05, metal: 0.05,
	},

	// great barracuda: very elongate, pointed head with an underbite, two far-apart dorsal fins
	barracuda: {
		pattern: PATTERN.barracuda, body: 0.87, sec: 2.0,
		top: [ [ 0, 0.002 ], [ 0.03, 0.012 ], [ 0.08, 0.025 ], [ 0.16, 0.041 ], [ 0.28, 0.057 ], [ 0.42, 0.064 ], [ 0.58, 0.063 ], [ 0.72, 0.054 ], [ 0.85, 0.04 ], [ 0.95, 0.03 ], [ 1, 0.028 ] ],
		bot: [ [ 0, 0.002 ], [ 0.03, 0.014 ], [ 0.08, 0.028 ], [ 0.16, 0.044 ], [ 0.28, 0.057 ], [ 0.42, 0.063 ], [ 0.58, 0.061 ], [ 0.72, 0.051 ], [ 0.85, 0.038 ], [ 0.95, 0.028 ], [ 1, 0.026 ] ],
		wid: [ [ 0, 0.002 ], [ 0.04, 0.014 ], [ 0.12, 0.028 ], [ 0.25, 0.039 ], [ 0.45, 0.044 ], [ 0.65, 0.039 ], [ 0.85, 0.028 ], [ 1, 0.018 ] ],
		mouth: { corner: 0.14, y: - 0.006, tip: - 0.002, protrude: 0.012 },
		eye: { u: 0.12, y: 0.018, r: 0.012 }, opercle: 0.24,
		scales: 0.008, scaleVis: 0.25, lateral: 0.2, arch: 0.05,
		dorsal: [ spiny( 0.44, 0.5, 5, [ [ 0, 0.055 ], [ 1, 0.03 ] ], [ 0.35, 0.6 ], 0.1 ), soft( 0.74, 0.8, 9, [ [ 0, 0.05 ], [ 1, 0.02 ] ], [ 0.55, 0.9 ] ) ],
		anal: [ soft( 0.75, 0.81, 9, [ [ 0, 0.045 ], [ 1, 0.02 ] ], [ 0.55, 0.9 ] ) ],
		pectoral: { u: 0.3, y: - 0.015, len: 0.08, base: 0.016, rays: 12, shape: 'pointed', spread: 0.35 },
		pelvic: { u: 0.47, len: 0.05, rays: 6 },
		caudal: { shape: 'forked', len: 0.13, span: 0.1, fork: 0.55, rays: 17 },
		iris: 0xb8c0b0, irid: 0.5, metal: 0.55,
	},

	// red snapper: deep, pointed snout, big lips, slightly forked tail
	redSnapper: {
		pattern: PATTERN.redSnapper, body: 0.82, sec: 2.15,
		top: [ [ 0, 0.004 ], [ 0.02, 0.02 ], [ 0.06, 0.045 ], [ 0.12, 0.075 ], [ 0.2, 0.11 ], [ 0.3, 0.145 ], [ 0.42, 0.162 ], [ 0.55, 0.155 ], [ 0.68, 0.125 ], [ 0.8, 0.09 ], [ 0.9, 0.062 ], [ 1, 0.05 ] ],
		bot: [ [ 0, 0.004 ], [ 0.02, 0.018 ], [ 0.06, 0.035 ], [ 0.12, 0.06 ], [ 0.2, 0.09 ], [ 0.3, 0.115 ], [ 0.42, 0.132 ], [ 0.55, 0.128 ], [ 0.68, 0.1 ], [ 0.8, 0.07 ], [ 0.9, 0.054 ], [ 1, 0.048 ] ],
		wid: [ [ 0, 0.004 ], [ 0.03, 0.02 ], [ 0.1, 0.042 ], [ 0.2, 0.058 ], [ 0.35, 0.066 ], [ 0.5, 0.062 ], [ 0.65, 0.05 ], [ 0.8, 0.034 ], [ 0.92, 0.024 ], [ 1, 0.02 ] ],
		mouth: { corner: 0.11, y: - 0.012, tip: - 0.004, protrude: 0.004 },
		eye: { u: 0.135, y: 0.058, r: 0.022 }, opercle: 0.29,
		scales: 0.018, scaleVis: 0.7, lateral: 0.45, arch: 0.15,
		dorsal: [ spiny( 0.34, 0.62, 10, [ [ 0, 0.045 ], [ 0.3, 0.085 ], [ 1, 0.065 ] ], [ 0.3, 0.5 ], 0.175 ), soft( 0.62, 0.86, 14, [ [ 0, 0.075 ], [ 0.4, 0.078 ], [ 1, 0.035 ] ], [ 0.6, 0.95 ] ) ],
		anal: [ spiny( 0.64, 0.68, 3, [ [ 0, 0.03 ], [ 1, 0.05 ] ], [ 0.4, 0.5 ], 0.1 ), soft( 0.68, 0.84, 8, [ [ 0, 0.075 ], [ 1, 0.035 ] ], [ 0.6, 0.9 ] ) ],
		pectoral: { u: 0.34, y: - 0.02, len: 0.19, base: 0.034, rays: 16, shape: 'pointed', spread: 0.35 },
		pelvic: { u: 0.38, len: 0.11, rays: 6 },
		caudal: { shape: 'forked', len: 0.18, span: 0.13, fork: 0.78, rays: 17 },
		iris: 0xc83020, irid: 0.3, metal: 0.25,
	},

	// Nassau grouper: robust, big head and mouth, notched spiny dorsal, rounded tail
	grouper: {
		pattern: PATTERN.grouper, body: 0.84, sec: 2.2,
		top: [ [ 0, 0.006 ], [ 0.03, 0.03 ], [ 0.08, 0.06 ], [ 0.15, 0.094 ], [ 0.25, 0.128 ], [ 0.38, 0.148 ], [ 0.52, 0.146 ], [ 0.66, 0.126 ], [ 0.8, 0.094 ], [ 0.92, 0.07 ], [ 1, 0.06 ] ],
		bot: [ [ 0, 0.006 ], [ 0.03, 0.03 ], [ 0.08, 0.06 ], [ 0.15, 0.09 ], [ 0.25, 0.12 ], [ 0.38, 0.137 ], [ 0.52, 0.134 ], [ 0.66, 0.11 ], [ 0.8, 0.08 ], [ 0.92, 0.063 ], [ 1, 0.058 ] ],
		wid: [ [ 0, 0.006 ], [ 0.04, 0.035 ], [ 0.12, 0.064 ], [ 0.25, 0.079 ], [ 0.4, 0.081 ], [ 0.6, 0.07 ], [ 0.8, 0.05 ], [ 1, 0.03 ] ],
		mouth: { corner: 0.16, y: - 0.022, tip: - 0.01, protrude: 0.008 },
		eye: { u: 0.14, y: 0.07, r: 0.019 }, opercle: 0.33,
		scales: 0.011, scaleVis: 0.4, lateral: 0.55, arch: 0.2,
		dorsal: [ spiny( 0.3, 0.6, 11, [ [ 0, 0.04 ], [ 0.3, 0.07 ], [ 1, 0.055 ] ], [ 0.3, 0.45 ], 0.21 ), soft( 0.6, 0.85, 17, [ [ 0, 0.065 ], [ 0.5, 0.075 ], [ 1, 0.03 ] ], [ 0.55, 0.9 ] ) ],
		anal: [ spiny( 0.64, 0.68, 3, [ [ 0, 0.025 ], [ 1, 0.04 ] ], [ 0.4, 0.5 ], 0.125 ), soft( 0.68, 0.84, 8, [ [ 0, 0.065 ], [ 0.5, 0.07 ], [ 1, 0.035 ] ], [ 0.55, 0.9 ] ) ],
		pectoral: { u: 0.33, y: - 0.02, len: 0.16, base: 0.04, rays: 17, shape: 'rounded', spread: 0.4 },
		pelvic: { u: 0.35, len: 0.12, rays: 6 },
		caudal: { shape: 'rounded', len: 0.16, span: 0.11, fork: 1, rays: 15 },
		iris: 0x9a8a60, irid: 0.05, metal: 0.0,
	},

	// blackfin tuna: torpedo, narrow keeled tail stalk, finlets, sickle pectorals, lunate tail
	tuna: {
		pattern: PATTERN.tuna, body: 0.84, sec: 2.0,
		top: [ [ 0, 0.003 ], [ 0.03, 0.02 ], [ 0.08, 0.045 ], [ 0.15, 0.075 ], [ 0.26, 0.105 ], [ 0.38, 0.118 ], [ 0.5, 0.115 ], [ 0.62, 0.095 ], [ 0.74, 0.065 ], [ 0.86, 0.035 ], [ 0.95, 0.02 ], [ 1, 0.018 ] ],
		bot: [ [ 0, 0.003 ], [ 0.03, 0.018 ], [ 0.08, 0.04 ], [ 0.15, 0.065 ], [ 0.26, 0.092 ], [ 0.38, 0.105 ], [ 0.5, 0.102 ], [ 0.62, 0.085 ], [ 0.74, 0.058 ], [ 0.86, 0.032 ], [ 0.95, 0.018 ], [ 1, 0.016 ] ],
		wid: [ [ 0, 0.003 ], [ 0.04, 0.025 ], [ 0.12, 0.055 ], [ 0.25, 0.08 ], [ 0.4, 0.088 ], [ 0.55, 0.08 ], [ 0.7, 0.058 ], [ 0.85, 0.035 ], [ 0.95, 0.03 ], [ 1, 0.02 ] ],
		mouth: { corner: 0.085, y: - 0.008, tip: - 0.003, protrude: 0.003 },
		eye: { u: 0.1, y: 0.03, r: 0.022 }, opercle: 0.26,
		scales: 0.0, scaleVis: 0.0, lateral: 0.3, arch: 0.2,
		dorsal: [ spiny( 0.3, 0.47, 13, [ [ 0, 0.07 ], [ 0.3, 0.06 ], [ 1, 0.015 ] ], [ 0.45, 0.8 ], 0.1 ), soft( 0.52, 0.6, 12, [ [ 0, 0.1 ], [ 0.5, 0.05 ], [ 1, 0.015 ] ], [ 0.75, 1.1 ] ) ],
		anal: [ soft( 0.56, 0.63, 12, [ [ 0, 0.09 ], [ 0.5, 0.045 ], [ 1, 0.012 ] ], [ 0.75, 1.1 ] ) ],
		pectoral: { u: 0.3, y: 0.0, len: 0.2, base: 0.03, rays: 12, shape: 'falcate', spread: 0.3 },
		pelvic: { u: 0.32, len: 0.06, rays: 5 },
		caudal: { shape: 'lunate', len: 0.16, span: 0.25, fork: 0.25, rays: 19 },
		finlets: { from: 0.64, to: 0.95, dorsal: 8, ventral: 7 },
		iris: 0xc0a040, irid: 0.9, metal: 0.55,
	},

	// mahi-mahi (dolphinfish): blunt forehead, a dorsal fin along the whole back, forked tail
	mahi: {
		pattern: PATTERN.mahi, body: 0.83, sec: 2.0,
		top: [ [ 0, 0.016 ], [ 0.005, 0.075 ], [ 0.013, 0.12 ], [ 0.03, 0.148 ], [ 0.07, 0.16 ], [ 0.18, 0.154 ], [ 0.32, 0.134 ], [ 0.48, 0.112 ], [ 0.64, 0.088 ], [ 0.8, 0.06 ], [ 0.92, 0.036 ], [ 1, 0.026 ] ],
		bot: [ [ 0, 0.01 ], [ 0.03, 0.045 ], [ 0.08, 0.072 ], [ 0.15, 0.09 ], [ 0.3, 0.096 ], [ 0.45, 0.09 ], [ 0.6, 0.078 ], [ 0.75, 0.06 ], [ 0.9, 0.035 ], [ 1, 0.022 ] ],
		wid: [ [ 0, 0.008 ], [ 0.04, 0.034 ], [ 0.15, 0.05 ], [ 0.3, 0.052 ], [ 0.5, 0.045 ], [ 0.7, 0.035 ], [ 0.9, 0.02 ], [ 1, 0.015 ] ],
		mouth: { corner: 0.075, y: - 0.03, tip: - 0.02, protrude: 0.004 },
		eye: { u: 0.085, y: 0.012, r: 0.017 }, opercle: 0.22,
		scales: 0.007, scaleVis: 0.2, lateral: 0.25, arch: 0.25,
		dorsal: [ soft( 0.07, 0.97, 44, [ [ 0, 0.075 ], [ 0.08, 0.105 ], [ 0.3, 0.08 ], [ 0.8, 0.055 ], [ 1, 0.03 ] ], [ 0.35, 0.9 ] ) ],
		anal: [ soft( 0.5, 0.97, 24, [ [ 0, 0.055 ], [ 0.2, 0.06 ], [ 1, 0.03 ] ], [ 0.5, 0.9 ] ) ],
		pectoral: { u: 0.2, y: - 0.02, len: 0.11, base: 0.022, rays: 16, shape: 'pointed', spread: 0.4 },
		pelvic: { u: 0.22, len: 0.08, rays: 6 },
		caudal: { shape: 'forked', len: 0.17, span: 0.17, fork: 0.3, rays: 17 },
		iris: 0x8a8a50, irid: 0.6, metal: 0.25,
	},

	// white mullet: robust, blunt head, small mouth, two widely spaced dorsal fins, forked tail
	mullet: {
		pattern: PATTERN.mullet, body: 0.82, sec: 2.15,
		top: [ [ 0, 0.008 ], [ 0.03, 0.03 ], [ 0.08, 0.055 ], [ 0.16, 0.08 ], [ 0.28, 0.1 ], [ 0.42, 0.107 ], [ 0.56, 0.1 ], [ 0.7, 0.082 ], [ 0.84, 0.058 ], [ 1, 0.044 ] ],
		bot: [ [ 0, 0.008 ], [ 0.03, 0.028 ], [ 0.08, 0.05 ], [ 0.16, 0.072 ], [ 0.28, 0.088 ], [ 0.42, 0.093 ], [ 0.56, 0.086 ], [ 0.7, 0.07 ], [ 0.84, 0.05 ], [ 1, 0.04 ] ],
		wid: [ [ 0, 0.008 ], [ 0.04, 0.036 ], [ 0.12, 0.06 ], [ 0.25, 0.072 ], [ 0.42, 0.072 ], [ 0.6, 0.06 ], [ 0.8, 0.04 ], [ 1, 0.024 ] ],
		mouth: { corner: 0.055, y: - 0.004, tip: 0.0, protrude: 0 },
		eye: { u: 0.1, y: 0.024, r: 0.02 }, opercle: 0.25,
		scales: 0.024, scaleVis: 0.6, lateral: 0.3, arch: 0.0,
		dorsal: [ spiny( 0.44, 0.52, 4, [ [ 0, 0.06 ], [ 1, 0.035 ] ], [ 0.35, 0.6 ], 0.125 ), soft( 0.66, 0.74, 9, [ [ 0, 0.06 ], [ 1, 0.025 ] ], [ 0.55, 0.9 ] ) ],
		anal: [ soft( 0.62, 0.72, 11, [ [ 0, 0.055 ], [ 1, 0.025 ] ], [ 0.55, 0.9 ] ) ],
		pectoral: { u: 0.27, y: 0.03, len: 0.13, base: 0.022, rays: 16, shape: 'pointed', spread: 0.45 },
		pelvic: { u: 0.4, len: 0.08, rays: 6 },
		caudal: { shape: 'forked', len: 0.18, span: 0.13, fork: 0.6, rays: 15 },
		iris: 0xc8b890, irid: 0.5, metal: 0.55,
	},

	// Atlantic needlefish / houndfish: long toothed beak, dorsal and anal fins far back
	needlefish: {
		pattern: PATTERN.needlefish, body: 0.9, sec: 2.0,
		top: [ [ 0, 0.0015 ], [ 0.1, 0.0035 ], [ 0.17, 0.007 ], [ 0.22, 0.017 ], [ 0.28, 0.026 ], [ 0.4, 0.032 ], [ 0.6, 0.034 ], [ 0.78, 0.03 ], [ 0.9, 0.02 ], [ 1, 0.014 ] ],
		bot: [ [ 0, 0.0015 ], [ 0.1, 0.0035 ], [ 0.17, 0.007 ], [ 0.22, 0.016 ], [ 0.28, 0.024 ], [ 0.4, 0.03 ], [ 0.6, 0.032 ], [ 0.78, 0.028 ], [ 0.9, 0.019 ], [ 1, 0.013 ] ],
		wid: [ [ 0, 0.0015 ], [ 0.1, 0.003 ], [ 0.18, 0.008 ], [ 0.24, 0.02 ], [ 0.4, 0.026 ], [ 0.7, 0.024 ], [ 0.9, 0.016 ], [ 1, 0.012 ] ],
		mouth: { corner: 0.2, y: 0.0, tip: 0.0, protrude: 0.006 },
		eye: { u: 0.235, y: 0.008, r: 0.012 }, opercle: 0.3,
		scales: 0.0, scaleVis: 0.0, lateral: - 0.7, arch: 0.0,
		dorsal: [ soft( 0.76, 0.9, 14, [ [ 0, 0.04 ], [ 0.2, 0.035 ], [ 1, 0.018 ] ], [ 0.6, 0.95 ] ) ],
		anal: [ soft( 0.73, 0.89, 18, [ [ 0, 0.04 ], [ 0.2, 0.035 ], [ 1, 0.018 ] ], [ 0.6, 0.95 ] ) ],
		pectoral: { u: 0.33, y: 0.006, len: 0.06, base: 0.01, rays: 12, shape: 'pointed', spread: 0.35 },
		pelvic: { u: 0.62, len: 0.04, rays: 6 },
		caudal: { shape: 'forked', len: 0.1, span: 0.06, fork: 0.75, rays: 15 },
		iris: 0xd0d8c8, irid: 0.6, metal: 0.55,
	},

	// bar jack: compressed, pointed snout, sickle pectorals, deeply forked tail
	jack: {
		pattern: PATTERN.jack, body: 0.78, sec: 2.0,
		top: [ [ 0, 0.004 ], [ 0.03, 0.024 ], [ 0.08, 0.055 ], [ 0.16, 0.088 ], [ 0.28, 0.114 ], [ 0.42, 0.12 ], [ 0.56, 0.107 ], [ 0.7, 0.078 ], [ 0.84, 0.042 ], [ 0.94, 0.024 ], [ 1, 0.02 ] ],
		bot: [ [ 0, 0.004 ], [ 0.03, 0.02 ], [ 0.08, 0.046 ], [ 0.16, 0.074 ], [ 0.28, 0.098 ], [ 0.42, 0.105 ], [ 0.56, 0.094 ], [ 0.7, 0.068 ], [ 0.84, 0.037 ], [ 0.94, 0.022 ], [ 1, 0.019 ] ],
		wid: [ [ 0, 0.004 ], [ 0.05, 0.022 ], [ 0.15, 0.04 ], [ 0.3, 0.048 ], [ 0.5, 0.044 ], [ 0.7, 0.032 ], [ 0.88, 0.02 ], [ 1, 0.016 ] ],
		mouth: { corner: 0.09, y: - 0.006, tip: - 0.002, protrude: 0.002 },
		eye: { u: 0.12, y: 0.03, r: 0.024 }, opercle: 0.26,
		scales: 0.008, scaleVis: 0.2, lateral: 0.35, arch: 0.45,
		dorsal: [ spiny( 0.34, 0.46, 8, [ [ 0, 0.045 ], [ 0.3, 0.05 ], [ 1, 0.02 ] ], [ 0.4, 0.7 ], 0.15 ), soft( 0.47, 0.84, 27, [ [ 0, 0.075 ], [ 0.15, 0.06 ], [ 1, 0.025 ] ], [ 0.55, 1.05 ] ) ],
		anal: [ spiny( 0.54, 0.57, 2, [ [ 0, 0.02 ], [ 1, 0.03 ] ], [ 0.5, 0.6 ], 0.15 ), soft( 0.58, 0.84, 24, [ [ 0, 0.065 ], [ 0.15, 0.05 ], [ 1, 0.022 ] ], [ 0.55, 1.05 ] ) ],
		pectoral: { u: 0.29, y: 0.0, len: 0.2, base: 0.024, rays: 19, shape: 'falcate', spread: 0.35 },
		pelvic: { u: 0.31, len: 0.07, rays: 6 },
		caudal: { shape: 'forked', len: 0.22, span: 0.19, fork: 0.25, rays: 17 },
		iris: 0xc8c0a0, irid: 0.7, metal: 0.5,
	},

	// tarpon: big silver scales, upturned mouth with the lower jaw jutting, dorsal filament
	tarpon: {
		pattern: PATTERN.tarpon, body: 0.8, sec: 2.05,
		top: [ [ 0, 0.004 ], [ 0.03, 0.02 ], [ 0.08, 0.045 ], [ 0.16, 0.075 ], [ 0.28, 0.1 ], [ 0.42, 0.11 ], [ 0.56, 0.102 ], [ 0.7, 0.08 ], [ 0.84, 0.052 ], [ 1, 0.036 ] ],
		bot: [ [ 0, 0.004 ], [ 0.03, 0.022 ], [ 0.08, 0.05 ], [ 0.16, 0.078 ], [ 0.28, 0.098 ], [ 0.42, 0.105 ], [ 0.56, 0.098 ], [ 0.7, 0.077 ], [ 0.84, 0.05 ], [ 1, 0.034 ] ],
		wid: [ [ 0, 0.004 ], [ 0.05, 0.025 ], [ 0.15, 0.044 ], [ 0.3, 0.052 ], [ 0.5, 0.05 ], [ 0.7, 0.04 ], [ 0.88, 0.026 ], [ 1, 0.018 ] ],
		mouth: { corner: 0.13, y: 0.004, tip: 0.018, protrude: 0.014 },
		eye: { u: 0.09, y: 0.028, r: 0.022 }, opercle: 0.22,
		scales: 0.05, scaleVis: 1.0, lateral: 0.05, arch: 0.05,
		dorsal: [ soft( 0.45, 0.56, 13, [ [ 0, 0.07 ], [ 0.6, 0.06 ], [ 0.93, 0.05 ], [ 1, 0.2 ] ], [ 0.45, 0.95 ] ) ],
		anal: [ soft( 0.64, 0.78, 20, [ [ 0, 0.07 ], [ 0.3, 0.05 ], [ 1, 0.02 ] ], [ 0.5, 0.95 ] ) ],
		pectoral: { u: 0.24, y: - 0.06, len: 0.13, base: 0.02, rays: 13, shape: 'pointed', spread: 0.5 },
		pelvic: { u: 0.43, len: 0.08, rays: 9 },
		caudal: { shape: 'forked', len: 0.2, span: 0.17, fork: 0.35, rays: 19 },
		iris: 0xc0c0b0, irid: 0.3, metal: 0.8,
	},

	// rays and the turtle: geometry from CreatureGeometry.js; these entries only feed the skin table
	stingray: { pattern: PATTERN.stingray, body: 1, eye: { u: 0.3, y: 0.05, r: 0.012 }, opercle: 0.4, mouth: { corner: 0.1, y: - 0.03, tip: - 0.03 }, lateral: 0, arch: 0, scales: 0, scaleVis: 0, iris: 0x606040, irid: 0, metal: 0 },
	eagleRay: { pattern: PATTERN.eagleRay, body: 1, eye: { u: 0.2, y: 0.05, r: 0.014 }, opercle: 0.3, mouth: { corner: 0.1, y: - 0.03, tip: - 0.03 }, lateral: 0, arch: 0, scales: 0, scaleVis: 0, iris: 0x404040, irid: 0, metal: 0 },
	turtle: { pattern: PATTERN.turtle, body: 1, eye: { u: 0.1, y: 0.04, r: 0.013 }, opercle: 0.2, mouth: { corner: 0.05, y: 0.0, tip: 0.0 }, lateral: 0, arch: 0, scales: 0, scaleVis: 0, iris: 0x302010, irid: 0, metal: 0 },

};

// Skin colours (sRGB): back, flank, belly, fins, fin edges; the shader adds the species'
// markings (stripes, bars, spots) on top.
export const SKIN = {
	silverside: { back: 0x6d8a7a, flank: 0xc4ccce, belly: 0xe6eaea, fin: 0xa8b4ae, edge: 0x98a4a0, rough: 0.3 },
	chromis: { back: 0x173a78, flank: 0x2764b8, belly: 0x5588c4, fin: 0x2d62b0, edge: 0x0c1424, rough: 0.4 },
	grunt: { back: 0xa88a2c, flank: 0xdcbc3a, belly: 0xe6ddb0, fin: 0xd8ac30, edge: 0xc89a24, rough: 0.4 },
	yellowtail: { back: 0x566a92, flank: 0x9ea6be, belly: 0xefe6e4, fin: 0xdcc676, edge: 0xe2c040, rough: 0.35 },
	tang: { back: 0x12296c, flank: 0x2242a0, belly: 0x2a4aa8, fin: 0x243f96, edge: 0x6aa2dc, rough: 0.45 },
	sergeant: { back: 0xc4ac3c, flank: 0xc6cabc, belly: 0xe6e6dc, fin: 0xaaaa98, edge: 0x8a8a80, rough: 0.4 },
	wrasse: { back: 0xd4bc1e, flank: 0xe4cc3c, belly: 0xeeeed4, fin: 0xdcca96, edge: 0xc8b070, rough: 0.4 },
	parrot: { back: 0x1d6a4c, flank: 0x2e9a7a, belly: 0x6cbc9c, fin: 0x3c9a7a, edge: 0xcc7a5a, rough: 0.4 },
	angel: { back: 0x0e0e12, flank: 0x121216, belly: 0x16161a, fin: 0x0e0e12, edge: 0x2c2410, rough: 0.45 },
	barracuda: { back: 0x36464c, flank: 0xb4bcc0, belly: 0xe6eaec, fin: 0x5a6464, edge: 0x2c3434, rough: 0.3 },
	redSnapper: { back: 0xb83a3c, flank: 0xd86a6a, belly: 0xeeccc4, fin: 0xcc3c34, edge: 0xb82c24, rough: 0.33 },
	grouper: { back: 0x7a6248, flank: 0xb49c7c, belly: 0xd8ccb4, fin: 0x6e5a40, edge: 0x3c3024, rough: 0.4 },
	tuna: { back: 0x0e1628, flank: 0x66748a, belly: 0xd6dade, fin: 0x1e2630, edge: 0x161a22, rough: 0.28 },
	mahi: { back: 0x125c6a, flank: 0xcdb52a, belly: 0xefe29a, fin: 0x2c5c9c, edge: 0x1c4c9c, rough: 0.3 },
	mullet: { back: 0x485856, flank: 0xb4bcbe, belly: 0xe6eaea, fin: 0x848c8c, edge: 0x6c7474, rough: 0.33 },
	needlefish: { back: 0x36766c, flank: 0xb4cccc, belly: 0xeef2f2, fin: 0x76968e, edge: 0x46666c, rough: 0.3 },
	jack: { back: 0x56768c, flank: 0xbcc8d0, belly: 0xe6ecee, fin: 0x86949c, edge: 0x3c444c, rough: 0.3 },
	tarpon: { back: 0x364c5c, flank: 0xd4dadc, belly: 0xeef0f2, fin: 0x86949c, edge: 0x4c565c, rough: 0.28 },
	stingray: { back: 0x6c604c, flank: 0x7a6c56, belly: 0xd8d6d0, fin: 0x4c4236, edge: 0x8a7c66, rough: 0.5 },
	eagleRay: { back: 0x14181e, flank: 0x1c2028, belly: 0xe0e2e2, fin: 0x101418, edge: 0x2a2e36, rough: 0.35 },
	turtle: { back: 0x3e3220, flank: 0x86683a, belly: 0xc8b884, fin: 0x4a4238, edge: 0x9a9280, rough: 0.45 },
};

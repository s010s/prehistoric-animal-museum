import * as THREE from '../engine/index.js';
import { WORLD } from './WorldLayout.js';
import { mulberry32, Noise2D, smoothstep } from '../util/Noise.js';
import * as Geo from './reef/ReefGeometry.js';
import { ReefBatch } from './reef/ReefBatch.js';
import { createReefMaterials, createReefView, SURFACE, packColor } from './reef/ReefMaterials.js';
import { bandFade } from '../materials/LODFade.js';
import { createNoiseVolume } from './reef/ReefNoise.js';
import { FishSchools } from './Fish.js';

// Caribbean fringing reef around WORLD.reef, 1.5 - 12 m deep.
//
// Zonation (the swell arrives from the south, the island lies to the north):
//  - reef crest on the shallow platform: elkhorn stands, fire coral, brain and mustard
//    hill corals, sea fans rocking in the surge
//  - fore reef, seaward: spurs of coral framework separated by sand grooves running with
//    the swell; staghorn thickets, star coral mounds and lobes, brain corals, plate corals,
//    a forest of gorgonians (sea rods, plumes, whips, fans) and sponges (barrels deeper)
//  - back reef, shoreward: patch heads on sand and seagrass, finger and starlet corals,
//    urchins, rubble
//  - scattered patch reefs around the main reef, fading out into the sand
//
// Placement: a grid pass lays overlapping slabs of framework rock wherever the reef is dense,
// then three layers of dart-throwing samples (structure, colonies, small life) whose density
// follows the framework map and whose species mix follows the zone. Solid structures are
// rasterized into a height field that later organisms settle on, which also serves
// collisions (floorHeightAt) and the fish.
//
// Rendering: two ReefBatch render objects (opaque rocks and colonies; alpha-tested fans and
// plumes) plus one for the fish, each a single pipeline issuing one indirect draw per model
// and level of detail in use. Each frame the instances in range of the camera frustum pick a
// level of detail by distance relative to their size; the shadow pass draws low-detail
// proxies of the large structures near the camera only. Far from the reef nothing is drawn.

const TAU = Math.PI * 2;
const MAX_TOP = - 0.6; // nothing rises above this (m)
const SWELL = new THREE.Vector2( WORLD.swellDir.x, WORLD.swellDir.y ).normalize();
const CELL = 8; // culling cell (m)
const RANGE = 45; // underwater draw distance (m): beyond ~40 m the water leaves < 10% contrast
const RANGE_ABOVE = 35; // from above the water: farther away the surface mostly reflects
const RANGE_FAR = 110; // large structures (outcrops, big heads) seen from high above the water
const SOFT_RANGE = 40; // fans and plumes (alpha tested: expensive overdraw, faint at distance)
const SHADOW_RANGE = 22; // large structures cast shadows within this distance of the camera (m)
const SHADOW_SIZE = 0.6; // smallest radius (m) that casts shadows
const HF_CELL = 0.25; // height field resolution (m)
// the bay floor outside the reef region that gets its own scatter (placeBay)
const BAY = { x0: - 200, x1: 135, z0: - 48, z1: 175 };

// Models: procedural geometry at several levels of detail, shared by the types below.
//  variants: distinct models; lods: levels (default 3); soft: alpha-tested batch
//  shadow: the lowest level also casts shadows near the camera (it is also the height-field
//  stamp of solid types)
const MODELS = {
	rock: { gen: ( r, l ) => Geo.createMound( r, l, 'rock' ), variants: 2, shadow: true },
	slab: { gen: ( r, l ) => Geo.createMound( r, l, 'slab' ), variants: 2, lods: 4, shadow: true },
	boulder: { gen: ( r, l ) => Geo.createMound( r, l, 'boulder' ), variants: 1, shadow: true },
	knobby: { gen: ( r, l ) => Geo.createMound( r, l, 'knobby' ), variants: 1 },
	dome: { gen: Geo.createDome, variants: 1, shadow: true },
	lobes: { gen: Geo.createLobes, variants: 1, shadow: true },
	pillars: { gen: Geo.createPillars, variants: 1, shadow: true },
	elkhorn: { gen: Geo.createElkhorn, variants: 2, shadow: true },
	staghorn: { gen: Geo.createStaghorn, variants: 2 },
	fingers: { gen: Geo.createFingers, variants: 1 },
	blades: { gen: Geo.createBlades, variants: 1, lods: 2 },
	plates: { gen: Geo.createPlates, variants: 1, shadow: true },
	rod: { gen: Geo.createSeaRod, variants: 2 },
	whip: { gen: Geo.createWhips, variants: 1 },
	barrel: { gen: Geo.createBarrel, variants: 1, shadow: true },
	tubes: { gen: ( r, l ) => Geo.createTubes( r, l, false ), variants: 1 },
	vase: { gen: ( r, l ) => Geo.createTubes( r, l, true ), variants: 1 },
	rope: { gen: Geo.createRopes, variants: 1 },
	urchin: { gen: Geo.createUrchin, variants: 1, lods: 2 },
	anemone: { gen: Geo.createAnemone, variants: 1, lods: 2 },
	rubble: { gen: Geo.createRubble, variants: 1 },
	grass: { gen: Geo.createSeagrass, variants: 1, lods: 2 },
	fan: { gen: Geo.createSeaFan, variants: 2, soft: true },
	plume: { gen: Geo.createSeaPlume, variants: 2, soft: true },
	// the deeper slope and wall
	lettuce: { gen: Geo.createLettuce, variants: 2 },
	wallPlates: { gen: Geo.createWallPlates, variants: 2, shadow: true },
	wire: { gen: Geo.createWireCoral, variants: 2 },
	blackCoral: { gen: Geo.createBlackCoral, variants: 1 },
	ear: { gen: Geo.createEarSponge, variants: 2 },
	// plants
	meadow: { gen: Geo.createMeadow, variants: 3 },
	halimeda: { gen: Geo.createHalimeda, variants: 2 },
	penicillus: { gen: Geo.createPenicillus, variants: 1, lods: 2 },
	sargassum: { gen: Geo.createSargassum, variants: 2 },
	// small life on the sand
	starfish: { gen: Geo.createStarfish, variants: 2, lods: 2 },
	cucumber: { gen: Geo.createCucumber, variants: 2, lods: 2 },
	conch: { gen: Geo.createConch, variants: 1, lods: 2 },
};

// Organism types.
//  model, surface (shading model), flex (sway amount), warp (per-colony shape warp of massive forms)
//  scale: size range; sy / sxz: vertical / horizontal stretch ranges
//  lod: [ LOD0, LOD1, cull ] or [ LOD0, LOD1, LOD2, cull ] distances in units of the instance radius
//  solid: stamped into the height field (others settle on it)
//  align: growth axis between vertical (0) and the surface normal (1); sink: burial (fraction of height)
//  flat: massive forms spread instead of growing above MAX_TOP
//  c1, c2: colour palettes (sRGB albedo; the water column takes away the reds); warm: shift of the
//  palette toward the red-brown pigments of living tissue (default 0.5)
const TYPES = {
	slab: { warp: 0.04, model: 'slab', surface: SURFACE.rock, scale: [ 2.2, 4.8 ], sy: [ 0.6, 1.1 ], sxz: [ 0.75, 1.3 ], lod: [ 1.5, 4, 10, 200 ], solid: true, align: 0.6, sink: 0.12, flat: 0.4,
		c1: [ 0x8e7c6a, 0x867262, 0x968270, 0x7e6c60, 0x8c786a ], c2: [ 0xb07a92, 0xba88a0, 0xa4708a, 0xc496a8, 0xa87088 ] },
	rock: { warp: 0.05, model: 'rock', surface: SURFACE.rock, scale: [ 1.0, 3.6 ], sy: [ 0.6, 1.1 ], sxz: [ 0.8, 1.25 ], lod: [ 3, 10, 200 ], solid: true, align: 0.3, sink: 0.14, flat: 0.45,
		c1: [ 0x8c7a68, 0x827060, 0x947e6c, 0x7a6a5c, 0x887464 ], c2: [ 0xb07a92, 0xbc8aa2, 0xa06c86, 0xc898ac, 0xa47c92 ] },
	boulder: { warp: 0.1, model: 'boulder', surface: SURFACE.star, scale: [ 0.8, 2.6 ], sy: [ 0.6, 1.1 ], sxz: [ 0.85, 1.2 ], lod: [ 3, 10, 200 ], solid: true, align: 0.6, sink: 0.05, flat: 0.5,
		c1: [ 0xae8e56, 0xa4885a, 0x98885a, 0xb49660, 0x9e8250, 0x8e8456 ], c2: [ 0x8c9068, 0x84886a, 0xb4a078 ] },
	lobes: { warp: 0.06, model: 'lobes', surface: SURFACE.star, scale: [ 0.8, 1.8 ], sy: [ 0.8, 1.3 ], sxz: [ 0.85, 1.2 ], lod: [ 3.5, 12, 200 ], solid: true, align: 0.4, sink: 0.03, flat: 0.6,
		c1: [ 0xb09460, 0xb89c68, 0xa48a5c, 0xac8e58 ], c2: [ 0x8e9068, 0xc0ac86 ] },
	brain: { warp: 0.12, model: 'dome', surface: SURFACE.brain, scale: [ 0.35, 1.3 ], sy: [ 0.75, 1.15 ], sxz: [ 0.85, 1.2 ], lod: [ 6, 20, 110 ], solid: true, align: 0.7, sink: 0.04, flat: 0.55,
		c1: [ 0xb89c60, 0xac9258, 0xc0a468, 0xa0925c, 0xb49660 ], c2: [ 0x6e6e4c, 0x7a6a4c, 0x646a52 ] },
	brainWide: { warp: 0.1, model: 'dome', surface: SURFACE.brainWide, scale: [ 0.8, 2.0 ], sy: [ 0.6, 1.0 ], sxz: [ 0.85, 1.2 ], lod: [ 5, 18, 160 ], solid: true, align: 0.6, sink: 0.05, flat: 0.5,
		c1: [ 0x9a7650, 0xa8845a, 0x8c6c4e, 0x9c7c56 ], c2: [ 0x7a8468, 0x8e8c70, 0xa89a74 ] },
	starlet: { warp: 0.1, model: 'dome', surface: SURFACE.porites, scale: [ 0.25, 0.8 ], sy: [ 0.7, 1.1 ], sxz: [ 0.85, 1.2 ], lod: [ 6, 20, 80 ], solid: true, align: 0.7, sink: 0.05, flat: 0.5,
		c1: [ 0xa87858, 0xb08262, 0x9a7058, 0xa47a5c ], c2: [ 0x86624a ] },
	knobby: { warp: 0.08, model: 'knobby', surface: SURFACE.porites, scale: [ 0.25, 0.85 ], sy: [ 0.6, 1.1 ], sxz: [ 0.8, 1.25 ], lod: [ 6, 20, 80 ], solid: true, align: 0.7, sink: 0.05, flat: 0.5,
		c1: [ 0x9c8244, 0x947a40, 0x8c8046, 0xa2884c, 0x907a42 ], c2: [ 0x7e7640 ] },
	pillar: { model: 'pillars', surface: SURFACE.pillar, scale: [ 0.8, 1.4 ], sy: [ 0.8, 1.2 ], sxz: [ 0.9, 1.1 ], lod: [ 5, 18, 200 ], solid: true, align: 0.1, sink: 0.02,
		c1: [ 0xb09470, 0xb89c78, 0xa48a68 ], c2: [ 0xd8c8a8 ] },
	elkhorn: { model: 'elkhorn', surface: SURFACE.acropora, scale: [ 1.0, 2.4 ], sy: [ 0.7, 1.0 ], sxz: [ 0.85, 1.2 ], lod: [ 5, 18, 200 ], solid: true, align: 0.2, sink: 0.03,
		c1: [ 0xb48440, 0xac7c3a, 0xa07438, 0xbc8e4c, 0xa87a40 ], c2: [ 0xd8c8a0, 0xe0d2ac ] },
	staghorn: { model: 'staghorn', surface: SURFACE.acropora, scale: [ 0.8, 1.5 ], sy: [ 0.8, 1.2 ], sxz: [ 0.85, 1.2 ], lod: [ 5, 18, 120 ], align: 0.15, sink: 0.03,
		c1: [ 0xb89462, 0xac8a5a, 0xc09c6a, 0xa4885e, 0xb09468 ], c2: [ 0xf0e8d8, 0xe4dcc8 ] },
	finger: { model: 'fingers', surface: SURFACE.finger, scale: [ 0.9, 1.9 ], sy: [ 0.8, 1.3 ], sxz: [ 0.85, 1.2 ], lod: [ 6, 20, 70 ], align: 0.5, sink: 0.02,
		c1: [ 0xb09a80, 0xb8a084, 0xa4928a, 0xb0a07c ], c2: [ 0xd8ccb8, 0xd0c4c8 ] },
	fire: { model: 'blades', surface: SURFACE.fire, scale: [ 0.7, 1.5 ], sy: [ 0.8, 1.2 ], sxz: [ 0.85, 1.2 ], lod: [ 6, 20, 70 ], align: 0.4, sink: 0.02,
		c1: [ 0xd0a858, 0xc49e50, 0xd4b064, 0xc09a52 ], c2: [ 0xf4ecd4 ] },
	plate: { warp: 0.05, model: 'plates', surface: SURFACE.plate, scale: [ 0.8, 1.8 ], sy: [ 0.8, 1.2 ], sxz: [ 0.85, 1.2 ], lod: [ 5, 18, 120 ], solid: true, align: 0.5, sink: 0.02,
		c1: [ 0x9a7c58, 0x8c7050, 0xa4845e, 0x927a54 ], c2: [ 0xd0c0a4 ] },
	rod: { model: 'rod', surface: SURFACE.gorgonian, flex: 0.25, scale: [ 0.65, 1.6 ], sy: [ 0.8, 1.2 ], sxz: [ 0.8, 1.2 ], lod: [ 4, 16, 60 ], align: 0.15, sink: 0.01,
		c1: [ 0x9a7a66, 0xa88a60, 0x8c6c70, 0xb08c62, 0x947c60, 0x9a7486, 0xac9868, 0x8a5a8c, 0x7a4c7e, 0xc0a062 ], c2: [ 0xc0b0a0, 0xc8b894, 0xb898c0 ] },
	whip: { model: 'whip', surface: SURFACE.gorgonian, flex: 0.5, scale: [ 0.6, 1.3 ], sy: [ 0.8, 1.2 ], sxz: [ 0.8, 1.2 ], lod: [ 5, 18, 90 ], align: 0.1, sink: 0.01,
		c1: [ 0x9a7248, 0x86583e, 0xa47e4a, 0x7a4a58 ], c2: [ 0xa88c60 ] },
	barrel: { warp: 0.06, model: 'barrel', surface: SURFACE.sponge, scale: [ 0.7, 1.5 ], sy: [ 0.8, 1.2 ], sxz: [ 0.9, 1.1 ], lod: [ 5, 18, 200 ], solid: true, align: 0.2, sink: 0.04,
		c1: [ 0x8c5040, 0x9a6050, 0x7c5448, 0x8a6258 ], c2: [ 0x60342a ] },
	tube: { model: 'tubes', surface: SURFACE.sponge, scale: [ 0.8, 1.6 ], sy: [ 0.8, 1.3 ], sxz: [ 0.9, 1.1 ], lod: [ 6, 20, 70 ], align: 0.2, sink: 0.02,
		c1: [ 0xd0b040, 0x9a6040, 0xd07030, 0xa49656, 0xc8a040, 0xb08a50, 0x8a5aa0 ], c2: [ 0x5a4020 ] },
	vase: { warm: 0, model: 'vase', surface: SURFACE.sponge, scale: [ 0.8, 1.5 ], sy: [ 0.8, 1.2 ], sxz: [ 0.9, 1.1 ], lod: [ 6, 20, 70 ], align: 0.2, sink: 0.02,
		c1: [ 0xa092cc, 0x9282c0, 0xaa90b8 ], c2: [ 0x6a5a98 ] },
	rope: { warm: 0, model: 'rope', surface: SURFACE.sponge, scale: [ 0.8, 1.5 ], sy: [ 0.9, 1.1 ], sxz: [ 0.9, 1.1 ], lod: [ 6, 20, 60 ], align: 0.5, sink: 0.0,
		c1: [ 0x86407a, 0x984040, 0x742e66 ], c2: [ 0x5a2a50 ] },
	urchin: { warm: 0, model: 'urchin', surface: SURFACE.urchin, scale: [ 0.8, 1.2 ], sy: [ 0.9, 1.1 ], sxz: [ 0.9, 1.1 ], lod: [ 8, 30, 60 ], align: 0.6, sink: 0.0,
		c1: [ 0x141014, 0x181418, 0x100c10 ], c2: [ 0x2a1a2a ] },
	anemone: { model: 'anemone', surface: SURFACE.anemone, flex: 0.35, scale: [ 0.9, 1.5 ], sy: [ 0.9, 1.1 ], sxz: [ 0.9, 1.1 ], lod: [ 8, 30, 50 ], align: 0.7, sink: 0.0,
		c1: [ 0xdccca8, 0xd0c0a0, 0xd8c8c0 ], c2: [ 0xc870a4, 0xa864b8, 0xd890a8 ] },
	rubble: { emerge: true, model: 'rubble', surface: SURFACE.rubble, scale: [ 0.8, 1.8 ], sy: [ 0.8, 1.2 ], sxz: [ 0.8, 1.2 ], lod: [ 6, 20, 50 ], align: 1.0, sink: 0.0,
		c1: [ 0xa09484 ], c2: [ 0xb07a92, 0xbc8aa2, 0x969460 ] },
	grass: { warm: 0, model: 'grass', surface: SURFACE.grass, flex: 0.6, scale: [ 0.8, 1.3 ], sy: [ 0.8, 1.2 ], sxz: [ 0.9, 1.1 ], lod: [ 6, 20, 70 ], align: 0.0, sink: 0.0,
		c1: [ 0x4c662c, 0x5a7032, 0x42582a, 0x52662e ], c2: [ 0x86784a ] },
	fan: { warm: 0, model: 'fan', surface: SURFACE.fan, flex: 0.38, scale: [ 0.4, 1.2 ], sy: [ 0.85, 1.15 ], sxz: [ 0.85, 1.15 ], lod: [ 5, 18, 130 ], align: 0.1, sink: 0.01, fan: true,
		c1: [ 0x7a4a80, 0x8a5890, 0x6a3a62, 0x9a6a92, 0xa89458, 0x8a7a48 ], c2: [ 0x5e2e60, 0x6e3e70, 0x7a6a40 ] },
	plume: { warm: 0, model: 'plume', surface: SURFACE.plume, flex: 0.55, scale: [ 0.65, 1.6 ], sy: [ 0.85, 1.2 ], sxz: [ 0.85, 1.15 ], lod: [ 5, 18, 110 ], align: 0.1, sink: 0.01,
		c1: [ 0x8a8a48, 0x7a7a40, 0x9a8a50, 0x8a7448, 0x6e3e6e, 0x7a4a62 ], c2: [ 0xaaa060, 0x9a7a60 ] },
	// lettuce coral: dense clumps of thin twisting blades (back reef and slope)
	lettuce: { warp: 0.03, model: 'lettuce', surface: SURFACE.lettuce, scale: [ 0.7, 1.7 ], sy: [ 0.8, 1.25 ], sxz: [ 0.85, 1.2 ], lod: [ 5, 16, 90 ], align: 0.4, sink: 0.02,
		c1: [ 0x9a7a48, 0xa88a50, 0x8c7244, 0xb09458, 0x7c7048 ], c2: [ 0xd8cca8, 0xc8b890 ] },
	// broad plates tiered down the deep slope, following it
	wallPlate: { warp: 0.03, model: 'wallPlates', surface: SURFACE.plate, scale: [ 0.8, 1.9 ], sy: [ 0.8, 1.15 ], sxz: [ 0.85, 1.2 ], lod: [ 5, 18, 160 ], solid: true, align: 0.7, sink: 0.02,
		c1: [ 0x8a6e50, 0x7c6448, 0x94785a, 0x806a54, 0x9a7e56 ], c2: [ 0xd4c4a4, 0xc8b89c ] },
	wire: { warm: 0.2, model: 'wire', surface: SURFACE.gorgonian, flex: 0.35, scale: [ 0.7, 1.3 ], sy: [ 0.9, 1.1 ], sxz: [ 0.9, 1.1 ], lod: [ 4, 14, 70 ], align: 0.55, sink: 0.01,
		c1: [ 0x8a7a50, 0x7a6a44, 0x9a7a4a, 0x6a6a48 ], c2: [ 0xa89868 ] },
	blackCoral: { warm: 0.2, model: 'blackCoral', surface: SURFACE.gorgonian, flex: 0.2, scale: [ 0.6, 1.4 ], sy: [ 0.85, 1.15 ], sxz: [ 0.85, 1.15 ], lod: [ 4, 14, 80 ], align: 0.4, sink: 0.01,
		c1: [ 0x6a6a3a, 0x7a6436, 0x5a5a38, 0x86703c ], c2: [ 0x9a8a50 ] },
	// elephant ear sponge: big orange / red plates on the slope
	ear: { warm: 0, model: 'ear', surface: SURFACE.sponge, scale: [ 0.6, 1.4 ], sy: [ 0.85, 1.2 ], sxz: [ 0.9, 1.1 ], lod: [ 5, 18, 120 ], align: 0.35, sink: 0.03,
		c1: [ 0xc0602c, 0xb8502a, 0xc87034, 0xa84830, 0xb86a3c ], c2: [ 0x6a2a1a ] },
	// the big barrels of the deep slope
	barrelDeep: { warp: 0.06, model: 'barrel', surface: SURFACE.sponge, scale: [ 1.2, 2.3 ], sy: [ 0.85, 1.25 ], sxz: [ 0.9, 1.1 ], lod: [ 5, 18, 250 ], solid: true, align: 0.25, sink: 0.04,
		c1: [ 0x8c5040, 0x9a6050, 0x7c5448, 0x8a6258, 0x946a58 ], c2: [ 0x60342a ] },
	fanDeep: { warm: 0, model: 'fan', surface: SURFACE.fan, flex: 0.22, scale: [ 0.9, 1.7 ], sy: [ 0.85, 1.15 ], sxz: [ 0.85, 1.15 ], lod: [ 5, 18, 160 ], align: 0.2, sink: 0.01, fan: true,
		c1: [ 0x7a4a80, 0x8a5890, 0x9a6a92, 0xa89458, 0xb09a5a, 0x9a4a60 ], c2: [ 0x5e2e60, 0x6e3e70, 0x7a6a40 ] },
	// plants: seagrass meadow patches (2 m across), calcareous green algae, Sargassum tufts
	meadow: { warm: 0, model: 'meadow', surface: SURFACE.grass, flex: 0.55, scale: [ 0.85, 1.2 ], sy: [ 0.75, 1.2 ], sxz: [ 0.85, 1.15 ], lod: [ 5, 13, 30 ], align: 0.8, sink: 0.0,
		c1: [ 0x6a8a3a, 0x78963e, 0x5e7e34, 0x82983f, 0x6e8838 ], c2: [ 0x9a8a52 ] },
	halimeda: { warm: 0, model: 'halimeda', surface: SURFACE.algae, flex: 0.12, scale: [ 0.8, 1.5 ], sy: [ 0.8, 1.3 ], sxz: [ 0.85, 1.15 ], lod: [ 6, 18, 50 ], align: 0.3, sink: 0.0,
		c1: [ 0x8aae4a, 0x7ea444, 0x9ab852, 0x76a046 ], c2: [ 0xd8dcb0 ] },
	penicillus: { warm: 0, model: 'penicillus', surface: SURFACE.algae, flex: 0.1, scale: [ 0.8, 1.4 ], sy: [ 0.8, 1.3 ], sxz: [ 0.9, 1.1 ], lod: [ 8, 40 ], align: 0.2, sink: 0.0,
		c1: [ 0x7a9a4a, 0x88a050, 0x6e8e44 ], c2: [ 0xd0d0b0 ] },
	// bay floor: limestone outcrops and boulders, half buried in the sand (seen from far above)
	bayRock: { far: true, warp: 0.06, model: 'rock', surface: SURFACE.rock, scale: [ 0.9, 3.2 ], sy: [ 0.5, 1.0 ], sxz: [ 0.75, 1.3 ], lod: [ 3, 10, 400 ], solid: true, align: 0.3, sink: 0.3, flat: 0.45,
		c1: [ 0x8c7a68, 0x7e6e5e, 0x948070, 0x76685a, 0x86766a ], c2: [ 0x9a7e6e, 0xa08a70, 0x8e8466 ] },
	baySlab: { far: true, warp: 0.04, model: 'slab', surface: SURFACE.rock, scale: [ 1.8, 4.2 ], sy: [ 0.45, 0.8 ], sxz: [ 0.75, 1.3 ], lod: [ 1.5, 4, 10, 400 ], solid: true, align: 0.7, sink: 0.2, flat: 0.4,
		c1: [ 0x8e7c6a, 0x847262, 0x7a6c5e, 0x8c7a66 ], c2: [ 0x9a8870, 0xa08a78, 0x8a8a68 ] },
	bayBoulder: { far: true, emerge: true, warp: 0.1, model: 'boulder', surface: SURFACE.rock, scale: [ 0.25, 1.1 ], sy: [ 0.55, 1.0 ], sxz: [ 0.8, 1.25 ], lod: [ 3, 10, 300 ], solid: true, align: 0.5, sink: 0.35, flat: 0.5,
		c1: [ 0x8a7866, 0x7c6c5c, 0x968474, 0x827262 ], c2: [ 0x9a8c72, 0x8c8468 ] },
	// shallow-water rocks along the beaches: the bigger ones break the surface at low water
	shoreRock: { far: true, emerge: true, warp: 0.06, model: 'rock', surface: SURFACE.rock, scale: [ 1.0, 2.8 ], sy: [ 0.55, 1.0 ], sxz: [ 0.75, 1.3 ], lod: [ 3, 10, 400 ], solid: true, align: 0.3, sink: 0.25, flat: 0.45,
		c1: [ 0x7a6c5e, 0x6e6254, 0x847464, 0x6a5e52, 0x76685a ], c2: [ 0x6e7450, 0x7a7a58, 0x86785a ] },
	starfish: { emerge: true, warm: 0.9, model: 'starfish', surface: SURFACE.anemone, scale: [ 0.8, 1.3 ], sy: [ 0.9, 1.1 ], sxz: [ 0.9, 1.1 ], lod: [ 10, 60 ], align: 1.0, sink: 0.0,
		c1: [ 0xd0602a, 0xc8702c, 0xd8803a, 0xb8502a, 0xc89040 ], c2: [ 0xe0b070 ] },
	cucumber: { warm: 0.3, model: 'cucumber', surface: SURFACE.sponge, scale: [ 0.8, 1.4 ], sy: [ 0.9, 1.1 ], sxz: [ 0.8, 1.2 ], lod: [ 10, 60 ], align: 1.0, sink: 0.05,
		c1: [ 0x3a2a1e, 0x4a3424, 0x2e2420, 0x5a4a30 ], c2: [ 0x2a1e18 ] },
	conch: { emerge: true, warm: 0.5, model: 'conch', surface: SURFACE.rubble, scale: [ 0.8, 1.3 ], sy: [ 0.9, 1.1 ], sxz: [ 0.9, 1.1 ], lod: [ 10, 60 ], align: 1.0, sink: 0.15,
		c1: [ 0xa09484 ], c2: [ 0xd8a090, 0xe0b098 ] },
	sargassum: { warm: 0, model: 'sargassum', surface: SURFACE.sargassum, flex: 0.9, scale: [ 0.7, 1.5 ], sy: [ 0.8, 1.3 ], sxz: [ 0.85, 1.15 ], lod: [ 5, 16, 60 ], align: 0.2, sink: 0.0,
		c1: [ 0x8a6a2a, 0x9a7a32, 0x7a5e26, 0xa08036, 0x806228 ], c2: [ 0x6a5a26 ] },
};

// Relative abundance of each type per zone and layer:
//   [ crest, fore reef (spurs and grooves), back reef (lagoon flats), patch reefs, deep slope ]
const LAYERS = [
	// structure: framework and large colonies (spacing in m)
	{ mode: 'structure', occ: 0, spacing: 2.0, allow: 0.45, types: {
		slab: [ 1.5, 1.2, 1.5, 1.5, 0.8 ], rock: [ 1.8, 1.8, 1.6, 2, 1.2 ], boulder: [ 1.2, 3, 0.7, 1.8, 2.0 ], lobes: [ 0.4, 2.4, 0.4, 1.2, 1.8 ], brainWide: [ 1.0, 1.5, 0.5, 1.0, 0.8 ],
		elkhorn: [ 5, 0.3, 0, 0, 0 ], barrel: [ 0, 0.5, 0, 0.1, 0.3 ], barrelDeep: [ 0, 0, 0, 0, 1.4 ], pillar: [ 0.05, 0.2, 0.02, 0.05, 0 ], plate: [ 0, 0.35, 0, 0.15, 0.4 ],
		wallPlate: [ 0, 0.1, 0, 0, 1.6 ], ear: [ 0, 0.1, 0, 0.05, 0.4 ],
	} },
	// colonies: medium corals and sponges, a few gorgonians
	{ mode: 'colony', occ: 1, spacing: 0.55, allow: 0.25, types: {
		brain: [ 1.2, 0.9, 0.5, 0.8, 0.5 ], knobby: [ 1.4, 0.7, 0.7, 0.7, 0.3 ], starlet: [ 0.3, 0.5, 1.0, 0.5, 0.3 ], staghorn: [ 0.8, 4, 0.5, 1.2, 0.3 ],
		finger: [ 0.5, 0.4, 2, 0.6, 0 ], fire: [ 1.2, 0.15, 0.2, 0.2, 0 ], plate: [ 0, 0.25, 0, 0.1, 0.6 ], lobes: [ 0.2, 0.8, 0.2, 0.5, 0.7 ],
		elkhorn: [ 2.5, 0.15, 0, 0, 0 ], lettuce: [ 0.3, 0.9, 0.9, 0.6, 0.8 ], wallPlate: [ 0, 0, 0, 0, 1.0 ],
		rod: [ 0.6, 1.0, 0.6, 0.8, 0.3 ], fan: [ 0.8, 0.5, 0.2, 0.5, 0.2 ], plume: [ 0.2, 0.6, 0.3, 0.4, 0.2 ],
		tube: [ 0.4, 1.6, 0.2, 0.7, 1.4 ], vase: [ 0.1, 0.8, 0, 0.3, 1.0 ], rope: [ 0.2, 0.7, 0.2, 0.4, 0.8 ], ear: [ 0, 0.3, 0, 0.1, 0.9 ], anemone: [ 0.2, 0.2, 0.15, 0.15, 0.05 ],
		sargassum: [ 1.6, 0.15, 0.5, 0.2, 0 ],
	} },
	// cover: colonies crowding onto the framework rock (a second pass, on rock only)
	{ mode: 'cover', occ: 1, spacing: 0.65, allow: 0.32, types: {
		brain: [ 1.0, 1.0, 0.8, 1.0, 0.6 ], brainWide: [ 0.3, 0.5, 0.2, 0.4, 0.4 ], knobby: [ 1.2, 0.8, 0.8, 0.8, 0.4 ], starlet: [ 0.3, 0.5, 0.8, 0.5, 0.4 ],
		lobes: [ 0.3, 1.2, 0.3, 0.8, 1.2 ], lettuce: [ 0.3, 0.9, 0.6, 0.6, 0.9 ], fire: [ 1.0, 0.2, 0.2, 0.2, 0 ], plate: [ 0, 0.3, 0, 0.1, 0.8 ], wallPlate: [ 0, 0, 0, 0, 1.4 ],
		tube: [ 0.3, 1.2, 0.2, 0.6, 1.2 ], vase: [ 0.1, 0.6, 0, 0.3, 0.9 ], rope: [ 0.2, 0.6, 0.2, 0.4, 0.6 ], ear: [ 0, 0.2, 0, 0.1, 0.7 ], sargassum: [ 1.4, 0.1, 0.4, 0.1, 0 ],
	} },
	// the gorgonian forest: sea rods, plumes, whips and fans rising between the colonies
	{ mode: 'forest', occ: 4, spacing: 0.75, allow: 0.3, types: {
		rod: [ 2.2, 3.6, 1.4, 2.4, 1.2 ], plume: [ 0.8, 2.4, 0.8, 1.4, 1.0 ], whip: [ 0.5, 1.3, 0.6, 1.0, 1.0 ], fan: [ 2.0, 1.2, 0.3, 0.9, 0.3 ],
		fanDeep: [ 0, 0.2, 0, 0.1, 2.2 ], wire: [ 0, 0.05, 0, 0, 1.2 ], blackCoral: [ 0, 0, 0, 0, 0.8 ],
	} },
	// small life, algae and debris
	{ mode: 'small', occ: 2, spacing: 0.4, allow: 0.25, types: {
		urchin: [ 0.3, 0.15, 0.4, 0.2, 0.05 ], rubble: [ 0.5, 0.8, 1.0, 0.7, 0.4 ], knobby: [ 0.3, 0.15, 0.2, 0.15, 0.1 ], brain: [ 0.15, 0.15, 0.1, 0.1, 0.1 ],
		rod: [ 0.4, 0.6, 0.3, 0.4, 0.3 ], fan: [ 0.3, 0.2, 0.1, 0.2, 0.2 ], finger: [ 0.2, 0.2, 0.6, 0.2, 0 ], starlet: [ 0.1, 0.15, 0.3, 0.15, 0.1 ],
		plume: [ 0.2, 0.3, 0.2, 0.2, 0.2 ], staghorn: [ 0.2, 0.8, 0.1, 0.2, 0 ], tube: [ 0.1, 0.35, 0.05, 0.15, 0.4 ], lettuce: [ 0.1, 0.3, 0.3, 0.2, 0.2 ],
		sargassum: [ 1.4, 0.1, 0.4, 0.1, 0 ], halimeda: [ 0.3, 0.25, 1.4, 0.5, 0.2 ], penicillus: [ 0.1, 0.05, 0.6, 0.2, 0 ],
	} },
];

// palette colour with per-colony variation; `warm` shifts it toward the red-brown pigments of
// living tissue (the water column removes most of the red again)
const hexColor = ( hex, rng, warm = 0 ) => {

	const c = new THREE.Color( hex ).offsetHSL( ( rng() - 0.5 ) * 0.04, ( rng() - 0.5 ) * 0.1, ( rng() - 0.5 ) * 0.1 );
	c.r *= 1 + 0.35 * warm;
	c.g *= 1 - 0.08 * warm;
	c.b *= 1 - 0.2 * warm;
	return c;

};

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _up = new THREE.Vector3( 0, 1, 0 );
const _m = new THREE.Matrix4(), _frustum = new THREE.Frustum(), _box = new THREE.Box3();

export class Reef {

	constructor( { scene, terrain, shoreField = null } ) {

		const t0 = performance.now();
		this.terrain = terrain;
		this.center = WORLD.reef.center.clone();
		this.radius = WORLD.reef.radius;
		this.group = new THREE.Group();
		this.group.name = 'Reef';
		scene.add( this.group );
		this.rng = mulberry32( 20260923 );
		this.noise = new Noise2D( 4242 );
		this.noise2 = new Noise2D( 977 );
		this.fft = null;
		this.timings = {};

		this.buildKinds();
		this.initFields();
		this.items = { hard: [], soft: [] };
		this.placeLayers();
		this.timings.place = performance.now() - t0;
		this.buildBatches();
		this.buildCells();

		this.fish = new FishSchools( {
			parent: this.group, terrain, center: this.center, radius: this.radius + 10,
			floorAt: ( x, z ) => this.floorHeightAt( x, z ),
			anchors: this.anchors,
			shoreField, // keeps the bay fish out of the breakers
		} );

		this.camera = null; // the main camera (seen in onBeforeRender)
		this._cullPos = new THREE.Vector3( Infinity, 0, 0 );
		this._cullQuat = new THREE.Quaternion();
		this._cullFrame = - 1;
		this.frame = 0;
		this.timings.total = performance.now() - t0;

	}

	// The ocean FFT: the gorgonians then sway with the actual swell. Call before the first render.
	setOcean( fft ) {

		this.fft = fft;

	}

	// Spray (fx/Spray.js): splashes of leaping fish and the whale's white water.
	setSpray( spray ) {

		this.fish.spray = spray;

	}

	// The humpback (world/marine/Whale.js): its escort of fish and its marks on the water.
	setWhale( whale ) {

		this.fish.setWhale( whale );

	}

	// ------------------------------------------------------------------ models

	buildKinds() {

		this.kinds = { hard: [], soft: [] };
		this.models = {}; // model -> [ { kind0, lods, radius, top, proxy, stamp } per variant ]
		let seed = 1;
		for ( const [ name, M ] of Object.entries( MODELS ) ) {

			const list = this.kinds[ M.soft ? 'soft' : 'hard' ];
			const nl = M.lods ?? 3;
			this.models[ name ] = [];
			for ( let v = 0; v < M.variants; v ++ ) {

				const s = seed ++ * 7919;
				const kind0 = list.length;
				let geo0 = null, low = null;
				for ( let l = 0; l < nl; l ++ ) {

					const g = M.gen( mulberry32( s ), l );
					if ( l === 0 ) geo0 = g;
					low = g;
					list.push( { geometry: g, type: name, lod: l } );

				}

				geo0.computeBoundingBox();
				const bb = geo0.boundingBox;
				const radius = Math.max( bb.max.x, - bb.min.x, bb.max.z, - bb.min.z, bb.max.y );
				const model = { kind0, lods: nl, radius, top: bb.max.y, proxy: - 1, stamp: low };
				if ( M.shadow ) {

					// low-detail copy drawn only in the shadow pass
					model.proxy = list.length;
					list.push( { geometry: low, type: name, lod: - 1, shadow: true, shadowOnly: true } );

				}

				this.models[ name ].push( model );

			}

		}

	}

	// ------------------------------------------------------------------ layout

	initFields() {

		const c = this.center;
		// region covered by the reef system
		this.x0 = c.x - 120;
		this.z0 = c.z - 70;
		this.x1 = c.x + 120;
		this.z1 = c.z + 115;
		// height field of solid structures (max y), for settling, collisions and the fish
		this.hx0 = this.x0;
		this.hz0 = Math.min( this.z0, BAY.z0 );
		this.hfW = Math.ceil( ( Math.max( this.x1, BAY.x1 ) - this.hx0 ) / HF_CELL );
		this.hfH = Math.ceil( ( this.z1 - this.hz0 ) / HF_CELL );
		this.hf = new Float32Array( this.hfW * this.hfH ).fill( - Infinity );
		// occupancy hash per layer ( x, z, r )
		this.occ = [ new Map(), new Map(), new Map(), new Map(), new Map() ]; // structure, colonies, small, meadow, forest
		this.occMax = [ 0, 0, 0, 0, 0 ];
		this.anchors = [];
		this.fields = [];
		this.fW = Math.ceil( this.x1 - this.x0 );
		this.fH = Math.ceil( this.z1 - this.z0 );

	}

	// swell-aligned coordinates relative to the reef centre: u seaward (south), v alongshore
	frameUV( x, z ) {

		const dx = x - this.center.x, dz = z - this.center.z;
		return [ - ( dx * SWELL.x + dz * SWELL.y ), - dx * SWELL.y + dz * SWELL.x ];

	}

	// Reef framework density (0 sand .. 1 continuous reef) and zone weights at x, z.
	habitat( x, z, out = {} ) {

		const n = this.noise, n2 = this.noise2;
		const depth = - this.terrain.heightAt( x, z );
		const [ u, v ] = this.frameUV( x, z );
		// main reef: elongated alongshore, ragged edges
		const ragged = n.fbm( x / 26, z / 26, 3 ) * 18 + n2.fbm( x / 8, z / 8, 2 ) * 4;
		const ru = u > 0 ? u / 72 : - u / 42, rv = v / 92;
		const main = 1 - smoothstep( 0.5, 1.0, Math.hypot( ru, rv ) + ragged / 90 );
		// fore reef: meandering spurs separated by narrower sand grooves that run with the swell
		const wv = v + n.fbm( u / 26 + 3.1, v / 26, 2 ) * 10 + n2.noise( u / 9, v / 9 ) * 2.5;
		const period = 12 + n2.noise( v / 40, 7.7 ) * 3;
		const ph = ( ( wv / period ) % 1 + 1 ) % 1;
		const grooveW = 0.1 + 0.07 * n.noise( u / 11 + 9, v / 11 ); // half width, fraction of the period
		const groove = 1 - smoothstep( grooveW, grooveW + 0.07, Math.abs( ph - 0.5 ) );
		const fore = smoothstep( 3, 14, u + ragged * 0.4 );
		// back reef: patch heads on sand and seagrass
		const back = smoothstep( - 4, - 20, u + ragged * 0.4 );
		const patchy = smoothstep( 0.0, 0.3, n.fbm( x / 12 + 7.7, z / 12 - 3.3, 3 ) + 0.1 );
		let f = main * ( 1 - fore * groove ) * ( 1 - back * ( 1 - patchy ) );
		// scattered patch reefs around the reef
		const patches = smoothstep( 0.38, 0.58, n2.fbm( x / 16 - 11, z / 16 + 5, 3 ) ) * ( 1 - main ) * ( 1 - smoothstep( 95, 130, Math.hypot( u * 0.9, v * 0.7 ) ) );
		f = Math.max( f, patches * 0.85 );
		// depth window (wandering, so it doesn't trace the isobaths): no swash, thinning out deep
		const dj = depth + n2.noise( x / 9 + 1.3, z / 9 ) * 0.35;
		// the deep slope below ~8 m: the spurs merge into a continuous slope of plates, barrels,
		// fans and black coral that thins out toward 20 m
		const deep = smoothstep( 7.5, 10.5, dj ) * ( 1 - back );
		const band = 1 - smoothstep( 1.0, 1.4, Math.hypot( ru, rv * 1.1 ) + ragged / 90 ); // seaward of the main reef
		f = Math.max( f, deep * band * smoothstep( - 0.35, 0.05, n.fbm( x / 14 - 21, z / 14 + 4, 3 ) ) * 0.95 );
		f *= smoothstep( 1.2, 1.75, dj ) * ( 1 - smoothstep( 16, 21, dj ) );
		// fade out well inside the region (no straight edges)
		f *= smoothstep( 0, 14, Math.min( x - this.x0, this.x1 - x, z - this.z0, this.z1 - z ) );
		out.f = Math.max( 0, Math.min( 1, f ) );
		out.depth = depth;
		// zone weights (crest, fore, back, patch, deep)
		const crest = ( 1 - smoothstep( 2.6, 4.2, dj ) ) * ( 1 - back ) * main;
		out.w0 = crest;
		out.w1 = main * ( 1 - crest ) * ( 1 - back * 0.8 ) * ( 1 - deep );
		out.w2 = main * back * ( 1 - crest * 0.5 );
		out.w3 = ( 1 - main ) * ( 1 - deep ) + 0.001;
		out.w4 = deep;
		out.u = u;
		out.v = v;
		return out;

	}

	// ------------------------------------------------------------------ height field

	hfIndex( x, z ) {

		const i = Math.floor( ( x - this.hx0 ) / HF_CELL ), j = Math.floor( ( z - this.hz0 ) / HF_CELL );
		if ( i < 0 || j < 0 || i >= this.hfW || j >= this.hfH ) return - 1;
		return j * this.hfW + i;

	}

	// top of solid structures at x, z (-Infinity if none)
	structureAt( x, z ) {

		const k = this.hfIndex( x, z );
		return k < 0 ? - Infinity : this.hf[ k ];

	}

	// seabed or the top of solid structures
	groundAt( x, z ) {

		return Math.max( this.terrain.heightAt( x, z ), this.structureAt( x, z ) );

	}

	// surface normal of the ground (finite differences over ~0.35 m)
	groundNormal( x, z, out ) {

		const e = 0.35;
		const hx = this.groundAt( x + e, z ) - this.groundAt( x - e, z );
		const hz = this.groundAt( x, z + e ) - this.groundAt( x, z - e );
		return out.set( - hx, 2 * e, - hz ).normalize();

	}

	// Rasterizes the triangles of an instance's low-detail model into the height field (with the
	// same per-colony warp as the vertex shader).
	stamp( geometry, it ) {

		const p = geometry.attributes.position.array, dat = geometry.attributes.aData.array, idx = geometry.index.array;
		_m.compose( _v.set( it.x, it.y, it.z ), it.q, _n.set( 1, 1, 1 ) );
		const e = _m.elements;
		const n = p.length / 3;
		const wx = this._stampX || ( this._stampX = new Float32Array( 8192 ) );
		const wy = this._stampY || ( this._stampY = new Float32Array( 8192 ) );
		const wz = this._stampZ || ( this._stampZ = new Float32Array( 8192 ) );
		const warp = it.flex < 0 ? - it.flex * it.s : 0, sd = it.seed * 17;
		const sx = it.s * it.sx, sy = it.s * it.sy, sz = it.s * it.sz;
		for ( let i = 0; i < n; i ++ ) {

			const lx = p[ i * 3 ], ly = p[ i * 3 + 1 ], lz = p[ i * 3 + 2 ];
			let x = lx * sx, y = ly * sy, z = lz * sz;
			if ( warp > 0 ) {

				const k = warp * ( dat[ i * 4 ] * 0.8 + 0.2 );
				const ax = lx * 3.1 + sd, ay = ly * 3.1 + sd, az = lz * 3.1 + sd;
				x += Math.sin( ay * 1.7 + az ) * k;
				y += Math.sin( az * 1.3 + ax * 1.1 ) * 0.6 * k;
				z += Math.sin( ax * 1.9 + ay * 0.7 ) * k;

			}

			wx[ i ] = e[ 0 ] * x + e[ 4 ] * y + e[ 8 ] * z + e[ 12 ];
			wy[ i ] = e[ 1 ] * x + e[ 5 ] * y + e[ 9 ] * z + e[ 13 ];
			wz[ i ] = e[ 2 ] * x + e[ 6 ] * y + e[ 10 ] * z + e[ 14 ];

		}

		const hf = this.hf, W = this.hfW, H = this.hfH, c = HF_CELL, x0 = this.hx0, z0 = this.hz0;
		for ( let t = 0; t < idx.length; t += 3 ) {

			const a = idx[ t ], b = idx[ t + 1 ], d = idx[ t + 2 ];
			const ax = wx[ a ], az = wz[ a ], bx = wx[ b ], bz = wz[ b ], dx = wx[ d ], dz = wz[ d ];
			const i0 = Math.max( 0, Math.floor( ( Math.min( ax, bx, dx ) - x0 ) / c ) ), i1 = Math.min( W - 1, Math.floor( ( Math.max( ax, bx, dx ) - x0 ) / c ) );
			const j0 = Math.max( 0, Math.floor( ( Math.min( az, bz, dz ) - z0 ) / c ) ), j1 = Math.min( H - 1, Math.floor( ( Math.max( az, bz, dz ) - z0 ) / c ) );
			const det = ( bz - dz ) * ( ax - dx ) + ( dx - bx ) * ( az - dz );
			if ( Math.abs( det ) < 1e-9 ) continue;
			for ( let j = j0; j <= j1; j ++ ) {

				const pz = z0 + ( j + 0.5 ) * c;
				for ( let i = i0; i <= i1; i ++ ) {

					const px = x0 + ( i + 0.5 ) * c;
					const l1 = ( ( bz - dz ) * ( px - dx ) + ( dx - bx ) * ( pz - dz ) ) / det;
					const l2 = ( ( dz - az ) * ( px - dx ) + ( ax - dx ) * ( pz - dz ) ) / det;
					const l3 = 1 - l1 - l2;
					if ( l1 < - 1e-4 || l2 < - 1e-4 || l3 < - 1e-4 ) continue;
					const y = l1 * wy[ a ] + l2 * wy[ b ] + l3 * wy[ d ];
					const k = j * W + i;
					if ( y > hf[ k ] ) hf[ k ] = y;

				}

			}

		}

	}

	// ------------------------------------------------------------------ placement

	occupied( layer, x, z, r, allow ) {

		const map = this.occ[ layer ];
		const reach = r + this.occMax[ layer ]; // the largest footprint in this layer so far
		const i0 = Math.floor( ( x - reach ) / 2 ), i1 = Math.floor( ( x + reach ) / 2 );
		const j0 = Math.floor( ( z - reach ) / 2 ), j1 = Math.floor( ( z + reach ) / 2 );
		for ( let i = i0; i <= i1; i ++ ) for ( let j = j0; j <= j1; j ++ ) {

			const list = map.get( i * 65536 + j );
			if ( ! list ) continue;
			for ( let k = 0; k < list.length; k += 3 ) {

				const dx = list[ k ] - x, dz = list[ k + 1 ] - z, rr = list[ k + 2 ];
				const min = ( rr + r ) * ( 1 - allow );
				if ( dx * dx + dz * dz < min * min ) return true;

			}

		}

		return false;

	}

	occupy( layer, x, z, r ) {

		const k = Math.floor( x / 2 ) * 65536 + Math.floor( z / 2 );
		const map = this.occ[ layer ];
		this.occMax[ layer ] = Math.max( this.occMax[ layer ], r );
		let list = map.get( k );
		if ( ! list ) map.set( k, list = [] );
		list.push( x, z, r );

	}

	// Places one instance of `name` at x, z; returns true when placed.
	place( name, x, z, rng, { layer = 1, allow = 0.25, onGround = false } = {} ) {

		const t = TYPES[ name ];
		const models = this.models[ t.model ];
		const model = models[ Math.floor( rng() * models.length ) ];
		const s0 = t.scale[ 0 ] + ( t.scale[ 1 ] - t.scale[ 0 ] ) * Math.pow( rng(), 1.3 );
		const sxz = t.sxz[ 0 ] + ( t.sxz[ 1 ] - t.sxz[ 0 ] ) * rng();
		let sy = t.sy[ 0 ] + ( t.sy[ 1 ] - t.sy[ 0 ] ) * rng();
		let s = s0;
		const foot = model.radius * s * 0.8;
		if ( this.occupied( layer, x, z, foot, allow ) ) return false;

		// settle on the seabed or on the structures below
		if ( this.terrain.heightAt( x, z ) > ( t.emerge ? - 0.35 : MAX_TOP - 0.3 ) ) return false;
		const ground = onGround ? ( x, z ) => this.terrain.heightAt( x, z ) : ( x, z ) => this.groundAt( x, z );
		let base = ground( x, z );
		// lowest point of (part of) the footprint so nothing floats on slopes
		const reach = foot * ( 0.6 - 0.45 * t.align );
		for ( let k = 0; k < 5; k ++ ) {

			const a = k * TAU / 5 + 0.3;
			base = Math.min( base, ground( x + Math.cos( a ) * reach, z + Math.sin( a ) * reach ) );

		}

		if ( onGround ) this.terrain.normalAt( x, z, _n );
		else this.groundNormal( x, z, _n );
		_v.copy( _up ).lerp( _n, t.align ).normalize();
		_q.setFromUnitVectors( _up, _v );
		let yaw = rng() * TAU;
		if ( t.fan ) yaw = Math.atan2( SWELL.x, SWELL.y ) + ( rng() - 0.5 ) * 0.7; // fans grow broadside to the surge
		_q2.setFromAxisAngle( _up, yaw );
		_q.multiply( _q2 );

		// keep below MAX_TOP: massive forms spread, others shrink
		const tilt = _v.y;
		let top = base + model.top * s * sy * tilt - t.sink * model.top * s * sy;
		if ( top > MAX_TOP && ! t.emerge ) {

			const room = MAX_TOP - base + t.sink * model.top * s * sy;
			const need = model.top * s * sy * tilt;
			let f = room / need;
			if ( t.flat && sy * f >= t.sy[ 0 ] * t.flat ) sy *= f;
			else {

				if ( t.flat ) {

					f = f * sy / ( t.sy[ 0 ] * t.flat );
					sy = t.sy[ 0 ] * t.flat;

				}

				s *= f;

			}

			if ( s < s0 * 0.4 || s < t.scale[ 0 ] * 0.4 ) return false;
			top = base + model.top * s * sy * tilt - t.sink * model.top * s * sy;
			if ( top > MAX_TOP + 0.01 ) return false;

		}

		const y = base - t.sink * model.top * s * sy;
		const c1 = hexColor( t.c1[ Math.floor( rng() * t.c1.length ) ], rng, t.warm ?? 0.5 );
		const c2 = hexColor( t.c2[ Math.floor( rng() * t.c2.length ) ], rng, t.warm ?? 0.5 );
		const item = {
			name, model, x, y, z, s, sx: sxz, sy, sz: 1 / sxz, q: _q.clone(),
			c1: packColor( c1 ), c2: packColor( c2 ), seed: rng(), flex: t.flex ? t.flex * ( 0.8 + rng() * 0.4 ) : - ( t.warp ?? 0 ) * ( 0.6 + rng() * 0.8 ),
			radius: model.radius * s * Math.max( sxz, 1 / sxz, sy ),
		};
		this.items[ MODELS[ t.model ].soft ? 'soft' : 'hard' ].push( item );
		this.occupy( layer, x, z, foot );
		if ( t.solid && model.stamp ) this.stamp( model.stamp, item );

		return true;

	}

	// The reef framework: overlapping low slabs of dead coral rock on the seabed wherever the
	// framework is dense (the spurs, the reef flat and the patch reefs), forming a continuous,
	// lumpy platform that the colonies then settle on.
	placeFramework( rng, stats ) {

		const hab = {};
		const step = 1.9;
		let n = 0;
		for ( let z = this.z0; z < this.z1; z += step ) for ( let x = this.x0; x < this.x1; x += step ) {

			const px = x + ( rng() - 0.5 ) * step, pz = z + ( rng() - 0.5 ) * step;
			this.habitat( px, pz, hab );
			const f = hab.f;
			if ( f < 0.3 || rng() > smoothstep( 0.3, 0.7, f ) ) continue;
			if ( this.place( 'slab', px, pz, rng, { layer: 0, allow: 0.72, onGround: true } ) ) n ++;

		}

		stats.framework = n;

	}

	placeLayers() {

		const rng = this.rng;
		const hab = {};
		const zones = [ 'w0', 'w1', 'w2', 'w3', 'w4' ];
		const W = this.x1 - this.x0, H = this.z1 - this.z0;
		const stats = {};
		let tt = performance.now();
		const lap = ( k ) => {

			const t = performance.now();
			this.timings[ k ] = t - tt;
			tt = t;

		};

		this.buildSkipGrid();
		lap( 'skip' );
		this.placeFramework( rng, stats );
		lap( 'framework' );
		LAYERS.forEach( ( L, li ) => {

			const names = Object.keys( L.types );
			const weights = names.map( ( k ) => L.types[ k ] );
			// dart throwing over the region; the acceptance follows the framework density
			const tries = Math.floor( W * H / ( L.spacing * L.spacing ) * 1.6 );
			const pick = new Float32Array( names.length );
			for ( let i = 0; i < tries; i ++ ) {

				const x = this.x0 + rng() * W, z = this.z0 + rng() * H;
				if ( this.skipAt( x, z ) <= 0.02 ) continue;
				this.habitatCached( x, z, hab );
				const f = hab.f;
				if ( f <= 0.02 ) continue;
				// dense framework in the structure layer; colonies crowd onto it (the cover pass only
				// on the rock), the gorgonian forest rises between them on the crest and fore reef
				const onRock = L.mode !== 'structure' && this.structureAt( x, z ) > this.terrain.heightAt( x, z ) + 0.05;
				let density;
				switch ( L.mode ) {

					case 'structure': density = Math.pow( f, 0.8 ); break;
					case 'colony': density = Math.pow( f, 0.6 ) * ( onRock ? 1 : 0.7 ); break;
					case 'cover': density = onRock ? Math.pow( f, 0.5 ) : 0; break;
					case 'forest': density = Math.pow( f, 0.7 ) * Math.min( 1, hab.w0 + hab.w1 + hab.w4 * 0.8 + hab.w3 * 0.6 + hab.w2 * 0.25 ); break;
					default: density = Math.pow( f, 0.5 ) * 0.9 * ( onRock ? 1 : 0.7 );

				}

				if ( rng() > density ) continue;
				let total = 0;
				for ( let k = 0; k < names.length; k ++ ) {

					let w = 0;
					for ( let zi = 0; zi < 5; zi ++ ) w += weights[ k ][ zi ] * hab[ zones[ zi ] ];
					w *= this.clusterWeight( names[ k ], x, z, hab );
					pick[ k ] = w;
					total += w;

				}

				if ( total <= 0 ) continue;
				let r = rng() * total, k = 0;
				while ( k < names.length - 1 && r > pick[ k ] ) r -= pick[ k ++ ];
				const name = names[ k ];
				if ( ! this.suits( name, hab ) ) continue;
				if ( this.place( name, x, z, rng, { layer: L.occ, allow: name === 'slab' ? 0.6 : L.allow } ) ) stats[ name ] = ( stats[ name ] || 0 ) + 1;

			}

			lap( L.mode );

		} );

		this.placeBay( rng, stats );
		lap( 'bay' );
		this.placeMeadows( rng, stats );
		lap( 'meadows' );
		this.placeAnchors();
		this.counts = stats;
		this.fields = null;
		this.skip = null;
		this.hc = null;

	}

	// Smooth noise fields sampled on a 1 m grid over the region, evaluated lazily and cached
	// (the placement passes query the clustering noise millions of times).
	field( slot, x, z ) {

		let f = this.fields[ slot ];
		if ( ! f ) f = this.fields[ slot ] = new Float32Array( this.fW * this.fH ).fill( NaN );
		const i = Math.min( this.fW - 1, Math.max( 0, Math.floor( x - this.x0 ) ) ), j = Math.min( this.fH - 1, Math.max( 0, Math.floor( z - this.z0 ) ) );
		const k = j * this.fW + i;
		let v = f[ k ];
		if ( v !== v ) {

			const a = this.x0 + i + 0.5, b = this.z0 + j + 0.5, n = this.noise;
			switch ( slot ) {

				case 0: v = n.fbm( a / 13 + 31, b / 13 - 7, 2 ); break; // staghorn thickets
				case 1: v = n.fbm( a / 15 - 17, b / 15 + 2, 2 ); break; // elkhorn stands
				case 2: v = n.fbm( a / 10 + 5, b / 10 + 9, 2 ); break; // gorgonian forests
				case 3: v = n.fbm( a / 7 - 3, b / 7 + 13, 2 ); break; // finger coral beds
				case 4: v = n.fbm( a / 9 + 41, b / 9 - 17, 2 ); break; // lettuce coral
				case 5: v = n.fbm( a / 6 - 27, b / 6 + 31, 2 ); break; // Sargassum
				default: v = n.fbm( a / 5 + 13, b / 5 + 57, 2 ); // green algae

			}

			f[ k ] = v;

		}

		return v;

	}

	// Patchiness per type: thickets, stands and forests instead of an even mix.
	clusterWeight( name, x, z, hab ) {

		switch ( name ) {

			case 'staghorn': return smoothstep( 0.05, 0.35, this.field( 0, x, z ) ) * 2.5 + 0.05;
			case 'elkhorn': return smoothstep( - 0.1, 0.3, this.field( 1, x, z ) ) * 2 + 0.1;
			case 'rod': case 'plume': case 'whip': return smoothstep( - 0.2, 0.3, this.field( 2, x, z ) ) * 1.6 + 0.3;
			case 'barrel': return smoothstep( 5, 8, hab.depth );
			case 'vase': case 'tube': return smoothstep( 3, 5, hab.depth ) + 0.1;
			case 'finger': return smoothstep( - 0.1, 0.3, this.field( 3, x, z ) ) * 2 + 0.1;
			case 'lettuce': return smoothstep( 0.0, 0.3, this.field( 4, x, z ) ) * 2.2 + 0.05;
			case 'sargassum': return smoothstep( - 0.05, 0.3, this.field( 5, x, z ) ) * 2.5 + 0.02;
			case 'halimeda': case 'penicillus': return smoothstep( - 0.1, 0.3, this.field( 6, x, z ) ) * 2 + 0.05;
			case 'wire': case 'blackCoral': return smoothstep( 9, 13, hab.depth );
			case 'barrelDeep': return smoothstep( 8, 12, hab.depth );
			default: return 1;

		}

	}

	// Upper bound of the framework density around x, z (2 m grid, dilated): lets the dart
	// throwing skip empty sand without evaluating the habitat.
	buildSkipGrid() {

		const c = 2;
		const W = Math.ceil( ( this.x1 - this.x0 ) / c ) + 1, H = Math.ceil( ( this.z1 - this.z0 ) / c ) + 1;
		const g = new Float32Array( W * H );
		const hab = {};
		for ( let j = 0; j < H; j ++ ) for ( let i = 0; i < W; i ++ ) g[ j * W + i ] = this.habitat( this.x0 + i * c, this.z0 + j * c, hab ).f;
		const d = new Float32Array( W * H );
		for ( let j = 0; j < H; j ++ ) for ( let i = 0; i < W; i ++ ) {

			let m = 0;
			for ( let b = Math.max( 0, j - 2 ); b <= Math.min( H - 1, j + 2 ); b ++ ) for ( let a = Math.max( 0, i - 2 ); a <= Math.min( W - 1, i + 2 ); a ++ ) m = Math.max( m, g[ b * W + a ] );
			d[ j * W + i ] = m;

		}

		this.skip = { W, H, c, d };

	}

	// habitat() cached on a 0.5 m grid (the dart throwing asks for it ~10^6 times)
	habitatCached( x, z, out ) {

		const c = 0.5;
		const W = this.hcW || ( this.hcW = Math.ceil( ( this.x1 - this.x0 ) / c ) ), H = this.hcH || ( this.hcH = Math.ceil( ( this.z1 - this.z0 ) / c ) );
		const cache = this.hc || ( this.hc = new Float32Array( W * H * 8 ).fill( NaN ) );
		const i = Math.min( W - 1, Math.max( 0, Math.floor( ( x - this.x0 ) / c ) ) ), j = Math.min( H - 1, Math.max( 0, Math.floor( ( z - this.z0 ) / c ) ) );
		const k = ( j * W + i ) * 8;
		if ( cache[ k ] !== cache[ k ] ) {

			this.habitat( this.x0 + ( i + 0.5 ) * c, this.z0 + ( j + 0.5 ) * c, out );
			cache[ k ] = out.f; cache[ k + 1 ] = out.depth; cache[ k + 2 ] = out.w0; cache[ k + 3 ] = out.w1;
			cache[ k + 4 ] = out.w2; cache[ k + 5 ] = out.w3; cache[ k + 6 ] = out.w4; cache[ k + 7 ] = out.u;
			return out;

		}

		out.f = cache[ k ]; out.depth = cache[ k + 1 ]; out.w0 = cache[ k + 2 ]; out.w1 = cache[ k + 3 ];
		out.w2 = cache[ k + 4 ]; out.w3 = cache[ k + 5 ]; out.w4 = cache[ k + 6 ]; out.u = cache[ k + 7 ];
		return out;

	}

	skipAt( x, z ) {

		const S = this.skip;
		const i = Math.round( ( x - this.x0 ) / S.c ), j = Math.round( ( z - this.z0 ) / S.c );
		if ( i < 0 || j < 0 || i >= S.W || j >= S.H ) return 0;
		return S.d[ j * S.W + i ];

	}

	// depth / exposure limits per type
	suits( name, hab ) {

		const d = hab.depth;
		switch ( name ) {

			case 'elkhorn': return d > 1.4 && d < 5.5;
			case 'fire': return d > 1.3 && d < 6;
			case 'staghorn': return d > 2.0;
			case 'barrel': return d > 4.5;
			case 'pillar': return d > 3;
			case 'plate': return d > 4;
			case 'vase': return d > 3;
			case 'plume': case 'whip': return d > 1.8;
			case 'lettuce': return d > 1.8;
			case 'wallPlate': case 'fanDeep': return d > 7;
			case 'wire': case 'barrelDeep': return d > 8;
			case 'blackCoral': return d > 11;
			case 'ear': return d > 5.5;
			case 'sargassum': return d < 4.5;
			case 'halimeda': return d < 13;
			case 'penicillus': return d < 7;
			default: return true;

		}

	}

	// Natural scatter over the bay floor and the other sandy bottoms outside the reef: limestone
	// outcrops and half-buried boulders in clusters, with rubble aprons and coral heads, sponges and
	// gorgonians settling on them; isolated heads and small life (urchins, cushion stars, sea
	// cucumbers, conchs) on the open sand; tufts of seagrass and green algae. Everything follows a
	// clustering noise with open sand between the patches: sparse near the swash, denser toward
	// the pier and in deeper water.
	placeBay( rng, stats ) {

		const T = this.terrain, n = this.noise, n2 = this.noise2;
		const P = WORLD.pier;
		const hab = {};
		const count = ( k ) => ( stats[ k ] = ( stats[ k ] || 0 ) + 1 );
		const inPier = ( x, z ) => ( Math.abs( x - P.x ) < 3.2 && z > P.zStart - 2 && z < P.zEnd + 1 ) || ( Math.abs( x - P.x ) < P.headWidth / 2 + 1.5 && z > P.zEnd - P.headDepth - 1.5 && z < P.zEnd + 1.5 );
		const density = ( x, z ) => {

			const d = - T.heightAt( x, z );
			if ( d < 0.7 || inPier( x, z ) ) return 0;
			// the reef has its own cover
			if ( x > this.x0 && x < this.x1 && z > this.z0 && z < this.z1 && this.habitatCached( x, z, hab ).f > 0.1 ) return 0;
			const deep = smoothstep( 0.5, 3.2, d ) * ( 1 - smoothstep( 16, 22, d ) );
			const dp = x - P.x;
			const nearPier = Math.exp( - ( dp * dp ) / ( 2 * 16 * 16 ) ) * smoothstep( P.zStart, P.zStart + 20, z );
			const cluster = smoothstep( - 0.12, 0.4, n.fbm( x / 30 + 17.3, z / 30 - 8.1, 3 ) + 0.3 * n2.fbm( x / 8 - 4.4, z / 8 + 2.2, 2 ) );
			return deep * cluster * ( 0.55 + 1.3 * nearPier );

		};

		const W = BAY.x1 - BAY.x0, H = BAY.z1 - BAY.z0;
		const colonies = [ 'brain', 'brain', 'starlet', 'knobby', 'knobby', 'tube', 'rope', 'rod', 'rod', 'fan', 'plume', 'urchin', 'urchin', 'anemone', 'vase', 'finger' ];
		const around = ( x, z, r0, r1, name, layer, allow ) => {

			const a = rng() * TAU, r = r0 + ( r1 - r0 ) * rng();
			const px = x + Math.cos( a ) * r, pz = z + Math.sin( a ) * r;
			if ( inPier( px, pz ) || - T.heightAt( px, pz ) < 0.45 ) return false;
			if ( ! this.suits( name, { depth: - T.heightAt( px, pz ) } ) ) return false;
			if ( this.place( name, px, pz, rng, { layer, allow } ) ) {

				count( 'bay_' + name );
				return true;

			}

			return false;

		};

		// outcrops and their communities, or seagrass / algae patches
		const tries = Math.floor( W * H / 7 );
		for ( let i = 0; i < tries; i ++ ) {

			const x = BAY.x0 + rng() * W, z = BAY.z0 + rng() * H;
			const dens = density( x, z );
			if ( dens <= 0 || rng() > Math.pow( dens, 0.7 ) ) continue;
			const depth = - T.heightAt( x, z );
			const rocky = n2.fbm( x / 22 + 3.3, z / 22 - 5.7, 2 ) > - 0.12 || depth < 2.4;
			if ( rocky ) {

				const pick = rng();
				const name = pick < 0.45 ? 'bayRock' : pick < 0.65 ? 'baySlab' : 'bayBoulder';
				if ( ! this.place( name, x, z, rng, { layer: 0, allow: 0.35, onGround: true } ) ) continue;
				count( name );
				// satellite boulders, a rubble apron, and life on the hard bits
				const k = 1 + Math.floor( rng() * 4 * dens + rng() * 2 );
				for ( let j = 0; j < k; j ++ ) around( x, z, 0.8, 3.5, 'bayBoulder', 0, 0.4 );
				for ( let j = 0; j < 2 + Math.floor( rng() * 3 ); j ++ ) around( x, z, 1.0, 4.5, 'rubble', 2, 0.5 );
				const life = Math.floor( ( 1 + rng() * 5 ) * Math.min( 1, depth / 3 ) );
				for ( let j = 0; j < life; j ++ ) around( x, z, 0.0, 2.2, colonies[ Math.floor( rng() * colonies.length ) ], 1, 0.3 );

			} else if ( depth > 2.4 ) {

				// seagrass tuft with ragged edges, green algae, a cucumber or a conch
				const k = 3 + Math.floor( rng() * 7 );
				for ( let j = 0; j < k; j ++ ) around( x, z, 0, 1.2 + k * 0.35, 'meadow', 3, 0.45 );
				for ( let j = 0; j < 2; j ++ ) if ( rng() < 0.6 ) around( x, z, 0.5, 3, rng() < 0.7 ? 'halimeda' : 'penicillus', 2, 0.3 );
				if ( rng() < 0.5 ) around( x, z, 0.5, 3, rng() < 0.6 ? 'cucumber' : 'conch', 2, 0.3 );

			}

		}

		// isolated coral heads and sponges on open sand
		for ( let i = 0, n1 = Math.floor( W * H / 16 ); i < n1; i ++ ) {

			const x = BAY.x0 + rng() * W, z = BAY.z0 + rng() * H;
			const dens = density( x, z );
			if ( dens <= 0 || rng() > dens * 0.5 ) continue;
			const name = [ 'brain', 'starlet', 'knobby', 'brainWide', 'tube', 'finger', 'staghorn' ][ Math.floor( rng() * 7 ) ];
			if ( ! this.suits( name, { depth: - T.heightAt( x, z ) } ) ) continue;
			if ( this.place( name, x, z, rng, { layer: 1, allow: 0.3, onGround: true } ) ) count( 'bay_' + name );

		}

		// the shallow strip along the beaches (0.45 - 3.2 m): isolated rocks and boulder groups (the
		// bigger rocks break the surface at low water), rubble, shells, a few coral heads and sponge
		// clumps; seagrass and algae only beyond the breakers. Clustered, with open sand between.
		for ( let i = 0, n4 = Math.floor( W * H / 2.5 ); i < n4; i ++ ) {

			const x = BAY.x0 + rng() * W, z = BAY.z0 + rng() * H;
			const d = - T.heightAt( x, z );
			if ( d < 0.45 || d > 3.2 || inPier( x, z ) ) continue;
			if ( x > this.x0 && x < this.x1 && z > this.z0 && z < this.z1 && this.habitatCached( x, z, hab ).f > 0.1 ) continue;
			const cl = smoothstep( 0.02, 0.38, n2.fbm( x / 18 - 31.7, z / 18 + 12.9, 3 ) + 0.25 * n.fbm( x / 6 + 5.5, z / 6 - 1.1, 2 ) );
			if ( rng() > cl * 0.9 ) continue;
			const r = rng();
			if ( r < 0.22 ) {

				if ( this.place( 'shoreRock', x, z, rng, { layer: 0, allow: 0.3, onGround: true } ) ) {

					count( 'shoreRock' );
					for ( let j = 0; j < 1 + Math.floor( rng() * 3 ); j ++ ) around( x, z, 0.8, 2.8, 'bayBoulder', 0, 0.4 );
					if ( rng() < 0.6 ) around( x, z, 0.6, 3, 'rubble', 2, 0.5 );
					if ( d > 1.2 && rng() < 0.5 ) around( x, z, 0, 1.6, rng() < 0.5 ? 'urchin' : 'knobby', 1, 0.3 );

				}

			} else if ( r < 0.45 ) {

				for ( let j = 0; j < 2 + Math.floor( rng() * 3 ); j ++ ) around( x, z, 0, 2.2, 'bayBoulder', 0, 0.4 );

			} else if ( r < 0.65 ) {

				for ( let j = 0; j < 2 + Math.floor( rng() * 3 ); j ++ ) around( x, z, 0, 2.5, 'rubble', 2, 0.5 );
				if ( rng() < 0.5 ) around( x, z, 0, 2, rng() < 0.5 ? 'conch' : 'starfish', 2, 0.3 );

			} else if ( r < 0.78 ) {

				around( x, z, 0, 1, rng() < 0.4 ? 'conch' : rng() < 0.5 ? 'starfish' : 'urchin', 2, 0.3 );

			} else if ( r < 0.9 ) {

				if ( d > 1.1 ) for ( let j = 0; j < 1 + Math.floor( rng() * 2 ); j ++ ) around( x, z, 0, 1.4, [ 'brain', 'starlet', 'knobby', 'knobby' ][ Math.floor( rng() * 4 ) ], 1, 0.3 );
				if ( d > 1.5 && rng() < 0.4 ) around( x, z, 0.5, 2, rng() < 0.6 ? 'tube' : 'rope', 1, 0.3 );

			} else if ( d > 2.4 ) {

				for ( let j = 0; j < 3 + Math.floor( rng() * 3 ); j ++ ) around( x, z, 0, 1.8, 'meadow', 3, 0.45 );
				if ( rng() < 0.5 ) around( x, z, 0.5, 2, 'halimeda', 2, 0.3 );

			} else {

				around( x, z, 0, 1.2, rng() < 0.5 ? 'halimeda' : 'penicillus', 2, 0.3 );

			}

		}

		// small life on the sand: cushion stars, sea cucumbers, conchs, urchins, rubble
		for ( let i = 0, n3 = Math.floor( W * H / 4 ); i < n3; i ++ ) {

			const x = BAY.x0 + rng() * W, z = BAY.z0 + rng() * H;
			const dens = density( x, z );
			if ( dens <= 0 || rng() > Math.sqrt( dens ) * 0.22 ) continue;
			const r = rng();
			const name = r < 0.3 ? 'starfish' : r < 0.5 ? 'cucumber' : r < 0.62 ? 'conch' : r < 0.8 ? 'urchin' : 'rubble';
			if ( this.place( name, x, z, rng, { layer: 2, allow: 0.3, onGround: name !== 'urchin' } ) ) count( 'bay_' + name );

		}

	}

	// Seagrass meadows: patches of turtle and manatee grass (2 m across) on the terrain's meadow
	// mask across the bay, 2 - 10 m deep (clear of the breakers along the beach and of the reef
	// framework), with calcareous green algae and a few urchins among them. The terrain's meadow
	// texture carries the far field (patches thin out and shrink into it beyond ~25 m).
	placeMeadows( rng, stats ) {

		const T = this.terrain;
		if ( ! T.seagrass ) return;
		const res = T.res;
		const mask = ( x, z ) => {

			const gi = Math.floor( x - T.origin ), gj = Math.floor( z - T.origin );
			if ( gi < 0 || gj < 0 || gi >= res || gj >= res ) return 0;
			return T.seagrass[ gj * res + gi ] / 255;

		};

		const hab = this._hab || ( this._hab = {} );
		const step = 1.5;
		let n = 0, algae = 0;
		for ( let z = - 40; z < 210; z += step ) for ( let x = - 210; x < 130; x += step ) {

			const px = x + ( rng() - 0.5 ) * step, pz = z + ( rng() - 0.5 ) * step;
			const r = rng(), r2 = rng();
			const depth = - T.heightAt( px, pz );
			if ( depth < 2.0 || depth > 11 ) continue;
			// the terrain's meadows, plus patchy beds on the sandy shallows beyond the surf zone
			// (from ~3 m: the bigger sets break in up to ~2.8 m of water); ragged edges
			const g = smoothstep( 0.2, 0.65, mask( px, pz ) ) * smoothstep( 2.0, 2.8, depth ) * ( 1 - smoothstep( 9, 11, depth ) );
			const bed = smoothstep( 0.02, 0.3, this.noise.fbm( px / 24 + 5.3, pz / 24 - 9.1, 3 ) ) * smoothstep( 3.0, 3.8, depth ) * ( 1 - smoothstep( 7, 9, depth ) );
			const pier = Math.abs( px - WORLD.pier.x ) < 4 && pz < WORLD.pier.zEnd + 3 ? 0 : 1;
			const dens = Math.max( g, bed * 0.9 ) * pier * ( 0.75 + 0.25 * this.noise2.noise( px / 5, pz / 5 ) );
			if ( r > dens ) continue;
			if ( this.structureAt( px, pz ) > T.heightAt( px, pz ) + 0.05 ) continue;
			if ( px > this.x0 && px < this.x1 && pz > this.z0 && pz < this.z1 && this.habitat( px, pz, hab ).f > 0.15 ) continue;
			if ( this.place( 'meadow', px, pz, rng, { layer: 3, allow: 0.45, onGround: true } ) ) n ++;
			// green algae and the odd urchin among the grass
			if ( r2 < 0.07 ) {

				const name = r2 < 0.045 ? 'halimeda' : r2 < 0.062 ? 'penicillus' : 'urchin';
				if ( this.place( name, px + ( rng() - 0.5 ) * 1.2, pz + ( rng() - 0.5 ) * 1.2, rng, { layer: 2, allow: 0.3, onGround: true } ) ) algae ++;

			}

		}

		stats.meadow = n;
		stats.meadowAlgae = algae;

	}

	// Coral heads for reef-associated fish: the largest solid structures.
	placeAnchors() {

		const near = ( it ) => Math.hypot( it.x - this.center.x, it.z - this.center.z ) < 42;
		const big = this.items.hard.filter( ( it ) => TYPES[ it.name ].solid && it.radius > 1.0 && near( it ) ).sort( ( a, b ) => b.radius - a.radius );
		for ( const it of big ) {

			if ( this.anchors.length >= 40 ) break;
			if ( this.anchors.some( ( a ) => Math.hypot( a[ 0 ] - it.x, a[ 1 ] - it.z ) < 7 ) ) continue;
			this.anchors.push( [ it.x, it.z ] );

		}

	}

	// ------------------------------------------------------------------ batches

	buildBatches() {

		this.batches = {};
		for ( const which of [ 'hard', 'soft' ] ) {

			const items = this.items[ which ];
			const batch = new ReefBatch( 'Reef.' + which, this.kinds[ which ], { maxInstances: items.length + 1, fade: true } );
			const d = batch.data;
			items.forEach( ( it, i ) => {

				const t = TYPES[ it.name ];
				it.range = this.drawDistance( it, which );
				d[ i * 16 ] = it.x;
				d[ i * 16 + 1 ] = it.y;
				d[ i * 16 + 2 ] = it.z;
				d[ i * 16 + 3 ] = it.s;
				d[ i * 16 + 4 ] = it.q.x;
				d[ i * 16 + 5 ] = it.q.y;
				d[ i * 16 + 6 ] = it.q.z;
				d[ i * 16 + 7 ] = it.q.w;
				d[ i * 16 + 8 ] = it.c1;
				d[ i * 16 + 9 ] = it.c2;
				d[ i * 16 + 10 ] = it.range + it.seed; // draw distance (integer m) + seed
				d[ i * 16 + 11 ] = t.surface;
				d[ i * 16 + 12 ] = it.sx;
				d[ i * 16 + 13 ] = it.sy;
				d[ i * 16 + 14 ] = it.sz;
				d[ i * 16 + 15 ] = it.flex;

			} );
			batch.upload();
			this.batches[ which ] = batch;

		}

		this.noise3D = createNoiseVolume();
		// the main camera and the draw distance, for the distance fade (the shadow pass has its own camera)
		this.viewBlock = createReefView();
		this.view = this.viewBlock.fields; // { position, range } handles (WGSL reefView.position / .range)
		this.view.position.value = new THREE.Vector3();
		this.view.range.value = RANGE;
		const mats = createReefMaterials( { hard: this.batches.hard, soft: this.batches.soft, getOcean: () => this.fft, noise: this.noise3D, view: this.viewBlock } );
		this.materials = mats;
		// level-of-detail cross-fades: dithered second draws of the instances in transition bands
		const fadeMats = createReefMaterials( { hard: this.batches.hard, soft: this.batches.soft, getOcean: () => this.fft, noise: this.noise3D, view: this.viewBlock, fade: true } );
		this.fadeMaterials = fadeMats;
		this.group.add( this.batches.hard.createFadeMesh( fadeMats.hard ), this.batches.soft.createFadeMesh( fadeMats.soft ) );
		const hard = this.batches.hard.createMesh( mats.hard, { castShadow: true } );
		const soft = this.batches.soft.createMesh( mats.soft );
		for ( const mesh of [ hard, soft ] ) {

			const cull = mesh.onBeforeRender;
			mesh.onBeforeRender = ( renderer, scene, camera, geometry, material, group ) => {

				if ( camera.isPerspectiveCamera ) {

					this.camera = camera;
					this.cull( camera );

				}

				cull( renderer, scene, camera, geometry, material, group );

			};
			this.group.add( mesh );

		}

	}

	// Distance (whole meters) beyond which an instance isn't drawn: by its type and size, capped
	// by the batch's draw distance.
	drawDistance( it, which ) {

		const lod = TYPES[ it.name ].lod;
		// large structures stay visible from high above the water (the underwater range still
		// limits them to RANGE when submerged)
		const cap = which === 'soft' ? SOFT_RANGE : TYPES[ it.name ].far || it.radius > 0.5 ? RANGE_FAR : RANGE;
		return Math.floor( Math.min( cap, lod[ lod.length - 1 ] * it.radius ) );

	}

	// Per-instance culling data, grouped in cells.
	buildCells() {

		this.cells = new Map();
		for ( const which of [ 'hard', 'soft' ] ) {

			const items = this.items[ which ];
			const n = items.length;
			const D = this[ which + 'Cull' ] = {
				x: new Float32Array( n ), y: new Float32Array( n ), z: new Float32Array( n ), r: new Float32Array( n ),
				d0: new Float32Array( n ), d1: new Float32Array( n ), d2: new Float32Array( n ), dmax: new Float32Array( n ),
				kind0: new Uint16Array( n ), lods: new Uint8Array( n ), proxy: new Int16Array( n ),
			};
			items.forEach( ( it, i ) => {

				const t = TYPES[ it.name ];
				const r = it.radius;
				D.x[ i ] = it.x;
				D.y[ i ] = it.y + r * 0.4;
				D.z[ i ] = it.z;
				D.r[ i ] = r;
				const four = t.lod.length === 4;
				D.d0[ i ] = t.lod[ 0 ] * r;
				D.d1[ i ] = t.lod[ 1 ] * r;
				D.d2[ i ] = four ? t.lod[ 2 ] * r : Infinity;
				D.dmax[ i ] = it.range;
				D.kind0[ i ] = it.model.kind0;
				D.lods[ i ] = it.model.lods;
				D.proxy[ i ] = it.model.proxy;
				const key = Math.floor( it.x / CELL ) * 4096 + Math.floor( it.z / CELL );
				let cell = this.cells.get( key );
				if ( ! cell ) this.cells.set( key, cell = { x: ( Math.floor( it.x / CELL ) + 0.5 ) * CELL, z: ( Math.floor( it.z / CELL ) + 0.5 ) * CELL, ymin: Infinity, ymax: - Infinity, r: 0, hard: [], soft: [] } );
				cell[ which ].push( i );
				cell.ymin = Math.min( cell.ymin, it.y );
				cell.ymax = Math.max( cell.ymax, it.y + r * 2 );
				cell.r = Math.max( cell.r, r );

			} );

		}

		this.cellList = [ ...this.cells.values() ];
		// extent of everything placed (the meadows reach beyond the reef region)
		this.extent = { x0: Infinity, x1: - Infinity, z0: Infinity, z1: - Infinity };
		for ( const c of this.cellList ) {

			c.hard = Uint32Array.from( c.hard );
			c.soft = Uint32Array.from( c.soft );
			this.extent.x0 = Math.min( this.extent.x0, c.x - CELL );
			this.extent.x1 = Math.max( this.extent.x1, c.x + CELL );
			this.extent.z0 = Math.min( this.extent.z0, c.z - CELL );
			this.extent.z1 = Math.max( this.extent.z1, c.z + CELL );

		}

	}

	// ------------------------------------------------------------------ runtime

	// Per frame: fish simulation, culling and levels of detail.
	update( dt, cameraPosition ) {

		this.frame ++;
		this.fish.update( dt, cameraPosition ?? null );
		if ( ! cameraPosition ) return;
		const p = cameraPosition;
		const e = this.extent;
		const dx = Math.max( e.x0 - p.x, 0, p.x - e.x1 ), dz = Math.max( e.z0 - p.z, 0, p.z - e.z1 );
		const near = Math.hypot( dx, dz ) < RANGE_FAR + 10 && p.y < 100;
		const hard = this.batches.hard, soft = this.batches.soft, fish = this.fish;
		// cull now with the camera seen in the last render (moved by the app for this frame
		// already): batches with nothing to draw are hidden, so far from the reef there are no
		// render objects at all
		const camera = this.camera;
		if ( near && camera ) {

			this.cull( camera );
			hard.mesh.visible = hard.visibleInstances > 0;
			soft.mesh.visible = soft.visibleInstances > 0;
			hard.mesh.castShadow = hard.shadowOffsets.length > 0;

		} else {

			hard.mesh.visible = near;
			soft.mesh.visible = near;
			if ( ! near ) hard.fadeMesh.visible = soft.fadeMesh.visible = false;

		}

		if ( camera && fish.mesh.visible ) {

			fish.cull( camera );
			fish.mesh.visible = fish.batch.visibleInstances > 0;

		}

	}

	// Picks the instances to draw for this camera and their levels of detail (once per frame:
	// from update(), or from the first render before the camera is known).
	cull( camera ) {

		if ( this._cullFrame === this.frame ) return;
		this._cullFrame = this.frame;
		const p = camera.position;
		// nothing changes while the camera is still
		if ( p.distanceToSquared( this._cullPos ) < 0.0025 && camera.quaternion.angleTo( this._cullQuat ) < 0.002 ) return;
		this._cullPos.copy( p );
		this._cullQuat.copy( camera.quaternion );
		camera.updateMatrixWorld();
		_m.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
		_frustum.setFromProjectionMatrix( _m, camera.coordinateSystem, camera.reversedDepth );
		// from above the water the range grows with the height: aerial views see the bay floor
		const range = p.y < 0.3 ? RANGE : Math.min( RANGE_FAR, RANGE_ABOVE + Math.max( 0, p.y ) * 1.4 );
		this.view.position.value.copy( p );
		this.view.range.value = range;
		const maxR = range + CELL;
		const cx = p.x, cy = p.y, cz = p.z;
		const hard = this.batches.hard, soft = this.batches.soft;
		hard.begin();
		soft.begin();
		for ( const cell of this.cellList ) {

			const dx = cell.x - cx, dz = cell.z - cz;
			if ( dx * dx + dz * dz > maxR * maxR ) continue;
			const pad = cell.r + 1;
			_box.min.set( cell.x - CELL * 0.5 - pad, cell.ymin - 0.5, cell.z - CELL * 0.5 - pad );
			_box.max.set( cell.x + CELL * 0.5 + pad, cell.ymax + 0.5, cell.z + CELL * 0.5 + pad );
			const visible = _frustum.intersectsBox( _box );
			const shadowCell = dx * dx + dz * dz < ( SHADOW_RANGE + CELL ) * ( SHADOW_RANGE + CELL );
			if ( ! visible && ! shadowCell ) continue;
			this.cullList( cell.hard, this.hardCull, hard, cx, cy, cz, range, visible );
			if ( visible ) this.cullList( cell.soft, this.softCull, soft, cx, cy, cz, range, true );

		}

		hard.commit();
		soft.commit();

	}

	cullList( ids, D, batch, cx, cy, cz, range, visible ) {

		for ( let k = 0; k < ids.length; k ++ ) {

			const i = ids[ k ];
			const dx = D.x[ i ] - cx, dy = D.y[ i ] - cy, dz = D.z[ i ] - cz;
			const d = Math.sqrt( dx * dx + dy * dy + dz * dz );
			// shadow proxies of large structures near the camera, in any direction
			if ( D.proxy[ i ] >= 0 && d < SHADOW_RANGE + D.r[ i ] && D.r[ i ] > SHADOW_SIZE ) batch.add( D.proxy[ i ], i );
			const dm = Math.min( D.dmax[ i ], range );
			if ( ! visible || d > dm ) continue;
			const lod = Math.min( d < D.d0[ i ] ? 0 : d < D.d1[ i ] ? 1 : d < D.d2[ i ] ? 2 : 3, D.lods[ i ] - 1 );
			const kind = D.kind0[ i ] + lod;
			// faded out (dithered) over the last tenth of the draw distance
			if ( d > dm * 0.9 ) {

				batch.addFade( kind, i, 1 - bandFade( d, dm * 0.9, dm ), false );
				continue;

			}

			// cross-faded into the next level over the last 12 % before its switch distance
			const sw = lod === 0 ? D.d0[ i ] : lod === 1 ? D.d1[ i ] : D.d2[ i ];
			if ( lod < D.lods[ i ] - 1 && d > sw * 0.88 ) {

				const f = bandFade( d, sw * 0.88, sw );
				batch.addFade( kind, i, f, true );
				batch.addFade( kind + 1, i, f, false );

			} else batch.add( kind, i );

		}

	}

	// Highest solid surface (seabed or coral / rock top) at x, z.
	floorHeightAt( x, z ) {

		return this.groundAt( x, z );

	}

	get stats() {

		const b = this.batches;
		return {
			instances: { hard: this.items.hard.length, soft: this.items.soft.length },
			visible: { hard: b.hard.visibleInstances, soft: b.soft.visibleInstances },
			triangles: b.hard.visibleTriangles + b.soft.visibleTriangles,
			shadowTriangles: b.hard.shadowTriangles,
			drawCalls: ( b.hard.mesh.visible ? 1 : 0 ) + ( b.soft.mesh.visible ? 1 : 0 ) + ( this.fish.mesh.visible ? 1 : 0 ),
			subDraws: b.hard.mainOffsets.length + b.soft.mainOffsets.length,
			shadowSubDraws: b.hard.shadowOffsets.length,
			kinds: { hard: this.kinds.hard.length, soft: this.kinds.soft.length },
			counts: this.counts, timings: this.timings, fish: this.fish.fishCount,
		};

	}

	dispose() {

		for ( const b of Object.values( this.batches ) ) b.dispose();
		for ( const m of [ ...Object.values( this.materials ), ...Object.values( this.fadeMaterials ) ] ) m.dispose();
		this.noise3D.destroy();
		this.fish.dispose();
		this.group.removeFromParent();

	}

}

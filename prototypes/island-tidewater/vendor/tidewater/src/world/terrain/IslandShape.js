// Hand-authored large-scale structure of the island: the ridge skeleton of the volcanic
// massif, sea stacks off the headlands and the footpaths around the village.

// Ridge skeleton: polylines of [x, z, crest height] (optional 4th value: half width, defaults
// to 2.2 * height + 40 m). Each polyline is the max of its segments; polylines are combined
// with a p-norm so junctions and saddles round off naturally. The cross profile is concave
// (sharp crest, flanks easing out toward the valley floors).
export const RIDGES = [
	// main east-west divide with the summit north of the bay
	[ [ - 480, - 360, 40 ], [ - 380, - 410, 110 ], [ - 250, - 460, 150 ], [ - 120, - 495, 178 ], [ - 35, - 510, 215 ], [ 50, - 495, 176 ], [ 150, - 470, 168 ], [ 270, - 430, 124 ], [ 400, - 360, 60 ], [ 470, - 320, 25 ] ],
	// west headland spur
	[ [ - 250, - 460, 140 ], [ - 262, - 340, 100 ], [ - 272, - 200, 66 ], [ - 278, - 70, 48, 120 ], [ - 274, 60, 36, 100 ], [ - 264, 165, 20, 70 ] ],
	// east headland spur
	[ [ 150, - 470, 155 ], [ 240, - 340, 108 ], [ 284, - 190, 70 ], [ 294, - 50, 50, 125 ], [ 294, 80, 36, 105 ], [ 290, 190, 18, 70 ] ],
	// central spur behind the village
	[ [ - 35, - 505, 195 ], [ - 15, - 410, 138 ], [ 8, - 330, 80, 180 ], [ 22, - 275, 38, 110 ] ],
	// minor spurs framing the valley
	[ [ - 150, - 485, 160 ], [ - 135, - 370, 104 ], [ - 118, - 280, 44, 120 ] ],
	[ [ 105, - 485, 162 ], [ 140, - 370, 110 ], [ 162, - 275, 42, 120 ] ],
	// north spurs
	[ [ - 110, - 500, 170 ], [ - 160, - 640, 110 ], [ - 200, - 770, 38 ] ],
	[ [ 50, - 495, 168 ], [ 115, - 630, 112 ], [ 165, - 765, 38 ] ],
	[ [ - 380, - 410, 100 ], [ - 440, - 560, 56 ] ],
	[ [ 270, - 430, 115 ], [ 390, - 550, 52 ] ],
];

for ( const r of RIDGES ) for ( const p of r ) if ( p.length < 4 ) p.push( 2.5 * p[ 2 ] + 50 );

const P = 6;
const CREST = 0.07;
const CREST_N = Math.sqrt( 1 + CREST * CREST ) - CREST;

// smooth envelope height of the ridge skeleton at (x, z)
export function ridgeEnvelope( x, z ) {

	let sum = 0;
	for ( let r = 0; r < RIDGES.length; r ++ ) {

		const pts = RIDGES[ r ];
		let best = 0;
		for ( let k = 0; k < pts.length - 1; k ++ ) {

			const a = pts[ k ], b = pts[ k + 1 ];
			const abx = b[ 0 ] - a[ 0 ], abz = b[ 1 ] - a[ 1 ];
			let t = ( ( x - a[ 0 ] ) * abx + ( z - a[ 1 ] ) * abz ) / ( abx * abx + abz * abz );
			t = t < 0 ? 0 : t > 1 ? 1 : t;
			const dx = x - ( a[ 0 ] + abx * t ), dz = z - ( a[ 1 ] + abz * t );
			const Wd = a[ 3 ] + ( b[ 3 ] - a[ 3 ] ) * t;
			const u0 = Math.sqrt( dx * dx + dz * dz ) / Wd;
			if ( u0 >= 1 ) continue;
			// rounded crest (soft |u|), renormalised so u = 1 at the foot
			const u = ( Math.sqrt( u0 * u0 + CREST * CREST ) - CREST ) / CREST_N;
			const q = 1 - u;
			const v = ( a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * t ) * q * q * ( 1 + 0.5 * u );
			if ( v > best ) best = v;

		}

		if ( best > 0 ) {

			const b2 = best * best;
			sum += b2 * b2 * b2;

		}

	}

	return sum > 0 ? Math.pow( sum, 1 / P ) : 0;

}

// Sea stacks off the headland tips: [x, z, radius, height]
export const SEA_STACKS = [
	[ - 272, 216, 9, 17 ], [ - 300, 196, 6, 11 ], [ - 244, 240, 5.5, 8 ], [ - 316, 152, 7, 13 ], [ - 286, 238, 4, 6 ],
	[ 298, 252, 10, 19 ], [ 262, 246, 6, 10 ], [ 328, 228, 7, 12 ], [ 322, 186, 5, 9 ], [ 280, 272, 4.5, 7 ],
];

// Footpaths (x, z polylines) with half widths. Worn into the ground (darkened + slightly sunken).
export const PATHS = [
	// beach at the spawn up to the front row and on to the plaza
	{ w: 1.1, pts: [ [ 21, - 56 ], [ 20, - 68 ], [ 18.5, - 80 ], [ 16.5, - 92 ], [ 15.5, - 100 ], [ 20, - 102.5 ], [ 28, - 104.5 ], [ 35.5, - 108.5 ] ] },
	// plaza north up the valley and onto the central spur (hiking trail)
	{ w: 0.6, pts: [ [ 42, - 116.5 ], [ 45.5, - 126 ], [ 48, - 138 ], [ 49, - 150 ], [ 49.5, - 162 ], [ 47, - 175 ], [ 41, - 188 ], [ 36, - 199 ], [ 31, - 212 ], [ 33, - 224 ], [ 26, - 236 ], [ 20, - 247 ], [ 24, - 258 ], [ 16, - 270 ], [ 11, - 283 ], [ 15, - 296 ], [ 8, - 309 ], [ 4, - 322 ] ] },
	// east: boathouse up to the boardwalk
	{ w: 0.9, pts: [ [ 88, - 62 ], [ 80, - 72 ], [ 70, - 80 ], [ 60, - 86 ], [ 54.5, - 90 ] ] },
	// west: along the back of the beach to the western grove
	{ w: 0.8, pts: [ [ 18, - 62 ], [ 5, - 68 ], [ - 12, - 73 ], [ - 30, - 77 ], [ - 50, - 80 ], [ - 72, - 84 ] ] },
];

// distance from (x, z) to a polyline; returns [distance, arc length position of the closest point]
export function polylineDistance( pts, x, z ) {

	let best = Infinity, acc = 0, bestArc = 0;
	for ( let k = 0; k < pts.length - 1; k ++ ) {

		const a = pts[ k ], b = pts[ k + 1 ];
		const abx = b[ 0 ] - a[ 0 ], abz = b[ 1 ] - a[ 1 ];
		const len2 = abx * abx + abz * abz;
		let t = ( ( x - a[ 0 ] ) * abx + ( z - a[ 1 ] ) * abz ) / len2;
		t = t < 0 ? 0 : t > 1 ? 1 : t;
		const dx = x - ( a[ 0 ] + abx * t ), dz = z - ( a[ 1 ] + abz * t );
		const d = dx * dx + dz * dz;
		const len = Math.sqrt( len2 );
		if ( d < best ) {

			best = d;
			bestArc = acc + t * len;

		}

		acc += len;

	}

	return [ Math.sqrt( best ), bestArc ];

}

// Catchable fish: game data for the species the world already swims (world/fish/FishSpecies.js).
//
//   name      display name
//   sci       scientific name
//   lw        [ a, b ] length-weight relation W (g) = a * L (cm, total length) ^ b (FishBase-style values)
//   model     key in SPECIES (the swimming model / skin)
//   habitat   weights per water type (see Bites.habitatAt): shallows (sand, < 3 m), reef (over the
//             reef), pier (around the piles), bay (open water 3–20 m), deep (offshore, > 20 m)
//   kg        [ min, max ] weight; sizes follow a skewed distribution (most fish are small)
//   price     $ per kg at the fish stand
//   fight     0..1 how hard it pulls (surge strength and frequency in the catch mini-game)
//   stamina   seconds of good pressure it takes to tire a typical one
//   time      activity by time of day: 'day', 'dawnDusk', 'night' or 'any'
//   rarity    0..1, scales how often it bites relative to the others in the same water
export const FISH = {
	silverside: { name: 'Hardhead silverside', sci: 'Atherinomorus stipes', lw: [ 0.0074, 3.1 ], model: 'silverside', habitat: { shallows: 1, pier: 0.6, bay: 0.2 }, kg: [ 0.02, 0.08 ], price: 3, fight: 0.05, stamina: 1.5, time: 'any', rarity: 0.2 },
	mullet: { name: 'Striped mullet', sci: 'Mugil cephalus', lw: [ 0.0112, 2.98 ], model: 'mullet', habitat: { shallows: 1, pier: 0.4 }, kg: [ 0.4, 2.2 ], price: 5, fight: 0.3, stamina: 5, time: 'day', rarity: 0.8 },
	needlefish: { name: 'Houndfish', sci: 'Tylosurus crocodilus', lw: [ 0.0012, 3.1 ], model: 'needlefish', habitat: { shallows: 0.7, bay: 0.5, pier: 0.3 }, kg: [ 0.5, 2.5 ], price: 4, fight: 0.45, stamina: 5, time: 'day', rarity: 0.5 },
	sergeant: { name: 'Sergeant major', sci: 'Abudefduf saxatilis', lw: [ 0.0234, 3.0 ], model: 'sergeant', habitat: { pier: 1, reef: 0.8 }, kg: [ 0.1, 0.35 ], price: 6, fight: 0.15, stamina: 2.5, time: 'day', rarity: 1 },
	grunt: { name: 'Bluestriped grunt', sci: 'Haemulon sciurus', lw: [ 0.0145, 3.06 ], model: 'grunt', habitat: { pier: 1, reef: 0.8, bay: 0.2 }, kg: [ 0.3, 1.2 ], price: 7, fight: 0.25, stamina: 4, time: 'any', rarity: 1 },
	yellowtail: { name: 'Yellowtail snapper', sci: 'Ocyurus chrysurus', lw: [ 0.0137, 2.98 ], model: 'yellowtail', habitat: { reef: 1, pier: 0.4, bay: 0.4 }, kg: [ 0.4, 1.6 ], price: 12, fight: 0.4, stamina: 5, time: 'dawnDusk', rarity: 0.9 },
	chromis: { name: 'Blue chromis', sci: 'Chromis cyanea', lw: [ 0.0209, 3.0 ], model: 'chromis', habitat: { reef: 1 }, kg: [ 0.03, 0.1 ], price: 4, fight: 0.05, stamina: 1.5, time: 'day', rarity: 0.4 },
	tang: { name: 'Blue tang', sci: 'Acanthurus coeruleus', lw: [ 0.0282, 2.95 ], model: 'tang', habitat: { reef: 1 }, kg: [ 0.2, 0.6 ], price: 8, fight: 0.2, stamina: 3, time: 'day', rarity: 0.6 },
	wrasse: { name: 'Hogfish', sci: 'Lachnolaimus maximus', lw: [ 0.0151, 3.07 ], model: 'wrasse', habitat: { reef: 0.8, bay: 0.3 }, kg: [ 0.5, 4 ], price: 16, fight: 0.35, stamina: 6, time: 'day', rarity: 0.35 },
	parrot: { name: 'Stoplight parrotfish', sci: 'Sparisoma viride', lw: [ 0.0151, 3.06 ], model: 'parrot', habitat: { reef: 1 }, kg: [ 0.8, 4 ], price: 9, fight: 0.35, stamina: 6, time: 'day', rarity: 0.5 },
	angel: { name: 'Queen angelfish', sci: 'Holacanthus ciliaris', lw: [ 0.0302, 2.94 ], model: 'angel', habitat: { reef: 1 }, kg: [ 0.4, 1.6 ], price: 14, fight: 0.25, stamina: 4, time: 'day', rarity: 0.3 },
	jack: { name: 'Crevalle jack', sci: 'Caranx hippos', lw: [ 0.02, 2.93 ], model: 'jack', habitat: { shallows: 0.5, pier: 0.7, bay: 0.8 }, kg: [ 1, 9 ], price: 6, fight: 0.75, stamina: 12, time: 'dawnDusk', rarity: 0.5 },
	barracuda: { name: 'Great barracuda', sci: 'Sphyraena barracuda', lw: [ 0.0051, 3.08 ], model: 'barracuda', habitat: { reef: 0.5, bay: 0.8, deep: 0.5 }, kg: [ 2, 16 ], price: 5, fight: 0.7, stamina: 11, time: 'any', rarity: 0.45 },
	grouper: { name: 'Nassau grouper', sci: 'Epinephelus striatus', lw: [ 0.0107, 3.07 ], model: 'grouper', habitat: { reef: 0.6, deep: 0.6 }, kg: [ 3, 14 ], price: 15, fight: 0.6, stamina: 12, time: 'any', rarity: 0.3 },
	redSnapper: { name: 'Red snapper', sci: 'Lutjanus campechanus', lw: [ 0.0137, 2.98 ], model: 'redSnapper', habitat: { deep: 1, bay: 0.2 }, kg: [ 1.5, 9 ], price: 18, fight: 0.5, stamina: 9, time: 'any', rarity: 0.7 },
	tuna: { name: 'Blackfin tuna', sci: 'Thunnus atlanticus', lw: [ 0.0145, 3.0 ], model: 'tuna', habitat: { deep: 1 }, kg: [ 3, 14 ], price: 16, fight: 0.85, stamina: 16, time: 'dawnDusk', rarity: 0.5 },
	mahi: { name: 'Mahi-mahi', sci: 'Coryphaena hippurus', lw: [ 0.0079, 3.0 ], model: 'mahi', habitat: { deep: 0.8 }, kg: [ 4, 18 ], price: 14, fight: 0.8, stamina: 15, time: 'day', rarity: 0.4 },
	tarpon: { name: 'Tarpon', sci: 'Megalops atlanticus', lw: [ 0.0077, 3.02 ], model: 'tarpon', habitat: { pier: 0.35, bay: 0.5, shallows: 0.15 }, kg: [ 10, 45 ], price: 4, fight: 1, stamina: 24, time: 'night', rarity: 0.2 },
};

export const FISH_IDS = Object.keys( FISH );

// $ value of a fish; trophy-sized ones fetch a bit more per kg
export function fishValue( id, kg ) {

	const f = FISH[ id ];
	const t = ( kg - f.kg[ 0 ] ) / Math.max( f.kg[ 1 ] - f.kg[ 0 ], 1e-6 );
	return Math.max( 1, Math.round( f.price * kg * ( 1 + 0.25 * Math.max( 0, t - 0.7 ) / 0.3 ) ) );

}

// total length (cm) of a fish of `kg`, from its species' length-weight relation
export function fishLengthCm( id, kg ) {

	const [ a, b ] = FISH[ id ].lw;
	return Math.pow( Math.max( kg, 0.001 ) * 1000 / a, 1 / b );

}

import { Matrix4, Quaternion, Vector3 } from '../engine/index.js';
import { FishProps } from '../world/fish/FishProps.js';
import { SPECIES } from '../world/fish/FishSpecies.js';
import { FISH, FISH_IDS, fishLengthCm } from './FishTable.js';

// Real fish (the world's fish models and wet skin, world/fish/FishProps) for the game:
//  - the fish you just landed, hanging from the line by the gills and flapping, for a moment
//  - fish on ice at the buyer's stall (static)
// One props batch built at startup (one pipeline compile): a hanging slot per catchable species,
// parked far below the world until it is shown, plus the stall's fish.
const PARK = new Vector3( 0, - 2000, 0 );
// model frame (nose +z, back +y, left flank +x) -> hanging from a hook through the gills: nose up,
// left flank toward +z, back toward +x (FishProps' 'gill' pose)
const GILL = new Matrix4().makeBasis( new Vector3( 0, 0, 1 ), new Vector3( 1, 0, 0 ), new Vector3( 0, 1, 0 ) );
// lying on its side, nose toward +x ('side')
const SIDE = new Matrix4().makeBasis( new Vector3( 0, 1, 0 ), new Vector3( 0, 0, 1 ), new Vector3( 1, 0, 0 ) );
const _m = new Matrix4(), _f = new Matrix4(), _q = new Quaternion(), _p = new Vector3(), _s = new Vector3(), _a = new Vector3();

// body length (m) for a weight: the species' length-weight relation (FishTable.fishLengthCm), so the
// fish on the line is the size the catch card reports
export function fishLength( species, kg ) {

	return fishLengthCm( species, kg ) / 100;

}

export class CatchDisplay {

	constructor( { scene, stall = [] } ) {

		const fp = this.props = new FishProps();
		this.slot = {};
		let i = 0;
		_f.makeTranslation( PARK.x, PARK.y, PARK.z );
		for ( const id of FISH_IDS ) {

			const model = FISH[ id ].model;
			fp.add( 'whole', model, _f, 'gill', 0.3, { anchor: FishProps.gillAnchor( model ), cloudy: 0.1, wet: 1 } );
			this.slot[ id ] = i ++;

		}

		// stall fish: { species, frame (Matrix4, world), L, pose ('side' | 'sideFlip') }
		for ( const s of stall ) fp.add( 'whole', FISH[ s.species ].model, s.frame, s.pose || 'side', s.L, { cloudy: 0.5, wet: 0.7 } );
		for ( const s of stall.filter( ( x ) => x.ice ) ) fp.add( 'ice', null, s.ice, 'flat', 0.5, { seed: 0.3, flags: 0 } );
		this.mesh = fp.build();
		this.mesh.name = 'GameFish';
		scene.add( this.mesh );
		this.shown = null;
		this.t = 0;

	}

	// hang `species` from `mouth` (world point: the end of the line), facing the camera
	show( species, kg, mouth, faceYaw, dt ) {

		const i = this.slot[ species ];
		if ( i === undefined ) return;
		if ( this.shown !== species ) this.hide();
		this.shown = species;
		this.t += dt;
		const model = FISH[ species ].model;
		const L = fishLength( species, kg );
		// struggling: the body curls side to side, the jaw works, the whole fish swings on the line
		const flap = Math.sin( this.t * 11 ) * 0.9 * Math.exp( - this.t * 0.5 );
		const swing = Math.sin( this.t * 2.6 ) * 0.25 * Math.exp( - this.t * 0.4 );
		_q.setFromAxisAngle( _a.set( 0, 1, 0 ), faceYaw + swing );
		_f.makeRotationFromQuaternion( _q ).setPosition( mouth );
		this.place( i, _f, GILL, L, FishProps.gillAnchor( model ), flap, 0, 0.4 + 0.4 * Math.max( 0, Math.sin( this.t * 7 ) ) );

	}

	hide() {

		if ( this.shown === null ) return;
		_f.makeTranslation( PARK.x, PARK.y, PARK.z );
		this.place( this.slot[ this.shown ], _f, GILL, 0.3, [ 0, 0, 0 ], 0, 0, 0 );
		this.shown = null;
		this.t = 0;

	}

	// write instance i of the props batch (same math as FishProps.add with no bend on the anchor)
	place( i, frame, pose, L, anchor, curl, sag, jaw ) {

		const fp = this.props;
		_m.multiplyMatrices( frame, pose );
		_m.decompose( _p, _q, _s );
		_p.sub( _a.set( anchor[ 0 ], anchor[ 1 ], anchor[ 2 ] ).multiplyScalar( L ).applyQuaternion( _q ) );
		const D = fp.batch.data, o = i * 16;
		D[ o ] = _p.x; D[ o + 1 ] = _p.y; D[ o + 2 ] = _p.z; D[ o + 3 ] = L;
		D[ o + 4 ] = _q.x; D[ o + 5 ] = _q.y; D[ o + 6 ] = _q.z; D[ o + 7 ] = _q.w;
		D[ o + 9 ] = curl; D[ o + 10 ] = sag; D[ o + 11 ] = jaw;
		fp.pos[ i * 4 ] = _p.x; fp.pos[ i * 4 + 1 ] = _p.y; fp.pos[ i * 4 + 2 ] = _p.z; fp.pos[ i * 4 + 3 ] = L;
		fp.batch.upload();

	}

}

export { SPECIES, SIDE };

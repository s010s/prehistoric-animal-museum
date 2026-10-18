import { BirdBatch } from './BirdBatch.js';
import { Birds } from './Birds.js';
import { CritterBatch } from './CritterBatch.js';
import { Crabs } from './Crabs.js';
import { ShadowBlobs } from './ShadowBlobs.js';
import { SwashProbe } from './SwashProbe.js';
import { Shorebirds } from './Shorebirds.js';

// Water heights for birds on / just above the sea (pelicans skimming, floating, diving): a few
// WaterQuery slots handed out to whoever asks, read back 1-3 frames later. Falls back to sea level.
class WaterHeights {

	constructor( query, n = 8 ) {

		this.query = query;
		this.n = n;
		this.start = - 1;
		try {

			if ( query ) this.start = query.allocate( 'wildlife', n );

		} catch ( e ) {

			console.warn( 'Wildlife: no water query slots', e );

		}

		this.keys = new Array( n ).fill( null );
		this.used = new Int32Array( n ).fill( - 1e6 );
		this.since = new Int32Array( n );
		this.frame = 0;

	}

	height( key, x, z ) {

		const q = this.query;
		if ( this.start < 0 ) return 0;
		let k = this.keys.indexOf( key );
		if ( k < 0 ) {

			// take the slot unused for longest
			k = 0;
			for ( let i = 1; i < this.n; i ++ ) if ( this.used[ i ] < this.used[ k ] ) k = i;
			this.keys[ k ] = key;
			this.since[ k ] = this.frame;

		}

		this.used[ k ] = this.frame;
		const slot = this.start + k;
		q.setPoint( slot, x, z );
		const h = q.cpu[ slot * 4 ];
		// the result is valid once the point has been in the queue for a few frames
		return q.cpuValid && this.frame - this.since[ k ] > 4 && Number.isFinite( h ) ? h : 0;

	}

	endFrame() {

		this.frame ++;

	}

}

// Island wildlife: gulls, terns, pelicans, frigatebirds and sanderlings (one instanced draw, plus
// the near shadow cascade), ghost crabs, hermit crabs and burrows (one draw), and soft contact
// shadows under the small ones (one draw in the late pass). Everything is simulated on the CPU
// near the viewer only; far away the crabs and shorebirds cost nothing and draw nothing.
//
// csm: the SunShadows instance (birds cast into its near cascade only).
//
// update( dt, camera, player ): player = null for the free camera (it only scares animals when
// it is near the ground).
export class Wildlife {

	constructor( {
		scene, renderer, terrain, terrainGPU = null, shore = null, village = null, colliders = null, vegetation = null,
		boat = null, boatModel = null, query = null, spray = null, csm = null,
	} ) {

		this.terrain = terrain;
		this.birdBatch = new BirdBatch( { csm } );
		scene.add( this.birdBatch.mesh );
		this.critterBatch = new CritterBatch();
		scene.add( this.critterBatch.mesh );
		this.crabs = new Crabs( { terrain, village, colliders, vegetation } );
		this.blobs = new ShadowBlobs();
		scene.add( this.blobs.mesh );
		let probe = null;
		if ( shore && terrainGPU ) {

			try {

				probe = new SwashProbe( renderer, { shore, terrainGPU } );

			} catch ( e ) {

				console.warn( 'Wildlife: swash probe unavailable', e );

			}

		}

		this.shorebirds = new Shorebirds( { terrain, probe } );
		this.water = new WaterHeights( query );
		this.birds = new Birds( { terrain, village, colliders, boat, boatModel, water: this.water, spray } );
		this.viewer = { x: 0, y: 0, z: 0, speed: 0, mode: 'walk', px: 0, pz: 0, init: false };
		this.test = null;
		this.cpuMs = 0;

	}

	// who the animals react to: the walker / swimmer / boat, or the free camera when near the ground
	updateViewer( dt, camera, player ) {

		const v = this.viewer;
		let x, y, z;
		if ( player ) {

			x = player.position.x; y = player.position.y; z = player.position.z;
			v.mode = player.mode;

		} else {

			x = camera.position.x; y = camera.position.y - 1.6; z = camera.position.z;
			v.mode = 'fly';

		}

		if ( ! v.init ) {

			v.px = x; v.pz = z;
			v.init = true;

		}

		const sp = Math.hypot( x - v.px, z - v.pz ) / Math.max( dt, 1e-3 );
		v.speed += ( Math.min( sp, 20 ) - v.speed ) * ( 1 - Math.exp( - dt * 4 ) );
		v.px = x; v.pz = z;
		v.x = x; v.y = y; v.z = z;
		// a camera flying well above the ground scares nothing
		const g = Math.max( this.terrain.heightAt( x, z ), 0 );
		return v.mode === 'fly' && y - g > 3 ? null : v;

	}

	update( dt, camera, player = null ) {

		const t0 = performance.now();
		const viewer = this.updateViewer( dt, camera, player );
		this.birdBatch.begin();
		this.critterBatch.begin();
		this.blobs.begin();
		if ( this.test ) this.test( this.birdBatch, dt, this.critterBatch, this.blobs );
		else {

			this.birds.update( dt, viewer, this.birdBatch, camera );
			this.shorebirds.update( dt, viewer, this.birdBatch, camera, this.blobs );
			this.crabs.update( dt, viewer, this.critterBatch, camera, this.blobs );

		}

		this.birdBatch.commit();
		this.critterBatch.commit();
		this.blobs.commit();
		this.water.endFrame();
		this.cpuMs += ( performance.now() - t0 - this.cpuMs ) * 0.05;

	}

}

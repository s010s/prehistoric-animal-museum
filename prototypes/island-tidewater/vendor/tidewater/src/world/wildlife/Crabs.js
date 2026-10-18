import { G } from '../../core/Globals.js';
import { WORLD } from '../WorldLayout.js';
import { mulberry32 } from '../../util/Noise.js';
import { CRITTER } from './CritterShapes.js';
import { TAU, clamp, smooth, angleDiff, approach, qGround } from './Kit.js';

// Ghost crabs and hermit crabs.
//
// Ghost crabs live in burrows on the dry upper beach and the dune foot. Only the burrows near
// the viewer are active (a fixed pool of crabs is handed out to them); far away nothing is
// simulated or drawn. A crab out of its burrow forages in stop-and-go bursts, sprints sideways,
// freezes when something moves nearby, and dashes into its burrow (or a neighbour's, or just away
// and freezes) when the viewer comes within a few metres. It peeks out again (eyestalks first)
// once things have been quiet for a while. They are out more at dusk and at night.
//
// Hermit crabs trundle about under the vegetation at the back of the beach and pull into their
// shells when approached, coming out again slowly.

const ACTIVE = 36; // m: burrows / homes simulated within this distance of the viewer
const DRAW = 34; // m: crabs shrink away before this distance
const MAX_GHOST = 32, MAX_HERMIT = 14;
const CELL = 12;

export class Crabs {

	constructor( { terrain, village = null, colliders = null, vegetation = null, seed = 5 } ) {

		this.terrain = terrain;
		this.rng = mulberry32( seed );
		this.burrows = this.placeBurrows( village, colliders );
		this.homes = this.placeHomes( vegetation, colliders );
		// spatial hash of the burrows / hermit homes
		this.grid = new Map();
		this.burrows.forEach( ( b, i ) => this.cell( b.x, b.z ).push( i ) );
		this.ghosts = [];
		this.hermits = [];
		this.time = 0;
		this.scan = 0;
		this.nearBurrows = [];
		this._rec = {
			x: 0, y: 0, z: 0, scale: 1, q: [ 0, 0, 0, 1 ], species: 0, phase: 0, stride: 0, lift: 0, out: 1, eyes: 1, claws: 0, seed: 0,
			px: 0, py: 0, pz: 0, pPhase: 0, pq: [ 0, 0, 0, 1 ],
		};

	}

	cell( x, z ) {

		const k = Math.floor( x / CELL ) * 4096 + Math.floor( z / CELL );
		let c = this.grid.get( k );
		if ( ! c ) this.grid.set( k, c = [] );
		return c;

	}

	// ------------------------------------------------------------------ placement

	okGround( x, z, colliders, village ) {

		const T = this.terrain;
		if ( colliders && colliders.groundHeightAt( x, z, 100 ) > - Infinity ) return false; // decks, boardwalks
		if ( village && village.getFootprints ) {

			for ( const f of village.getFootprints() ) if ( Math.hypot( f.x - x, f.z - z ) < f.r ) return false;

		}

		const e = 0.8;
		const gx = T.heightAt( x + e, z ) - T.heightAt( x - e, z ), gz = T.heightAt( x, z + e ) - T.heightAt( x, z - e );
		return Math.hypot( gx, gz ) / ( 2 * e ) < 0.22;

	}

	sandAt( x, z ) {

		const T = this.terrain;
		const i = Math.floor( ( x - T.origin ) / T.texel ), j = Math.floor( ( z - T.origin ) / T.texel );
		if ( i < 0 || j < 0 || i >= T.res || j >= T.res ) return 0;
		return T.sand[ j * T.res + i ] / 255;

	}

	placeBurrows( village, colliders ) {

		const T = this.terrain, rng = this.rng;
		const out = [];
		const B = WORLD.beach;
		for ( let x = B.xMin + 4; x < B.xMax - 4; x += 1.7 ) {

			for ( let z = - 110; z < - 40; z += 1.7 ) {

				const px = x + ( rng() - 0.5 ) * 1.6, pz = z + ( rng() - 0.5 ) * 1.6;
				const h = T.heightAt( px, pz );
				// above the reach of the swash, on loose sand, thinning out into the dunes
				if ( h < 1.0 || h > 4.5 ) continue;
				if ( this.sandAt( px, pz ) < 0.75 ) continue;
				if ( Math.abs( px - WORLD.pier.x ) < 4.5 ) continue;
				const dens = 0.16 * smooth( 1.0, 1.4, h ) * ( 1 - 0.6 * smooth( 2.5, 4.5, h ) );
				if ( rng() > dens ) continue;
				if ( ! this.okGround( px, pz, colliders, village ) ) continue;
				if ( out.some( ( b ) => Math.abs( b.x - px ) < 2.2 && Math.abs( b.z - pz ) < 2.2 ) ) continue;
				out.push( {
					x: px, z: pz, y: h, yaw: rng() * TAU, seed: rng(), size: 0.85 + rng() * 0.35,
					resident: rng() < 0.75, crab: null, hideT: rng() * 30,
				} );

			}

		}

		return out;

	}

	placeHomes( vegetation, colliders ) {

		const rng = this.rng;
		const out = [];
		const B = WORLD.beach;
		const palms = vegetation && vegetation.records ? vegetation.records.palms : [];
		for ( const p of palms ) {

			if ( p.x < B.xMin || p.x > B.xMax || p.z < - 130 || p.z > - 50 || p.y < 1 || p.y > 9 ) continue;
			if ( rng() > 0.55 ) continue;
			const a = rng() * TAU, r = 0.8 + rng() * 2.2;
			const x = p.x + Math.cos( a ) * r, z = p.z + Math.sin( a ) * r;
			if ( ! this.okGround( x, z, colliders, null ) ) continue;
			out.push( { x, z, seed: rng(), crab: null } );

		}

		// and a few along the upper beach where the dune plants start
		for ( let i = 0; i < 40 && out.length < 60; i ++ ) {

			const x = B.xMin + 10 + rng() * ( B.xMax - B.xMin - 20 );
			let z = - 100;
			for ( ; z < - 45; z += 1 ) if ( this.terrain.heightAt( x, z ) < 3.2 ) break;
			if ( Math.abs( x - WORLD.pier.x ) < 5 || ! this.okGround( x, z - 2, colliders, null ) ) continue;
			out.push( { x, z: z - 2 - rng() * 4, seed: rng(), crab: null } );

		}

		return out;

	}

	// ------------------------------------------------------------------ update

	update( dt, viewer, batch, camera, blobs = null ) {

		this.time += dt;
		const cp = camera.position;
		const night = G.night.value;
		// dusk / night: ghost crabs come out
		const sunY = G.sunDir.value.y;
		this.activity = clamp( 0.45 + 0.5 * Math.max( night, smooth( 0.35, 0.05, sunY ) ), 0, 0.95 );

		// (re)assign the pool to the burrows near the viewer, a few times a second
		this.scan -= dt;
		if ( this.scan <= 0 ) {

			this.scan = 0.25;
			this.assign( cp );

		}

		for ( const c of this.ghosts ) this.updateGhost( c, dt, viewer );
		for ( const c of this.hermits ) this.updateHermit( c, dt, viewer );

		// draw burrows (near), ghost crabs, hermit crabs
		const rec = this._rec;
		for ( const b of this.nearBurrows ) {

			const d = Math.hypot( b.x - cp.x, b.z - cp.z );
			if ( d > DRAW ) continue;
			this.burrowRecord( b, rec, smooth( DRAW, DRAW * 0.75, d ) );
			batch.write( rec );

		}

		for ( const c of this.ghosts ) if ( c.visible ) {

			this.crabRecord( c, rec, cp );
			if ( rec.scale <= 0 ) continue;
			batch.write( rec );
			if ( blobs ) blobs.add( c.x, c.y, c.z, rec.scale * 0.75, rec.scale * ( c.lift + 0.12 ), smooth( 0.35, 0.8, c.out ), c.sx, c.sz );

		}

		for ( const c of this.hermits ) {

			this.crabRecord( c, rec, cp );
			if ( rec.scale <= 0 ) continue;
			batch.write( rec );
			if ( blobs ) blobs.add( c.x, c.y, c.z, rec.scale * 0.8, rec.scale * 0.45, 0.9, c.sx, c.sz );

		}

	}

	assign( cp ) {

		// burrows in range
		const near = this.nearBurrows;
		near.length = 0;
		const r = Math.ceil( ACTIVE / CELL );
		const ci = Math.floor( cp.x / CELL ), cj = Math.floor( cp.z / CELL );
		for ( let i = ci - r; i <= ci + r; i ++ ) for ( let j = cj - r; j <= cj + r; j ++ ) {

			const c = this.grid.get( i * 4096 + j );
			if ( ! c ) continue;
			for ( const k of c ) {

				const b = this.burrows[ k ];
				if ( Math.hypot( b.x - cp.x, b.z - cp.z ) < ACTIVE ) near.push( b );

			}

		}

		// release crabs whose burrow went out of range (they are far and tiny by then)
		for ( let i = this.ghosts.length - 1; i >= 0; i -- ) {

			const c = this.ghosts[ i ];
			if ( Math.hypot( c.home.x - cp.x, c.home.z - cp.z ) > ACTIVE + 4 ) {

				c.home.crab = null;
				this.ghosts.splice( i, 1 );

			}

		}

		// residents of burrows coming into range: out and about, or down the hole
		near.sort( ( a, b ) => Math.hypot( a.x - cp.x, a.z - cp.z ) - Math.hypot( b.x - cp.x, b.z - cp.z ) );
		for ( const b of near ) {

			if ( this.ghosts.length >= MAX_GHOST ) break;
			if ( b.crab || ! b.resident ) continue;
			b.crab = this.spawnGhost( b, Math.hypot( b.x - cp.x, b.z - cp.z ) );
			this.ghosts.push( b.crab );

		}

		// hermit crabs
		for ( let i = this.hermits.length - 1; i >= 0; i -- ) {

			const c = this.hermits[ i ];
			if ( Math.hypot( c.home.x - cp.x, c.home.z - cp.z ) > ACTIVE * 0.8 + 4 ) {

				c.home.crab = null;
				this.hermits.splice( i, 1 );

			}

		}

		for ( const h of this.homes ) {

			if ( this.hermits.length >= MAX_HERMIT ) break;
			if ( h.crab || Math.hypot( h.x - cp.x, h.z - cp.z ) > ACTIVE * 0.8 ) continue;
			h.crab = this.spawnHermit( h );
			this.hermits.push( h.crab );

		}

	}

	newCrab( species, home, seed ) {

		return {
			species, home, seed, x: home.x, z: home.z, y: 0, yaw: this.rng() * TAU, bodyYaw: 0, speed: 0, vx: 0, vz: 0,
			phase: this.rng() * TAU, pPhase: 0, stride: 0, lift: 0.3, out: 1, eyes: 1, claws: 0, state: 'idle', t: 1,
			tx: home.x, tz: home.z, want: 0, q: [ 0, 0, 0, 1 ], pq: [ 0, 0, 0, 1 ], px: 0, py: 0, pz: 0, fresh: true,
			visible: true, fade: 0, alarm: 0, feed: 0,
			size: species === CRITTER.GHOST ? ( 0.034 + seed * 0.022 ) * home.size : 0.028 + seed * 0.016,
		};

	}

	spawnGhost( b, dist ) {

		const c = this.newCrab( CRITTER.GHOST, b, b.seed );
		const out = this.rng() < this.activity;
		if ( out && dist > 12 ) {

			const a = this.rng() * TAU, r = 0.5 + this.rng() * 4;
			c.x = b.x + Math.cos( a ) * r;
			c.z = b.z + Math.sin( a ) * r;
			c.state = 'idle';
			c.t = 0.5 + this.rng() * 3;

		} else {

			c.state = 'hidden';
			c.out = 0;
			c.visible = false;
			c.x = b.x; c.z = b.z;
			c.t = 3 + this.rng() * 20;

		}

		c.bodyYaw = this.rng() * TAU;
		return c;

	}

	spawnHermit( h ) {

		const c = this.newCrab( CRITTER.HERMIT, h, h.seed );
		c.state = 'idle';
		c.t = this.rng() * 5;
		c.eyes = 1;
		const a = this.rng() * TAU;
		c.x = h.x + Math.cos( a ) * this.rng() * 2;
		c.z = h.z + Math.sin( a ) * this.rng() * 2;
		c.lift = 0.08;
		return c;

	}

	// viewer distance and closing speed (m, m/s); far away when there is nobody on the ground
	threat( c, viewer ) {

		if ( ! viewer || viewer.mode === 'boat' ) return { d: 1e9, closing: 0 };
		const dx = c.x - viewer.x, dz = c.z - viewer.z;
		const d = Math.hypot( dx, dz );
		if ( Math.abs( viewer.y - c.y ) > 6 ) return { d: 1e9, closing: 0 };
		return { d, closing: viewer.speed };

	}

	// run toward (tx, tz) at speed v (m/s), sideways like a crab
	moveTo( c, dt, v, accel = 12 ) {

		const dx = c.tx - c.x, dz = c.tz - c.z;
		const d = Math.hypot( dx, dz );
		const want = d < 0.02 ? 0 : Math.min( v, d * 6 );
		c.speed += clamp( want - c.speed, - accel * 2 * dt, accel * dt );
		if ( d > 1e-4 ) {

			const s = Math.min( c.speed * dt, d );
			c.vx = dx / d * c.speed;
			c.vz = dz / d * c.speed;
			c.x += dx / d * s;
			c.z += dz / d * s;
			if ( c.species === CRITTER.GHOST ) {

				// body across the direction of travel (either side leading, whichever is closer)
				const heading = Math.atan2( dx, dz );
				const a = heading + Math.PI / 2, b = heading - Math.PI / 2;
				const target = Math.abs( angleDiff( a, c.bodyYaw ) ) < Math.abs( angleDiff( b, c.bodyYaw ) ) ? a : b;
				c.bodyYaw += angleDiff( target, c.bodyYaw ) * approach( 14, dt );

			} else c.bodyYaw += angleDiff( Math.atan2( dx, dz ), c.bodyYaw ) * approach( 3, dt );

		}

		return d;

	}

	pickSpot( c, r0, r1, downhill = 0 ) {

		const a = this.rng() * TAU, r = r0 + this.rng() * ( r1 - r0 );
		c.tx = c.home.x + Math.cos( a ) * r;
		c.tz = c.home.z + Math.sin( a ) * r + downhill;

	}

	updateGhost( c, dt, viewer ) {

		const b = c.home;
		c.pPhase = c.phase;
		const th = this.threat( c, viewer );
		const scary = th.d < 6.5 + th.closing * 1.2;
		const alert = th.d < 10 + th.closing * 1.5;
		c.t -= dt;

		switch ( c.state ) {

			case 'hidden':
				c.visible = false;
				c.out = 0;
				if ( th.d < 10 ) c.t = Math.max( c.t, 4 + this.rng() * 6 );
				if ( c.t <= 0 ) {

					c.state = 'peek';
					c.t = 1.5 + this.rng() * 3;
					c.x = b.x; c.z = b.z;
					c.visible = true;
					c.fresh = true;

				}

				break;

			case 'peek':
				// eyestalks just above the rim, looking around
				c.out += ( 0.45 - c.out ) * approach( 3, dt );
				c.eyes = 1;
				if ( alert ) {

					c.state = 'enter';
					c.t = 0.3;

				} else if ( c.t <= 0 ) {

					c.state = 'emerge';
					c.t = 0.5;

				}

				break;

			case 'emerge':
				c.out = Math.min( 1, c.out + dt * 1.6 );
				if ( alert ) c.state = 'enter';
				else if ( c.out >= 1 ) {

					c.state = 'idle';
					c.t = 1 + this.rng() * 3;

				}

				break;

			case 'idle':
				// stand, pick at the sand with the claws
				c.feed += dt * 4;
				c.claws = 0.25 + 0.25 * Math.max( 0, Math.sin( c.feed ) );
				this.moveTo( c, dt, 0 );
				if ( scary ) this.flee( c, viewer );
				else if ( alert ) {

					c.state = 'freeze';
					c.t = 0.8 + this.rng() * 1.5;

				} else if ( c.t <= 0 ) {

					const r = this.rng();
					if ( r < 0.15 && this.time > 2 ) {

						// home for a while
						c.state = 'return';

					} else {

						// a short trip: mostly a stroll, sometimes a sprint; now and then down toward the water
						c.state = r < 0.45 ? 'dash' : 'walk';
						this.pickSpot( c, 0.5, r < 0.45 ? 5 : 2.5, this.rng() < 0.2 ? 3 : 0 );
						c.t = 5;

					}

				}

				break;

			case 'walk':
			case 'dash': {

				const v = c.state === 'dash' ? 1.2 + c.seed * 0.9 : 0.12 + c.seed * 0.1;
				const d = this.moveTo( c, dt, v );
				c.claws = 0.1;
				if ( scary ) this.flee( c, viewer );
				else if ( alert ) {

					c.state = 'freeze';
					c.t = 0.6 + this.rng() * 1.5;

				} else if ( d < 0.05 || c.t <= 0 ) {

					c.state = 'idle';
					c.t = 1 + this.rng() * 5;

				}

				break;

			}

			case 'freeze':
				// motionless, eyes up, watching
				this.moveTo( c, dt, 0, 30 );
				c.claws = 0.05;
				if ( scary ) this.flee( c, viewer );
				else if ( c.t <= 0 ) {

					if ( alert ) {

						this.flee( c, viewer );

					} else {

						c.state = 'idle';
						c.t = 1 + this.rng() * 2;

					}

				}

				break;

			case 'flee': {

				// flat out; into the burrow when it reaches it
				const d = this.moveTo( c, dt, 2.1 + c.seed * 0.9, 25 );
				c.claws = 0;
				c.eyes = c.target ? 0.6 : 1;
				if ( d < 0.08 ) {

					if ( c.target ) {

						c.state = 'enter';
						c.t = 0.25;

					} else {

						c.state = 'freeze';
						c.t = 2 + this.rng() * 3;

					}

				}

				break;

			}

			case 'return': {

				c.tx = b.x; c.tz = b.z;
				const d = this.moveTo( c, dt, 0.3 + c.seed * 0.2 );
				if ( scary ) this.flee( c, viewer );
				else if ( d < 0.05 ) {

					c.state = 'enter';
					c.t = 0.4;

				}

				break;

			}

			case 'enter':
				// down the hole
				c.speed = 0;
				c.x += ( c.home.x - c.x ) * approach( 20, dt );
				c.z += ( c.home.z - c.z ) * approach( 20, dt );
				c.out = Math.max( 0, c.out - dt / 0.22 );
				c.eyes = Math.max( 0, c.eyes - dt * 4 );
				if ( c.out <= 0 ) {

					c.state = 'hidden';
					c.visible = false;
					// stays down while it is busy up there; comes back up after a while
					c.t = 12 + this.rng() * 25 + ( 1 - this.activity ) * 30;

				}

				break;

		}

		// the gait: stride frequency grows with speed (a blur when sprinting)
		const W = c.size;
		const f = clamp( c.speed / ( W * 2.4 ), 0, 13 );
		c.phase = ( c.phase + TAU * f * dt ) % ( TAU * 64 );
		c.stride += ( clamp( c.speed / ( W * 10 ), 0, 1 ) - c.stride ) * approach( 10, dt );
		const liftWant = c.state === 'freeze' ? 0.26 : c.speed > 0.6 ? 0.4 : 0.32;
		c.lift += ( liftWant - c.lift ) * approach( 8, dt );
		if ( c.state !== 'enter' && c.state !== 'peek' ) c.eyes += ( 1 - c.eyes ) * approach( 6, dt );

	}

	// run for the burrow if it is not toward the threat; else a neighbour's; else away and freeze
	flee( c, viewer ) {

		c.state = 'flee';
		const ux = c.x - viewer.x, uz = c.z - viewer.z;
		const ul = Math.hypot( ux, uz ) || 1;
		let best = null, bestS = - Infinity;
		const consider = ( b ) => {

			if ( b.crab && b.crab !== c ) return;
			const dx = b.x - c.x, dz = b.z - c.z;
			const d = Math.hypot( dx, dz );
			if ( d > 11 ) return;
			// burrows away from the viewer score best; toward it only if very close
			const away = d > 0.01 ? ( dx * ux + dz * uz ) / ( d * ul ) : 1;
			if ( away < - 0.35 && d > 1.2 ) return;
			const s = - d * 0.5 + away * 2 + ( b === c.home ? 1.5 : 0 );
			if ( s > bestS ) {

				bestS = s;
				best = b;

			}

		};

		consider( c.home );
		for ( const b of this.nearBurrows ) consider( b );
		if ( best ) {

			if ( best !== c.home ) {

				// moves in
				c.home.crab = null;
				c.home = best;
				best.crab = c;

			}

			c.target = best;
			c.tx = best.x;
			c.tz = best.z;

		} else {

			c.target = null;
			const a = Math.atan2( ux, uz ) + ( this.rng() - 0.5 ) * 1.2;
			const r = 4 + this.rng() * 5;
			c.tx = c.x + Math.sin( a ) * r;
			c.tz = c.z + Math.cos( a ) * r;

		}

	}

	updateHermit( c, dt, viewer ) {

		c.pPhase = c.phase;
		const th = this.threat( c, viewer );
		c.t -= dt;
		const close = th.d < 2.2 + th.closing * 0.6;
		switch ( c.state ) {

			case 'idle':
				this.moveTo( c, dt, 0 );
				if ( close ) this.withdraw( c );
				else if ( c.t <= 0 ) {

					c.state = 'walk';
					this.pickSpot( c, 0, 3 );
					c.t = 20;

				}

				break;

			case 'walk': {

				const d = this.moveTo( c, dt, 0.035 + c.seed * 0.03, 0.3 );
				if ( close ) this.withdraw( c );
				else if ( d < 0.03 || c.t <= 0 ) {

					c.state = 'idle';
					c.t = 3 + this.rng() * 12;

				}

				break;

			}

			case 'withdrawn':
				// in the shell until it has been quiet for a while, then out again, slowly
				c.speed = 0;
				c.out = Math.max( 0, c.out - dt / 0.25 );
				if ( th.d < 4 ) c.t = Math.max( c.t, 6 + this.rng() * 8 );
				if ( c.t <= 0 ) c.state = 'emerge';
				break;

			case 'emerge':
				c.out = Math.min( 1, c.out + dt / 2.5 );
				if ( close ) this.withdraw( c );
				else if ( c.out >= 1 ) {

					c.state = 'idle';
					c.t = 2 + this.rng() * 4;

				}

				break;

		}

		const W = c.size;
		c.phase = ( c.phase + TAU * clamp( c.speed / ( W * 1.6 ), 0, 6 ) * dt ) % ( TAU * 64 );
		c.stride += ( clamp( c.speed / ( W * 3 ), 0, 1 ) - c.stride ) * approach( 6, dt );
		c.lift += ( ( c.out > 0.5 ? 0.14 : 0 ) * c.out - c.lift ) * approach( 6, dt );
		c.claws = 0.15;
		c.eyes = c.out;

	}

	withdraw( c ) {

		c.state = 'withdrawn';
		c.t = 8 + this.rng() * 10;

	}

	// ------------------------------------------------------------------ records

	crabRecord( c, r, cp ) {

		const T = this.terrain;
		const d = Math.hypot( c.x - cp.x, c.z - cp.z );
		const fadeIn = c.fade = Math.min( 1, c.fade + 0.05 );
		r.scale = c.size * smooth( DRAW, DRAW * 0.72, d ) * fadeIn;
		if ( r.scale <= 0 ) return;
		const y = T.heightAt( c.x, c.z );
		c.y = y;
		// orientation: ground normal, body yaw
		const e = 0.15;
		const nx = T.heightAt( c.x - e, c.z ) - T.heightAt( c.x + e, c.z ), nz = T.heightAt( c.x, c.z - e ) - T.heightAt( c.x, c.z + e );
		const nl = Math.hypot( nx, 2 * e, nz );
		c.sx = - nx / ( 2 * e );
		c.sz = - nz / ( 2 * e );
		for ( let i = 0; i < 4; i ++ ) c.pq[ i ] = c.q[ i ];
		qGround( c.q, c.bodyYaw, nx / nl, 2 * e / nl, nz / nl );
		if ( c.fresh ) {

			c.px = c.x; c.py = y; c.pz = c.z;
			for ( let i = 0; i < 4; i ++ ) c.pq[ i ] = c.q[ i ];
			c.pPhase = c.phase;
			c.fresh = false;

		}

		r.x = c.x; r.y = y; r.z = c.z;
		for ( let i = 0; i < 4; i ++ ) {

			r.q[ i ] = c.q[ i ];
			r.pq[ i ] = c.pq[ i ];

		}

		r.species = c.species;
		r.phase = c.phase;
		r.pPhase = c.pPhase;
		r.stride = c.stride;
		r.lift = c.lift;
		r.out = c.out;
		r.eyes = c.eyes;
		r.claws = c.claws;
		r.seed = c.seed;
		r.px = c.px; r.py = c.py; r.pz = c.pz;
		c.px = c.x; c.py = y; c.pz = c.z;

	}

	burrowRecord( b, r, k ) {

		const T = this.terrain;
		r.x = b.x; r.y = b.y; r.z = b.z;
		r.scale = 0.05 * b.size * k;
		if ( ! b.q ) {

			b.q = [ 0, 0, 0, 1 ];
			const e = 0.3;
			const nx = T.heightAt( b.x - e, b.z ) - T.heightAt( b.x + e, b.z ), nz = T.heightAt( b.x, b.z - e ) - T.heightAt( b.x, b.z + e );
			const nl = Math.hypot( nx, 2 * e, nz );
			qGround( b.q, b.yaw, nx / nl, 2 * e / nl, nz / nl );

		}

		for ( let i = 0; i < 4; i ++ ) r.q[ i ] = r.pq[ i ] = b.q[ i ];
		r.species = CRITTER.BURROW;
		r.phase = r.pPhase = 0;
		r.stride = 0; r.lift = 0; r.out = 1; r.eyes = 0; r.claws = 0;
		r.seed = b.seed;
		r.px = b.x; r.py = b.y; r.pz = b.z;

	}

}

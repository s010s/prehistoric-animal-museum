import { Vector3, Vector4 } from '../engine/index.js';
import { UniformBlock, ShaderModule } from '../engine/webgpu.js';

// The humpback's marks on the water surface (read by WaterMaterial): churned white water where
// it breaks the surface and rolls, spreading and fading over ~15 s, and the smooth, flat "fluke
// print" slick it leaves where it dives. A handful of analytic patches in a small uniform array
// (no textures): ( x, z, radius, strength ), strength > 0 foam, < 0 slick.
//
// WGSL (`whaleWaterModule`): fn whaleWater( xz: vec2f ) -> vec2f   ( foam, slick )
const N = 6;
const block = new UniformBlock( 'WhaleMarks', {
	marks: [ `vec4f[${ N }]`, new Array( N ).fill( 0 ).map( () => new Vector4( 0, 0, 1, 0 ) ) ],
}, { label: 'whaleMarks' } );
// three-style handle: whaleMarks.array[ k ].set( x, z, r, strength )
export const whaleMarks = { get array() { return block.fields.marks.value; } };

// foam and slick amounts at a surface point
export const whaleWaterModule = new ShaderModule( {
	name: 'whaleWater',
	uniforms: block,
	uniformName: 'whaleMarks',
	code: /* wgsl */`
fn whaleWater( xz: vec2f ) -> vec2f {
	var foam = 0.0; var slick = 0.0;
	for ( var i = 0; i < ${ N }; i++ ) {
		let e = whaleMarks.marks[ i ];
		let d = length( xz - e.xy ) / e.z;
		// (outside a mark, or an unused one, core or the amounts are 0)
		if ( d >= 1.0 || e.w == 0.0 ) { continue; }
		let core = 1.0 - smoothstep( 0.2, 1.0, d );
		// churned water breaks up into lumps and streaks with dark water between them, denser
		// toward the middle
		let q = xz * 0.8; let q2 = xz * 2.9;
		let n1 = sin( q.x + sin( q.y * 1.3 ) * 1.7 ) * sin( q.y * 1.1 + sin( q.x * 1.7 ) * 1.4 );
		let n2 = sin( q2.x * 1.1 + sin( q2.y ) * 1.3 ) * sin( q2.y * 0.9 + sin( q2.x * 1.2 ) );
		let lumps = smoothstep( -0.25, 0.55, n1 * 0.7 + n2 * 0.45 + ( 1.0 - d ) * 0.5 );
		foam = max( foam, core * max( e.w, 0.0 ) * lumps * 0.85 );
		slick = max( slick, core * max( - e.w, 0.0 ) );
	}
	return vec2f( foam, slick );
}
`,
} );

// CPU side: emits the patches from the whale's state; spray bursts of white water around the body
// as it breaks the surface.
const _p = new Vector3(), _v = new Vector3();
export class WhaleWater {

	constructor() {

		this.events = []; // { x, z, r, age, life, kind: 'foam' | 'slick', peak }
		this.foamTimer = 0;
		this.slickDone = false;
		this.breaches = 0;
		this.splashes = 0;

	}

	update( whale, dt, spray ) {

		const b = whale.brain;
		const d = b.water - b.position.y; // depth of the root below the surface
		const breaking = b.state === 'surface' && d < 1.6;
		if ( breaking ) {

			// churn: a new patch every ~1.2 s at mid-body while the back is out, spreading behind
			this.foamTimer -= dt;
			if ( this.foamTimer <= 0 ) {

				this.foamTimer = 1.2;
				whale.toWorld( _p.set( 0, whale.rest[ 8 ].y, whale.zHead - 5 ), _v );
				this.push( { x: _v.x, z: _v.z, r: 5.5, age: 0, life: 16, kind: 'foam', peak: 0.9 } );

			}

			// white water erupting along the flanks at the waterline
			if ( spray && Math.random() < dt * 30 ) {

				const side = Math.random() < 0.5 ? - 1 : 1;
				whale.toWorld( _p.set( side * 1.6, whale.rest[ 8 ].y, whale.zHead - 2 - Math.random() * 8 ), _v );
				_v.y = b.water + 0.05;
				spray.emit( _v, _p.set( ( Math.random() - 0.5 ) * 1.5, 1.6 + Math.random() * 1.6, ( Math.random() - 0.5 ) * 1.5 ), 10, 0.05, 0, { spread: 1.2, jitter: 0.4, life: 1.4 } );

			}

		}

		// breach: white water where it bursts out, a huge splash, spray and foam where it falls back
		if ( b.breaches !== this.breaches ) {

			this.breaches = b.breaches;
			whale.toWorld( _p.set( 0, whale.rest[ 2 ].y, whale.zHead - 2 ), _v );
			this.push( { x: _v.x, z: _v.z, r: 6, age: 0, life: 14, kind: 'foam', peak: 1 } );
			this.burst( whale, spray, _v, 5, 7, 18 );

		}

		if ( b.splashes !== this.splashes ) {

			this.splashes = b.splashes;
			whale.toWorld( _p.set( 0, whale.rest[ 8 ].y, whale.zHead - 5 ), _v );
			this.push( { x: _v.x, z: _v.z, r: 11, age: 0, life: 20, kind: 'foam', peak: 1 } );
			this.push( { x: _v.x + 3, z: _v.z - 2, r: 7, age: 0, life: 12, kind: 'foam', peak: 0.9 } );
			this.burst( whale, spray, _v, 9, 11, 26 );

		}

		// the fluke-up dive leaves a flat slick where the flukes went under
		if ( b.flukeUp > 0.6 && ! this.slickDone ) {

			this.slickDone = true;
			whale.toWorld( _p.set( 0, whale.rest[ whale.rest.length - 1 ].y, whale.manifest.notchZ ), _v );
			this.push( { x: _v.x, z: _v.z, r: 6, age: 0, life: 24, kind: 'slick', peak: 1 } );
			this.push( { x: _v.x, z: _v.z, r: 3.5, age: 0, life: 7, kind: 'foam', peak: 0.7 } );

		}

		if ( b.state !== 'surface' ) this.slickDone = false;

		// age the patches; write the uniform array
		const u = whaleMarks.array;
		for ( let k = 0; k < N; k ++ ) {

			const e = this.events[ k ];
			if ( ! e ) {

				u[ k ].set( 0, 0, 1, 0 );
				continue;

			}

			e.age += dt;
			const f = Math.max( 0, 1 - e.age / e.life );
			const grow = e.kind === 'foam' ? 1 + e.age * 0.06 : 1 + e.age * 0.02;
			u[ k ].set( e.x, e.z, e.r * grow, ( e.kind === 'foam' ? 1 : - 1 ) * e.peak * f * Math.min( 1, e.age * 3 ) );

		}

		this.events = this.events.filter( ( e ) => e.age < e.life );

	}

	// a ring of spray sheets, drops and mist around p (radius r, launch speed up)
	burst( whale, spray, p, r, up, n ) {

		if ( ! spray ) return;
		const water = whale.brain.water;
		for ( let k = 0; k < 9; k ++ ) {

			const a = k / 9 * Math.PI * 2 + Math.random() * 0.5;
			const q = new Vector3( p.x + Math.cos( a ) * r * ( 0.4 + Math.random() * 0.6 ), water + 0.2, p.z + Math.sin( a ) * r * ( 0.4 + Math.random() * 0.6 ) );
			const vel = new Vector3( Math.cos( a ) * 2.5, up * ( 0.6 + Math.random() * 0.5 ), Math.sin( a ) * 2.5 );
			spray.emit( q, vel, n, 0.3, 3, { spread: 2.4, jitter: 0.5, life: 2.8, sizeJitter: 0.8 } );
			spray.emit( q, vel.clone().multiplyScalar( 0.9 ), n * 2, 0.025, 0, { spread: 3, jitter: 0.4, life: 2.4 } );
			if ( k % 3 === 0 ) spray.emit( q, vel.clone().multiplyScalar( 0.5 ), n, 0.8, 1, { spread: 2.2, jitter: 0.6, life: 5 } );

		}

	}

	push( e ) {

		this.events.push( e );
		if ( this.events.length > N ) this.events.shift();

	}

}

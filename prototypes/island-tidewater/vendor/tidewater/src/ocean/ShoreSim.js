import { Vector2 } from '../engine/math/index.js';
import { GPU, Texture, StorageBuffer, UniformBlock, ShaderModule, ComputeKernel, commonModule } from '../engine/webgpu.js';
import { makeLaceTexture, LACE_TILE } from './SurfFoam.js';

// Eulerian state over the main beach, updated every frame on the GPU:
//   r = foam carried by the water (made by the bore roller, the plunge point, the swash front and
//       the spray falling back; advected with the actual flow: bores, uprush, backwash; thinned
//       where the flow spreads it out)
//   g = sand wetness (1 while covered, dries over ~half a minute)
//   b = foam stranded on the sand when the water drains away (pops over a few seconds)
//   a = depth-averaged flow speed along the local wave direction (m/s): carries the foam pattern
//       (SurfFoam flow map) and gives the divergence that thins the foam
//
// WGSL (this.module, prefix shoreSim; no sampler bindings, loads only):
//   fn shoreSimUvOf( xz: vec2f ) -> vec2f
//   fn shoreSimInside( uv: vec2f ) -> f32                 fade at the region border
//   fn shoreSimStateAt( uv: vec2f ) -> vec4f              bilinear state from 4 loads
//   fn shoreSimState( xz: vec2f ) -> vec4f                raw state, faded out at the region border
//   fn shoreSimSample( xz: vec2f ) -> vec4f               vec4( foam on the water, sand wetness, foam left on the sand, flow speed )
//   fn shoreSimLaceLoad( q: vec2f ) -> vec4f              bilinear lace lookup from loads (nearest copy)
//   fn shoreSimSandFoam( xz: vec2f, s: vec4f, h: f32 ) -> f32   foam left on the sand (0..1); s = shoreSimSample( xz ), h unused
// this.depositModule (read_write atomic binding, for the spray update kernel):
//   fn shoreSimDepositAt( xz: vec2f, n: u32 )             deposit foam where n spray drops fall back
export class ShoreSim {

	constructor( renderer, { terrainGPU, shore, center = new Vector2( 10, - 25 ), size = 380, res = 768 } ) {

		this.renderer = renderer;
		this.terrain = terrainGPU;
		this.shore = shore;
		this.res = res;
		this.uniforms = new UniformBlock( 'ShoreSimParams', {
			min: [ 'vec2f', new Vector2( center.x - size / 2, center.y - size / 2 ) ],
			size: [ 'f32', size ],
			dryTime: [ 'f32', 28 ],
			foamLife: [ 'f32', 4.5 ], // on the thin swash sheet
			surfFoamLife: [ 'f32', 2.6 ], // in the turbulent surf zone
			residueLife: [ 'f32', 5.0 ],
			foamGen: [ 'f32', 1.0 ],
			depositGain: [ 'f32', 0.02 ], // foam per drop
		} );
		const F = this.uniforms.fields;
		this.uMin = F.min;
		this.uSize = F.size;
		this.dryTime = F.dryTime;
		this.foamLife = F.foamLife;
		this.surfFoamLife = F.surfFoamLife;
		this.residueLife = F.residueLife;
		this.foamGen = F.foamGen;
		this.depositGain = F.depositGain;

		// tileable lace (bubble strands, bubbles, mottling, per-cell random), generated once on the CPU
		this.lace = makeLaceTexture();
		// cheap filtered wave direction over the region (lace motion, surf zone turbidity)
		shore.buildDirTexture( { min: new Vector2( center.x - size / 2, center.y - size / 2 ), size } );

		// nearest + read with loads everywhere (manual bilinear): no sampler binding in any material
		const make = ( name ) => new Texture( { label: name, width: res, height: res, format: 'rgba16float', usage: [ 'sample', 'storage', 'copySrc', 'copyDst' ] } );
		this.stateA = make( 'shoreStateA' ); // read by materials
		this.stateB = make( 'shoreStateB' ); // written by the sim

		// foam deposited by spray falling back into the water (drops per texel, atomic adds from the
		// spray update, consumed and cleared here)
		this.deposit = new StorageBuffer( { label: 'shoreDeposit', count: res * res, type: 'u32' } );

		const laceN = this.lace.userData.size;
		this.module = new ShaderModule( {
			name: 'shoreSim',
			deps: [ commonModule ],
			uniforms: this.uniforms,
			uniformName: 'shoreSimP',
			bindings: {
				shoreSimStateTex: { texture: this.stateA },
				shoreSimLaceNearest: { texture: this.lace.userData.nearest },
			},
			code: /* wgsl */`
const SHORE_SIM_RES: f32 = ${ res }.0;
const SHORE_SIM_LACE_TILE: f32 = ${ LACE_TILE };

fn shoreSimUvOf( xz: vec2f ) -> vec2f {
	return ( xz - shoreSimP.min ) / shoreSimP.size;
}

fn shoreSimInside( uv: vec2f ) -> f32 {
	return smoothstep( 0.0, 0.02, uv.x ) * smoothstep( 1.0, 0.98, uv.x ) * smoothstep( 0.0, 0.02, uv.y ) * smoothstep( 1.0, 0.98, uv.y );
}

// bilinear state at texture coordinate uv, from 4 loads
fn shoreSimStateAt( uv: vec2f ) -> vec4f {
	let fp = clamp( uv * SHORE_SIM_RES - 0.5, vec2f( 0.0 ), vec2f( SHORE_SIM_RES - 1.001 ) );
	let i = vec2i( floor( fp ) );
	let t = fract( fp );
	let a = textureLoad( shoreSimStateTex, i, 0 );
	let b = textureLoad( shoreSimStateTex, i + vec2i( 1, 0 ), 0 );
	let c = textureLoad( shoreSimStateTex, i + vec2i( 0, 1 ), 0 );
	let d = textureLoad( shoreSimStateTex, i + vec2i( 1, 1 ), 0 );
	return mix( mix( a, b, t.x ), mix( c, d, t.x ), t.y );
}

// raw state (foam, wetness, residue amount, lace offset), faded out at the region border
fn shoreSimState( xz: vec2f ) -> vec4f {
	let uv = shoreSimUvOf( xz );
	var out = vec4f( 0.0 );
	if ( uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0 ) {
		out = shoreSimStateAt( uv ) * shoreSimInside( uv );
	}
	return out;
}

// vec4( foam amount on the water, sand wetness, foam amount left on the sand, flow speed ).
// Used by the water (x, w), the underwater lighting (x) and the terrain (y, z; for the lacy look
// of the foam left on the sand use shoreSimSandFoam()). No sampler bindings.
fn shoreSimSample( xz: vec2f ) -> vec4f {
	return shoreSimState( xz );
}

// bilinear lace lookup from 4 loads of the nearest-filtered copy (no sampler binding needed)
fn shoreSimLaceLoad( q: vec2f ) -> vec4f {
	let fp = q / SHORE_SIM_LACE_TILE * ${ laceN }.0 - 0.5;
	let i = vec2i( floor( fp ) );
	let t = fract( fp );
	let m = vec2i( ${ laceN - 1 } );
	let a = textureLoad( shoreSimLaceNearest, i & m, 0 );
	let b = textureLoad( shoreSimLaceNearest, ( i + vec2i( 1, 0 ) ) & m, 0 );
	let c = textureLoad( shoreSimLaceNearest, ( i + vec2i( 0, 1 ) ) & m, 0 );
	let d = textureLoad( shoreSimLaceNearest, ( i + vec2i( 1, 1 ) ) & m, 0 );
	return mix( mix( a, b, t.x ), mix( c, d, t.x ), t.y );
}

// Foam left on the sand (0..1): thin bubble lines and single bubbles where the draining water
// left its foam, popping patch by patch as it dries. Static on the sand (world space). s:
// shoreSimSample( xz ). (h: the ground height at xz, unused.)
fn shoreSimSandFoam( xz: vec2f, s: vec4f, h: f32 ) -> f32 {
	let r = s.z;
	// (screen-space footprint first: derivatives before the branch)
	let fp = length( fwidth( xz ) ) / SHORE_SIM_LACE_TILE * ${ laceN }.0;
	var out = 0.0;
	if ( r > 0.01 ) {
		let lace = shoreSimLaceLoad( xz + 11.3 );
		// fade to the average where a pixel covers several strands (no mipmaps on the load path)
		let near = smoothstep( 3.0, 1.2, fp );
		let keep = smoothstep( lace.w * 0.55, lace.w * 0.55 + 0.08, r ); // staggered popping
		// thin bubble lines where the strands were, a little wider where more foam was left
		let lw = r * 0.1 + 0.06;
		let strand = ( 1.0 - smoothstep( lw, lw + 0.07, lace.x ) ) * ( lace.z * 0.5 + 0.6 );
		let lines = max( strand * smoothstep( 0.02, 0.25, r ) * keep, lace.y * keep * 0.8 );
		out = mix( smoothstep( 0.08, 0.6, r ) * 0.12, lines, near ) * 0.85;
	}
	return out;
}
`,
		} );

		// Deposit foam where spray falls back (compute): n drops at world xz
		this.depositModule = new ShaderModule( {
			name: 'shoreSimDeposit',
			deps: [ this.module ],
			bindings: { shoreSimDepositA: { storage: this.deposit, access: 'read_write', type: 'atomic<u32>' } },
			code: /* wgsl */`
fn shoreSimDepositAt( xz: vec2f, n: u32 ) {
	let uv = shoreSimUvOf( xz );
	if ( uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0 ) {
		let ij = vec2u( uv * SHORE_SIM_RES );
		atomicAdd( &shoreSimDepositA[ ij.y * ${ res }u + ij.x ], n );
	}
}
`,
		} );

		this.kernel = new ComputeKernel( {
			label: 'Shore Sim',
			modules: [ this.module, shore.module, terrainGPU.module ],
			workgroupSize: [ 8, 8, 1 ],
			bindings: {
				shoreSimOut: { storageTexture: this.stateB, access: 'write' },
				shoreSimDeposit: { storage: this.deposit, access: 'read_write', type: 'u32' },
				shoreSimLace: { texture: this.lace },
			},
			code: /* wgsl */`
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	if ( gid.x >= ${ res }u || gid.y >= ${ res }u ) { return; }
	let ij = vec2f( gid.xy );
	let uv = ( ij + 0.5 ) / SHORE_SIM_RES;
	let p = shoreSimP.min + uv * shoreSimP.size;
	let ground = terrainHeightAt( p );
	let depth = frame.seaLevel - ground;
	let dt = frame.dt;

	let here = textureLoad( shoreSimStateTex, vec2i( gid.xy ), 0 );
	let di = gid.y * ${ res }u + gid.x;
	let drops = f32( shoreSimDeposit[ di ] );
	if ( drops > 0.0 ) {
		shoreSimDeposit[ di ] = 0u;
	}

	// far from the surf and swash zone nothing happens: just let everything decay
	if ( depth > 7.0 || ground > 3.2 ) {
		let k = exp( - dt / 2.0 );
		textureStore( shoreSimOut, gid.xy, vec4f( here.x * k, here.y * exp( - dt / shoreSimP.dryTime ), here.z * k, 0.0 ) );
		return;
	}

	let sw = shoreEvaluateWorld( p, depth, ground );

	// fraction of this texel covered by water: open water, or the swash sheet up to its leading
	// edge (soft over one texel, so no field stored here shows the texel grid)
	let cov = select( sat( ( sw.runup - sw.inland ) / ( shoreSimP.size / SHORE_SIM_RES ) + 0.5 ), 1.0, depth > 0.03 );
	let covered = cov > 0.5;
	let vel = select( vec2f( 0.0 ), sw.flow, covered );

	// semi-Lagrangian advection (backtrace)
	let back = uv - vel * dt / shoreSimP.size;
	let prev = shoreSimStateAt( back );

	// foam: made where the bore roller / plunge point / swash front pass, torn into patches by
	// the mottling of the lace texture, then it decays (bubbles rising and popping) and drains
	// into the sand once the water has gone
	let mott = textureSampleLevel( shoreSimLace, smpLinearRepeat, p / ( SHORE_SIM_LACE_TILE * 4.3 ), 2.0 ).z;
	let patchK = smoothstep( 0.25, 0.75, mott ) * 0.8 + 0.35;
	let swashy = smoothstep( 0.35, 0.05, depth );
	// dense foam collapses within a second or two (big bubbles burst first), the lace it leaves lingers
	let lace = mix( shoreSimP.surfFoamLife, shoreSimP.foamLife, swashy );
	let life = mix( 0.7, mix( lace, 0.8, smoothstep( 0.3, 0.8, prev.x ) ), cov );
	let gen = ( sw.foam * 2.2 + sw.swashFoam * 1.4 ) * patchK * cov;
	// the foam is diluted where the flow spreads it out (the uprush thinning as it climbs, the
	// backwash draining): d(foam)/dt = - foam * du/ds along the flow
	let h = shoreSimP.size / SHORE_SIM_RES;
	let dirH = sw.dir * ( h / shoreSimP.size );
	let uAhead = shoreSimStateAt( uv + dirH ).w;
	let uBehind = shoreSimStateAt( uv - dirH ).w;
	let spreadRate = max( ( uAhead - uBehind ) / ( 2.0 * h ), 0.0 );
	let splash = drops * shoreSimP.depositGain * cov;
	let foam = min( prev.x * exp( - dt * ( 1.0 / life + spreadRate ) ) + gen * shoreSimP.foamGen * dt + splash, 1.0 );

	// wetness: saturated while covered, then dries
	let wet = max( here.y * exp( - dt / shoreSimP.dryTime ), cov );

	// residue: foam stranded on the sand when the water leaves (the draining film gathers its
	// bubbles into lines, so it concentrates); washed away by the next uprush
	let stranded = min( here.x * 2.4, 1.0 ) * ( 1.0 - cov );
	let residue = max( here.z * mix( exp( - dt / shoreSimP.residueLife ), 0.85, cov ), stranded );

	textureStore( shoreSimOut, gid.xy, vec4f( foam, wet, residue, dot( vel, sw.dir ) ) );
}
`,
		} );

	}

	update() {

		this.kernel.dispatch( this.kernel.groups( this.res, this.res ) );
		const size = { width: this.res, height: this.res };
		GPU.getEncoder().copyTextureToTexture( { texture: this.stateB.getGPU() }, { texture: this.stateA.getGPU() }, size );

	}

}

import { ShaderModule, UniformBlock } from '../engine/gpu/Shader.js';
import { ComputeKernel } from '../engine/gpu/Compute.js';
import { StorageBuffer } from '../engine/gpu/Texture.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { Matrix4, Vector2 } from '../engine/math/index.js';

// Camera + object motion blur: reconstruction filter (McGuire et al. 2012, "A Reconstruction Filter
// for Plausible Motion Blur") with the Call of Duty: Advanced Warfare refinements (Jimenez 2014):
//   1. tile max: per 20x20 output-pixel tile the longest velocity (and the shortest, for the fast path)
//   2. neighbour max: the longest over the 3x3 tiles around each tile (every streak reaching a pixel
//      starts within one tile of it, as a streak is capped to one tile length each way)
//   3. gather, inlined in the final pass: ~4-12 jittered samples (interleaved gradient noise, new
//      offset every frame) along the neighbourhood's dominant motion and the pixel's own motion, with
//      soft depth comparisons: a moving foreground smears over the background, a static foreground
//      stays sharp over a moving background. Tiles whose velocities are all alike (camera rotation)
//      take a fast colour-only path; tiles with no motion (< 0.5 px) skip it and stay pixel-identical.
// Runs on the temporally resolved image at the output resolution, before bloom and the lens effects.
// Velocity: uv-space motion (current - previous, y down), unjittered (so the TAA jitter never blurs);
// the three.js version read NDC motion, the conversions below are adjusted accordingly.
//
// WGSL (this.module, prefix `mb`): fn mbApply( sharpColor: vec3f, uv: vec2f ) -> vec3f (the former
// apply()). `color` is a getter of the texture the blur gathers (the resolved image).
const TILE = 20; // tile side in output pixels = maximum blur radius (streak <= 2 * TILE)
const WG = 10; // tile-max threads per side, each reducing a 2x2 pixel block
const MAX_TILES_X = 400, MAX_TILES_Y = 224; // up to 8000 x 4480 output pixels

const SHARED = /* wgsl */`
const MB_TILE: f32 = ${ TILE }.0;
const MB_MAX_TILES_X: i32 = ${ MAX_TILES_X };

// uv motion (current - previous) of the pixel at uv with reversed-Z depth d (sky = 0): sky pixels
// reproject their far-plane points with last frame's unjittered camera
fn mbUvVelocity( vel: vec4f, uv: vec2f, d: f32 ) -> vec2f {
	let ndc = ( uv * 2.0 - 1.0 ) * vec2f( 1.0, -1.0 );
	let prev = mbParams.skyReproj * vec4f( ndc, 0.0, 1.0 );
	return select( ( ndc - prev.xy / prev.w ) * vec2f( 0.5, -0.5 ), vel.xy, d > 1e-7 );
}

// uv velocity -> half streak vector in output pixels (shutter applied, capped at one tile)
fn mbToPx( vel: vec2f ) -> vec2f {
	let v = vel * mbParams.outSize * ( mbParams.shutter * 0.5 );
	let l = length( v );
	return v * min( 1.0, MB_TILE / max( l, 1e-6 ) );
}
`;

export class MotionBlur {

	constructor( { velocityTexture, depthTexture, color } ) {

		this.uniforms = new UniformBlock( 'MotionBlurParams', {
			// sky pixels (depth 0): reproject their far-plane points with last frame's unjittered camera
			skyReproj: [ 'mat4x4f', new Matrix4() ],
			outSize: [ 'vec2f', new Vector2( 1, 1 ) ],
			tileCount: [ 'vec2f', new Vector2( 1, 1 ) ],
			// fraction of the frame time the shutter is open: 0.5 = 180 degree shutter, 0 = off
			shutter: [ 'f32', 0.5 ],
			frameIndex: [ 'f32', 0 ],
		}, { label: 'motionBlur' } );
		const U = this.uniforms.fields;
		this.shutter = U.shutter;
		this.outSize = U.outSize;
		this.tileCount = U.tileCount;
		this.frameIndex = U.frameIndex;
		this.skyReproj = U.skyReproj;
		this._vp = new Matrix4();
		this._prevVP = new Matrix4();
		this._hasPrev = false;
		this.color = color; // Texture or getter
		this.velocityTexture = velocityTexture;
		this.depthTexture = depthTexture;
		this.tileMax = new StorageBuffer( { label: 'mbTileMax', count: MAX_TILES_X * MAX_TILES_Y, type: 'vec4f' } );
		this.neighborMax = new StorageBuffer( { label: 'mbNeighborMax', count: MAX_TILES_X * MAX_TILES_Y, type: 'vec4f' } );
		this._frame = 0;
		this._buildKernels();

		const colorTex = () => ( typeof this.color === 'function' ? this.color() : this.color );
		this.module = new ShaderModule( {
			name: 'motionBlur',
			deps: [ commonModule ],
			uniforms: this.uniforms,
			uniformName: 'mbParams',
			bindings: {
				mbVelocity: { texture: () => this.velocityTexture },
				mbDepth: { texture: () => this.depthTexture },
				mbColor: { texture: colorTex },
				mbNeighbor: { storage: this.neighborMax, access: 'read' },
			},
			code: SHARED + /* wgsl */`
fn mbTexel( uv: vec2f, inSize: vec2f ) -> vec2i { return clamp( vec2i( uv * inSize ), vec2i( 0 ), vec2i( inSize ) - 1 ); }
fn mbSample( uv: vec2f ) -> vec3f { return textureSampleLevel( mbColor, smpLinearClamp, uv, 0.0 ).rgb; }

// Motion-blurred colour at uv. sharpColor = the (sharpened) unblurred colour at uv, returned
// unchanged where nothing moves; the blur itself reads the unsharpened resolved image, so
// sharpening never acts on blurred pixels.
fn mbApply( sharpColor: vec3f, uvIn: vec2f ) -> vec3f {
	var out = sharpColor;
	if ( mbParams.shutter > 0.0 ) {
		let pix = uvIn * mbParams.outSize;
		let tile = clamp( vec2i( floor( pix / MB_TILE ) ), vec2i( 0 ), vec2i( mbParams.tileCount ) - 1 );
		let nm = mbNeighbor[ tile.y * MB_MAX_TILES_X + tile.x ];
		let nmLen = nm.z;
		if ( nmLen >= 0.5 ) {
			let inSize = vec2f( textureDimensions( mbVelocity ) );
			let cX = mbTexel( uvIn, inSize );
			let dX = textureLoad( mbDepth, cX, 0 );
			let vX = mbToPx( mbUvVelocity( textureLoad( mbVelocity, cX, 0 ), uvIn, dX ) );
			let lenX = length( vX );
			// interleaved gradient noise, shifted every frame
			let pn = floor( pix ) + mbParams.frameIndex * 5.588238;
			let jitter = fract( fract( dot( pn, vec2f( 0.06711056, 0.00583715 ) ) ) * 52.9829189 ) - 0.5;
			// sample pairs: ~3 px apart along the streak, 2..6 pairs
			let pairs = i32( clamp( ceil( nmLen / 3.0 ), 2.0, 6.0 ) );
			let invSize = 1.0 / mbParams.outSize;
			var acc = vec3f( 0.0 );
			let fade = sat( nmLen - 0.5 ); // continuous with the early-out below 0.5 px

			if ( nm.w > nmLen * 0.75 ) {
				// fast path: all streaks in the neighbourhood alike (camera rotation, distant scenery):
				// a plain directional average along the pixel's own motion
				for ( var i = 0; i < pairs; i++ ) {
					let tt = ( f32( i ) + 0.5 + jitter ) / f32( pairs );
					let o = vX * tt * invSize;
					acc += mbSample( uvIn + o );
					acc += mbSample( uvIn - o );
				}
				out = mix( sharpColor, acc / ( f32( pairs ) * 2.0 ), fade );
			} else {
				// full reconstruction: soft depth classification of each sample against the centre
				var wSum = 0.0;
				let dirX = select( nm.xy, vX, lenX > 0.5 );
				for ( var i = 0; i < pairs; i++ ) {
					let tt = ( f32( i ) + 0.5 + jitter ) / f32( pairs );
					// alternate between the neighbourhood's dominant direction and the pixel's own (Jimenez 2014)
					let dir = select( nm.xy, dirX, ( i & 1 ) == 1 );
					let off = dir * tt;
					let offLen = length( off );
					for ( var k = 0; k < 2; k++ ) {
						let sgn = select( -1.0, 1.0, k == 0 );
						let uvY = uvIn + off * invSize * sgn;
						let tY = mbTexel( uvY, inSize );
						let dY = textureLoad( mbDepth, tY, 0 );
						let lenY = length( mbToPx( mbUvVelocity( textureLoad( mbVelocity, tY, 0 ), uvY, dY ) ) );
						// reversed-Z depth ~ 1/distance: q > 0 when the sample is farther than the centre
						let q = ( dX - dY ) / max( max( dX, dY ), 1e-12 );
						let behind = sat( q * 40.0 + 0.5 );
						// a sample behind the centre shows through the centre's own streak; one in front
						// covers the centre when its streak reaches it (1 px soft cylinders)
						let spreadX = sat( lenX - max( offLen - 1.0, 0.0 ) );
						let spreadY = sat( lenY - max( offLen - 1.0, 0.0 ) );
						let w = behind * spreadX + ( 1.0 - behind ) * spreadY;
						acc += mbSample( uvY ) * w;
						wSum += w;
					}
				}
				// whatever the samples don't cover is this pixel's own (sharpened) colour
				let n = f32( pairs ) * 2.0;
				let res = acc / n + sharpColor * max( 1.0 - wSum / n, 0.0 );
				out = mix( sharpColor, res, fade );
			}
		}
	}
	return out;
}
`,
		} );

	}

	_buildKernels() {

		const N = WG * WG;
		let reduce = '';
		for ( let s = 64; s > 0; s >>= 1 ) {

			reduce += /* wgsl */`
	if ( t < ${ s }u && t + ${ s }u < ${ N }u ) {
		let a = mbShared[ t ];
		let b = mbShared[ t + ${ s }u ];
		let m = select( a, b, b.z > a.z );
		mbShared[ t ] = vec4f( m.xyz, min( a.w, b.w ) );
	}
	workgroupBarrier();`;

		}

		const common = { mbParams: { uniform: this.uniforms } };
		this.tileKernel = new ComputeKernel( {
			label: 'Motion Blur Tiles',
			modules: [ commonModule ],
			bindings: {
				...common,
				mbVelocity: { texture: () => this.velocityTexture },
				mbDepth: { texture: () => this.depthTexture },
				mbTileMaxRW: { storage: this.tileMax, access: 'read_write' },
			},
			workgroupSize: [ WG, WG, 1 ],
			code: SHARED + /* wgsl */`
var<workgroup> mbShared: array<vec4f, ${ N }>;
@compute @workgroup_size( WG_X, WG_Y, 1 )
fn main( @builtin( local_invocation_id ) lid: vec3u, @builtin( workgroup_id ) wid: vec3u ) {
	let t = lid.y * ${ WG }u + lid.x;
	let inSize = vec2i( textureDimensions( mbVelocity ) );
	var best = vec2f( 0.0 ); var bestL = 0.0; var minL = 1e8;
	for ( var k = 0; k < 4; k++ ) {
		let o = vec2u( u32( k & 1 ), u32( k >> 1u ) );
		let p = vec2f( wid.xy * ${ TILE }u + lid.xy * 2u + o ) + 0.5;
		let q = min( vec2i( p / mbParams.outSize * vec2f( inSize ) ), inSize - 1 );
		let v = mbToPx( mbUvVelocity( textureLoad( mbVelocity, q, 0 ), p / mbParams.outSize, textureLoad( mbDepth, q, 0 ) ) );
		let l = dot( v, v );
		if ( l > bestL ) {
			bestL = l;
			best = v;
		}
		minL = min( minL, l );
	}
	mbShared[ t ] = vec4f( best, bestL, minL );
	workgroupBarrier();
${ reduce }
	if ( t == 0u ) {
		let r = mbShared[ 0 ];
		let idx = i32( wid.y ) * MB_MAX_TILES_X + i32( wid.x );
		// xy = longest half streak (px), z = its length, w = shortest length in the tile
		mbTileMaxRW[ idx ] = vec4f( r.xy, sqrt( r.z ), sqrt( r.w ) );
	}
}
`,
		} );

		let neigh = '';
		for ( let dy = - 1; dy <= 1; dy ++ ) for ( let dx = - 1; dx <= 1; dx ++ ) {

			let take = 'm.z > best.z';
			if ( dx !== 0 && dy !== 0 ) {

				// a diagonal tile only matters when its streak runs toward this tile (Jimenez 2014)
				const d = [ - dx * Math.SQRT1_2, - dy * Math.SQRT1_2 ];
				take += ` && abs( dot( m.xy, vec2f( ${ d[ 0 ] }, ${ d[ 1 ] } ) ) ) > m.z * 0.7`;

			}

			neigh += /* wgsl */`
		{
			let x = clamp( tx + ${ dx }, 0, nx - 1 ); let y = clamp( ty + ${ dy }, 0, ny - 1 );
			let m = mbTileMaxR[ y * MB_MAX_TILES_X + x ];
			if ( ${ take } ) { best = m; }
			minL = min( minL, m.w );
		}`;

		}

		this.neighborKernel = new ComputeKernel( {
			label: 'Motion Blur Neighbourhood',
			modules: [ commonModule ],
			bindings: {
				...common,
				mbTileMaxR: { storage: this.tileMax, access: 'read' },
				mbNeighborRW: { storage: this.neighborMax, access: 'read_write' },
			},
			workgroupSize: [ 8, 8, 1 ],
			code: /* wgsl */`
const MB_MAX_TILES_X: i32 = ${ MAX_TILES_X };
@compute @workgroup_size( WG_X, WG_Y, 1 )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	let tx = i32( gid.x ); let ty = i32( gid.y );
	let nx = i32( mbParams.tileCount.x ); let ny = i32( mbParams.tileCount.y );
	if ( tx < nx && ty < ny ) {
		var best = vec4f( 0.0 ); var minL = 1e8;
${ neigh }
		// xy = dominant half streak (px), z = its length, w = shortest streak in the neighbourhood
		mbNeighborRW[ ty * MB_MAX_TILES_X + tx ] = vec4f( best.xyz, minL );
	}
}
`,
		} );

	}

	// Per frame before the TAA jitter is applied (unjittered camera matrices).
	updateCamera( camera ) {

		camera.updateMatrixWorld();
		if ( camera.matrixWorldInverse ) camera.matrixWorldInverse.copy( camera.matrixWorld ).invert();
		this._vp.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
		if ( ! this._hasPrev ) this._prevVP.copy( this._vp );
		this._hasPrev = true;
		// previous view-projection * inverse current: far-plane NDC -> last frame's clip position
		this.skyReproj.value.copy( this._vp ).invert().premultiply( this._prevVP );
		this._prevVP.copy( this._vp );

	}

	// Per frame, after the scene render (velocity + depth ready) and before the final pass.
	// width / height: output (drawing buffer) size
	compute( width, height ) {

		if ( this.shutter.value <= 0 ) return;
		const tx = Math.min( MAX_TILES_X, Math.ceil( width / TILE ) );
		const ty = Math.min( MAX_TILES_Y, Math.ceil( height / TILE ) );
		this.outSize.value.set( width, height );
		this.tileCount.value.set( tx, ty );
		this._frame = ( this._frame + 1 ) % 64;
		this.frameIndex.value = this._frame;
		this.tileKernel.dispatch( [ tx, ty, 1 ] );
		this.neighborKernel.dispatch( [ Math.ceil( tx / 8 ), Math.ceil( ty / 8 ), 1 ] );

	}

}

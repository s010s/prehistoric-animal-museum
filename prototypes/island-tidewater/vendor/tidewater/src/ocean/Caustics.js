import { GPU, UniformBlock, Texture, ShaderModule, composeShader, createShaderModule } from '../engine/webgpu.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { ComputeMips } from './ComputeMips.js';

// Caustics by rasterized photon splatting (as in Evan Wallace's "WebGL Water").
//
// A fine grid covering one FFT tile is drawn into an offscreen target. Each vertex is a point on
// the real wave surface; the sun ray is refracted through the surface normal there and followed
// down to a plane `D` metres below, and the vertex is placed at that landing point. The fragment
// writes (area on the surface / area on the floor) with additive blending, which is exactly the
// light concentration, so focusing folds form the bright caustic networks physically. The grid
// covers the tile plus a margin on every side (the FFT tiles, so the margin is the neighbouring
// tiles' surface): light refracted in from across the tile edge lands inside it, and the result
// tiles seamlessly (no finite area). Landing offsets stay well under the margin at these depths.
//
// Two focal planes are rendered (R = shallow, G = deep) and blended by the real depth at lookup.
// A second, larger tile from the next cascade adds broad focusing so the result never repeats.
//
// WGSL module (`caustics.module`, prefix `caustics`; built on first access, after `detail` is set):
//   fn causticsSample( P: vec3f, depth: f32, slope: vec2f, foam: f32, gdx: vec2f, gdy: vec2f ) -> vec3f
//        caustic light factor (mean ~1); gdx / gdy = dpdx / dpdy of P.xz (the pixel footprint)
//   fn causticsSampleLevel( P: vec3f, depth: f32, level: f32 ) -> vec3f   flat surface, fixed blur level
//   fn causticsSampleBaked( P, depth, slope, foam, gdx, gdy, detailK: f32 ) -> vec3f
//        as causticsSample, with the gust / slick factor precomputed (UnderwaterLighting's baked map)
//   fn causticsSampleBakedMono( ... )  same without the chromatic dispersion (the refraction source)
//   fn causticsSampleShaft( P: vec3f, depth: f32, level: f32, detailK: f32 ) -> vec3f
//        flat surface, one fine lookup (no dispersion) and a precomputed gust / slick factor: for
//        ray marches (the factor varies over hundreds of metres: take it once per pixel)
//   fn causticsDetailK( xz: vec2f ) -> f32   that gust / slick factor
class CausticLayer {

	constructor( fft, cascade, { res, grid, depths, name, slopeLevel, margin } ) {

		this.fft = fft;
		this.cascade = cascade;
		this.tile = fft.sizes[ cascade ];
		this.res = res;
		// [-margin, 1 + margin]^2 at the same vertex density as the tile
		this.margin = margin;
		this.grid = Math.ceil( grid * ( 1 + 2 * margin ) );
		this.depths = depths;

		// the floor is mostly seen at grazing angles: filter along the view (anisotropic sampler at
		// lookup), stay sharp across it
		this.texture = new Texture( { label: name, width: res, height: res, format: 'rgba16float', mips: true, usage: [ 'sample', 'render', 'storage', 'copyDst', 'copySrc' ], sampler: 'anisoRepeat' } );
		this.target = { texture: this.texture };

		// indexed grid: each surface vertex is shaded once (the post-transform cache shares it
		// between its 6 triangles) instead of once per triangle corner
		const g = this.grid, row = g + 1;
		const idx = new Uint32Array( g * g * 6 );
		for ( let y = 0, i = 0; y < g; y ++ ) for ( let x = 0; x < g; x ++ ) {

			const a = y * row + x;
			idx[ i ++ ] = a; idx[ i ++ ] = a + 1; idx[ i ++ ] = a + row;
			idx[ i ++ ] = a + row; idx[ i ++ ] = a + 1; idx[ i ++ ] = a + row + 1;

		}

		this.indexCount = idx.length;
		this.indexBuffer = GPU.device.createBuffer( { label: name + ' indices', size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST } );
		GPU.queue.writeBuffer( this.indexBuffer, 0, idx );
		// box-filtered mips in compute (instead of a render pass per level)
		this.mipChain = new ComputeMips( this.texture, name );

		const L = this.tile;
		this.pipelines = [];

		for ( let k = 0; k < depths.length; k ++ ) {

			const D = depths[ k ];
			const code = /* wgsl */`
struct CauOut { @builtin( position ) pos: vec4f, @location( 0 ) vOld: vec2f, @location( 1 ) vNew: vec2f };

@vertex fn vs( @builtin( vertex_index ) vi: u32 ) -> CauOut {
	// vertex of a ${ this.grid } x ${ this.grid } quad grid over [-margin, 1 + margin]^2 (indexed)
	let cx = vi % ${ this.grid + 1 }u; let cy = vi / ${ this.grid + 1 }u;
	let uv = vec2f( vec2u( cx, cy ) ) / ${ this.grid }.0 * ${ ( 1 + 2 * margin ).toFixed( 4 ) } - ${ margin.toFixed( 4 ) };
	let d = textureSampleLevel( oceanDerivatives, smpLinearRepeat, uv, ${ cascade }, ${ slopeLevel.toFixed( 3 ) } );
	let s = vec2f( d.x / max( d.z + 1.0, 0.3 ), d.y / max( d.w + 1.0, 0.3 ) );
	let n = normalize( vec3f( - s.x, 1.0, - s.y ) );
	let T = refract( - frame.sunDir, n, 1.0 / 1.333 );
	let tDown = max( - T.y, 0.15 );
	// flat-surface refraction offset is removed so the pattern stays registered with the
	// entry point (the lookup re-applies it with the real depth)
	let T0 = refract( - frame.sunDir, vec3f( 0.0, 1.0, 0.0 ), 1.0 / 1.333 );
	let off = ( T.xz / tDown - T0.xz / max( - T0.y, 0.15 ) ) * ${ D.toFixed( 3 ) };
	let p = uv * ${ L };
	let qq = p + off;
	var o: CauOut;
	o.vOld = p;
	o.vNew = qq;
	let ndc = qq / ${ L } * 2.0 - 1.0;
	o.pos = vec4f( ndc.x, ndc.y, 0.0, 1.0 );
	return o;
}

@fragment fn fs( in: CauOut ) -> @location( 0 ) vec4f {
	// area ratio between the surface patch and its image on the floor
	let ao = abs( dpdx( in.vOld ).x * dpdy( in.vOld ).y - dpdx( in.vOld ).y * dpdy( in.vOld ).x );
	let an = abs( dpdx( in.vNew ).x * dpdy( in.vNew ).y - dpdx( in.vNew ).y * dpdy( in.vNew ).x );
	// soft limit: a single nearly-folded cell must not become a flat white hot spot (the
	// finite sun disk spreads real caustic peaks to a few times the mean anyway)
	let I = ao / max( an + ao * ( 1.0 / 8.0 ), 1e-9 );
	return vec4f( ${ k === 0 ? 'I' : '0.0' }, ${ k === 1 ? 'I' : '0.0' }, 0.0, 1.0 );
}
`;
			const c = composeShader( { modules: [ commonModule, fft.module ], code, stage: 'render', label: name } );
			const module = createShaderModule( c.code, name );
			const add = { srcFactor: 'one', dstFactor: 'one', operation: 'add' };
			const pipeline = GPU.renderPipeline( {
				label: name + k,
				layout: GPU.device.createPipelineLayout( { bindGroupLayouts: [ c.group0.layout, c.bindings.layout ] } ),
				vertex: { module, entryPoint: 'vs' },
				fragment: { module, entryPoint: 'fs', targets: [ { format: 'rgba16float', blend: { color: add, alpha: add } } ] },
				primitive: { topology: 'triangle-list', cullMode: 'none' },
			} );
			this.pipelines.push( { pipeline, bindings: c.bindings, group0: c.group0 } );

		}

	}

	render() {

		const enc = GPU.getEncoder();
		const rp = enc.beginRenderPass( {
			label: this.texture.label,
			colorAttachments: [ { view: this.texture.view( { dimension: '2d', baseMipLevel: 0, mipLevelCount: 1 } ), clearValue: [ 0, 0, 0, 0 ], loadOp: 'clear', storeOp: 'store' } ],
		} );
		rp.setIndexBuffer( this.indexBuffer, 'uint32' );
		for ( const p of this.pipelines ) {

			rp.setPipeline( GPU.ready( p.pipeline ) );
			rp.setBindGroup( 0, p.group0.getBindGroup() );
			rp.setBindGroup( 1, p.bindings.getBindGroup() );
			rp.drawIndexed( this.indexCount, 1 );

		}

		rp.end();

	}

	mips( pass ) {

		this.mipChain.dispatch( pass );

	}

}

export class Caustics {

	constructor( renderer, fft ) {

		this.renderer = renderer;
		this.fft = fft;
		this.params = new UniformBlock( 'CausticsParams', { strength: [ 'f32', 0.75 ] }, { label: 'caustics' } );
		this.strength = this.params.fields.strength;
		this.detail = null; // SeaDetail: rougher water in gusts focuses more, slicks less
		const fine = fft.cascades - 1;
		// fine networks (finest cascade, ripples < ~11 cm filtered out: they defocus immediately)
		this.fine = new CausticLayer( fft, fine, { res: 512, grid: 256, depths: [ 1.2, 4.0 ], name: 'causticsFine', slopeLevel: 1, margin: 0.35 } );
		// broad focusing from the next cascade; different tile size -> no visible repetition
		this.broad = new CausticLayer( fft, fine - 1, { res: 256, grid: 128, depths: [ 3.0, 9.0 ], name: 'causticsBroad', slopeLevel: 0.5, margin: 0.35 } );
		this._module = null;

	}

	update() {

		this.fine.render( this.renderer );
		this.broad.render( this.renderer );
		GPU.computePass( 'Caustics Mips', ( pass ) => {

			this.fine.mips( pass );
			this.broad.mips( pass );

		} );

	}

	// Caustic light factor (vec3, mean ~1) at a world point `depth` meters below the surface.
	//   slope: vec2 slope (dh/dx, dh/dz) of the long waves above (swell, shore waves). Their
	//          refraction tilts the light, so the whole network sways as each wave passes.
	//   foam:  surface foam / bubble coverage above (0..1): diffuses the light, kills the network
	//   gdx / gdy: change of world xz across one pixel (fragment derivatives): the networks are
	//          filtered over the pixel's footprint, anisotropically. Without it the fixed blur level
	//          aliases into crawling noise on distant or grazing floors.
	get module() {

		if ( this._module ) return this._module;
		const det = this.detail;
		const F = this.fine, B = this.broad;
		this._module = new ShaderModule( {
			name: 'caustics',
			deps: [ commonModule, det ? det.module : null ],
			uniforms: this.params,
			uniformName: 'caustics',
			bindings: {
				causticsFineTex: { texture: F.texture },
				causticsBroadTex: { texture: B.texture },
			},
			code: /* wgsl */`
// the blur level is the least filtering; with a footprint, each gradient is stretched to at
// least that level's texel size
fn _causticsStretch( g: vec2f, minLen: f32 ) -> vec2f { return g * max( minLen / max( length( g ), 1e-9 ), 1.0 ); }
fn _causticsFetchFine( uv: vec2f, lvl: f32, gdx: vec2f, gdy: vec2f, useGrad: bool ) -> vec4f {
	if ( ! useGrad ) { return textureSampleLevel( causticsFineTex, smpAnisoRepeat, uv, lvl ); }
	let minLen = exp2( lvl ) / ${ F.res }.0;
	return textureSampleGrad( causticsFineTex, smpAnisoRepeat, uv, _causticsStretch( gdx / ${ F.tile }, minLen ), _causticsStretch( gdy / ${ F.tile }, minLen ) );
}
fn _causticsFetchBroad( uv: vec2f, lvl: f32, gdx: vec2f, gdy: vec2f, useGrad: bool ) -> vec4f {
	if ( ! useGrad ) { return textureSampleLevel( causticsBroadTex, smpAnisoRepeat, uv, lvl ); }
	let minLen = exp2( lvl ) / ${ B.res }.0;
	return textureSampleGrad( causticsBroadTex, smpAnisoRepeat, uv, _causticsStretch( gdx / ${ B.tile }, minLen ), _causticsStretch( gdy / ${ B.tile }, minLen ) );
}

// gust / slick factor of the caustics at xz (1 without sea detail)
fn causticsDetailK( xz: vec2f ) -> f32 {
${ det ? `	let det = seaDetailSample( xz );
	return mix( 0.55, 1.25, det.gust ) * ( 1.0 - det.slick * 0.6 );` : '	return 1.0;' }
}

// mono: one fine lookup instead of three (no chromatic dispersion); detailK < 0: evaluated here
fn _causticsSample( P: vec3f, depth: f32, level: f32, slope: vec2f, foam: f32, hasFoam: bool, gdx: vec2f, gdy: vec2f, useGrad: bool, mono: bool, detailK: f32 ) -> vec3f {
	// the light reaching this point entered the water up-sun along the refracted sun ray
	let n = normalize( vec3f( - slope.x, 1.0, - slope.y ) );
	let Ls = refract( - frame.sunDir, n, 1.0 / 1.333 );
	let tDown = max( - Ls.y, 0.15 );
	let entry = P.xz - Ls.xz * ( depth / tDown );

	// deeper -> softer (finite sun disk + forward scattering)
	let blur = select( clamp( depth * 0.4 - 0.2, 0.0, 3.0 ), level, level >= 0.0 );
	let wD = sat( ( depth - 1.2 ) / 2.8 ); // blend between the two focal planes

	let uvF = entry / ${ F.tile };
	let tg = _causticsFetchFine( uvF, blur, gdx, gdy, useGrad );
	let g = mix( tg.x, tg.y, wD );
	var r = g;
	var b = g;
	if ( ! mono ) {
		// slight chromatic dispersion: each color lands a little apart along the sun direction
		let disp = normalize( Ls.xz + vec2f( 1e-4, 0.0 ) ) * ( depth * 0.0035 );
		let tr = _causticsFetchFine( uvF + disp / ${ F.tile }, blur, gdx, gdy, useGrad );
		let tb = _causticsFetchFine( uvF - disp / ${ F.tile }, blur, gdx, gdy, useGrad );
		r = mix( tr.x, tr.y, wD );
		b = mix( tb.x, tb.y, wD );
	}
	let broad = _causticsFetchBroad( entry / ${ B.tile }, 1.5, gdx, gdy, useGrad );
	let br = mix( broad.x, broad.y, sat( depth / 9.0 ) );
	let c = vec3f( r, g, b ) * mix( 1.0, br, 0.6 );

	// no caustics right at the surface, strongest in the first metres, fading with depth
	var k = smoothstep( 0.03, 0.5, depth ) * exp( depth * -0.06 ) * caustics.strength;
	k *= select( causticsDetailK( entry ), detailK, detailK >= 0.0 );
	if ( hasFoam ) { k *= 1.0 - sat( foam ); }
	let result = mix( vec3f( 1.0 ), c, k );
	// foam and bubble clouds scatter the light back up: the floor under them is shaded
	return select( result, result * ( 1.0 - sat( foam ) * 0.6 ), hasFoam );
}

fn causticsSample( P: vec3f, depth: f32, slope: vec2f, foam: f32, gdx: vec2f, gdy: vec2f ) -> vec3f {
	return _causticsSample( P, depth, -1.0, slope, foam, true, gdx, gdy, true, false, -1.0 );
}

fn causticsSampleBaked( P: vec3f, depth: f32, slope: vec2f, foam: f32, gdx: vec2f, gdy: vec2f, detailK: f32 ) -> vec3f {
	return _causticsSample( P, depth, -1.0, slope, foam, true, gdx, gdy, true, false, detailK );
}

// without the chromatic dispersion (one fine lookup): the water's refraction source, seen blurred
fn causticsSampleBakedMono( P: vec3f, depth: f32, slope: vec2f, foam: f32, gdx: vec2f, gdy: vec2f, detailK: f32 ) -> vec3f {
	return _causticsSample( P, depth, -1.0, slope, foam, true, gdx, gdy, true, true, detailK );
}

fn causticsSampleLevel( P: vec3f, depth: f32, level: f32 ) -> vec3f {
	return _causticsSample( P, depth, level, vec2f( 0.0 ), 0.0, false, vec2f( 0.0 ), vec2f( 0.0 ), false, false, -1.0 );
}

fn causticsSampleShaft( P: vec3f, depth: f32, level: f32, detailK: f32 ) -> vec3f {
	return _causticsSample( P, depth, level, vec2f( 0.0 ), 0.0, false, vec2f( 0.0 ), vec2f( 0.0 ), false, true, detailK );
}
`,
		} );
		return this._module;

	}

	// the lookup textures (three version: target.texture of each layer)
	get fineTex() {

		return this.fine.texture;

	}

	get broadTex() {

		return this.broad.texture;

	}

}

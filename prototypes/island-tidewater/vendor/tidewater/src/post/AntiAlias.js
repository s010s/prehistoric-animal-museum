import { Texture, RenderTarget } from '../engine/gpu/Texture.js';
import { FullscreenPass } from '../engine/render/FullscreenPass.js';
import { decodeImage } from '../engine/loaders/GLTF.js';

// Spatial anti-aliasing alternatives to the temporal upscaler (Quality > Anti-aliasing):
//   'none' — the internal image scaled to the output (bilinear)
//   'fxaa' — FXAA (port of three's FXAANode: luma edges, edge walk, sub-pixel blend)
//   'smaa' — SMAA 1x medium (port of three's SMAANode, iryoku/smaa 2.8: colour edges, blending
//            weights from the area / search textures, neighbourhood blend)
// They write the post chain's resolved image (the temporal upscaler's history target), so bloom, the
// motion blur and the final pass run unchanged; the camera is not jittered in these modes.
// Edges are found on a tone mapped, gamma-like proxy of the HDR image (the thresholds are meant for
// display values). The SMAA lookup textures (public/textures/smaa, from three.js) load at startup;
// until they are in, SMAA falls back to FXAA.
const CLR = [ 0, 0, 0, 0 ];

const PROXY = /* wgsl */`
fn aaIn( uv: vec2f ) -> vec3f { return textureSampleLevel( aaSrc, smpLinearClamp, uv, 0.0 ).rgb; }
// display-like value for edge detection: exposed, Reinhard on the max channel, square root
fn aaP( c: vec3f ) -> vec3f {
	let e = max( c, vec3f( 0.0 ) ) * aaExposure[ 0 ] * frame.exposure;
	return sqrt( e / ( 1.0 + max( e.r, max( e.g, e.b ) ) ) );
}
fn aaLuma( uv: vec2f ) -> f32 { return dot( aaP( aaIn( uv ) ), vec3f( 0.3, 0.59, 0.11 ) ); }
`;

export class AntiAlias {

	// src: getter of the image to anti-alias (internal resolution); exposure: the auto exposure buffer
	constructor( { src, exposure } ) {

		this.src = src;
		this.exposure = exposure;
		this.edges = new RenderTarget( 1, 1, { colors: [ 'rgba8unorm' ], label: 'smaaEdges' } );
		this.weights = new RenderTarget( 1, 1, { colors: [ 'rgba8unorm' ], label: 'smaaWeights' } );
		this.area = null;
		this.search = null;
		this._passes = null;
		this._load();

	}

	async _load() {

		const base = ( import.meta.env && import.meta.env.BASE_URL ) || '/';
		const tex = async ( name, label ) => {

			const bytes = new Uint8Array( await ( await fetch( base + 'textures/smaa/' + name ) ).arrayBuffer() );
			const img = await decodeImage( bytes, 'image/png' );
			return new Texture( { label, width: img.width, height: img.height, format: 'rgba8unorm', data: img.data } );

		};

		try {

			[ this.area, this.search ] = await Promise.all( [ tex( 'area.png', 'smaaArea' ), tex( 'search.png', 'smaaSearch' ) ] );

		} catch ( e ) {

			console.warn( 'SMAA textures failed to load', e );

		}

	}

	_build() {

		const common = { aaSrc: { texture: this.src }, aaExposure: { storage: this.exposure, access: 'read' } };

		const none = new FullscreenPass( {
			label: 'AA none', colorFormats: [ 'rgba16float' ], bindings: { aaSrc: { texture: this.src } },
			code: 'fn fragment( in: FSIn ) -> vec4f { return textureSampleLevel( aaSrc, smpLinearClamp, in.uv, 0.0 ); }',
		} );

		const fxaa = new FullscreenPass( {
			label: 'FXAA', colorFormats: [ 'rgba16float' ], bindings: common,
			code: PROXY + /* wgsl */`
fn fragment( in: FSIn ) -> vec4f {
	var FXAA_STEPS = array<f32, 6>( 1.0, 1.5, 2.0, 2.0, 2.0, 4.0 );
	let uv = in.uv;
	let ts = 1.0 / vec2f( textureDimensions( aaSrc ) );
	let m = aaLuma( uv );
	let n = aaLuma( uv + ts * vec2f( 0.0, -1.0 ) ); let e = aaLuma( uv + ts * vec2f( 1.0, 0.0 ) );
	let s = aaLuma( uv + ts * vec2f( 0.0, 1.0 ) ); let w = aaLuma( uv + ts * vec2f( -1.0, 0.0 ) );
	let ne = aaLuma( uv + ts * vec2f( 1.0, -1.0 ) ); let nw = aaLuma( uv + ts * vec2f( -1.0, -1.0 ) );
	let se = aaLuma( uv + ts * vec2f( 1.0, 1.0 ) ); let sw = aaLuma( uv + ts * vec2f( -1.0, 1.0 ) );
	let highest = max( max( max( s, e ), max( n, w ) ), m );
	let lowest = min( min( min( s, e ), min( n, w ) ), m );
	let contrast = highest - lowest;
	if ( contrast < max( 0.0312, 0.063 * highest ) ) { return vec4f( aaIn( uv ), 1.0 ); }

	// sub-pixel blend
	var f = ( 2.0 * ( s + e + n + w ) + ( se + sw + ne + nw ) ) / 12.0;
	f = clamp( abs( f - m ) / max( contrast, 1e-6 ), 0.0, 1.0 );
	let bf = smoothstep( 0.0, 1.0, f );
	let pixelBlend = bf * bf;

	// edge orientation and the side the edge lies on
	let horizontal = abs( s + n - 2.0 * m ) * 2.0 + abs( se + ne - 2.0 * e ) + abs( sw + nw - 2.0 * w );
	let vertical = abs( e + w - 2.0 * m ) * 2.0 + abs( se + sw - 2.0 * s ) + abs( ne + nw - 2.0 * n );
	let isH = horizontal >= vertical;
	let pL = select( e, s, isH ); let nL = select( w, n, isH );
	let pG = abs( pL - m ); let nG = abs( nL - m );
	var pixelStep = select( ts.x, ts.y, isH );
	var oppL = pL; var grad = pG;
	if ( pG < nG ) { pixelStep = - pixelStep; oppL = nL; grad = nG; }

	// walk along the edge both ways to its ends
	var uvEdge = uv;
	var edgeStep = vec2f( 0.0, ts.y );
	if ( isH ) { uvEdge.y += pixelStep * 0.5; edgeStep = vec2f( ts.x, 0.0 ); } else { uvEdge.x += pixelStep * 0.5; }
	let edgeL = ( m + oppL ) * 0.5;
	let gt = grad * 0.25;
	var puv = uvEdge + edgeStep * FXAA_STEPS[ 0 ];
	var pD = aaLuma( puv ) - edgeL;
	var pEnd = abs( pD ) >= gt;
	for ( var i = 1; i < 6 && ! pEnd; i++ ) { puv += edgeStep * FXAA_STEPS[ i ]; pD = aaLuma( puv ) - edgeL; pEnd = abs( pD ) >= gt; }
	if ( ! pEnd ) { puv += edgeStep * 8.0; }
	var nuv = uvEdge - edgeStep * FXAA_STEPS[ 0 ];
	var nD = aaLuma( nuv ) - edgeL;
	var nEnd = abs( nD ) >= gt;
	for ( var i = 1; i < 6 && ! nEnd; i++ ) { nuv -= edgeStep * FXAA_STEPS[ i ]; nD = aaLuma( nuv ) - edgeL; nEnd = abs( nD ) >= gt; }
	if ( ! nEnd ) { nuv -= edgeStep * 8.0; }
	let pDist = select( puv.y - uv.y, puv.x - uv.x, isH );
	let nDist = select( uv.y - nuv.y, uv.x - nuv.x, isH );
	let shortest = min( pDist, nDist );
	let deltaSign = select( nD >= 0.0, pD >= 0.0, pDist <= nDist );
	let edgeBlend = select( 0.5 - shortest / ( pDist + nDist ), 0.0, deltaSign == ( m - edgeL >= 0.0 ) );

	let fb = max( pixelBlend, edgeBlend );
	var fuv = uv;
	if ( isH ) { fuv.y += pixelStep * fb; } else { fuv.x += pixelStep * fb; }
	return vec4f( aaIn( fuv ), 1.0 );
}
`,
		} );

		this._passes = { none, fxaa };

	}

	// the SMAA passes need the lookup textures (their bindings are laid out from them)
	_buildSMAA() {

		const common = { aaSrc: { texture: this.src }, aaExposure: { storage: this.exposure, access: 'read' } };
		const edges = new FullscreenPass( {
			label: 'SMAA edges', colorFormats: [ 'rgba8unorm' ], bindings: common,
			code: PROXY + /* wgsl */`
fn smaaDelta( a: vec3f, b: vec3f ) -> f32 { let t = abs( a - b ); return max( t.r, max( t.g, t.b ) ); }
fn fragment( in: FSIn ) -> vec4f {
	let uv = in.uv;
	let px = 1.0 / vec2f( textureDimensions( aaSrc ) );
	let C = aaP( aaIn( uv ) );
	var delta = vec4f( smaaDelta( C, aaP( aaIn( uv + vec2f( - px.x, 0.0 ) ) ) ), smaaDelta( C, aaP( aaIn( uv + vec2f( 0.0, - px.y ) ) ) ), 0.0, 0.0 );
	var edges = step( vec2f( 0.1 ), delta.xy );
	if ( dot( edges, vec2f( 1.0 ) ) == 0.0 ) { return vec4f( 0.0 ); }
	delta.z = smaaDelta( C, aaP( aaIn( uv + vec2f( px.x, 0.0 ) ) ) );
	delta.w = smaaDelta( C, aaP( aaIn( uv + vec2f( 0.0, px.y ) ) ) );
	var maxDelta = max( max( delta.x, delta.y ), max( delta.z, delta.w ) );
	let dLL = smaaDelta( C, aaP( aaIn( uv + vec2f( - 2.0 * px.x, 0.0 ) ) ) );
	let dTT = smaaDelta( C, aaP( aaIn( uv + vec2f( 0.0, - 2.0 * px.y ) ) ) );
	maxDelta = max( maxDelta, max( dLL, dTT ) );
	// local contrast adaptation
	edges *= step( vec2f( 0.5 * maxDelta ), delta.xy );
	return vec4f( edges, 0.0, 0.0 );
}
`,
		} );

		const weights = new FullscreenPass( {
			label: 'SMAA weights', colorFormats: [ 'rgba8unorm' ],
			bindings: { aaEdges: { texture: () => this.edges.texture }, aaArea: { texture: () => this.area }, aaSearch: { texture: () => this.search } },
			code: /* wgsl */`
const SMAA_STEPS: i32 = 8;
fn smaaE( uv: vec2f ) -> vec2f { return textureSampleLevel( aaEdges, smpLinearClamp, uv, 0.0 ).rg; }
fn smaaSearchLength( e: vec2f, bias: f32, scale: f32 ) -> f32 {
	return 255.0 * textureSampleLevel( aaSearch, smpNearestClamp, vec2f( bias + e.x * scale, e.y ), 0.0 ).r;
}
fn smaaArea( dist: vec2f, e1: f32, e2: f32, offset: f32 ) -> vec2f {
	let ps = vec2f( 1.0 / 160.0, 1.0 / 560.0 );
	var tc = ps * ( 16.0 * round( 4.0 * vec2f( e1, e2 ) ) + dist ) + 0.5 * ps;
	tc.y += offset / 7.0;
	return textureSampleLevel( aaArea, smpLinearClamp, tc, 0.0 ).rg;
}
fn smaaXLeft( tc: vec2f, end: f32, inv: vec2f ) -> f32 {
	var e = vec2f( 0.0, 1.0 ); var c = tc;
	for ( var i = 0; i < SMAA_STEPS; i++ ) {
		e = smaaE( c ); c.x -= 2.0 * inv.x;
		if ( c.x <= end || e.y <= 0.8281 || e.x != 0.0 ) { break; }
	}
	c.x += 0.25 * inv.x + inv.x + 2.0 * inv.x;
	return c.x - inv.x * smaaSearchLength( e, 0.0, 0.5 );
}
fn smaaXRight( tc: vec2f, end: f32, inv: vec2f ) -> f32 {
	var e = vec2f( 0.0, 1.0 ); var c = tc;
	for ( var i = 0; i < SMAA_STEPS; i++ ) {
		e = smaaE( c ); c.x += 2.0 * inv.x;
		if ( c.x >= end || e.y <= 0.8281 || e.x != 0.0 ) { break; }
	}
	c.x -= 0.25 * inv.x + inv.x + 2.0 * inv.x;
	return c.x + inv.x * smaaSearchLength( e, 0.5, 0.5 );
}
fn smaaYUp( tc: vec2f, end: f32, inv: vec2f ) -> f32 {
	var e = vec2f( 1.0, 0.0 ); var c = tc;
	for ( var i = 0; i < SMAA_STEPS; i++ ) {
		e = smaaE( c ); c.y -= 2.0 * inv.y;
		if ( c.y <= end || e.x <= 0.8281 || e.y != 0.0 ) { break; }
	}
	c.y += 0.25 * inv.y + inv.y + 2.0 * inv.y;
	return c.y - inv.y * smaaSearchLength( e.yx, 0.0, 0.5 );
}
fn smaaYDown( tc: vec2f, end: f32, inv: vec2f ) -> f32 {
	var e = vec2f( 1.0, 0.0 ); var c = tc;
	for ( var i = 0; i < SMAA_STEPS; i++ ) {
		e = smaaE( c ); c.y += 2.0 * inv.y;
		if ( c.y >= end || e.x <= 0.8281 || e.y != 0.0 ) { break; }
	}
	c.y -= 0.25 * inv.y + inv.y + 2.0 * inv.y;
	return c.y + inv.y * smaaSearchLength( e.yx, 0.5, 0.5 );
}
fn fragment( in: FSIn ) -> vec4f {
	let uv = in.uv;
	let inv = 1.0 / vec2f( textureDimensions( aaEdges ) );
	let pix = uv / inv;
	let o0 = vec4f( uv, uv ) + vec4f( inv, inv ) * vec4f( -0.25, -0.125, 1.25, -0.125 );
	let o1 = vec4f( uv, uv ) + vec4f( inv, inv ) * vec4f( -0.125, -0.25, -0.125, 1.25 );
	let o2 = vec4f( o0.xz, o1.yw ) + vec4f( -2.0, 2.0, -2.0, 2.0 ) * vec4f( inv.xx, inv.yy ) * f32( SMAA_STEPS );
	var w = vec4f( 0.0 );
	let e = smaaE( uv );
	if ( e.y > 0.0 ) {
		// edge at north: distances to its ends left and right, and the crossing edges there
		let xl = smaaXLeft( o0.xy, o2.x, inv );
		let e1 = textureSampleLevel( aaEdges, smpLinearClamp, vec2f( xl, o1.y ), 0.0 ).r;
		let xr = smaaXRight( o0.zw, o2.y, inv );
		let d = vec2f( xl, xr ) / inv.x - pix.x;
		let e2 = textureSampleLevel( aaEdges, smpLinearClamp, vec2f( xr + inv.x, o1.y ), 0.0 ).r;
		let a = smaaArea( sqrt( abs( d ) ), e1, e2, 0.0 );
		w = vec4f( a, w.zw );
	}
	if ( e.x > 0.0 ) {
		// edge at west: up and down
		let yu = smaaYUp( o1.xy, o2.z, inv );
		let e1 = textureSampleLevel( aaEdges, smpLinearClamp, vec2f( o0.x, yu ), 0.0 ).g;
		let yd = smaaYDown( o1.zw, o2.w, inv );
		let d = vec2f( yu, yd ) / inv.y - pix.y;
		let e2 = textureSampleLevel( aaEdges, smpLinearClamp, vec2f( o0.x, yd + inv.y ), 0.0 ).g;
		let a = smaaArea( sqrt( abs( d ) ), e1, e2, 0.0 );
		w = vec4f( w.xy, a );
	}
	return w;
}
`,
		} );

		const blend = new FullscreenPass( {
			label: 'SMAA blend', colorFormats: [ 'rgba16float' ],
			bindings: { aaSrc: { texture: this.src }, aaWeights: { texture: () => this.weights.texture } },
			code: /* wgsl */`
fn fragment( in: FSIn ) -> vec4f {
	let uv = in.uv;
	let inv = 1.0 / vec2f( textureDimensions( aaWeights ) );
	let w0 = textureSampleLevel( aaWeights, smpLinearClamp, uv, 0.0 );
	let a = vec4f( w0.x, textureSampleLevel( aaWeights, smpLinearClamp, uv + vec2f( 0.0, inv.y ), 0.0 ).y,
		w0.z, textureSampleLevel( aaWeights, smpLinearClamp, uv + vec2f( inv.x, 0.0 ), 0.0 ).w );
	let C = textureSampleLevel( aaSrc, smpLinearClamp, uv, 0.0 );
	if ( dot( a, vec4f( 1.0 ) ) < 1e-5 ) { return C; }
	// the line with the largest weight through each direction; the stronger direction wins
	var off = vec2f( select( - a.z, a.w, a.w > a.z ), select( - a.x, a.y, a.y > a.x ) );
	if ( abs( off.x ) > abs( off.y ) ) { off.y = 0.0; } else { off.x = 0.0; }
	let Cop = textureSampleLevel( aaSrc, smpLinearClamp, uv + sign( off ) * inv, 0.0 );
	return mix( C, Cop, max( abs( off.x ), abs( off.y ) ) );
}
`,
		} );

		Object.assign( this._passes, { edges, weights, blend } );
		this._smaa = true;

	}

	// record the chosen mode into `target` (a Texture at the output resolution)
	render( mode, target ) {

		if ( ! this._passes ) this._build();
		const p = this._passes;
		if ( mode === 'smaa' && this.area && this.search ) {

			if ( ! this._smaa ) this._buildSMAA();
			const s = typeof this.src === 'function' ? this.src() : this.src;
			this.edges.setSize( s.width, s.height );
			this.weights.setSize( s.width, s.height );
			p.edges.render( { colorViews: [ this.edges.texture ], clear: CLR } );
			p.weights.render( { colorViews: [ this.weights.texture ], clear: CLR } );
			p.blend.render( { colorViews: [ target ], clear: CLR } );

		} else if ( mode === 'fxaa' || mode === 'smaa' ) {

			p.fxaa.render( { colorViews: [ target ], clear: CLR } );

		} else {

			p.none.render( { colorViews: [ target ], clear: CLR } );

		}

	}

}

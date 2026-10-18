import { Scene, PerspectiveCamera, Matrix4, Quaternion, Vector3, Vector4 } from '../engine/index.js';
import { GPU, Texture, MeshRenderer, FullscreenPass, createViewUniforms, setFrameCamera, UniformBlock } from '../engine/webgpu.js';
import { FishProps } from '../world/fish/FishProps.js';
import { ACES_WGSL } from '../post/PostFX.js';
import { FISH, FISH_IDS, fishLengthCm } from './FishTable.js';

// Studio portraits of the catchable fish: the real game models (world/fish, through FishProps) in a
// neutral photo studio, side-on and horizontal (nose left, as in a field guide).
//
//   const fp = new FishPortrait();
//   fp.attach( canvas )                      live view in a DOM canvas (the catch card); detach() stops it
//   fp.show( species, kg )                   start the card's animation (slide in, tail flick, slow turn)
//   fp.thumbnail( species ) -> Promise<url>  a cached side view (PNG object URL; null without a DOM)
//   fp.update( dt )                          once per frame: the live view, or one queued thumbnail
//
// Everything goes through its own MeshRenderer, view uniforms and targets, with the STUDIO_LIGHTING
// pass define (engine lighting: no world hooks, studio environment; the key light is this view's
// frame.sunDir / sunColor, the softbox azimuth frame.debug.x). The fish sit far above the island in
// a private scene. A GPU buffer holds one value per submit, so at most one portrait is drawn per
// frame: the live card first, thumbnails when it is idle.
//
// The fish model API used is FishProps ('whole' fish, instance records as FishProps / CatchDisplay):
// swapping the models (e.g. scanned fish) only needs this class and FishProps to agree.

const STUDIO = new Vector3( 0, 6000, 0 );
const PARK = new Vector3( 0, 4800, 0 );
// model frame (nose +z, back +y, left flank +x) -> nose toward -x (left on screen), back up, left
// flank toward +z (the camera)
const PORTRAIT = new Matrix4().makeBasis( new Vector3( 0, 0, 1 ), new Vector3( 0, 1, 0 ), new Vector3( - 1, 0, 0 ) );
const SS = 2; // supersampling per axis (the silhouette is the whole picture: no aliased edges)
const THUMB_W = 360, THUMB_H = 170;
const VFOV = 16; // degrees: a long lens, little perspective distortion

const _m = new Matrix4(), _f = new Matrix4(), _q = new Quaternion(), _q2 = new Quaternion(), _p = new Vector3(), _s = new Vector3(), _a = new Vector3();

const hasDOM = typeof HTMLCanvasElement !== 'undefined' && typeof document !== 'undefined' && typeof document.createElement === 'function';

export class FishPortrait {

	constructor() {

		// one 'whole' fish per species, all parked; the one being drawn moves to the studio
		const fp = this.props = new FishProps();
		this.slot = {};
		_f.makeTranslation( PARK.x, PARK.y, PARK.z );
		FISH_IDS.forEach( ( id, i ) => {

			fp.add( 'whole', FISH[ id ].model, _f, 'side', 0.3, { cloudy: 0.08, wet: 1, seed: 0.37 } );
			this.slot[ id ] = i;

		} );
		this.mesh = fp.build();
		this.mesh.name = 'FishPortrait';
		this.mesh.frustumCulled = false;
		this.scene = new Scene();
		this.scene.add( this.mesh );
		this.scene.updateMatrixWorld( true );
		this.renderer = new MeshRenderer();
		this.camera = new PerspectiveCamera( VFOV, 2, 0.05, 200 );

		// the studio: key light from the upper front left, a grey sweep and one softbox (lighting.js)
		const block = this.block = createViewUniforms( 'fishPortrait' );
		this._dbg = new Vector4();
		const follow = block.onBeforePack;
		this.light = { dir: new Vector3( - 0.45, 0.78, 0.55 ).normalize(), color: new Vector3( 3.1, 3.0, 2.85 ), env: 1.0, sweep: 0.4 };
		block.onBeforePack = () => {

			follow();
			const F = block.fields;
			F.sunDir.value = this.light.dir;
			F.sunColor.value = this.light.color;
			F.envIntensity.value = this.light.env;
			F.night.value = 0;
			// own vector: the view block shares the main block's objects
			this._dbg.set( this.light.sweep, 0, 0, 0 );
			F.debug.value = this._dbg;

		};

		this.exposure = new UniformBlock( 'PortraitParams', { exposure: [ 'f32', 1.15 ], ss: [ 'f32', SS ] }, { label: 'portrait' } );
		this.targets = {}; // by name: { hdr, depth, w, h }
		this.shown = null; // species currently in the studio
		this.live = null; // { species, kg, t }
		this.canvas = null;
		this.context = null;
		this.present = null; // FullscreenPass into the canvas format
		this.toThumb = null; // FullscreenPass into rgba8unorm
		this.thumbs = new Map(); // species -> { url, pixels, width, height }
		this.queue = []; // [ { species, resolve } ]
		this.pending = new Map(); // species -> Promise
		this.busy = false;

	}

	// ---- targets and passes

	_target( name, w, h ) {

		let t = this.targets[ name ];
		if ( t && t.w === w && t.h === h ) return t;
		if ( t ) {

			t.hdr.destroy();
			t.depth.destroy();

		}

		t = this.targets[ name ] = {
			w, h,
			hdr: new Texture( { label: 'portrait.' + name, width: w, height: h, format: 'rgba16float', usage: [ 'render', 'sample' ] } ),
			depth: new Texture( { label: 'portrait.' + name + '.depth', width: w, height: h, format: 'depth32float', usage: [ 'render' ] } ),
		};
		return t;

	}

	// tone map + downsample (SS x SS box of tone-mapped samples: antialiased edges), premultiplied
	// alpha, sRGB encoded for an 8-bit target
	_pass( format, getSrc ) {

		return new FullscreenPass( {
			label: 'fish portrait ' + format,
			bindings: { portraitSrc: { texture: getSrc, sampleType: 'unfilterable-float' }, portrait: { uniform: this.exposure } },
			colorFormats: [ format ],
			code: ACES_WGSL + /* wgsl */`
fn fragment( in: FSIn ) -> vec4f {
	let n = i32( portrait.ss );
	let base = vec2i( in.pos.xy ) * n;
	var rgb = vec3f( 0.0 );
	var a = 0.0;
	for ( var y = 0; y < n; y++ ) {
		for ( var x = 0; x < n; x++ ) {
			let c = textureLoad( portraitSrc, base + vec2i( x, y ), 0 );
			let cov = sat( c.a );
			rgb += acesFilmicToneMapping( max( c.rgb, vec3f( 0.0 ) ) / max( cov, 1e-4 ), portrait.exposure ) * cov;
			a += cov;
		}
	}
	let k = 1.0 / f32( n * n );
	rgb *= k;
	a *= k;
	// premultiplied: encode the colour, then weight by coverage
	let straight = rgb / max( a, 1e-4 );
	return vec4f( linearToSrgb( straight ) * a, a );
}
`,
		} );

	}

	// ---- placing the fish

	_place( species, kg, { yaw = 0, pitch = 0, roll = 0, x = 0, y = 0, curl = 0, jaw = 0.15 } = {} ) {

		if ( this.shown && this.shown !== species ) this._park( this.shown );
		this.shown = species;
		const L = fishLengthCm( species, kg ) / 100;
		_q.setFromAxisAngle( _a.set( 0, 1, 0 ), yaw );
		_q2.setFromAxisAngle( _a.set( 0, 0, 1 ), pitch );
		_q.multiply( _q2 );
		_q2.setFromAxisAngle( _a.set( 1, 0, 0 ), roll );
		_q.multiply( _q2 );
		_f.makeRotationFromQuaternion( _q ).setPosition( STUDIO.x + x * L, STUDIO.y + y * L, STUDIO.z );
		this._write( this.slot[ species ], _f, L, curl, jaw );
		return L;

	}

	_park( species ) {

		_f.makeTranslation( PARK.x, PARK.y, PARK.z );
		this._write( this.slot[ species ], _f, 0.3, 0, 0 );

	}

	// instance record (FishProps): r0 = ( position, L ), r1 = orientation, r2.yzw = ( curl, sag, jaw )
	_write( i, frame, L, curl, jaw ) {

		const fp = this.props;
		_m.multiplyMatrices( frame, PORTRAIT );
		_m.decompose( _p, _q, _s );
		const D = fp.batch.data, o = i * 16;
		D[ o ] = _p.x; D[ o + 1 ] = _p.y; D[ o + 2 ] = _p.z; D[ o + 3 ] = L;
		D[ o + 4 ] = _q.x; D[ o + 5 ] = _q.y; D[ o + 6 ] = _q.z; D[ o + 7 ] = _q.w;
		D[ o + 9 ] = curl; D[ o + 10 ] = 0; D[ o + 11 ] = jaw;
		fp.pos[ i * 4 ] = _p.x; fp.pos[ i * 4 + 1 ] = _p.y; fp.pos[ i * 4 + 2 ] = _p.z; fp.pos[ i * 4 + 3 ] = L;
		fp.batch.upload();

	}

	// frame the fish: its body length fills `fill` of the width
	_frame( L, w, h, fill = 0.8 ) {

		const cam = this.camera;
		cam.aspect = w / h;
		cam.updateProjectionMatrix();
		const tanH = Math.tan( VFOV * Math.PI / 360 ) * cam.aspect;
		const dist = ( L * 1.08 / fill ) / 2 / tanH;
		cam.near = Math.max( 0.02, dist - L * 2 );
		cam.far = dist + L * 4;
		cam.updateProjectionMatrix();
		// a touch from above: the back and the flank both read
		cam.position.set( STUDIO.x, STUDIO.y + dist * 0.06, STUDIO.z + dist );
		cam.lookAt( STUDIO.x, STUDIO.y, STUDIO.z );
		cam.updateMatrixWorld();

	}

	_draw( target ) {

		setFrameCamera( this.camera, target.w, target.h, { block: this.block } );
		this.props.cull( this.camera, - ( ++ this._cullToken || ( this._cullToken = 1 ) ) );
		this.renderer.render( this.scene, {
			camera: this.camera, frameBlock: this.block, kind: 'color', label: 'fish portrait',
			colorViews: [ target.hdr.view() ], colorFormats: [ 'rgba16float' ],
			depthView: target.depth.view(), depthFormat: 'depth32float',
			clearColors: [ [ 0, 0, 0, 0 ] ], clearDepth: 0,
			defines: { STUDIO_LIGHTING: 1 },
		} );

	}

	// ---- live view (the catch card)

	attach( canvas ) {

		if ( ! hasDOM || ! canvas || ! navigator.gpu ) return false;
		if ( this.canvas !== canvas ) {

			this.canvas = canvas;
			this.context = canvas.getContext( 'webgpu' );
			this.format = navigator.gpu.getPreferredCanvasFormat();
			this.context.configure( { device: GPU.device, format: this.format, alphaMode: 'premultiplied' } );
			this.present = null;

		}

		return true;

	}

	show( species, kg ) {

		this.live = { species, kg, t: 0 };

	}

	detach() {

		this.live = null;

	}

	// card animation: the fish slides in from the left with a tail flick and settles, then turns slowly
	// while the softbox highlight sweeps along its flank
	_liveTransform( t ) {

		const ease = ( x ) => 1 - Math.pow( 1 - Math.min( 1, Math.max( 0, x ) ), 3 );
		const inT = ease( t / 0.7 );
		// overshoot on arrival (a spring)
		const settle = Math.exp( - Math.max( 0, t - 0.55 ) * 4 ) * Math.sin( Math.max( 0, t - 0.55 ) * 9 );
		const x = - ( 1 - inT ) * 1.6 + settle * 0.05;
		const y = ( 1 - inT ) * 0.25;
		const flick = Math.sin( t * 13 ) * 0.9 * Math.exp( - t * 1.6 ) * ( t < 0.1 ? t * 10 : 1 );
		const yaw = - ( 1 - inT ) * 0.9 + Math.sin( t * 0.55 ) * 0.2 * inT;
		const roll = ( 1 - inT ) * 0.5 + Math.sin( t * 0.4 + 1 ) * 0.05;
		const pitch = ( 1 - inT ) * - 0.3 + Math.sin( t * 0.7 ) * 0.03;
		return { x, y, yaw, roll, pitch, curl: flick, jaw: 0.12 + 0.12 * Math.max( 0, Math.sin( t * 5 ) ) * Math.exp( - t * 0.5 ) };

	}

	// ---- thumbnails

	thumbnail( species ) {

		if ( this.thumbs.has( species ) ) return Promise.resolve( this.thumbs.get( species ).url );
		if ( this.pending.has( species ) ) return this.pending.get( species );
		const p = new Promise( ( resolve ) => this.queue.push( { species, resolve } ) );
		this.pending.set( species, p );
		return p;

	}

	// the cached thumbnail URL, or null (and one is queued)
	thumbUrl( species ) {

		const t = this.thumbs.get( species );
		if ( t ) return t.url;
		this.thumbnail( species );
		return null;

	}

	_renderThumb( job ) {

		const { species } = job;
		const T = this._target( 'thumb', THUMB_W * SS, THUMB_H * SS );
		// a mid-sized specimen: proportions of an adult
		const kg = FISH[ species ].kg[ 0 ] * 0.4 + FISH[ species ].kg[ 1 ] * 0.6;
		const L = this._place( species, kg, { yaw: - 0.05, pitch: 0.02, curl: 0.06, jaw: 0.1 } );
		this.light.sweep = 0.45;
		this._frame( L, T.w, T.h, 0.84 );
		this._draw( T );
		if ( ! this.thumbTex ) this.thumbTex = new Texture( { label: 'portrait.thumb8', width: THUMB_W, height: THUMB_H, format: 'rgba8unorm', usage: [ 'render', 'copySrc' ] } );
		if ( ! this.toThumb ) this.toThumb = this._pass( 'rgba8unorm', () => this.targets.thumb.hdr );
		this.toThumb.render( { colorViews: [ this.thumbTex.view() ], clear: [ 0, 0, 0, 0 ] } );
		// read back after this frame's submit
		const rowBytes = THUMB_W * 4, padded = Math.ceil( rowBytes / 256 ) * 256;
		const staging = GPU.device.createBuffer( { label: 'portrait.readback', size: padded * THUMB_H, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST } );
		GPU.getEncoder().copyTextureToBuffer( { texture: this.thumbTex.getGPU() }, { buffer: staging, bytesPerRow: padded, rowsPerImage: THUMB_H }, { width: THUMB_W, height: THUMB_H, depthOrArrayLayers: 1 } );
		this.busy = true;
		GPU.onSubmit( null, () => {

			staging.mapAsync( GPUMapMode.READ ).then( async () => {

				const src = new Uint8Array( staging.getMappedRange() );
				const px = new Uint8ClampedArray( rowBytes * THUMB_H );
				for ( let y = 0; y < THUMB_H; y ++ ) px.set( src.subarray( y * padded, y * padded + rowBytes ), y * rowBytes );
				staging.unmap();
				staging.destroy();
				// premultiplied -> straight alpha (ImageData / PNG)
				for ( let i = 0; i < px.length; i += 4 ) {

					const a = px[ i + 3 ];
					if ( a > 0 && a < 255 ) {

						px[ i ] = Math.min( 255, px[ i ] * 255 / a );
						px[ i + 1 ] = Math.min( 255, px[ i + 1 ] * 255 / a );
						px[ i + 2 ] = Math.min( 255, px[ i + 2 ] * 255 / a );

					}

				}

				const entry = { url: null, pixels: px, width: THUMB_W, height: THUMB_H };
				entry.url = await toURL( px, THUMB_W, THUMB_H );
				this.thumbs.set( species, entry );
				this.pending.delete( species );
				this.busy = false;
				job.resolve( entry.url );
				if ( this.onThumb ) this.onThumb( species, entry.url );

			} ).catch( ( e ) => {

				console.warn( 'fish thumbnail failed', e );
				this.busy = false;
				this.pending.delete( species );
				job.resolve( null );

			} );

		} );

	}

	// ---- per frame

	update( dt ) {

		if ( ! GPU.device ) return;
		const lv = this.live;
		if ( lv && this.context ) {

			lv.t += dt;
			const c = this.canvas;
			const dpr = Math.min( 2, globalThis.devicePixelRatio || 1 );
			const cw = Math.max( 2, Math.min( 1600, Math.round( c.clientWidth * dpr ) ) ), ch = Math.max( 2, Math.round( cw * ( c.clientHeight / Math.max( 1, c.clientWidth ) ) ) );
			if ( c.width !== cw || c.height !== ch ) {

				c.width = cw;
				c.height = ch;

			}

			const T = this._target( 'live', cw * SS, ch * SS );
			const tr = this._liveTransform( lv.t );
			const L = this._place( lv.species, lv.kg, tr );
			this.light.sweep = - 1.1 + ( ( lv.t * 0.32 ) % 2.6 );
			this._frame( L, T.w, T.h, 0.78 );
			this._draw( T );
			if ( ! this.present ) this.present = this._pass( this.format, () => this.targets.live.hdr );
			this.present.render( { colorViews: [ this.context.getCurrentTexture().createView() ], clear: [ 0, 0, 0, 0 ] } );
			return;

		}

		if ( ! this.busy && this.queue.length ) this._renderThumb( this.queue.shift() );

	}

}

// RGBA (straight alpha) -> PNG object URL (browser); null headless
async function toURL( px, w, h ) {

	if ( ! hasDOM ) return null;
	try {

		const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas( w, h ) : Object.assign( document.createElement( 'canvas' ), { width: w, height: h } );
		cv.getContext( '2d' ).putImageData( new ImageData( px, w, h ), 0, 0 );
		const blob = cv.convertToBlob ? await cv.convertToBlob( { type: 'image/png' } ) : await new Promise( ( r ) => cv.toBlob( r, 'image/png' ) );
		return URL.createObjectURL( blob );

	} catch ( e ) {

		return null;

	}

}

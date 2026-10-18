import { GPU } from '../gpu/GPU.js';
import { RenderTarget } from '../gpu/Texture.js';
import { Material } from './Material.js';
import { FullscreenPass } from './FullscreenPass.js';
import { Mesh } from '../scene/Mesh.js';
import { Scene } from '../scene/Scene.js';
import { Frustum, Matrix4, Sphere, Vector3 } from '../math/index.js';

const _local = new Vector3();
const _sphere = new Sphere();
const _frustum = new Frustum();
const _vp = new Matrix4();
const _inv = new Matrix4();

export const LAYERS = {
	OPAQUE: 0,
	WATER: 1,
	TRANSPARENT: 2,
	REFLECT_ONLY: 3,
};

export const SCENE_FORMATS = [ 'rgba16float', 'rgba16float', 'rgba8unorm' ];
export const DEPTH_FORMAT = 'depth32float';

// Scene renderer (internal resolution = output * scale, upscaled later by TAAU):
//   1. opaque layer -> sceneRT (HDR color + velocity + water mask, reversed-Z float depth), then the
//      background (sky) where nothing was drawn
//   2. copies of color / depth -> opaqueCopy (sampled by the water for refraction / absorption), and a
//      half float copy of the depth (opaqueDepthHalf)
//   3. hull masks (closed volumes the sea is not drawn inside)
//   4. water + transparent layers -> sceneRT on top. Velocity blends premultiplied there: opaque
//      outputs overwrite it, blended effects write ( v * a, 0, a ), glass writes 0.
// sceneRT textures: [ 0 ] color, [ 1 ] velocity (uv-space motion cur - prev in xy), [ 2 ] water mask
// (r = the visible surface is seen from below, g = a water surface is the visible surface).
export class SceneRenderer {

	constructor( meshRenderer, scene, camera ) {

		this.meshRenderer = meshRenderer;
		this.scene = scene;
		this.camera = camera;
		this.scale = 1;
		this.width = 1;
		this.height = 1;
		this.sceneRT = new RenderTarget( 1, 1, { colors: [ { format: 'rgba16float', name: 'color' }, { format: 'rgba16float', name: 'velocity' }, { format: 'rgba8unorm', name: 'waterMask' } ], depth: DEPTH_FORMAT, label: 'scene' } );
		this.velocityTexture = this.sceneRT.textures[ 1 ];
		this.waterMaskTexture = this.sceneRT.textures[ 2 ];
		this.opaqueCopy = new RenderTarget( 1, 1, { colors: [ 'rgba16float' ], depth: DEPTH_FORMAT, label: 'opaqueCopy' } );
		// the opaque depth again as half float (reversed-Z keeps its relative precision): for many
		// scattered reads that tolerate centimetres, e.g. the water's screen-space reflection march
		this.opaqueDepthHalf = new RenderTarget( 1, 1, { colors: [ 'r16float' ], label: 'opaqueDepthHalf' } );
		this._depthHalfPass = null;
		this.hullMaskRT = new RenderTarget( 1, 1, { colors: [ 'r16float' ], depth: DEPTH_FORMAT, label: 'hullMask' } );
		this.hullMaskScene = new Scene();
		this.hullMaskMaterial = new Material( { name: 'hullMask', lit: false, side: 'double', surface: 's.albedo = vec3f( length( in.P - frame.cameraPos ), 0.0, 0.0 ); s.emissive = vec3f( 0.0 );' } );
		this.hullMasks = [];
		this.hullMaskActive = { value: 0 };
		// background: an object with draw( renderPassEncoder ) using SCENE_FORMATS + DEPTH_FORMAT,
		// depth compare 'equal' at depth 0 (see Sky)
		this.background = null;
		this.clearColor = [ 0, 0, 0, 1 ];
		this.onBeforeWater = null;

	}

	setSize( w, h ) {

		this.width = w;
		this.height = h;
		this.sceneRT.setSize( w, h );
		this.opaqueCopy.setSize( w, h );
		this.opaqueDepthHalf.setSize( w, h );
		this.hullMaskRT.setSize( w, h );

	}

	// register a closed volume that follows `object`
	addHullMask( geometry, object ) {

		geometry.computeBoundingBox();
		geometry.computeBoundingSphere();
		const mesh = new Mesh( geometry, this.hullMaskMaterial );
		mesh.matrixAutoUpdate = false;
		mesh.frustumCulled = false;
		this.hullMaskScene.add( mesh );
		this.hullMasks.push( { mesh, object, box: geometry.boundingBox.clone().expandByScalar( 0.05 ), sphere: geometry.boundingSphere } );
		return mesh;

	}

	_renderHullMasks( camera ) {

		let active = 0;
		_frustum.setFromProjectionMatrix( _vp.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse ) );
		for ( const h of this.hullMasks ) {

			h.object.updateWorldMatrix( true, false );
			h.mesh.matrix.copy( h.object.matrixWorld );
			h.mesh.matrixWorld.copy( h.object.matrixWorld );
			_local.setFromMatrixPosition( camera.matrixWorld ).applyMatrix4( _inv.copy( h.object.matrixWorld ).invert() );
			const on = ! h.box.containsPoint( _local ) && _frustum.intersectsSphere( _sphere.copy( h.sphere ).applyMatrix4( h.object.matrixWorld ) );
			h.mesh.visible = on;
			if ( on ) active ++;

		}

		this.hullMaskActive.value = active > 0 ? 1 : 0;
		if ( ! active ) return;
		const rt = this.hullMaskRT;
		this.meshRenderer.render( this.hullMaskScene, {
			label: 'hull mask', kind: 'color', camera, colorViews: [ rt.texture.view() ], colorFormats: rt.formats,
			clearColors: [ [ 0, 0, 0, 0 ] ], depthView: rt.depthTexture.view(), depthFormat: DEPTH_FORMAT, clearDepth: 0, cull: false,
		} );

	}

	render() {

		const { scene, camera, meshRenderer: mr } = this;
		const rt = this.sceneRT;
		const views = rt.textures.map( ( t ) => t.view() );
		const common = { camera, colorViews: views, colorFormats: rt.formats, depthView: rt.depthTexture.view(), depthFormat: DEPTH_FORMAT, kind: 'main' };

		// 1. opaques + background
		mr.render( scene, {
			...common, label: 'opaque', layerMask: 1 << LAYERS.OPAQUE,
			clearColors: [ this.clearColor, [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ] ], clearDepth: 0,
			after: this.background ? ( rp ) => this.background.draw( rp ) : null,
		} );

		// 2. copies for refraction
		const enc = GPU.getEncoder();
		const size = { width: rt.width, height: rt.height };
		enc.copyTextureToTexture( { texture: rt.texture.getGPU() }, { texture: this.opaqueCopy.texture.getGPU() }, size );
		enc.copyTextureToTexture( { texture: rt.depthTexture.getGPU() }, { texture: this.opaqueCopy.depthTexture.getGPU() }, size );
		if ( ! this._depthHalfPass ) this._depthHalfPass = new FullscreenPass( {
			label: 'opaque depth half', colorFormats: [ 'r16float' ],
			bindings: { srcDepth: { texture: () => this.opaqueCopy.depthTexture } },
			code: 'fn fragment( in: FSIn ) -> vec4f { return vec4f( textureLoad( srcDepth, vec2i( in.pos.xy ), 0 ), 0.0, 0.0, 1.0 ); }',
		} );
		this._depthHalfPass.render( { colorViews: [ this.opaqueDepthHalf.texture ], clear: [ 0, 0, 0, 0 ] } );

		// 3. hull interiors
		if ( this.hullMasks.length > 0 ) this._renderHullMasks( camera );
		if ( this.onBeforeWater ) this.onBeforeWater();

		// 4. water + transparents
		mr.render( scene, { ...common, label: 'water + transparent', late: true, layerMask: ( 1 << LAYERS.WATER ) | ( 1 << LAYERS.TRANSPARENT ) } );

	}

}

import { UniformBlock } from '../gpu/Uniforms.js';
import { Color, Vector2, Vector3, Vector4 } from '../math/index.js';

// Materials are WGSL snippets plugged into one mesh shader template (render/MeshShader.js).
//
//   const mat = new Material( {
//     name: 'rock',
//     modules: [ terrainModule ],                   // WGSL modules the snippets call
//     uniforms: { tint: [ 'vec3f', new Color( 0.5, 0.45, 0.4 ) ], wet: [ 'f32', 0 ] },   // -> mat.tint, mat.wet
//     textures: { rockAlbedo: tex, rockNormal: { texture: tex2 } },                          // group 1 bindings
//     varyings: { vHeight: 'f32' },                  // extra vertex -> fragment values (in.vs.vHeight)
//     attributes: { aSeed: 'f32' },                  // extra geometry attributes (v.aSeed); instanced if the attribute is
//     vertex: `v.position += v.normal * 0.01 * sin( frame.time ); o.vHeight = v.position.y;`,
//     surface: `s.albedo = mat.tint; s.roughness = 0.8 + 0.2 * in.vs.vHeight;`,
//     defines: { MY_SWITCH: 1 },
//     side: 'front' | 'back' | 'double', transparent: false, blending: 'normal', depthWrite: true, alphaTest: 0,
//   } );
//
// Snippets (bodies; the template wraps them in functions):
//   vertex:   fn materialVertex( v: ptr<function, VertexData>, o: ptr<function, VSOut> )   — `v.` / `o.` fields
//             VertexData: position, normal, uv, color (local space), model (object * instance matrix),
//             instance, vertex, worldOffset, prevWorldOffset (added after the model transform),
//             useWorld + worldPos / worldNormal / prevWorldPos (set the world position directly, CDLOD),
//             plus every entry of `attributes`. Pointer fields are accessed with `(*v).x` or `v.x` (WGSL
//             allows the latter).
//   surface:  fn materialSurface( in: FragInput, s: ptr<function, Surface> )
//             FragInput: vs (the VSOut: varyings), P (world pos), N (geometric normal, facing the viewer on
//             double-sided), V (to camera), uv, color, front, pixel (frag coord xy)
//             Surface: albedo, alpha, normal (world), roughness, metalness, emissive, ao, translucency,
//             specularIntensity, clearcoat, clearcoatRoughness, clearcoatNormal, sheenColor, sheenRoughness, envIntensity
//   output:   fn materialOutput( in: FragInput, s: Surface, r: ptr<function, FragResult> )   (optional)
//             runs after lighting: r.color (vec4f, rgb = lit radiance), r.velocity, r.mask. Set `lit: false`
//             to skip lighting entirely (r.color starts as vec4( s.albedo + s.emissive, s.alpha )).
//   shadow:   optional body of fn materialShadow( in: FragInput ) -> bool (return false to discard in the
//             shadow pass); defaults to running `surface` for alpha when alphaTest > 0.
//
// Uniform values: mat.uniforms.tint.value.set(...) / mat.set( 'wet', 0.3 ). Built-in fields `color`,
// `roughness`, `metalness`, `emissive`, `opacity` are always present and seed the Surface.

let _id = 0;

const BUILTIN_UNIFORMS = {
	color: [ 'vec3f', null ],
	opacity: [ 'f32', 1 ],
	emissive: [ 'vec3f', null ],
	roughness: [ 'f32', 1 ],
	metalness: [ 'f32', 0 ],
	alphaTest: [ 'f32', 0 ],
};

export class Material {

	constructor( o = {} ) {

		this.id = _id ++;
		this.isMaterial = true;
		this.name = o.name || 'material' + this.id;
		this.version = 0;
		this.modules = o.modules || [];
		this.varyings = o.varyings || {};
		this.attributes = o.attributes || {};
		this.vertex = o.vertex || '';
		this.surface = o.surface || '';
		this.output = o.output || '';
		this.shadow = o.shadow || '';
		this.defines = { ...( o.defines || {} ) };
		this.lit = o.lit !== false;
		this.side = o.side || 'front';
		this.transparent = !! o.transparent;
		this.blending = o.blending || ( this.transparent ? 'normal' : 'none' );
		this.depthWrite = o.depthWrite ?? ! this.transparent;
		this.depthTest = o.depthTest ?? true;
		this.depthCompare = o.depthCompare || null;
		this.depthBias = o.depthBias || 0; // constant bias (reversed-Z: positive pulls toward the camera)
		this.depthBiasSlopeScale = o.depthBiasSlopeScale || 0;
		this.colorWrite = o.colorWrite ?? true;
		this.topology = o.topology || 'triangle-list';
		this.visible = o.visible ?? true;
		this.vertexColors = !! o.vertexColors;
		// velocity weight in the late (blended) pass: 1 = own motion, 0 = keep what is behind (glass)
		this.velocityWeight = o.velocityWeight ?? 1;
		// per-material lighting switches (see SceneLighting hooks)
		this.underwaterLighting = o.underwaterLighting || 'full';
		this.appliesHillShadow = !! o.appliesHillShadow;
		this.localLightsCheap = !! o.localLightsCheap;
		this.receiveShadows = o.receiveShadows ?? true;
		this.userData = o.userData || {};

		const fields = { ...BUILTIN_UNIFORMS };
		for ( const k in o.uniforms || {} ) fields[ k ] = o.uniforms[ k ];
		this.uniformBlock = new UniformBlock( 'MaterialParams' + this.id, fields, { label: this.name } );
		this.uniforms = this.uniformBlock.fields;
		const u = this.uniforms;
		u.color.value = toColor( o.color, new Color( 1, 1, 1 ) );
		u.emissive.value = toColor( o.emissive, new Color( 0, 0, 0 ) );
		if ( o.roughness !== undefined ) u.roughness.value = o.roughness;
		if ( o.metalness !== undefined ) u.metalness.value = o.metalness;
		if ( o.opacity !== undefined ) u.opacity.value = o.opacity;
		if ( o.alphaTest !== undefined ) u.alphaTest.value = o.alphaTest;

		this.bindings = {};
		for ( const k in o.textures || {} ) {

			const t = o.textures[ k ];
			this.bindings[ k ] = t && t.isTexture ? { texture: t } : typeof t === 'function' ? { texture: t } : t;

		}

		for ( const k in o.storage || {} ) {

			const b = o.storage[ k ];
			this.bindings[ k ] = b && b.isStorageBuffer ? { storage: b, access: 'read' } : b;

		}

		Object.assign( this.bindings, o.bindings || {} );
		this._listeners = [];

	}

	// three-style accessors for the common scalar params
	get color() { return this.uniforms.color.value; }
	set color( v ) { this.uniforms.color.value = toColor( v, this.uniforms.color.value ); }
	get emissive() { return this.uniforms.emissive.value; }
	set emissive( v ) { this.uniforms.emissive.value = toColor( v, this.uniforms.emissive.value ); }
	get roughness() { return this.uniforms.roughness.value; }
	set roughness( v ) { this.uniforms.roughness.value = v; }
	get metalness() { return this.uniforms.metalness.value; }
	set metalness( v ) { this.uniforms.metalness.value = v; }
	get opacity() { return this.uniforms.opacity.value; }
	set opacity( v ) { this.uniforms.opacity.value = v; }
	get alphaTest() { return this.uniforms.alphaTest.value; }
	set alphaTest( v ) {

		if ( ( v > 0 ) !== ( this.uniforms.alphaTest.value > 0 ) ) this.needsUpdate = true;
		this.uniforms.alphaTest.value = v;

	}

	set( name, v ) {

		this.uniformBlock.set( name, v );

	}

	// any change to code / defines / pipeline state: rebuild pipelines
	set needsUpdate( v ) {

		if ( v ) this.version ++;

	}

	setDefine( k, v ) {

		if ( this.defines[ k ] === v ) return;
		this.defines[ k ] = v;
		this.version ++;

	}

	// the state that selects a pipeline (besides geometry layout and pass)
	pipelineKey() {

		return `${ this.id }.${ this.version }.${ this.side }.${ this.transparent }.${ typeof this.blending === 'string' ? this.blending : JSON.stringify( this.blending ) }.${ this.depthWrite }.${ this.depthTest }.${ this.depthCompare }.${ this.colorWrite }.${ this.topology }.${ this.alphaTest > 0 }.${ this.underwaterLighting }.${ this.appliesHillShadow }.${ this.localLightsCheap }.${ this.receiveShadows }.${ this.depthBias }.${ this.depthBiasSlopeScale }.${ this.vertexColors }`;

	}

	allDefines() {

		return {
			...this.defines,
			UNDERWATER_LIGHTING: { none: 0, lite: 1, full: 2 }[ this.underwaterLighting ] ?? 2,
			HILL_SHADOW_SELF: this.appliesHillShadow ? 1 : 0,
			LOCAL_LIGHTS_CHEAP: this.localLightsCheap ? 1 : 0,
			ALPHA_TEST: this.alphaTest > 0 ? 1 : 0,
			DOUBLE_SIDED: this.side === 'double' ? 1 : 0,
			BACK_SIDE: this.side === 'back' ? 1 : 0,
			TRANSPARENT: this.transparent ? 1 : 0,
			RECEIVE_SHADOWS: this.receiveShadows ? 1 : 0,
		};

	}

	addEventListener( type, fn ) {

		if ( type === 'dispose' ) this._listeners.push( fn );

	}

	dispose() {

		for ( const f of this._listeners ) f( { target: this } );

	}

	clone() {

		const m = Object.create( Object.getPrototypeOf( this ) );
		Object.assign( m, this );
		m.id = _id ++;
		m.version = 0;
		m.defines = { ...this.defines };
		m.bindings = { ...this.bindings };
		m.uniformBlock = new UniformBlock( 'MaterialParams' + m.id, Object.fromEntries( this.uniformBlock.order.map( ( k ) => [ k, [ this.uniformBlock.layout[ k ].typeStr, cloneValue( this.uniforms[ k ].value ) ] ] ) ), { label: m.name } );
		m.uniforms = m.uniformBlock.fields;
		m._listeners = [];
		return m;

	}

}

function cloneValue( v ) {

	if ( v && typeof v === 'object' && v.clone ) return v.clone();
	if ( Array.isArray( v ) ) return v.map( cloneValue );
	return v;

}

function toColor( v, target ) {

	if ( v === undefined || v === null ) return target;
	if ( v.isColor ) return target.copy ? target.copy( v ) : v.clone();
	if ( typeof v === 'number' || typeof v === 'string' ) return target.set( v );
	if ( Array.isArray( v ) ) return target.setRGB( v[ 0 ], v[ 1 ], v[ 2 ] );
	if ( v.isVector3 ) return target.setRGB( v.x, v.y, v.z );
	return target;

}

// Blend state presets (color target); `custom` objects pass through as a GPUBlendState.
export function blendState( b ) {

	if ( ! b || b === 'none' ) return undefined;
	if ( typeof b === 'object' ) return b;
	const c = ( src, dst, op = 'add' ) => ( { srcFactor: src, dstFactor: dst, operation: op } );
	switch ( b ) {

		case 'normal': return { color: c( 'src-alpha', 'one-minus-src-alpha' ), alpha: c( 'one', 'one-minus-src-alpha' ) };
		case 'premultiplied': return { color: c( 'one', 'one-minus-src-alpha' ), alpha: c( 'one', 'one-minus-src-alpha' ) };
		case 'additive': return { color: c( 'src-alpha', 'one' ), alpha: c( 'zero', 'one' ) };
		case 'add': return { color: c( 'one', 'one' ), alpha: c( 'one', 'one' ) };
		case 'multiply': return { color: c( 'dst', 'zero' ), alpha: c( 'zero', 'one' ) };
		case 'min': return { color: c( 'one', 'one', 'min' ), alpha: c( 'one', 'one', 'min' ) };
		case 'max': return { color: c( 'one', 'one', 'max' ), alpha: c( 'one', 'one', 'max' ) };

	}

	throw new Error( 'unknown blending ' + b );

}

// Unlit material helper (MeshBasicNodeMaterial replacement): `color` WGSL expression or a surface body.
export function basicMaterial( o = {} ) {

	return new Material( { lit: false, ...o } );

}

export { Vector2, Vector3, Vector4, Color };

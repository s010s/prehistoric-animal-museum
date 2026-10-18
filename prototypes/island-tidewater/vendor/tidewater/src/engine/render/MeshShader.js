import { commonModule } from './wgsl/common.js';
import { surfaceModule, lightingModule, hookModules, shadowModule } from './wgsl/lighting.js';
import { collectModules } from '../gpu/Shader.js';
import { GPU } from '../gpu/GPU.js';

// Builds the WGSL of a mesh pipeline: vertex fetch + material vertex hook + transform, fragment
// surface hook + lighting + outputs. See Material.js for the snippet contract.
//
// pass.kind:
//   'main'  — scene color (rgba16float) + velocity (rgba16float, uv-space motion in xy) + water mask (rgba8)
//   'depth' — depth only (shadow maps); fragment only when alpha matters
//   'color' — a single color target (cube faces, hull mask, reflections)
// pass.late: the water / transparent pass (velocity is blended premultiplied there)
// pass.defines: extra defines, e.g. REFRACTION_CLIP + REFRACTION_CLIP_MARGIN (m): fragments higher than
// sea level + margin are dropped (the water's refraction source, ocean/RefractionPass.js). With the
// 'clip-distances' feature the vertex stage clips there (nothing above is rasterized, and the pass
// keeps early depth / hidden surface removal); otherwise the fragment discards.

const STD_ATTRS = {
	position: 'vec3f',
	normal: 'vec3f',
	uv: 'vec2f',
	color: 'vec4f',
};

const DEFAULTS = {
	normal: 'vec3f( 0.0, 1.0, 0.0 )',
	uv: 'vec2f( 0.0 )',
	color: 'vec4f( 1.0 )',
};

const FLAT = /^(u32|i32|vec[234][ui])$/;

function zero( t ) {

	if ( t === 'f32' ) return '0.0';
	if ( t === 'u32' ) return '0u';
	if ( t === 'i32' ) return '0i';
	return `${ t }()`;

}

// layout: [ { name, wgsl, location, instanced } ] (see MeshRenderer.geometryLayout)
export function buildMeshShader( material, layout, pass ) {

	const kind = pass.kind;
	const has = new Set( layout.map( ( a ) => a.name ) );
	const defs = material.allDefines();
	defs.PASS_MAIN = kind === 'main' ? 1 : 0;
	defs.PASS_DEPTH = kind === 'depth' ? 1 : 0;
	defs.PASS_COLOR = kind === 'color' ? 1 : 0;
	defs.PASS_LATE = pass.late ? 1 : 0;
	defs.LIT = material.lit ? 1 : 0;
	defs.INSTANCED = has.has( 'instanceMatrix0' ) ? 1 : 0;
	defs.INSTANCE_COLOR = has.has( 'instanceColor' ) ? 1 : 0;
	Object.assign( defs, pass.defines || {} );
	defs.CLIP_DISTANCES = defs.REFRACTION_CLIP && GPU.features.has( 'clip-distances' ) ? 1 : 0;

	// ---- vertex input
	let vin = 'struct VertexIn {\n';
	for ( const a of layout ) vin += `\t@location( ${ a.location } ) ${ a.name }: ${ a.wgsl },\n`;
	vin += '\t@builtin( instance_index ) instance: u32,\n\t@builtin( vertex_index ) vertex: u32,\n};\n';

	// ---- vertex data seen by the material hook
	let vdata = 'struct VertexData {\n\tposition: vec3f,\n\tnormal: vec3f,\n\tuv: vec2f,\n\tcolor: vec4f,\n\tmodel: mat4x4f,\n\tprevModel: mat4x4f,\n\tinstance: u32,\n\tvertex: u32,\n\tworldOffset: vec3f,\n\tprevWorldOffset: vec3f,\n\tuseWorld: bool,\n\tworldPos: vec3f,\n\tworldNormal: vec3f,\n\tprevWorldPos: vec3f,\n';
	for ( const k in material.attributes ) vdata += `\t${ k }: ${ material.attributes[ k ] },\n`;
	vdata += '};\n';

	// ---- varyings
	const withMotion = kind === 'main';
	let loc = 0;
	let vsout = 'struct VSOut {\n\t@builtin( position ) clip: vec4f,\n';
	vsout += `\t@location( ${ loc ++ } ) worldPos: vec3f,\n`;
	vsout += `\t@location( ${ loc ++ } ) normal: vec3f,\n`;
	vsout += `\t@location( ${ loc ++ } ) uv: vec2f,\n`;
	vsout += `\t@location( ${ loc ++ } ) color: vec4f,\n`;
	if ( withMotion ) {

		vsout += `\t@location( ${ loc ++ } ) curClip: vec4f,\n`;
		vsout += `\t@location( ${ loc ++ } ) prevClip: vec4f,\n`;

	}

	for ( const k in material.varyings ) {

		const t = material.varyings[ k ];
		vsout += `\t@location( ${ loc ++ } )${ FLAT.test( t ) ? ' @interpolate( flat )' : '' } ${ k }: ${ t },\n`;

	}

	vsout += '};\n';
	// the vertex output with hardware clip distances (a fragment input can't carry them)
	if ( defs.CLIP_DISTANCES ) {

		const fields = [ ...vsout.matchAll( /\s(\w+): [^,]+,\n/g ) ].map( ( m ) => m[ 1 ] );
		vsout += vsout.replace( 'struct VSOut {', 'struct VSOutClip {' ).replace( /};\n$/, '\t@builtin( clip_distances ) clipDistances: array<f32, 1>,\n};\n' );
		vsout += `fn vsClip( o: VSOut, d: f32 ) -> VSOutClip {\n\tvar c: VSOutClip;\n${ fields.map( ( f ) => `\tc.${ f } = o.${ f };\n` ).join( '' ) }\tc.clipDistances[ 0 ] = d;\n\treturn c;\n}\n`;

	}

	let fetch = '';
	for ( const k in STD_ATTRS ) {

		if ( has.has( k ) ) {

			const a = layout.find( ( x ) => x.name === k );
			if ( k === 'color' && a.wgsl === 'vec3f' ) fetch += `\tv.color = vec4f( i.color, 1.0 );\n`;
			else fetch += `\tv.${ k } = i.${ k };\n`;

		} else if ( k !== 'position' ) fetch += `\tv.${ k } = ${ DEFAULTS[ k ] };\n`;

	}

	for ( const k in material.attributes ) fetch += has.has( k ) ? `\tv.${ k } = i.${ k };\n` : `\tv.${ k } = ${ zero( material.attributes[ k ] ) };\n`;

	const main = /* wgsl */`
struct Draw {
	model: mat4x4f,
	prevModel: mat4x4f,
	params: vec4f,  // x: object id, y: user, z: user, w: user
	params2: vec4f,
};
@group( 2 ) @binding( 0 ) var<uniform> draw: Draw;

${ vin }
${ vdata }
${ vsout }

struct FragInput {
	vs: VSOut,
	P: vec3f,
	N: vec3f,
	V: vec3f,
	uv: vec2f,
	color: vec4f,
	front: bool,
	pixel: vec2f,
};

struct FragResult {
	color: vec4f,
	velocity: vec4f,
	mask: vec4f,
};

fn cofactor3( m: mat4x4f ) -> mat3x3f {
	let a = m[ 0 ].xyz; let b = m[ 1 ].xyz; let c = m[ 2 ].xyz;
	return mat3x3f( cross( b, c ), cross( c, a ), cross( a, b ) );
}

fn materialVertex( v: ptr<function, VertexData>, o: ptr<function, VSOut> ) {
${ material.vertex }
}

fn materialSurface( in: FragInput, s: ptr<function, Surface> ) {
${ material.surface }
}

fn materialOutput( in: FragInput, s: Surface, r: ptr<function, FragResult> ) {
${ material.output }
}

#if CLIP_DISTANCES
@vertex fn vs( i: VertexIn ) -> VSOutClip {
#else
@vertex fn vs( i: VertexIn ) -> VSOut {
#endif
	var v: VertexData;
${ fetch }#if !HAS_POSITION
	v.position = vec3f( 0.0 );
#endif
	v.instance = i.instance;
	v.vertex = i.vertex;
#if INSTANCED
	let im = mat4x4f( i.instanceMatrix0, i.instanceMatrix1, i.instanceMatrix2, i.instanceMatrix3 );
	v.model = draw.model * im;
	v.prevModel = draw.prevModel * im;
#else
	v.model = draw.model;
	v.prevModel = draw.prevModel;
#endif
#if INSTANCE_COLOR
	v.color = vec4f( v.color.rgb * i.instanceColor, v.color.a );
#endif
	v.worldOffset = vec3f( 0.0 );
	v.prevWorldOffset = vec3f( 1e30 );
	v.useWorld = false;
	v.prevWorldPos = vec3f( 1e30 );
	var o: VSOut;
	materialVertex( &v, &o );
	var wp: vec3f;
	var wn: vec3f;
	var pwp: vec3f;
	if ( v.useWorld ) {
		wp = v.worldPos;
		wn = v.worldNormal;
		pwp = select( v.prevWorldPos, wp, v.prevWorldPos.x > 1e29 );
	} else {
		let lp = vec4f( v.position, 1.0 );
		wp = ( v.model * lp ).xyz + v.worldOffset;
		wn = cofactor3( v.model ) * v.normal;
		pwp = ( v.prevModel * lp ).xyz + select( v.prevWorldOffset, v.worldOffset, v.prevWorldOffset.x > 1e29 );
	}
	o.worldPos = wp;
	o.normal = wn;
	o.uv = v.uv;
	o.color = v.color;
	o.clip = frame.viewProj * vec4f( wp, 1.0 );
#if PASS_MAIN
	o.curClip = frame.viewProjNoJitter * vec4f( wp, 1.0 );
	o.prevClip = frame.prevViewProjNoJitter * vec4f( pwp, 1.0 );
#endif
#if CLIP_DISTANCES
	return vsClip( o, frame.seaLevel + REFRACTION_CLIP_MARGIN - wp.y );
#else
	return o;
#endif
}

#if PASS_MAIN && !PASS_LATE && LIT && !IS_WATER && !ALPHA_TEST && !STUDIO_LIGHTING
// Deep under the water, seen from above it: the water drawn over this pixel shows the refraction
// pass (ocean/RefractionPass.js) at its refracted end point, never this pixel's own colour. The end
// point is predicted as the water shader traces it (flat surface, the seabed at P's depth, a margin
// for the wave slopes); where it would leave the screen the water takes the refraction pass' edge.
const SUBMERGED_DEPTH: f32 = 2.5; // m below sea level: below the deepest wave troughs
fn submergedHidden( P: vec3f ) -> bool {
	let sea = frame.seaLevel;
	if ( P.y > sea - SUBMERGED_DEPTH || frame.cameraPos.y < sea + 1.0 ) { return false; }
	let V = normalize( P - frame.cameraPos );
	let pos = frame.cameraPos + V * ( ( frame.cameraPos.y - sea ) / max( - V.y, 1e-4 ) );
	let Tr = refract( V, vec3f( 0.0, 1.0, 0.0 ), 1.0 / 1.333 );
	let Tv = normalize( vec3f( Tr.x, min( Tr.y, -0.08 ), Tr.z ) );
	let L = ( sea - P.y ) / max( - Tv.y, 0.04 );
	let c = frame.viewProj * vec4f( pos + Tv * min( L, 80.0 ), 1.0 );
	let uv = c.xy / max( c.w, 1e-4 ) * vec2f( 0.5, -0.5 ) + 0.5;
	return all( uv > vec2f( 0.1 ) ) && all( uv < vec2f( 0.9 ) ) && c.w > 0.0;
}
#endif

fn fragInput( vs: VSOut, front: bool ) -> FragInput {
	var in: FragInput;
	in.vs = vs;
	in.P = vs.worldPos;
	var N = normalize( vs.normal );
#if DOUBLE_SIDED
	N = select( -N, N, front );
#endif
#if BACK_SIDE
	N = -N;
#endif
	in.N = N;
	in.V = normalize( frame.cameraPos - vs.worldPos );
	in.uv = vs.uv;
	in.color = vs.color;
	in.front = front;
	in.pixel = vs.clip.xy;
	return in;
}

fn surfaceOf( in: FragInput ) -> Surface {
	var s = defaultSurface( in.N );
	s.albedo = mat.color * in.color.rgb;
	s.alpha = mat.opacity * in.color.a;
	s.roughness = mat.roughness;
	s.metalness = mat.metalness;
	s.emissive = mat.emissive;
	materialSurface( in, &s );
	return s;
}

#if PASS_DEPTH
#if NEEDS_DEPTH_FRAGMENT
@fragment fn fs( vs: VSOut, @builtin( front_facing ) front: bool ) {
	let in = fragInput( vs, front );
#if HAS_SHADOW_HOOK
	if ( ! materialShadow( in ) ) { discard; }
#else
	let s = surfaceOf( in );
	if ( s.alpha < mat.alphaTest ) { discard; }
#endif
}
#endif
#else

#if PASS_MAIN
struct FragOut {
	@location( 0 ) color: vec4f,
	@location( 1 ) velocity: vec4f,
	@location( 2 ) mask: vec4f,
};
#else
struct FragOut {
	@location( 0 ) color: vec4f,
};
#endif

@fragment fn fs( vs: VSOut, @builtin( front_facing ) front: bool ) -> FragOut {
	let in = fragInput( vs, front );
#if REFRACTION_CLIP
#if !CLIP_DISTANCES
	// the water's refraction source only holds what is under the water (pass.defines)
	if ( in.P.y > frame.seaLevel + REFRACTION_CLIP_MARGIN ) { discard; }
#endif
#endif
#if PASS_MAIN && !PASS_LATE && LIT && !IS_WATER && !ALPHA_TEST && !STUDIO_LIGHTING
	// hidden under the water (see submergedHidden): an ambient colour, keeping depth and motion
	if ( submergedHidden( in.P ) ) {
		var so: FragOut;
		so.color = vec4f( mat.color * in.color.rgb * hookEnvDiffuse( in.N ) * hookAmbientModulation( in.P, in.N ), 1.0 );
		let cur0 = vs.curClip.xy / vs.curClip.w;
		let prev0 = vs.prevClip.xy / vs.prevClip.w;
		so.velocity = vec4f( ( cur0 - prev0 ) * vec2f( 0.5, -0.5 ), 0.0, 1.0 );
		so.mask = vec4f( 0.0 );
		return so;
	}
#endif
	var s = surfaceOf( in );
#if ALPHA_TEST
	if ( s.alpha < mat.alphaTest ) { discard; }
#endif
	s.normal = normalize( s.normal );
	s.clearcoatNormal = normalize( s.clearcoatNormal );
	var r: FragResult;
#if LIT
	r.color = vec4f( shadeSurface( s, in.P, in.V, in.pixel ), s.alpha );
#else
	r.color = vec4f( s.albedo + s.emissive, s.alpha );
#endif
#if PASS_MAIN
	let cur = vs.curClip.xy / vs.curClip.w;
	let prev = vs.prevClip.xy / vs.prevClip.w;
	r.velocity = vec4f( ( cur - prev ) * vec2f( 0.5, -0.5 ), 0.0, 1.0 );
#else
	r.velocity = vec4f( 0.0 );
#endif
	r.mask = vec4f( 0.0 );
	materialOutput( in, s, &r );
	var out: FragOut;
	out.color = r.color;
#if PASS_MAIN
#if PASS_LATE
	// premultiplied: opaque outputs overwrite, blended ones weight their motion by coverage
#if VELOCITY_OPAQUE
	// the fragment owns the motion of its pixel even when its colour is blended (AirMotes specks)
	let a = VELOCITY_WEIGHT;
#else
	let a = select( 1.0, r.color.a, TRANSPARENT_F ) * VELOCITY_WEIGHT;
#endif
	out.velocity = vec4f( r.velocity.xy * a, 0.0, a );
#else
	out.velocity = r.velocity;
#endif
	out.mask = r.mask;
#endif
	return out;
}
#endif
`;

	const shadowHook = material.shadow ? `fn materialShadow( in: FragInput ) -> bool {\n${ material.shadow }\n}\n` : '';
	defs.HAS_SHADOW_HOOK = material.shadow ? 1 : 0;
	defs.NEEDS_DEPTH_FRAGMENT = kind === 'depth' && ( material.alphaTest > 0 || material.shadow ) ? 1 : 0;
	defs.HAS_POSITION = has.has( 'position' ) ? 1 : 0;

	const code = main
		.replace( 'fn fragInput(', shadowHook + 'fn fragInput(' )
		.replace( /\bTRANSPARENT_F\b/g, material.transparent ? 'true' : 'false' )
		.replace( /\bVELOCITY_WEIGHT\b/g, fmt( material.velocityWeight ) )
		.replace( /\bREFRACTION_CLIP_MARGIN\b/g, fmt( ( pass.defines && pass.defines.REFRACTION_CLIP_MARGIN ) ?? 0 ) );

	// modules: lighting (with the installed hooks) for colour passes, or whenever a material module needs it
	let modules = [ commonModule, surfaceModule, ...material.modules ];
	const needsLighting = kind !== 'depth' || collectModules( material.modules ).includes( lightingModule );
	if ( needsLighting ) modules = [ commonModule, surfaceModule, ...hookModules(), lightingModule, ...material.modules ];
	// custom-shaded materials (the water) that only need sunShadow(): no scene lighting hooks, whose
	// modules would add their uniform buffers / textures to the pipeline (12 uniform buffers per stage)
	if ( material.lightingHooks === false && ! collectModules( material.modules ).includes( lightingModule ) ) modules = [ commonModule, surfaceModule, shadowModule, ...material.modules ];

	return {
		code,
		modules,
		defines: defs,
		bindings: { mat: { uniform: material.uniformBlock }, ...material.bindings },
		hasFragment: kind !== 'depth' || defs.NEEDS_DEPTH_FRAGMENT === 1,
	};

}

function fmt( x ) {

	const s = String( x );
	return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0';

}

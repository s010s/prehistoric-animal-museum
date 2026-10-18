import { Group } from '../scene/Group.js';
import { Mesh } from '../scene/Mesh.js';
import { BufferGeometry } from '../geometry/BufferGeometry.js';
import { BufferAttribute } from '../geometry/BufferAttribute.js';
import { Texture, StorageBuffer } from '../gpu/Texture.js';
import { generateMipmaps } from '../gpu/Mipmaps.js';
import { Material } from './Material.js';
import { decodeImage } from '../loaders/GLTF.js';

// Skinned, animated models (glTF skins) on the GPU.
//
//   const gltf = await loadGLB( url );                       // engine/loaders/GLTF.js
//   const model = await SkinnedModel.create( gltf, { materials: ( info ) => ( { ... } ) } );
//   scene.add( model.group );                                // meshes are children of model.group
//   model.play( 'idle_neutral_01', { fade: 0.5, loop: true, speed: 1 } );
//   model.update( dt );                                      // before rendering: animation + joint upload
//   model.hold();                                            // when it stops updating (keeps motion vectors at 0)
//
// Pose: every node's local TRS starts from the glTF rest pose; each playing clip samples its
// channels (linear / step, quaternions nlerped) and the layers are blended by weight (crossfades:
// the incoming layer's weight rises while the others fall, their sum stays 1). World matrices of
// the node hierarchy -> joint matrices = jointWorld * inverseBind (glTF: the skinned mesh node's
// own transform is ignored), so skinned vertices come out in the model's space and the mesh
// objects' model matrix (model.group's world matrix) places them in the world.
//
// GPU: one storage buffer per model with 2 x joints mat4 (this frame, then the previous frame).
// The material vertex hook skins position and normal with 4 weights and writes the world position,
// the normal and last frame's world position (useWorld), so motion vectors (TAA, motion blur)
// include the animation, and the shadow / depth passes skin the same way (same hook).
//
// Geometry attributes: skinIndex (vec4u, Uint32Array) and skinWeight (vec4f).
// Materials: materials( { gltfMaterial, name, textures: { albedo, normal, orm }, alphaMode } )
// may return Material options to override / extend the default glTF PBR material (see skinnedMaterial).

const SKIN_VERTEX = ( J ) => /* wgsl */`
	let sj = v.skinIndex;
	let sw = v.skinWeight;
	let sk = skinJoints[ sj.x ] * sw.x + skinJoints[ sj.y ] * sw.y + skinJoints[ sj.z ] * sw.z + skinJoints[ sj.w ] * sw.w;
	let skp = skinJoints[ sj.x + ${ J }u ] * sw.x + skinJoints[ sj.y + ${ J }u ] * sw.y + skinJoints[ sj.z + ${ J }u ] * sw.z + skinJoints[ sj.w + ${ J }u ] * sw.w;
	let lp = vec4f( v.position, 1.0 );
	let lm = v.model * sk;
	v.useWorld = true;
	v.worldPos = ( lm * lp ).xyz;
	v.worldNormal = cofactor3( lm ) * v.normal;
	v.prevWorldPos = ( v.prevModel * skp * lp ).xyz;
`;

// Default glTF-style PBR surface: base colour (sRGB, alpha), ORM (G roughness, B metalness), tangent-space
// normal map through a derivative TBN. Extra surface code (e.g. skin / cloth tweaks) runs after it.
export function skinnedMaterial( { name, joints, jointBuffer, textures = {}, alphaMode = 'OPAQUE', alphaCutoff = 0.5, doubleSided = false, surface = '', uniforms = {}, color = null, roughness = 1, metalness = 1, defines = {}, modules = [] } ) {

	const T = {};
	if ( textures.albedo ) T.chAlbedo = textures.albedo;
	if ( textures.normal ) T.chNormal = textures.normal;
	if ( textures.orm ) T.chOrm = textures.orm;
	const code = /* wgsl */`
#if HAS_ALBEDO
	let ca = textureSample( chAlbedo, smpAnisoRepeat, in.uv );
	s.albedo *= ca.rgb;
	s.alpha *= ca.a;
#endif
#if HAS_ORM
	let orm = textureSample( chOrm, smpAnisoRepeat, in.uv );
	s.roughness *= orm.g;
	s.metalness *= orm.b;
#endif
#if HAS_NORMAL
	let nm = textureSample( chNormal, smpAnisoRepeat, in.uv ).xyz * 2.0 - 1.0;
	s.normal = perturbNormalByMap( in.P, in.N, in.uv, nm );
#endif
${ surface }
`;
	return new Material( {
		name,
		modules,
		attributes: { skinIndex: 'vec4u', skinWeight: 'vec4f' },
		storage: { skinJoints: { storage: jointBuffer, access: 'read' } },
		textures: T,
		uniforms,
		color: color || undefined,
		roughness,
		metalness,
		vertex: SKIN_VERTEX( joints ),
		surface: code,
		side: doubleSided ? 'double' : 'front',
		alphaTest: alphaMode === 'MASK' || alphaMode === 'BLEND' ? alphaCutoff : 0,
		defines: { HAS_ALBEDO: T.chAlbedo ? 1 : 0, HAS_ORM: T.chOrm ? 1 : 0, HAS_NORMAL: T.chNormal ? 1 : 0, ...defines },
	} );

}

// ---- pose math on flat arrays (column-major 4x4)

function composeTRS( out, o, t, r, s ) {

	const x = r[ 0 ], y = r[ 1 ], z = r[ 2 ], w = r[ 3 ];
	const x2 = x + x, y2 = y + y, z2 = z + z;
	const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
	const sx = s[ 0 ], sy = s[ 1 ], sz = s[ 2 ];
	out[ o ] = ( 1 - ( yy + zz ) ) * sx; out[ o + 1 ] = ( xy + wz ) * sx; out[ o + 2 ] = ( xz - wy ) * sx; out[ o + 3 ] = 0;
	out[ o + 4 ] = ( xy - wz ) * sy; out[ o + 5 ] = ( 1 - ( xx + zz ) ) * sy; out[ o + 6 ] = ( yz + wx ) * sy; out[ o + 7 ] = 0;
	out[ o + 8 ] = ( xz + wy ) * sz; out[ o + 9 ] = ( yz - wx ) * sz; out[ o + 10 ] = ( 1 - ( xx + yy ) ) * sz; out[ o + 11 ] = 0;
	out[ o + 12 ] = t[ 0 ]; out[ o + 13 ] = t[ 1 ]; out[ o + 14 ] = t[ 2 ]; out[ o + 15 ] = 1;

}

function mul4( out, o, a, ao, b, bo ) {

	for ( let c = 0; c < 4; c ++ ) {

		const b0 = b[ bo + c * 4 ], b1 = b[ bo + c * 4 + 1 ], b2 = b[ bo + c * 4 + 2 ], b3 = b[ bo + c * 4 + 3 ];
		for ( let r = 0; r < 4; r ++ ) out[ o + c * 4 + r ] = a[ ao + r ] * b0 + a[ ao + 4 + r ] * b1 + a[ ao + 8 + r ] * b2 + a[ ao + 12 + r ] * b3;

	}

}

// sample one channel at time t into out (w components), cached segment index
function sampleChannel( ch, t, out ) {

	const T = ch.times, V = ch.values, w = ch.path === 'rotation' ? 4 : 3, n = T.length;
	if ( n === 1 || t <= T[ 0 ] ) {

		for ( let c = 0; c < w; c ++ ) out[ c ] = V[ c ];
		return;

	}

	if ( t >= T[ n - 1 ] ) {

		for ( let c = 0; c < w; c ++ ) out[ c ] = V[ ( n - 1 ) * w + c ];
		return;

	}

	let k = ch._k || 0;
	if ( T[ k ] > t ) k = 0;
	while ( k < n - 2 && T[ k + 1 ] <= t ) k ++;
	ch._k = k;
	const f = ch.step ? 0 : ( t - T[ k ] ) / ( T[ k + 1 ] - T[ k ] );
	const a = k * w, b = ( k + 1 ) * w;
	if ( w === 4 ) {

		// nlerp along the shorter arc
		const d = V[ a ] * V[ b ] + V[ a + 1 ] * V[ b + 1 ] + V[ a + 2 ] * V[ b + 2 ] + V[ a + 3 ] * V[ b + 3 ];
		const sb = d < 0 ? - f : f;
		let x = V[ a ] * ( 1 - f ) + V[ b ] * sb, y = V[ a + 1 ] * ( 1 - f ) + V[ b + 1 ] * sb, z = V[ a + 2 ] * ( 1 - f ) + V[ b + 2 ] * sb, q = V[ a + 3 ] * ( 1 - f ) + V[ b + 3 ] * sb;
		const l = 1 / Math.hypot( x, y, z, q );
		out[ 0 ] = x * l; out[ 1 ] = y * l; out[ 2 ] = z * l; out[ 3 ] = q * l;

	} else for ( let c = 0; c < 3; c ++ ) out[ c ] = V[ a + c ] + ( V[ b + c ] - V[ a + c ] ) * f;

}

export class SkinnedModel {

	// gltf: result of loadGLB / parseGLB. Uses the first skin.
	static async create( gltf, { materials = null, textureSize = null } = {} ) {

		const m = new SkinnedModel( gltf );
		await m._buildMeshes( materials );
		return m;

	}

	constructor( gltf ) {

		this.gltf = gltf;
		const skin = gltf.skins[ 0 ];
		if ( ! skin ) throw new Error( 'SkinnedModel: no skin' );
		this.skin = skin;
		const N = gltf.nodes.length;
		this.nodeCount = N;
		this.joints = skin.joints.length;
		// rest pose, current local TRS and world matrices per node
		this.rest = gltf.nodes.map( ( n ) => ( { t: Float32Array.from( n.t ), r: Float32Array.from( n.r ), s: Float32Array.from( n.s ) } ) );
		this.local = gltf.nodes.map( ( n ) => ( { t: Float32Array.from( n.t ), r: Float32Array.from( n.r ), s: Float32Array.from( n.s ) } ) );
		this.world = new Float32Array( N * 16 );
		this._localM = new Float32Array( 16 );
		// parent-first traversal order
		this.order = [];
		this.parent = new Int32Array( N ).fill( - 1 );
		const visit = ( i ) => {

			this.order.push( i );
			for ( const c of gltf.nodes[ i ].children ) {

				this.parent[ c ] = i;
				visit( c );

			}

		};

		for ( const r of gltf.roots ) visit( r );
		this.jointData = new Float32Array( this.joints * 32 );
		this.jointBuffer = new StorageBuffer( { label: 'skinJoints', count: this.joints * 2, type: 'mat4x4f' } );
		this._first = true;
		// clips by name
		this.clips = new Map();
		for ( const a of gltf.animations ) this.clips.set( a.name, a );
		this.layers = []; // { clip, time, weight, target, fadeRate, loop, speed }
		// blend accumulators
		this._acc = gltf.nodes.map( () => ( { t: new Float32Array( 3 ), r: new Float32Array( 4 ), s: new Float32Array( 3 ), wt: 0, wr: 0, ws: 0 } ) );
		this._tmp = new Float32Array( 4 );
		this.group = new Group();
		this.group.name = 'SkinnedModel';
		this.meshes = [];
		this.materials = [];
		this.onClipEnd = null;
		this._pose();

	}

	async _buildMeshes( materialOptions ) {

		const g = this.gltf;
		// textures (shared between materials that use the same image)
		const texCache = new Map();
		const tex = async ( info, srgb ) => {

			if ( ! info ) return null;
			const src = g.textures[ info.index ].source;
			const key = src + ( srgb ? 's' : 'l' );
			if ( ! texCache.has( key ) ) {

				const im = g.images[ src ];
				const px = await decodeImage( im.bytes, im.mimeType );
				const t = new Texture( { label: 'char' + src, width: px.width, height: px.height, format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm', data: px.data, mips: true, usage: [ 'sample', 'copyDst' ], sampler: 'anisoRepeat' } );
				t.getGPU();
				generateMipmaps( t );
				texCache.set( key, t );

			}

			return texCache.get( key );

		};

		const meshNode = g.nodes.findIndex( ( n ) => n.mesh !== undefined && n.skin !== undefined );
		const prims = g.meshes[ g.nodes[ meshNode ].mesh ];
		const matCache = new Map();
		for ( const p of prims ) {

			const geo = new BufferGeometry();
			const A = p.attributes;
			geo.setAttribute( 'position', new BufferAttribute( A.POSITION.array, 3 ) );
			if ( A.NORMAL ) geo.setAttribute( 'normal', new BufferAttribute( A.NORMAL.array, 3 ) );
			if ( A.TEXCOORD_0 ) geo.setAttribute( 'uv', new BufferAttribute( toFloat( A.TEXCOORD_0 ), 2 ) );
			geo.setAttribute( 'skinIndex', new BufferAttribute( Uint32Array.from( A.JOINTS_0.array ), 4 ) );
			geo.setAttribute( 'skinWeight', new BufferAttribute( normalizeWeights( toFloat( A.WEIGHTS_0 ) ), 4 ) );
			if ( p.indices ) geo.setIndex( new BufferAttribute( p.indices instanceof Uint32Array || p.indices instanceof Uint16Array ? p.indices : Uint32Array.from( p.indices ), 1 ) );
			geo.computeBoundingSphere();

			let mat = matCache.get( p.material );
			if ( ! mat ) {

				const gm = g.materials[ p.material ] || {};
				const pbr = gm.pbrMetallicRoughness || {};
				const info = {
					gltfMaterial: gm,
					name: gm.name || 'material',
					textures: {
						albedo: await tex( pbr.baseColorTexture, true ),
						orm: await tex( pbr.metallicRoughnessTexture, false ),
						normal: await tex( gm.normalTexture, false ),
					},
					alphaMode: gm.alphaMode || 'OPAQUE',
				};
				const extra = materialOptions ? materialOptions( info ) || {} : {};
				mat = skinnedMaterial( {
					name: 'skinned-' + info.name,
					joints: this.joints,
					jointBuffer: this.jointBuffer,
					textures: info.textures,
					alphaMode: info.alphaMode,
					alphaCutoff: gm.alphaCutoff ?? 0.5,
					doubleSided: !! gm.doubleSided,
					roughness: pbr.roughnessFactor ?? 1,
					metalness: pbr.metallicFactor ?? 1,
					...extra,
				} );
				matCache.set( p.material, mat );
				this.materials.push( mat );

			}

			const mesh = new Mesh( geo, mat );
			mesh.name = 'skinned:' + ( g.materials[ p.material ]?.name || '' );
			// skinned: the bind-pose bounds don't follow the animation
			mesh.frustumCulled = false;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			this.group.add( mesh );
			this.meshes.push( mesh );

		}

	}

	clipNames() {

		return [ ...this.clips.keys() ];

	}

	clipDuration( name ) {

		const c = this.clips.get( name );
		return c ? c.duration : 0;

	}

	// Crossfade to a clip. { fade: seconds, loop, speed, from: start time }
	play( name, { fade = 0.4, loop = true, speed = 1, from = 0 } = {} ) {

		const clip = this.clips.get( name );
		if ( ! clip ) throw new Error( 'SkinnedModel: no clip ' + name );
		const cur = this.layers.find( ( l ) => l.clip === clip && l.target === 1 );
		if ( cur ) return cur;
		const layer = { clip, time: from, weight: this.layers.length ? 0 : 1, target: 1, fade: Math.max( fade, 1e-3 ), loop, speed, ended: false };
		for ( const l of this.layers ) {

			l.target = 0;
			l.fade = layer.fade;

		}

		this.layers.push( layer );
		return layer;

	}

	get current() {

		const l = this.layers.find( ( x ) => x.target === 1 );
		return l ? l.clip.name : null;

	}

	// Hold the current pose: last frame's joints = this frame's (no motion vectors). Call it when
	// the model stops being updated (off screen, far away): otherwise the last step would stay in
	// the joint buffer and the model would read as moving forever (TAA / motion-blur smear).
	hold() {

		if ( this._held ) return;
		const J = this.joints, D = this.jointData;
		D.copyWithin( J * 16, 0, J * 16 );
		this.jointBuffer.write( D );
		this._held = true;

	}

	// dt = 0: evaluate without motion (a new clip / teleport: no motion vectors)
	update( dt ) {

		if ( dt === 0 ) this._first = true;
		this._held = false;

		// advance and fade layers
		for ( const l of this.layers ) {

			l.time += dt * l.speed;
			const d = l.clip.duration;
			if ( l.time >= d ) {

				if ( l.loop && d > 0 ) l.time %= d;
				else {

					l.time = d;
					if ( ! l.ended ) {

						l.ended = true;
						if ( l.target === 1 && this.onClipEnd ) this.onClipEnd( l.clip.name );

					}

				}

			}

			const step = dt / l.fade;
			l.weight = l.target > l.weight ? Math.min( l.target, l.weight + step ) : Math.max( l.target, l.weight - step );

		}

		this.layers = this.layers.filter( ( l ) => l.target > 0 || l.weight > 1e-4 );
		// renormalise (fades in and out at the same rate keep the sum ~1)
		let W = 0;
		for ( const l of this.layers ) W += l.weight;
		if ( W > 1e-4 ) for ( const l of this.layers ) l.weight /= W;
		this._pose();

	}

	// evaluate the blended pose, world matrices and joint matrices; upload
	_pose() {

		const N = this.nodeCount, acc = this._acc, tmp = this._tmp;
		for ( let i = 0; i < N; i ++ ) {

			const a = acc[ i ];
			a.wt = a.wr = a.ws = 0;
			a.t.fill( 0 ); a.r.fill( 0 ); a.s.fill( 0 );

		}

		for ( const l of this.layers ) {

			if ( l.weight <= 0 ) continue;
			for ( const ch of l.clip.channels ) {

				const a = acc[ ch.node ];
				sampleChannel( ch, l.time, tmp );
				if ( ch.path === 'rotation' ) {

					// align hemispheres with what is accumulated
					const d = a.r[ 0 ] * tmp[ 0 ] + a.r[ 1 ] * tmp[ 1 ] + a.r[ 2 ] * tmp[ 2 ] + a.r[ 3 ] * tmp[ 3 ];
					const w = d < 0 ? - l.weight : l.weight;
					for ( let c = 0; c < 4; c ++ ) a.r[ c ] += tmp[ c ] * w;
					a.wr += l.weight;

				} else if ( ch.path === 'translation' ) {

					for ( let c = 0; c < 3; c ++ ) a.t[ c ] += tmp[ c ] * l.weight;
					a.wt += l.weight;

				} else {

					for ( let c = 0; c < 3; c ++ ) a.s[ c ] += tmp[ c ] * l.weight;
					a.ws += l.weight;

				}

			}

		}

		for ( let i = 0; i < N; i ++ ) {

			const a = acc[ i ], L = this.local[ i ], R = this.rest[ i ];
			for ( let c = 0; c < 3; c ++ ) {

				L.t[ c ] = a.t[ c ] + R.t[ c ] * ( 1 - Math.min( a.wt, 1 ) );
				L.s[ c ] = a.s[ c ] + R.s[ c ] * ( 1 - Math.min( a.ws, 1 ) );

			}

			if ( a.wr > 0 ) {

				const rw = 1 - Math.min( a.wr, 1 );
				const d = a.r[ 0 ] * R.r[ 0 ] + a.r[ 1 ] * R.r[ 1 ] + a.r[ 2 ] * R.r[ 2 ] + a.r[ 3 ] * R.r[ 3 ];
				const sr = d < 0 ? - rw : rw;
				let x = a.r[ 0 ] + R.r[ 0 ] * sr, y = a.r[ 1 ] + R.r[ 1 ] * sr, z = a.r[ 2 ] + R.r[ 2 ] * sr, w = a.r[ 3 ] + R.r[ 3 ] * sr;
				const l = 1 / Math.hypot( x, y, z, w );
				L.r[ 0 ] = x * l; L.r[ 1 ] = y * l; L.r[ 2 ] = z * l; L.r[ 3 ] = w * l;

			} else L.r.set( R.r );

		}

		const W = this.world, M = this._localM;
		for ( const i of this.order ) {

			const L = this.local[ i ];
			composeTRS( M, 0, L.t, L.r, L.s );
			const p = this.parent[ i ];
			if ( p < 0 ) W.set( M, i * 16 );
			else mul4( W, i * 16, W, p * 16, M, 0 );

		}

		// previous frame's joints -> second half, then this frame's
		const J = this.joints, D = this.jointData, ibm = this.skin.inverseBindMatrices;
		if ( ! this._first ) D.copyWithin( J * 16, 0, J * 16 );
		for ( let j = 0; j < J; j ++ ) mul4( D, j * 16, W, this.skin.joints[ j ] * 16, ibm, j * 16 );
		if ( this._first ) {

			D.copyWithin( J * 16, 0, J * 16 );
			this._first = false;

		}

		this.jointBuffer.write( D );

	}

	// world-space position of a node (by name) in model space, e.g. the head for look-at
	nodeWorld( name, out ) {

		const i = this.gltf.nodes.findIndex( ( n ) => n.name === name );
		if ( i < 0 ) return null;
		const W = this.world;
		return out.set( W[ i * 16 + 12 ], W[ i * 16 + 13 ], W[ i * 16 + 14 ] );

	}

	dispose() {

		this.jointBuffer.destroy();
		for ( const m of this.meshes ) m.geometry.dispose && m.geometry.dispose();

	}

}

function toFloat( a ) {

	if ( a.array instanceof Float32Array ) return a.array;
	const k = a.normalized ? 1 / ( a.array instanceof Uint8Array ? 255 : a.array instanceof Uint16Array ? 65535 : 1 ) : 1;
	return Float32Array.from( a.array, ( x ) => x * k );

}

function normalizeWeights( w ) {

	for ( let i = 0; i < w.length; i += 4 ) {

		const s = w[ i ] + w[ i + 1 ] + w[ i + 2 ] + w[ i + 3 ];
		if ( s > 0 ) for ( let c = 0; c < 4; c ++ ) w[ i + c ] /= s;
		else w[ i ] = 1;

	}

	return w;

}

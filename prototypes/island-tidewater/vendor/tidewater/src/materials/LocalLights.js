import * as THREE from '../engine/index.js';
import { ShaderModule, UniformBlock } from '../engine/gpu/Shader.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { surfaceModule } from '../engine/render/wgsl/lighting.js';
import { G } from '../engine/render/Frame.js';
import { SceneLighting } from './SceneLighting.js';

// Local lights (lanterns, lamp posts, path lights, lit windows, the boat's cabin and navigation
// lights, the handheld flashlight) without a light object per lamp: unrolling every light into every
// material would multiply shader size and compile time. Instead the CPU picks the
// MAX lights nearest the camera each frame and packs them into three small uniform arrays; every
// lit material evaluates them in ONE loop (the physical BRDF: diffuse + GGX
// specular), inverse-square falloff with a smooth range window, optional spot cone, no shadows.
// Skipped entirely (uniform loop bound) when no light is active (daytime without the flashlight).
// They bypass the sun-only terms of the direct light (clouds, caustics, contact shadows).
//
// WGSL: `localLightsModule` (prefix localLights) installs the `localLights` lighting hook and exposes
//   uniforms localLights.{ pos[ 8 ], col[ 8 ], dir[ 8 ], count, flashOn, flashPos, flashDir, flashCol, flashCone }
//   fn localLightsSpotProfile( cd: f32, cosInner: f32, cosOuter: f32 ) -> f32
// for effects outside the lighting model (underwater beam in-scatter, marine snow: add the module).
// Exclusions per material define: IS_WATER, NO_LOCAL_LIGHTS (the former `material.localLights = false`);
// LOCAL_LIGHTS_CHEAP (material.localLightsCheap) = Lambert only.
const MAX = 8;
const v4 = () => Array.from( { length: MAX }, () => new THREE.Vector4() );
const params = new UniformBlock( 'LocalLightParams', {
	pos: [ `vec4f[${ MAX }]`, v4() ], // xyz, range^2
	col: [ `vec4f[${ MAX }]`, v4() ], // rgb x intensity, cos(inner cone)
	dir: [ `vec4f[${ MAX }]`, v4() ], // spot axis, cos(outer cone) (-2: point light)
	count: [ 'i32', 0 ],
	flashOn: [ 'f32', 0 ],
	flashCone: [ 'vec2f', new THREE.Vector2( 0.99, 0.82 ) ], // cos inner, cos outer
	flashPos: [ 'vec3f', new THREE.Vector3() ],
	flashDir: [ 'vec3f', new THREE.Vector3( 0, 0, - 1 ) ],
	flashCol: [ 'vec3f', new THREE.Vector3() ], // rgb x intensity
}, { label: 'localLights' } );
const F = params.fields;
const uPos = { array: F.pos.value };
const uCol = { array: F.col.value };
const uDir = { array: F.dir.value };
const uCount = F.count;

// the flashlight for effects outside the lighting model (underwater beam in-scatter, marine snow):
// `{ value }` handles of the localLights uniforms
export const FLASH = {
	on: F.flashOn,
	pos: F.flashPos,
	dir: F.flashDir,
	col: F.flashCol,
	cone: F.flashCone,
};

export const localLightsModule = new ShaderModule( {
	name: 'localLights',
	deps: [ commonModule, surfaceModule ],
	uniforms: params,
	uniformName: 'localLights',
	code: /* wgsl */`
// spot profile shared by the shading, the beam and the snow: hot centre, soft edge, faint spill
fn localLightsSpotProfile( cd: f32, cosInner: f32, cosOuter: f32 ) -> f32 {
	let m = smoothstep( cosOuter, cosInner, cd );
	return max( m * m, smoothstep( cosOuter - 0.55, cosOuter, cd ) * 0.05 );
}

fn hookLocalLights( s: Surface, P: vec3f, N: vec3f, V: vec3f, acc: ptr<function, LightAccum> ) {
#if !IS_WATER && !NO_LOCAL_LIGHTS
	let diffuseColor = s.albedo * ( 1.0 - s.metalness );
	let specF0 = mix( vec3f( 0.04 ) * s.specularIntensity, s.albedo, s.metalness );
	let specF90 = mix( s.specularIntensity, 1.0, s.metalness );
	let rough = clamp( s.roughness, 0.03, 1.0 );
	for ( var i = 0; i < localLights.count; i++ ) {
		let p = localLights.pos[ i ];
		let d = p.xyz - P;
		let d2 = dot( d, d );
		if ( d2 < p.w ) {
			let c = localLights.col[ i ];
			let sd = localLights.dir[ i ];
			let L = d * inverseSqrt( max( d2, 1e-6 ) );
			// smooth range window (1 - (d/r)^4)^2 on the inverse-square law
			let x = d2 / p.w;
			let win = sat( 1.0 - x * x );
			// spot: hot centre, soft edge at the outer cone, faint wide spill
			let spot = localLightsSpotProfile( dot( -L, sd.xyz ), c.w, sd.w );
			// Beer-Lambert over the underwater part of the path (straight, mean sea level): red dies
			// within metres, so what the torch lights far away under water is dim and blue-green
			let r = d2 * inverseSqrt( max( d2, 1e-6 ) );
			let under = sat( ( frame.seaLevel - min( P.y, p.y ) ) / max( abs( p.y - P.y ), 1e-3 ) );
			let Tw = exp( -( frame.waterAbsorption + frame.waterScattering ) * ( r * under ) );
			// the + 0.15 m^2 softens the near field of a lamp's finite size (no hot spot on the post)
			let lightColor = c.xyz * Tw * ( win * win * spot / ( d2 + 0.15 ) );
			let irradiance = max( dot( N, L ), 0.0 ) * lightColor;
#if LOCAL_LIGHTS_CHEAP
			// foliage (heavy overdraw): Lambert only
			( *acc ).directDiffuse += irradiance * diffuseColor * INV_PI;
#else
			( *acc ).directDiffuse += irradiance * diffuseColor * INV_PI;
			( *acc ).directSpecular += irradiance * BRDF_GGX( L, V, N, specF0, specF90, rough );
#if SHEEN
			( *acc ).directSpecular += irradiance * BRDF_Sheen( L, V, N, s.sheenColor, max( s.sheenRoughness, 0.07 ) );
#endif
#endif
		}
	}
#endif
}
`,
} );

SceneLighting.set( 'localLights', localLightsModule );

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
const smooth = ( x, a, b ) => {

	const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

};

// CPU side: sources and the flashlight, packed every frame.
//   add( { position (live Vector3), color, intensity, range, dir?, cosInner?, cosOuter?, kind, flicker? } )
//   intensity: luminous intensity in scene units (illuminance at 1 m); range: cut-off distance (m)
export class LocalLights {

	constructor() {

		this.sources = [];
		this.enabled = true;
		this.strength = 1; // UI multiplier for the lamps (not the flashlight)
		this.flashlight = {
			on: false, intensity: 55, range: 30,
			color: new THREE.Color( 1.0, 0.71, 0.49 ), // ~4500 K
			cosInner: Math.cos( THREE.MathUtils.degToRad( 9 ) ), cosOuter: Math.cos( THREE.MathUtils.degToRad( 35 ) ),
			position: new THREE.Vector3(), dir: new THREE.Vector3( 0, 0, - 1 ), primed: false,
		};
		this._list = [];
		this.time = 0;
		this.active = 0;

	}

	add( src ) {

		src.phase = src.phase ?? Math.random() * 100;
		this.sources.push( src );
		return src;

	}

	toggleFlashlight( on = ! this.flashlight.on ) {

		this.flashlight.on = on;
		this.flashlight.primed = false;
		return on;

	}

	update( camera, dt ) {

		this.time += dt;
		let n = 0;
		FLASH.on.value = this.flashlight.on && this.enabled ? 1 : 0;
		const pos = uPos.array, col = uCol.array, dir = uDir.array;
		const fl = this.flashlight;
		if ( fl.on && this.enabled ) {

			// held a little right of and below the eye, lagging the view slightly
			camera.updateMatrixWorld();
			const e = camera.matrixWorld.elements;
			_r.set( e[ 0 ], e[ 1 ], e[ 2 ] ).normalize();
			_u.set( e[ 4 ], e[ 5 ], e[ 6 ] ).normalize();
			_f.set( - e[ 8 ], - e[ 9 ], - e[ 10 ] ).normalize();
			if ( ! fl.primed ) {

				fl.dir.copy( _f );
				fl.primed = true;

			}

			fl.dir.lerp( _f, 1 - Math.exp( - dt / 0.06 ) ).normalize();
			fl.position.setFromMatrixPosition( camera.matrixWorld ).addScaledVector( _r, 0.2 ).addScaledVector( _u, - 0.22 ).addScaledVector( _f, 0.15 );
			// faint against daylight (the scene's night is exposed far brighter than physical)
			const k = fl.intensity * ( 0.08 + 0.92 * smooth( G.night.value, 0.0, 0.6 ) );
			pos[ 0 ].set( fl.position.x, fl.position.y, fl.position.z, fl.range * fl.range );
			col[ 0 ].set( fl.color.r * k, fl.color.g * k, fl.color.b * k, fl.cosInner );
			dir[ 0 ].set( fl.dir.x, fl.dir.y, fl.dir.z, fl.cosOuter );
			n = 1;
			FLASH.pos.value.copy( fl.position );
			FLASH.dir.value.copy( fl.dir );
			FLASH.col.value.set( fl.color.r * k, fl.color.g * k, fl.color.b * k );
			FLASH.cone.value.set( fl.cosInner, fl.cosOuter );

		}

		// lamps: on from dusk (same ramp as the lantern glass), nearest first
		const on = smooth( G.night.value, 0.15, 0.75 ) * this.strength;
		if ( on > 0.002 && this.enabled ) {

			const cp = camera.position;
			const list = this._list;
			list.length = 0;
			for ( const s of this.sources ) {

				if ( s.enabled === false ) continue;
				if ( s.update ) s.update();
				s.d2 = s.position.distanceToSquared( cp );
				list.push( s );

			}

			list.sort( ( a, b ) => a.d2 - b.d2 );
			const slots = MAX - n;
			// fade out the farthest selected lights as they approach the cut (no popping)
			const dCut = list.length > slots ? Math.sqrt( list[ slots ].d2 ) : Infinity;
			for ( let i = 0; i < Math.min( slots, list.length ); i ++ ) {

				const s = list[ i ];
				const fade = Number.isFinite( dCut ) ? smooth( Math.sqrt( s.d2 ), dCut, dCut * 0.8 ) : 1;
				const fl2 = s.flicker ? 1 + s.flicker * Math.sin( this.time * 9 + s.phase ) * Math.sin( this.time * 5.3 + s.phase * 0.37 ) : 1;
				const k = s.intensity * on * fade * fl2 * ( s.scale ?? 1 );
				if ( k <= 1e-4 ) continue;
				const r = s.range;
				pos[ n ].set( s.position.x, s.position.y, s.position.z, r * r );
				col[ n ].set( s.color.r * k, s.color.g * k, s.color.b * k, s.cosInner ?? - 1.5 );
				if ( s.dir ) dir[ n ].set( s.dir.x, s.dir.y, s.dir.z, s.cosOuter ?? - 2 );
				else dir[ n ].set( 0, - 1, 0, - 2 );
				n ++;

			}

		}

		uCount.value = n;
		this.active = n;

	}

}

// Boat lights in the hull frame: warm cabin dome, instrument glow, navigation lights (red port,
// green starboard, white masthead and stern). Positions follow the boat's world matrix.
export function addBoatLights( lights, boat ) {

	const L = boat.lines;
	const obj = boat.group;
	const sternY = L.sheerY( 0 ) + 0.1;
	const defs = [
		{ p: [ 0, 2.24, 0.42 ], color: [ 1.0, 0.84, 0.62 ], intensity: 0.9, range: 5.5, kind: 'boatDome' },
		{ p: [ - 0.45, 1.5, 1.12 ], color: [ 0.45, 0.75, 1.0 ], intensity: 0.12, range: 2.2, kind: 'boatInstruments' },
		{ p: [ 0.47, 3.45, - 0.47 ], color: [ 1.0, 0.06, 0.03 ], intensity: 1.4, range: 8, kind: 'boatNav', side: [ 1, 0, 0 ] },
		{ p: [ - 0.47, 3.45, - 0.47 ], color: [ 0.05, 1.0, 0.3 ], intensity: 1.4, range: 8, kind: 'boatNav', side: [ - 1, 0, 0 ] },
		{ p: [ 0, 3.97, - 0.5 ], color: [ 1.0, 0.95, 0.85 ], intensity: 1.2, range: 8, kind: 'boatNav' },
		{ p: [ 0, sternY, L.zAft - 0.05 ], color: [ 1.0, 0.95, 0.85 ], intensity: 0.8, range: 7, kind: 'boatNav' },
	];
	const out = [];
	for ( const d of defs ) {

		const local = new THREE.Vector3( ...d.p );
		const localDir = d.side ? new THREE.Vector3( ...d.side ) : null;
		const src = {
			position: new THREE.Vector3(), color: new THREE.Color( ...d.color ), intensity: d.intensity, range: d.range, kind: d.kind,
			dir: localDir ? new THREE.Vector3() : null, cosInner: localDir ? 0.25 : undefined, cosOuter: localDir ? - 0.2 : undefined,
			update() {

				obj.updateWorldMatrix( true, false );
				this.position.copy( local ).applyMatrix4( obj.matrixWorld );
				if ( localDir ) this.dir.copy( localDir ).transformDirection( obj.matrixWorld );

			},
		};
		src.update();
		out.push( lights.add( src ) );

	}

	return out;

}

// Village lights (Village.getLightSources()): lanterns, lamp posts, path lights, lit windows. Window
// lights sit just outside the pane and only light outward (porches); lanterns flicker a little.
export function addVillageLights( lights, village ) {

	const K = { lantern: 1.5, pathLight: 1.0, window: 0.8 };
	const R = { lantern: 11, pathLight: 7, window: 6 };
	for ( const l of village.getLightSources() ) {

		const kind = l.kind || 'lantern';
		const src = { position: l.position, color: l.color, intensity: l.intensity * ( K[ kind ] ?? 1.2 ), range: R[ kind ] ?? 12, kind };
		if ( kind === 'window' ) {

			// outward normal: away from the nearest building centre
			let best = null, bd = Infinity;
			for ( const b of village.buildings || [] ) {

				const dd = ( b.x - l.position.x ) ** 2 + ( b.z - l.position.z ) ** 2;
				if ( dd < bd ) {

					bd = dd;
					best = b;

				}

			}

			const n = best ? _v.set( l.position.x - best.x, 0, l.position.z - best.z ) : _v.set( 0, 0, 1 );
			if ( n.lengthSq() < 1e-6 ) n.set( 0, 0, 1 );
			n.normalize();
			src.position = l.position.clone().addScaledVector( n, 0.35 );
			src.dir = n.clone();
			src.cosInner = 0.35;
			src.cosOuter = - 0.15;

		} else {

			src.flicker = 0.08;

		}

		lights.add( src );

	}

}

import { Group, Mesh, Vector3 } from '../engine/index.js';
import { SkinnedModel } from '../engine/render/Skinning.js';
import { loadGLB } from '../engine/loaders/GLTF.js';
import { prepare, mergePrepared, cylinder, sphere, roundedBox, box, rod, mat4 } from '../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from './GameMaterials.js';

// A trader the player talks to (E within `radius`). Swappable: `model` is a slot (a Group) that
// holds the stand-in figure; setModel( obj ) replaces it. loadCharacter( url ) swaps in a skinned,
// animated character (engine SkinnedModel, Rocketbox avatars) once it has loaded: idle clip,
// a wave when the player comes up, talk gestures while their panel is open (vendor.talking).
//   new Vendor( { name, position, yaw, radius, greeting, idle, material, character } )
//   vendor.group (add to the scene), vendor.inRange( p ), vendor.update( dt, lookAt )
export class Vendor {

	constructor( { name, kind = 'buyer', position, yaw = 0, radius = 2.6, greeting = '', idle = '', material = null, look = {}, character = null } ) {

		this.name = name;
		this.kind = kind; // 'buyer' (fish stand) | 'shop' (upgrades)
		this.greeting = greeting;
		this.idle = idle;
		this.radius = radius;
		this.position = position.clone();
		this.yaw = yaw;
		this.group = new Group();
		this.group.name = 'Vendor:' + name;
		this.group.position.copy( position );
		this.group.rotation.y = yaw;
		this.model = new Group();
		this.group.add( this.model );
		this.material = material || createPropMaterial( 'vendor' );
		this.figure = new Mesh( buildFigure( look ), this.material );
		this.figure.castShadow = true;
		this.model.add( this.figure );
		this._t = Math.random() * 10;
		this._yawOff = 0;
		this.character = null;
		this.talking = false;
		this._near = false;
		if ( character ) this.loadCharacter( character.url, character ).catch( ( e ) => console.warn( 'Vendor: character failed to load', e ) );

	}

	// clips: { idle, talk, greet } clip names in the GLB
	async loadCharacter( url, { idle = 'idle_neutral_01', talk = 'gestic_talk_relaxed_01', greet = 'wave_01', listen = null } = {} ) {

		const model = await SkinnedModel.create( await loadGLB( url ) );
		// on land, never under water: no caustics / wave lookups in their shaders
		for ( const m of model.materials ) m.underwaterLighting = 'lite';
		this.clips = { idle, talk, greet, listen };
		model.play( idle, { fade: 0.01, from: Math.random() * model.clipDuration( idle ) } );
		// pose right away: far from the player the animation holds, and the rest pose is a T-pose
		model.update( 0 );
		// one-shot clips (the wave) hand back to the idle / talk loop
		model.onClipEnd = () => model.play( this.talking ? talk : idle, { fade: 0.5 } );
		this.character = model;
		this.setModel( model.group );

	}

	setModel( obj ) {

		this.model.clear();
		this.model.add( obj );
		this.figure = obj;

	}

	inRange( p ) {

		return Math.hypot( p.x - this.position.x, p.z - this.position.z ) < this.radius && Math.abs( p.y - this.position.y ) < 2.5;

	}

	// idle motion: breathing, a slow weight shift, turning toward the player when near
	update( dt, lookAt = null ) {

		this._t += dt;
		let want = 0;
		if ( lookAt ) {

			const dx = lookAt.x - this.position.x, dz = lookAt.z - this.position.z;
			if ( dx * dx + dz * dz < 64 ) {

				want = Math.atan2( dx, dz ) - this.yaw;
				want = Math.atan2( Math.sin( want ), Math.cos( want ) );
				want = Math.max( - 1.1, Math.min( 1.1, want ) );

			}

		}

		this._yawOff += ( want - this._yawOff ) * ( 1 - Math.exp( - dt * 2.5 ) );
		const f = this.figure;
		if ( this.character ) {

			const c = this.character, K = this.clips;
			const d2 = lookAt ? ( lookAt.x - this.position.x ) ** 2 + ( lookAt.z - this.position.z ) ** 2 : Infinity;
			// animate only when someone can see it up close (the pose holds otherwise)
			if ( d2 > 3600 ) {

				c.hold();
				return;

			}

			const near = d2 < ( this.radius + 3 ) ** 2;
			if ( near && ! this._near && K.greet && ! this.talking ) c.play( K.greet, { fade: 0.35, loop: false } );
			this._near = near;
			const busy = c.current === K.greet;
			if ( ! busy ) {

				const want = this.talking ? K.talk : K.idle;
				if ( c.current !== want ) c.play( want, { fade: 0.6 } );

			}

			f.rotation.y = this._yawOff;
			c.update( dt );
			return;

		}

		f.rotation.y = this._yawOff + Math.sin( this._t * 0.37 ) * 0.05;
		f.rotation.z = Math.sin( this._t * 0.23 ) * 0.02;
		f.scale.y = 1 + Math.sin( this._t * 1.6 ) * 0.006;

	}

}

// Stand-in figure (~1.72 m, facing local +Z): a weathered islander in a hat, apron and boots.
// look: { shirt, trousers, apron, hat, hair, skin, beard } colours to tell the traders apart.
function buildFigure( look = {} ) {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	const SKIN = { color: look.skin ?? 0x9a6a4a, rough: 0.55, pattern: PAT.skin };
	const SHIRT = { color: look.shirt ?? 0x5d7a8c, rough: 0.9, pattern: PAT.cloth };
	const TROUSERS = { color: look.trousers ?? 0x3f4a3c, rough: 0.9, pattern: PAT.cloth };
	const APRON = { color: look.apron ?? 0xd8b24a, rough: 0.45 };
	const BOOTS = { color: 0xe8e2d0, rough: 0.5 };
	const HAT = { color: look.hat ?? 0xc9a86a, rough: 0.9, pattern: PAT.cloth };
	const HAIR = { color: look.hair ?? 0xb8b2a6, rough: 0.9 };
	const V = ( x, y, z ) => new Vector3( x, y, z );
	// legs and white rubber boots
	for ( const s of [ - 1, 1 ] ) {

		add( cylinder( 0.075, 0.068, 0.36, 10 ), { ...BOOTS, matrix: mat4( s * 0.1, 0.18, 0.01 ) } );
		add( cylinder( 0.068, 0.06, 0.08, 10 ), { ...BOOTS, matrix: mat4( s * 0.1, 0.04, 0.05, 0, 0, 0, 1, 1, 1.5 ) } );
		add( cylinder( 0.085, 0.072, 0.48, 10 ), { ...TROUSERS, matrix: mat4( s * 0.1, 0.6, 0 ) } );

	}

	// torso: a little barrel-chested, a slight stoop
	add( roundedBox( 0.38, 0.52, 0.24, 0.08, 3 ), { ...SHIRT, matrix: mat4( 0, 1.1, - 0.01, 0.06 ) } );
	add( roundedBox( 0.36, 0.14, 0.22, 0.06, 2 ), { ...TROUSERS, matrix: mat4( 0, 0.86, 0 ) } );
	// apron with bib and straps
	add( box( 0.34, 0.62, 0.012 ), { ...APRON, matrix: mat4( 0, 0.86, 0.125, 0.05 ) } );
	add( box( 0.24, 0.24, 0.012 ), { ...APRON, matrix: mat4( 0, 1.2, 0.132, 0.08 ) } );
	for ( const s of [ - 1, 1 ] ) add( rod( V( s * 0.1, 1.3, 0.13 ), V( s * 0.12, 1.36, - 0.1 ), 0.012, 4 ), APRON );
	// arms: sleeves rolled up, forearms resting forward
	for ( const s of [ - 1, 1 ] ) {

		add( rod( V( s * 0.22, 1.3, 0 ), V( s * 0.25, 1.02, 0.05 ), 0.055, 8, 0.05 ), SHIRT );
		add( rod( V( s * 0.25, 1.02, 0.05 ), V( s * 0.2, 0.92, 0.27 ), 0.045, 8, 0.04 ), SKIN );
		add( sphere( 0.045, 8, 6 ), { ...SKIN, matrix: mat4( s * 0.19, 0.9, 0.31 ) } );

	}

	// neck, head, ears, nose, grey hair and beard stubble
	add( cylinder( 0.055, 0.06, 0.1, 10 ), { ...SKIN, matrix: mat4( 0, 1.41, 0.01 ) } );
	add( sphere( 0.108, 14, 10 ), { ...SKIN, matrix: mat4( 0, 1.55, 0.02, 0, 0, 0, 1, 1.12, 1.02 ) } );
	add( sphere( 0.02, 6, 5 ), { ...SKIN, matrix: mat4( 0, 1.54, 0.13, 0, 0, 0, 1, 1.4, 1 ) } );
	for ( const s of [ - 1, 1 ] ) add( sphere( 0.025, 6, 5 ), { ...SKIN, matrix: mat4( s * 0.105, 1.55, 0.0, 0, 0, 0, 0.5, 1, 1 ) } );
	add( sphere( 0.112, 12, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.3 ), { ...HAIR, matrix: mat4( 0, 1.55, 0.03 ) } );
	for ( const s of [ - 1, 1 ] ) add( sphere( 0.012, 6, 4 ), { color: 0x1a1512, rough: 0.2, matrix: mat4( s * 0.04, 1.58, 0.115 ) } );
	// straw hat
	add( cylinder( 0.1, 0.115, 0.1, 16 ), { ...HAT, matrix: mat4( 0, 1.7, 0.01 ) } );
	add( cylinder( 0.26, 0.25, 0.015, 24 ), { ...HAT, matrix: mat4( 0, 1.655, 0.01, - 0.05 ) } );
	add( cylinder( 0.118, 0.118, 0.025, 16 ), { color: 0x6b3a2a, rough: 0.8, matrix: mat4( 0, 1.67, 0.01 ) } );
	return mergePrepared( P );

}

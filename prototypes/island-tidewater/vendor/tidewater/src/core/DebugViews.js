import { Vector3 } from '../engine/math/index.js';

// Named review cameras used to check every change from the same set of angles.
// window.__view( name ) jumps there; window.__views lists them.
export const VIEWS = {
	beach: { p: [ 15, 3.0, - 58 ], yaw: Math.PI, pitch: - 0.08, time: 16.2 },
	surf: { p: [ 12, 1.7, - 44 ], yaw: Math.PI + 0.25, pitch: - 0.02, time: 16.2 },
	surfSide: { p: [ 40, 2.2, - 36 ], yaw: Math.PI * 0.62, pitch: - 0.08, time: 10.5 },
	swash: { p: [ 10, 1.6, - 49 ], yaw: Math.PI + 0.1, pitch: - 0.35, time: 16.2 },
	sunGlitter: { p: [ 0, 12, 120 ], yaw: Math.PI * 0.5, pitch: - 0.1, time: 16.2 },
	deepBlue: { p: [ 0, 3, 200 ], yaw: - Math.PI * 0.5, pitch: - 0.06, time: 12.5 },
	aerial: { p: [ 60, 95, 140 ], yaw: Math.PI * 0.08, pitch: - 0.55, time: 15.0 },
	shallowSeabed: { p: [ 8, 1.6, - 30 ], yaw: Math.PI, pitch: - 0.75, time: 13.0 },
	underwater: { p: [ - 70, - 2.5, 50 ], yaw: Math.PI * 0.8, pitch: 0.25, time: 13.0 },
	waterline: { p: [ 5, 0.02, - 10 ], yaw: Math.PI, pitch: 0.0, time: 14.0 },
	sunset: { p: [ 20, 2.5, - 50 ], yaw: Math.PI * 1.35, pitch: 0.02, time: 18.35 },
	sunsetWest: { p: [ 20, 2.5, - 50 ], yaw: 2.02, pitch: 0.03, time: 18.05 },
	pier: { p: [ 75, 4, - 10 ], yaw: Math.PI * 1.15, pitch: - 0.1, time: 15.5 },
	village: { p: [ 62, 7, - 62 ], yaw: 0.34, pitch: - 0.12, time: 15.5 },
	// from the pier over the shallows, looking down (refraction near the bottom edge of the screen)
	pierShallows: { p: [ 53.4, 3.92, 5 ], yaw: 1.2, pitch: - 0.45, time: 9.0 },
	pierShallowsE: { p: [ 56.6, 3.92, 5 ], yaw: - 1.2, pitch: - 0.45, time: 16.5 },
	// looking at the sun from the beach, a little off axis (lens flare, sun disc); lookSun: aimed once the sky has updated
	sunFlare: { p: [ 15, 3.0, - 58 ], yaw: 0, pitch: 0, time: 11.0, lookSun: [ 0.18, - 0.08 ] },
	// at the waterline looking down toward the sun over the swash film (its edge on the wet sand)
	swashFilm: { p: [ 10, 1.7, - 44 ], yaw: 0, pitch: 0, time: 16.2, lookSun: [ - 0.5, - 1.0 ] },
	swashFilmE: { p: [ 30, 1.7, - 39 ], yaw: 0, pitch: 0, time: 16.2, lookSun: [ - 0.5, - 0.9 ] },
	// from above the beach: the back edge of the swash sheet in the backwash (Dan's view)
	swashAbove: { p: [ 46.08, 23.35, - 53.27 ], yaw: 1.87, pitch: - 0.57, time: 16.2 },
	palms: { p: [ - 30, 3.2, - 58 ], yaw: Math.PI * 0.42, pitch: - 0.1, time: 9.5 },
	tHeadW: { p: [ - 150, 6, 40 ], yaw: 1.156, pitch: 0.02, time: 15.0 },
	tLowSun: { p: [ 60, 95, 140 ], yaw: Math.PI * 0.08, pitch: - 0.35, time: 17.6 },
	tValley: { p: [ 35, 16, - 175 ], yaw: 0.1, pitch: 0.12, time: 10.0 },
	tSummit: { p: [ - 60, 300, - 470 ], yaw: Math.PI * 1.02, pitch: - 0.35, time: 16.0 },
	tStacks: { p: [ - 240, 8, 300 ], yaw: 0.15, pitch: - 0.05, time: 16.5 },
	tCove: { p: [ - 160, 2.2, - 30 ], yaw: 1.35, pitch: - 0.08, time: 10.5 },
	tMorning: { p: [ 18, 3.0, - 60 ], yaw: 0.2, pitch: 0.05, time: 7.2 },
};

export function installDebugViews( app ) {

	window.__views = Object.keys( VIEWS );
	// the current camera as a VIEWS entry (paste it back as a named view): __pose()
	window.__pose = () => {

		const c = app.camera, e = new Vector3().setFromMatrixColumn( c.matrixWorld, 2 ).negate();
		const r = ( v ) => Math.round( v * 100 ) / 100;
		return JSON.stringify( { p: [ r( c.position.x ), r( c.position.y ), r( c.position.z ) ], yaw: r( Math.atan2( - e.x, - e.z ) ), pitch: r( Math.asin( e.y ) ), time: r( app.settings.timeOfDay ) } );

	};
	window.__view = ( name ) => {

		const v = VIEWS[ name ];
		if ( ! v ) return 'unknown view';
		if ( v.time !== undefined ) app.settings.timeOfDay = v.time;
		if ( app.setFreeCam ) app.setFreeCam( true );
		app.fly.setPose( new Vector3( ...v.p ), v.yaw, v.pitch );
		app.fly.velocity.set( 0, 0, 0 );
		return name;

	};

}

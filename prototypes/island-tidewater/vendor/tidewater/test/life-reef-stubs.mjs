// Node module hook for test/life-reef.mjs: replaces src/world/Fish.js with a stub when
// REEF_STUB_FISH=1 (the fish are ported / tested separately in test/life-fish.mjs).
export async function resolve( specifier, context, next ) {

	if ( process.env.REEF_STUB_FISH === '1' && /\/Fish\.js$/.test( specifier ) && context.parentURL && context.parentURL.endsWith( '/Reef.js' ) ) {

		const src = `export class FishSchools { constructor() { this.mesh = { visible: false }; this.batch = { visibleInstances: 0 }; this.fishCount = 0; } update() {} cull() {} dispose() {} }`;
		return { url: 'data:text/javascript,' + encodeURIComponent( src ), shortCircuit: true };

	}

	return next( specifier, context );

}

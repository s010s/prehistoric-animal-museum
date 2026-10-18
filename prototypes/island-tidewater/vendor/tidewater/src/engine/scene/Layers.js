// 32-bit visibility mask (three.js Layers-compatible).

export class Layers {

	constructor() {

		this.mask = 1 | 0;

	}

	set( ch ) { this.mask = ( 1 << ch | 0 ) >>> 0; }
	enable( ch ) { this.mask |= 1 << ch | 0; }
	enableAll() { this.mask = 0xffffffff | 0; }
	toggle( ch ) { this.mask ^= 1 << ch | 0; }
	disable( ch ) { this.mask &= ~ ( 1 << ch | 0 ); }
	disableAll() { this.mask = 0; }
	test( layers ) { return ( this.mask & layers.mask ) !== 0; }
	isEnabled( ch ) { return ( this.mask & ( 1 << ch | 0 ) ) !== 0; }

}

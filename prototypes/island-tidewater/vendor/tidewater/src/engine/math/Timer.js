// Frame timer (three.js Timer-compatible): call update( timestamp ) once per
// frame, then read getDelta() / getElapsed() in seconds.

const now = () => ( typeof performance !== 'undefined' ? performance.now() : Date.now() );

export class Timer {

	constructor() {

		this._startTime = now();
		this._previousTime = 0;
		this._currentTime = 0; // relative to _startTime
		this._delta = 0;
		this._elapsed = 0;
		this._timescale = 1;
		this._document = null;
		this._pageVisibilityHandler = null;

	}

	// Resets on tab re-show so a hidden tab doesn't produce one huge delta.
	connect( document ) {

		this._document = document;
		if ( document.hidden !== undefined ) {

			this._pageVisibilityHandler = () => { if ( document.hidden === false ) this.reset(); };
			document.addEventListener( 'visibilitychange', this._pageVisibilityHandler, false );

		}

	}

	disconnect() {

		if ( this._pageVisibilityHandler !== null ) {

			this._document.removeEventListener( 'visibilitychange', this._pageVisibilityHandler );
			this._pageVisibilityHandler = null;

		}

		this._document = null;

	}

	getDelta() { return this._delta / 1000; }
	getElapsed() { return this._elapsed / 1000; }
	getTimescale() { return this._timescale; }
	setTimescale( s ) { this._timescale = s; return this; }
	reset() { this._currentTime = now() - this._startTime; return this; }
	dispose() { this.disconnect(); }

	update( timestamp ) {

		if ( this._pageVisibilityHandler !== null && this._document.hidden === true ) {

			this._delta = 0;

		} else {

			this._previousTime = this._currentTime;
			this._currentTime = ( timestamp !== undefined ? timestamp : now() ) - this._startTime;
			this._delta = ( this._currentTime - this._previousTime ) * this._timescale;
			this._elapsed += this._delta;

		}

		return this;

	}

}

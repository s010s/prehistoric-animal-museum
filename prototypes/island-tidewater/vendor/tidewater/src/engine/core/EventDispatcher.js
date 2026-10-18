// Minimal event dispatcher (three.js EventDispatcher-compatible).

export class EventDispatcher {

	addEventListener( type, listener ) {

		if ( this._listeners === undefined ) this._listeners = {};
		const l = this._listeners;
		if ( l[ type ] === undefined ) l[ type ] = [];
		if ( ! l[ type ].includes( listener ) ) l[ type ].push( listener );

	}

	hasEventListener( type, listener ) {

		const l = this._listeners;
		return l !== undefined && l[ type ] !== undefined && l[ type ].includes( listener );

	}

	removeEventListener( type, listener ) {

		const arr = this._listeners && this._listeners[ type ];
		if ( arr === undefined ) return;
		const i = arr.indexOf( listener );
		if ( i !== - 1 ) arr.splice( i, 1 );

	}

	dispatchEvent( event ) {

		const arr = this._listeners && this._listeners[ event.type ];
		if ( arr === undefined ) return;
		event.target = this;
		for ( const fn of arr.slice() ) fn.call( this, event );
		event.target = null;

	}

}

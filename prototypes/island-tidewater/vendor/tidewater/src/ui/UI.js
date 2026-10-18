import { icon, brandMark } from './icons.js';

// Tidewater UI: settings panel (tabs → folders → controls), HUD, help,
// photo mode, start overlay and loader. Plain DOM, no dependencies.
// All styling lives in ui.css (class prefix `tw-`).

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const lerp = ( a, b, t ) => a + ( b - a ) * t;
const TAU = Math.PI * 2;

let uidCounter = 0;
const uid = ( p = 'tw' ) => `${ p }-${ ++ uidCounter }`;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
const esc = ( s ) => String( s ?? '' ).replace( /[&<>"']/g, ( c ) => ESC[ c ] );

// Tiny element factory: h( 'button', 'cls', { type: 'button', text: 'Hi' } )
function h( tag, cls, attrs ) {

	const e = document.createElement( tag );
	if ( cls ) e.className = cls;
	if ( attrs ) {

		for ( const k in attrs ) {

			const v = attrs[ k ];
			if ( v === undefined || v === null || v === false ) continue;
			if ( k === 'html' ) e.innerHTML = v;
			else if ( k === 'text' ) e.textContent = v;
			else e.setAttribute( k, v === true ? '' : String( v ) );

		}

	}

	return e;

}

const isTypingTarget = ( t ) => !! t && ( t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' ||
	( t.tagName === 'INPUT' && ! /^(checkbox|radio|range|button|color|submit|reset)$/i.test( t.type ) ) );

const differs = ( a, b ) => ( typeof a === 'number' && typeof b === 'number' )
	? Math.abs( a - b ) > 1e-9 * Math.max( 1, Math.abs( b ) )
	: a !== b;

function decimalsOf( step ) {

	if ( ! step || ! isFinite( step ) ) return 0;
	const s = String( step );
	const e = s.indexOf( 'e-' );
	if ( e >= 0 ) return parseInt( s.slice( e + 2 ), 10 );
	const d = s.indexOf( '.' );
	return d < 0 ? 0 : s.length - d - 1;

}

const autoDecimals = ( range ) => ( range <= 1 ? 3 : range <= 10 ? 2 : range <= 100 ? 1 : 0 );

// ── colour helpers ──────────────────────────────────────────────────────────

function normHex( v ) {

	if ( typeof v === 'number' && isFinite( v ) ) return '#' + ( v & 0xffffff ).toString( 16 ).padStart( 6, '0' );
	let s = String( v ?? '' ).trim().replace( /^#/, '' ).toLowerCase();
	if ( s.length === 3 ) s = s.split( '' ).map( ( c ) => c + c ).join( '' );
	return /^[0-9a-f]{6}$/.test( s ) ? '#' + s : '#000000';

}

const hexToRgb = ( hex ) => {

	const n = parseInt( normHex( hex ).slice( 1 ), 16 );
	return [ ( n >> 16 ) & 255, ( n >> 8 ) & 255, n & 255 ];

};

const rgbToHex = ( r, g, b ) => '#' + [ r, g, b ].map( ( x ) => clamp( Math.round( x ), 0, 255 ).toString( 16 ).padStart( 2, '0' ) ).join( '' );

const mixHex = ( a, b, t ) => {

	const A = hexToRgb( a ), B = hexToRgb( b );
	return rgbToHex( lerp( A[ 0 ], B[ 0 ], t ), lerp( A[ 1 ], B[ 1 ], t ), lerp( A[ 2 ], B[ 2 ], t ) );

};

// ── time-of-day palette ─────────────────────────────────────────────────────

// [ hour, zenith, horizon ]
// The dial's sun crosses the horizon at 06:00 and 18:00.
const SKY_KEYS = [
	[ 0, '#040915', '#0b1730' ],
	[ 4.4, '#060d22', '#18244a' ],
	[ 5.3, '#18264f', '#b0616a' ],
	[ 6.1, '#35609e', '#f2a86e' ],
	[ 7.6, '#3d7cc2', '#a8d2ec' ],
	[ 12, '#2c74c6', '#c2e4f6' ],
	[ 16.3, '#3778be', '#b6daee' ],
	[ 17.4, '#3a5d9c', '#f1a25f' ],
	[ 18.1, '#262f5d', '#dc6a4e' ],
	[ 18.9, '#101a3c', '#473358' ],
	[ 19.8, '#050b1a', '#0f1b36' ],
	[ 24, '#040915', '#0b1730' ],
];

function skyAt( hour ) {

	const hh = ( ( hour % 24 ) + 24 ) % 24;
	for ( let i = 0; i < SKY_KEYS.length - 1; i ++ ) {

		const a = SKY_KEYS[ i ], b = SKY_KEYS[ i + 1 ];
		if ( hh >= a[ 0 ] && hh <= b[ 0 ] ) {

			const t = ( hh - a[ 0 ] ) / ( ( b[ 0 ] - a[ 0 ] ) || 1 );
			const s = t * t * ( 3 - 2 * t );
			return [ mixHex( a[ 1 ], b[ 1 ], s ), mixHex( a[ 2 ], b[ 2 ], s ) ];

		}

	}

	return [ SKY_KEYS[ 0 ][ 1 ], SKY_KEYS[ 0 ][ 2 ] ];

}

const PHASES = [ [ 4.8, 'Night' ], [ 5.6, 'Dawn' ], [ 6.4, 'Sunrise' ], [ 7.2, 'Golden hour' ], [ 10.5, 'Morning' ],
	[ 13.5, 'Midday' ], [ 16.8, 'Afternoon' ], [ 17.6, 'Golden hour' ], [ 18.4, 'Sunset' ], [ 19.3, 'Dusk' ], [ 24, 'Night' ] ];

const phaseAt = ( hh ) => {

	for ( const [ end, name ] of PHASES ) if ( hh < end ) return name;
	return 'Night';

};

const fmtClock = ( hours ) => {

	const m = Math.round( ( ( ( hours % 24 ) + 24 ) % 24 ) * 60 ) % 1440;
	return `${ String( Math.floor( m / 60 ) ).padStart( 2, '0' ) }:${ String( m % 60 ).padStart( 2, '0' ) }`;

};

// ── HUD helpers ─────────────────────────────────────────────────────────────

const CARDINALS = [ 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW' ];

function modeIcon( label ) {

	const s = String( label || '' ).toLowerCase();
	if ( s.includes( 'boat' ) ) return 'boat';
	if ( s.includes( 'div' ) ) return 'dive';
	if ( s.includes( 'swim' ) ) return 'swim';
	if ( s.includes( 'free' ) || s.includes( 'fly' ) ) return 'move';
	if ( s.includes( 'photo' ) ) return 'viewfinder';
	if ( s.includes( 'walk' ) || s.includes( 'run' ) ) return 'walk';
	return 'dot';

}

function callHook( fn, ...args ) {

	const list = Array.isArray( fn ) ? fn : [ fn ];
	for ( const f of list ) {

		if ( typeof f !== 'function' ) continue;
		try {

			f( ...args );

		} catch ( err ) {

			console.error( '[UI] callback failed', err );

		}

	}

}

// ════════════════════════════════════════════════════════════════════════════
// Controls
// ════════════════════════════════════════════════════════════════════════════

class Control {

	constructor( parent, opts, type ) {

		this.parent = parent;
		this.ui = parent.ui;
		this.opts = opts;
		this.type = type;
		this.label = opts.label ?? ( opts.key != null ? String( opts.key ) : '' );
		if ( opts.object && opts.key != null ) {

			this.object = opts.object;
			this.key = opts.key;

		} else {

			// no bound object: keep the value locally (`value` option)
			this.object = { value: opts.value };
			this.key = 'value';

		}

		this.onChange = opts.onChange || null;
		this.enabled = true;
		this._default = undefined;
		this._mod = false;
		this.el = h( 'div', `tw-ctl tw-ctl-${ type }` );
		parent._append( this.el );
		this.ui._controls.add( this );

	}

	get value() {

		return this.object[ this.key ];

	}

	set value( v ) {

		this.setValue( v );

	}

	// Writes the value to the bound object, repaints and (optionally) notifies.
	setValue( v, notify = true ) {

		this.object[ this.key ] = v;
		this.update();
		if ( notify ) this._emit();
		return this;

	}

	_emit() {

		if ( ! this.onChange ) return;
		try {

			this.onChange( this.value, this );

		} catch ( err ) {

			console.error( `[UI] onChange failed for "${ this.label }"`, err );

		}

	}

	// Re-reads the value from the bound object.
	update() {

		this._syncModified();
		return this;

	}

	reset() {

		if ( this._default === undefined || ! this.isModified() ) return this;
		this.setValue( this._default );
		this._flash();
		return this;

	}

	isModified() {

		return this._default !== undefined && differs( this.value, this._default );

	}

	setVisible( b ) {

		this.el.hidden = ! b;
		return this;

	}

	setEnabled( b ) {

		this.enabled = !! b;
		this.el.classList.toggle( 'is-disabled', ! this.enabled );
		this.el.inert = ! this.enabled;
		return this;

	}

	setLabel( text ) {

		this.label = String( text );
		if ( this.labelText ) this.labelText.textContent = this.label;
		return this;

	}

	dispose() {

		this.el.remove();
		this.ui._controls.delete( this );

	}

	_syncModified() {

		const m = this.isModified();
		if ( m !== this._mod ) {

			this._mod = m;
			this.el.classList.toggle( 'is-modified', m );

		}

	}

	_flash() {

		this.el.classList.remove( 'is-flash' );
		void this.el.offsetWidth;
		this.el.classList.add( 'is-flash' );

	}

	// Label with a reset affordance: double-click the label, or the ↺ button
	// that appears while the value differs from its default.
	_makeLabel( text, tooltip ) {

		const lab = h( 'span', 'tw-label' );
		const txt = h( 'span', 'tw-label-text', { text } );
		if ( tooltip ) {

			txt.dataset.tip = tooltip;
			txt.dataset.tipHint = 'Double-click to reset';

		}

		const rst = h( 'button', 'tw-reset', { type: 'button', tabindex: '-1', 'aria-label': `Reset ${ text }`, 'data-tip': 'Reset to default', html: icon( 'reset' ) } );
		rst.addEventListener( 'click', ( e ) => {

			e.stopPropagation();
			this.reset();

		} );
		lab.addEventListener( 'dblclick', ( e ) => {

			e.preventDefault();
			e.stopPropagation();
			this.reset();

		} );
		lab.append( txt, rst );
		this.labelEl = lab;
		this.labelText = txt;
		return lab;

	}

	// Visible = active tab, panel open, every ancestor folder open.
	_isShown() {

		if ( this.el.hidden ) return false;
		let p = this.parent;
		while ( p ) {

			if ( p.isTab ) return p === this.ui.activeTab && this.ui._panelOpen && ! this.ui._photo;
			if ( ! p.isOpen || p.el.hidden ) return false;
			p = p.parent;

		}

		return false;

	}

}

// ── Slider ──────────────────────────────────────────────────────────────────

class SliderControl extends Control {

	constructor( parent, o ) {

		super( parent, o, 'slider' );
		let min = Number( o.min ?? 0 ), max = Number( o.max ?? 1 );
		if ( max < min ) [ min, max ] = [ max, min ];
		this.min = min;
		this.max = max;
		this.step = o.step > 0 ? Number( o.step ) : 0;
		this.log = !! o.log && min > 0;
		this.unit = o.unit || '';
		this.format = typeof o.format === 'function' ? o.format : null;
		this.onFinishChange = o.onFinishChange || null;
		this.decimals = o.decimals ?? ( this.step ? decimalsOf( this.step ) : autoDecimals( max - min ) );
		this._default = this.value;

		const head = h( 'div', 'tw-row' );
		head.append( this._makeLabel( this.label, o.tooltip ) );
		this.valueEl = h( 'button', 'tw-value', { type: 'button', tabindex: '-1', 'data-tip': 'Click to type a value' } );
		head.append( this.valueEl );

		this.track = h( 'div', 'tw-slider', { role: 'slider', tabindex: '0', 'aria-label': this.label, 'aria-valuemin': min, 'aria-valuemax': max } );
		this.rail = h( 'div', 'tw-slider-rail' );
		this.fill = h( 'div', 'tw-slider-fill' );
		this.mark = h( 'div', 'tw-slider-mark' );
		this.thumb = h( 'div', 'tw-slider-thumb' );
		this.rail.append( this.fill, this.mark, this.thumb );
		this.track.append( this.rail );
		this.el.append( head, this.track );

		// bipolar ranges fill outward from zero
		this._t0 = ( ! this.log && min < 0 && max > 0 ) ? this._toT( 0 ) : 0;
		if ( typeof this._default === 'number' ) this.mark.style.left = `${ this._toT( this._default ) * 100 }%`;

		this._bindPointer();
		this._bindKeys();
		this.valueEl.addEventListener( 'click', () => this._edit() );
		this.update();

	}

	_toT( v ) {

		if ( typeof v !== 'number' || ! isFinite( v ) ) return 0;
		if ( this.log ) return clamp( Math.log( v / this.min ) / Math.log( this.max / this.min ), 0, 1 );
		return this.max > this.min ? clamp( ( v - this.min ) / ( this.max - this.min ), 0, 1 ) : 0;

	}

	_fromT( t ) {

		const v = this.log ? this.min * Math.pow( this.max / this.min, t ) : this.min + ( this.max - this.min ) * t;
		return this._quantize( v );

	}

	_quantize( v ) {

		v = clamp( v, this.min, this.max );
		if ( this.step ) {

			const base = this.log ? 0 : this.min;
			v = base + Math.round( ( v - base ) / this.step ) * this.step;
			v = clamp( + v.toFixed( Math.min( 12, this.decimals + 3 ) ), this.min, this.max );

		} else if ( this.log ) {

			v = + v.toPrecision( 6 );

		}

		return v;

	}

	_setFromT( t ) {

		const v = this._fromT( t );
		if ( differs( v, this.value ) ) this.setValue( v );

	}

	_num( v ) {

		if ( v == null ) return '—';
		if ( typeof v !== 'number' || ! isFinite( v ) ) return String( v );
		let d = this.decimals;
		if ( this.log && ! this.step ) {

			const a = Math.abs( v );
			d = a < 0.1 ? 4 : a < 1 ? 3 : a < 10 ? 2 : a < 100 ? 1 : 0;

		}

		let s = v.toFixed( d );
		if ( /^-0(\.0*)?$/.test( s ) ) s = s.slice( 1 );
		return s.replace( '-', '−' );

	}

	_text( v ) {

		if ( this.format ) {

			let s;
			try {

				s = this.format( v );

			} catch {

				s = this._num( v );

			}

			return esc( s );

		}

		if ( ! this.unit ) return esc( this._num( v ) );
		const tight = /^(°|%|×|x)$/.test( this.unit ) ? ' is-tight' : '';
		return `${ esc( this._num( v ) ) }<span class="tw-unit${ tight }">${ esc( this.unit ) }</span>`;

	}

	update() {

		const v = this.value;
		const t = this._toT( v );
		if ( t !== this._t ) {

			this._t = t;
			const a = Math.min( t, this._t0 ), b = Math.max( t, this._t0 );
			this.fill.style.left = `${ a * 100 }%`;
			this.fill.style.width = `${ ( b - a ) * 100 }%`;
			this.thumb.style.left = `${ t * 100 }%`;

		}

		const txt = this._text( v );
		if ( txt !== this._txt ) {

			this._txt = txt;
			this.valueEl.innerHTML = txt;
			this.track.setAttribute( 'aria-valuenow', typeof v === 'number' ? v : 0 );
			this.track.setAttribute( 'aria-valuetext', this.format ? this.valueEl.textContent : `${ this._num( v ) }${ this.unit ? ' ' + this.unit : '' }` );

		}

		this._syncModified();
		return this;

	}

	// Drag: click on the rail jumps, grabbing the thumb keeps its offset,
	// holding Shift gives 10× finer control.
	_bindPointer() {

		const track = this.track;
		let baseT = 0, baseX = 0, fine = false, width = 1, id = null;

		const move = ( e ) => {

			if ( e.pointerId !== id ) return;
			const f = e.shiftKey;
			if ( f !== fine ) {

				baseT = this._dragT;
				baseX = e.clientX;
				fine = f;

			}

			const t = clamp( baseT + ( e.clientX - baseX ) / width * ( fine ? 0.1 : 1 ), 0, 1 );
			this._dragT = t;
			this._setFromT( t );

		};

		const end = ( e ) => {

			if ( e.pointerId !== id ) return;
			id = null;
			track.removeEventListener( 'pointermove', move );
			track.removeEventListener( 'pointerup', end );
			track.removeEventListener( 'pointercancel', end );
			this.el.classList.remove( 'is-dragging' );
			this.ui._dragEnd();
			if ( this.onFinishChange ) {

				try {

					this.onFinishChange( this.value, this );

				} catch ( err ) {

					console.error( err );

				}

			}

		};

		track.addEventListener( 'pointerdown', ( e ) => {

			if ( ! this.enabled || e.button !== 0 || id !== null ) return;
			e.preventDefault();
			track.focus( { preventScroll: true } );
			const r = this.rail.getBoundingClientRect();
			width = Math.max( 1, r.width );
			fine = e.shiftKey;
			const onThumb = e.target === this.thumb;
			const t = onThumb ? this._toT( this.value ) : clamp( ( e.clientX - r.left ) / width, 0, 1 );
			baseT = t;
			baseX = e.clientX;
			this._dragT = t;
			id = e.pointerId;
			try {

				track.setPointerCapture( id );

			} catch { /* pointer already released */ }

			track.addEventListener( 'pointermove', move );
			track.addEventListener( 'pointerup', end );
			track.addEventListener( 'pointercancel', end );
			this.el.classList.add( 'is-dragging' );
			this.ui._dragStart();
			if ( ! onThumb ) this._setFromT( t );

		} );

	}

	_bindKeys() {

		this.track.addEventListener( 'keydown', ( e ) => {

			if ( ! this.enabled ) return;
			let stepT = this.log || ! this.step ? 0.01 : this.step / ( this.max - this.min || 1 );
			stepT = Math.max( stepT, 0.001 ) * ( e.shiftKey ? 10 : 1 );
			switch ( e.key ) {

				case 'ArrowRight': case 'ArrowUp': this._nudge( 1, stepT ); break;
				case 'ArrowLeft': case 'ArrowDown': this._nudge( - 1, stepT ); break;
				case 'PageUp': this._nudge( 1, 0.1 ); break;
				case 'PageDown': this._nudge( - 1, 0.1 ); break;
				case 'Home': this._setFromT( 0 ); break;
				case 'End': this._setFromT( 1 ); break;
				case 'Enter': this._edit(); break;
				default: return;

			}

			e.preventDefault();
			e.stopPropagation();

		} );

	}

	// Moves by at least one representable value (log + step can otherwise stall).
	_nudge( dir, stepT ) {

		const v0 = this.value;
		let t = this._toT( v0 );
		for ( let i = 0; i < 200; i ++ ) {

			t = clamp( t + dir * stepT, 0, 1 );
			const v = this._fromT( t );
			if ( differs( v, v0 ) ) {

				this.setValue( v );
				return;

			}

			if ( t === 0 || t === 1 ) return;

		}

	}

	// Click the readout to type an exact value.
	_edit() {

		if ( ! this.enabled || this._editing ) return;
		this._editing = true;
		const v = this.value;
		const inp = h( 'input', 'tw-value-input', {
			type: 'text', inputmode: 'decimal', spellcheck: 'false', autocomplete: 'off', 'aria-label': this.label,
			value: typeof v === 'number' ? String( + v.toFixed( Math.max( this.decimals, 4 ) ) ) : String( v ?? '' ),
		} );
		this.valueEl.replaceWith( inp );
		inp.focus();
		inp.select();

		const finish = ( commit ) => {

			if ( ! this._editing ) return;
			this._editing = false;
			if ( commit ) {

				const n = parseFloat( inp.value.replace( ',', '.' ).replace( '−', '-' ) );
				if ( isFinite( n ) ) {

					const q = this._quantize( n );
					if ( differs( q, this.value ) ) this.setValue( q );

				}

			}

			inp.replaceWith( this.valueEl );
			this._txt = null;
			this.update();

		};

		inp.addEventListener( 'keydown', ( e ) => {

			e.stopPropagation();
			if ( e.key === 'Enter' || e.key === 'Escape' ) {

				e.preventDefault();
				finish( e.key === 'Enter' );
				this.track.focus( { preventScroll: true } );

			}

		} );
		inp.addEventListener( 'blur', () => finish( true ) );

	}

}

// ── Toggle ──────────────────────────────────────────────────────────────────

class ToggleControl extends Control {

	constructor( parent, o ) {

		super( parent, o, 'toggle' );
		this._default = !! this.value;
		this.sw = h( 'button', 'tw-switch', { type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': this.label } );
		this.sw.append( h( 'span', 'tw-switch-knob' ) );
		this.el.append( this._makeLabel( this.label, o.tooltip ), this.sw );
		// whole row toggles; the 2nd click of a double-click is left to the reset gesture
		this.el.addEventListener( 'click', ( e ) => {

			if ( ! this.enabled || e.detail > 1 || e.target.closest( '.tw-reset' ) ) return;
			this.setValue( ! this.value );

		} );
		this.update();

	}

	isModified() {

		return !! this.value !== this._default;

	}

	update() {

		const on = !! this.value;
		if ( on !== this._on ) {

			this._on = on;
			this.sw.setAttribute( 'aria-checked', String( on ) );
			this.el.classList.toggle( 'is-on', on );

		}

		this._syncModified();
		return this;

	}

}

// ── Select (segmented ≤ 4 options, dropdown otherwise) ──────────────────────

function normalizeOptions( options ) {

	if ( ! options ) return [];
	if ( Array.isArray( options ) ) {

		return options.map( ( o ) => ( o !== null && typeof o === 'object' )
			? { label: String( o.label ?? o.value ), value: 'value' in o ? o.value : o.label }
			: { label: String( o ), value: o } );

	}

	return Object.keys( options ).map( ( k ) => ( { label: k, value: options[ k ] } ) );

}

class SelectControl extends Control {

	constructor( parent, o ) {

		super( parent, o, 'select' );
		this._default = this.value;
		this._build( o.options );

	}

	_build( options ) {

		this.options = normalizeOptions( options );
		this.segmented = this.opts.segmented ?? this.options.length <= 4;
		this.el.replaceChildren();
		this.el.classList.toggle( 'is-segmented', this.segmented );
		this.el.classList.toggle( 'is-dropdown', ! this.segmented );
		this._i = undefined;
		this._mod = undefined;
		if ( this.segmented ) this._buildSegmented();
		else this._buildDropdown();
		this.update();

	}

	setOptions( options ) {

		this._build( options );
		return this;

	}

	_buildSegmented() {

		const head = h( 'div', 'tw-row' );
		head.append( this._makeLabel( this.label, this.opts.tooltip ) );
		const seg = h( 'div', 'tw-seg', { role: 'radiogroup', 'aria-label': this.label } );
		seg.style.setProperty( '--n', Math.max( 1, this.options.length ) );
		this.ind = h( 'span', 'tw-seg-ind' );
		seg.append( this.ind );
		this.btns = this.options.map( ( opt, i ) => {

			const b = h( 'button', 'tw-seg-btn', { type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: '-1', text: opt.label } );
			b.addEventListener( 'click', () => this._pick( i ) );
			seg.append( b );
			return b;

		} );
		seg.addEventListener( 'keydown', ( e ) => {

			const d = ( e.key === 'ArrowRight' || e.key === 'ArrowDown' ) ? 1 : ( e.key === 'ArrowLeft' || e.key === 'ArrowUp' ) ? - 1 : 0;
			if ( ! d ) return;
			e.preventDefault();
			e.stopPropagation();
			const n = this.options.length;
			const i = ( ( Math.max( 0, this._index() ) + d ) % n + n ) % n;
			this._pick( i );
			this.btns[ i ].focus();

		} );
		this.el.append( head, seg );

	}

	_buildDropdown() {

		this.btn = h( 'button', 'tw-dd', { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': this.label } );
		this.btnText = h( 'span', 'tw-dd-text' );
		this.btn.append( this.btnText );
		this.btn.insertAdjacentHTML( 'beforeend', icon( 'chevron-down', 'tw-dd-chev' ) );
		const open = () => this.ui._openMenu( this.btn, this.options.map( ( o ) => o.label ), this._index(), ( i ) => this._pick( i ) );
		this.btn.addEventListener( 'click', () => {

			if ( this.ui._menuAnchor === this.btn ) this.ui._closeMenu();
			else open();

		} );
		this.btn.addEventListener( 'keydown', ( e ) => {

			if ( e.key !== 'ArrowDown' && e.key !== 'ArrowUp' ) return;
			e.preventDefault();
			e.stopPropagation();
			open();

		} );
		this.el.append( this._makeLabel( this.label, this.opts.tooltip ), this.btn );

	}

	_index() {

		const v = this.value;
		let i = this.options.findIndex( ( o ) => o.value === v );
		if ( i < 0 ) i = this.options.findIndex( ( o ) => String( o.value ) === String( v ) );
		return i;

	}

	_pick( i ) {

		const o = this.options[ i ];
		if ( ! o || ! this.enabled ) return;
		if ( o.value !== this.value ) this.setValue( o.value );

	}

	isModified() {

		return this.value !== this._default;

	}

	update() {

		const i = this._index();
		if ( i !== this._i ) {

			this._i = i;
			if ( this.segmented ) {

				this.btns.forEach( ( b, j ) => {

					b.setAttribute( 'aria-checked', String( j === i ) );
					b.tabIndex = j === Math.max( 0, i ) ? 0 : - 1;

				} );
				this.ind.style.setProperty( '--i', Math.max( 0, i ) );
				this.ind.hidden = i < 0;

			} else {

				this.btnText.textContent = i >= 0 ? this.options[ i ].label : String( this.value ?? '—' );

			}

		}

		this._syncModified();
		return this;

	}

}

// ── Color ───────────────────────────────────────────────────────────────────
// object[key] may be a hex string, a 0xRRGGBB number, or a THREE.Color-like
// object ({ getHexString, setHex } or plain { r, g, b } in 0..1).

class ColorControl extends Control {

	constructor( parent, o ) {

		super( parent, o, 'color' );
		this._default = this._read();
		const wrap = h( 'label', 'tw-color' );
		this.hexEl = h( 'span', 'tw-hex' );
		this.swatch = h( 'span', 'tw-swatch' );
		this.input = h( 'input', 'tw-color-input', { type: 'color', 'aria-label': this.label } );
		wrap.append( this.hexEl, this.swatch, this.input );
		this.input.addEventListener( 'input', () => {

			this._write( this.input.value );
			this.update();
			this._emit();

		} );
		this.el.append( this._makeLabel( this.label, o.tooltip ), wrap );
		this.update();

	}

	get hex() {

		return this._read();

	}

	_read() {

		const v = this.object[ this.key ];
		if ( v && typeof v === 'object' ) {

			if ( typeof v.getHexString === 'function' ) return '#' + v.getHexString();
			if ( 'r' in v ) return rgbToHex( v.r * 255, v.g * 255, v.b * 255 );

		}

		return normHex( v );

	}

	_write( hex ) {

		hex = normHex( hex );
		const v = this.object[ this.key ];
		if ( v && typeof v === 'object' ) {

			if ( typeof v.setHex === 'function' ) v.setHex( parseInt( hex.slice( 1 ), 16 ) );
			else if ( 'r' in v ) {

				const [ r, g, b ] = hexToRgb( hex );
				v.r = r / 255;
				v.g = g / 255;
				v.b = b / 255;

			}

		} else if ( typeof v === 'number' ) this.object[ this.key ] = parseInt( hex.slice( 1 ), 16 );
		else this.object[ this.key ] = hex;

	}

	// Accepts '#rrggbb', 0xrrggbb or a colour object; writes in the bound format.
	setValue( v, notify = true ) {

		if ( v && typeof v === 'object' ) {

			v = typeof v.getHexString === 'function' ? '#' + v.getHexString() : rgbToHex( v.r * 255, v.g * 255, v.b * 255 );

		}

		this._write( v );
		this.update();
		if ( notify ) this._emit();
		return this;

	}

	isModified() {

		return this._read() !== this._default;

	}

	update() {

		const hex = this._read();
		if ( hex !== this._hex ) {

			this._hex = hex;
			this.swatch.style.background = hex;
			this.hexEl.textContent = hex.slice( 1 ).toUpperCase();
			if ( this.input.value !== hex ) this.input.value = hex;

		}

		this._syncModified();
		return this;

	}

}

// ── Button ──────────────────────────────────────────────────────────────────

class ButtonControl extends Control {

	constructor( parent, o ) {

		super( parent, o, 'button' );
		const variant = o.variant === 'primary' || o.variant === 'ghost' ? o.variant : 'default';
		this.btn = h( 'button', `tw-btn tw-btn-${ variant }`, { type: 'button' } );
		this.btn.innerHTML = ( o.icon ? icon( o.icon ) : '' ) + `<span class="tw-btn-text">${ esc( this.label ) }</span>`;
		if ( o.tooltip ) this.btn.dataset.tip = o.tooltip;
		this.btn.addEventListener( 'click', ( e ) => {

			if ( ! this.enabled ) return;
			try {

				o.onClick?.( this, e );

			} catch ( err ) {

				console.error( `[UI] button "${ this.label }" failed`, err );

			}

		} );
		this.el.append( this.btn );

	}

	setLabel( text ) {

		this.label = String( text );
		this.btn.querySelector( '.tw-btn-text' ).textContent = this.label;
		return this;

	}

	update() {

		return this;

	}

}

// ── Presets (chip row) ──────────────────────────────────────────────────────

class PresetsControl extends Control {

	constructor( parent, o ) {

		super( parent, o, 'presets' );
		this.presets = o.presets || [];
		this.active = this._resolve( o.active );
		if ( o.label ) {

			const head = h( 'div', 'tw-row' );
			const lab = h( 'span', 'tw-label' );
			this.labelText = h( 'span', 'tw-label-text', { text: o.label } );
			lab.append( this.labelText );
			head.append( lab );
			this.el.append( head );

		}

		const grid = h( 'div', 'tw-presets', { role: 'radiogroup', 'aria-label': o.label || 'Presets' } );
		grid.style.setProperty( '--n', Math.min( 4, Math.max( 1, this.presets.length ) ) );
		this.chips = this.presets.map( ( p, i ) => {

			const b = h( 'button', 'tw-chip', { type: 'button', role: 'radio', 'aria-checked': 'false' } );
			b.innerHTML = ( p.icon ? icon( p.icon ) : '' ) + `<span>${ esc( p.label ) }</span>`;
			if ( p.tooltip || p.description ) b.dataset.tip = p.tooltip || p.description;
			b.addEventListener( 'click', () => this.apply( i ) );
			grid.append( b );
			return b;

		} );
		this.el.append( grid );
		this.update();

	}

	_resolve( a ) {

		if ( typeof a === 'number' ) return a;
		if ( typeof a === 'string' ) return this.presets.findIndex( ( p ) => p.label === a || p.id === a );
		return - 1;

	}

	get value() {

		return this.active >= 0 ? ( this.presets[ this.active ]?.label ?? null ) : null;

	}

	set value( v ) {

		this.setActive( v );

	}

	// Runs the preset, then re-reads every control so sliders reflect it.
	apply( which ) {

		const i = typeof which === 'number' ? which : this._resolve( which );
		const p = this.presets[ i ];
		if ( ! p || ! this.enabled ) return this;
		this.active = i;
		try {

			p.apply?.( p, i );

		} catch ( err ) {

			console.error( `[UI] preset "${ p.label }" failed`, err );

		}

		this.ui.refresh();
		try {

			this.opts.onChange?.( p, i );

		} catch ( err ) {

			console.error( err );

		}

		return this;

	}

	setActive( which ) {

		this.active = this._resolve( which );
		this.update();
		return this;

	}

	reset() {

		return this;

	}

	isModified() {

		return false;

	}

	update() {

		if ( this.active !== this._a ) {

			this._a = this.active;
			this.chips.forEach( ( c, j ) => {

				c.classList.toggle( 'is-active', j === this.active );
				c.setAttribute( 'aria-checked', String( j === this.active ) );

			} );

		}

		return this;

	}

}

// ── Info (read-only live value) ─────────────────────────────────────────────

class InfoControl extends Control {

	constructor( parent, o ) {

		super( parent, o, 'info' );
		this.getter = typeof o.get === 'function' ? o.get : () => this.object[ this.key ];
		const lab = h( 'span', 'tw-label' );
		this.labelText = h( 'span', 'tw-label-text', { text: this.label } );
		if ( o.tooltip ) this.labelText.dataset.tip = o.tooltip;
		lab.append( this.labelText );
		this.valEl = h( 'span', 'tw-info-value' );
		this.el.append( lab, this.valEl );
		this.update();

	}

	reset() {

		return this;

	}

	isModified() {

		return false;

	}

	update() {

		let v;
		try {

			v = this.getter();

		} catch {

			v = null;

		}

		if ( typeof v === 'number' ) v = Number.isInteger( v ) ? v.toLocaleString( 'en-US' ) : v.toFixed( 2 );
		const s = v == null || v === '' ? '—' : String( v );
		if ( s !== this._s ) {

			this._s = s;
			this.valEl.textContent = s;

		}

		return this;

	}

}

// ── Time of day ─────────────────────────────────────────────────────────────
// A sun-path dial: the day arc above the horizon, the night arc squashed
// below it. The sun is draggable; a 24 h sky-gradient strip gives fine control.

const TOD = { w: 300, h: 148, cx: 150, cy: 100, rx: 118, up: 74, down: 32 };

function todPoint( hours ) {

	const th = Math.PI - ( ( hours - 6 ) / 12 ) * Math.PI;
	const s = Math.sin( th );
	return { x: TOD.cx + TOD.rx * Math.cos( th ), y: TOD.cy - ( s >= 0 ? TOD.up : TOD.down ) * s, elev: s };

}

function todHours( x, y ) {

	const nx = ( x - TOD.cx ) / TOD.rx;
	const dy = TOD.cy - y;
	const ny = dy >= 0 ? dy / TOD.up : dy / TOD.down;
	const th = Math.atan2( ny, nx );
	return ( ( 6 + ( Math.PI - th ) / Math.PI * 12 ) % 24 + 24 ) % 24;

}

function todSVG( id ) {

	const { w, h, cx, cy, rx, up, down } = TOD;
	let seed = 11;
	const rnd = () => ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647;
	let stars = '';
	for ( let i = 0; i < 26; i ++ ) {

		stars += `<circle cx="${ ( 6 + rnd() * ( w - 12 ) ).toFixed( 1 ) }" cy="${ ( 5 + rnd() * ( cy - 16 ) ).toFixed( 1 ) }" r="${ ( 0.45 + rnd() * 0.75 ).toFixed( 2 ) }" opacity="${ ( 0.35 + rnd() * 0.65 ).toFixed( 2 ) }"/>`;

	}

	let ticks = '';
	for ( let hr = 0; hr < 24; hr += 3 ) {

		const p = todPoint( hr );
		ticks += `<circle cx="${ p.x.toFixed( 1 ) }" cy="${ p.y.toFixed( 1 ) }" r="${ hr % 6 ? 1.1 : 1.8 }"/>`;

	}

	const labels = [ [ '06', cx - rx, cy + 13 ], [ '12', cx, cy - up - 7 ], [ '18', cx + rx, cy + 13 ], [ '00', cx, cy + down + 11 ] ]
		.map( ( [ t, x, y ] ) => `<text x="${ x }" y="${ y }">${ t }</text>` ).join( '' );

	return `<svg class="tw-tod-svg" viewBox="0 0 ${ w } ${ h }" role="slider" tabindex="0" aria-label="Time of day" aria-valuemin="0" aria-valuemax="24">
		<defs>
			<linearGradient id="${ id }-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c74c6"/><stop offset="1" stop-color="#c2e4f6"/></linearGradient>
			<linearGradient id="${ id }-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d2a3a"/><stop offset="1" stop-color="#03101a"/></linearGradient>
			<radialGradient id="${ id }-glow"><stop offset="0" stop-color="#fff1d6" stop-opacity=".95"/><stop offset=".28" stop-color="#ffc98a" stop-opacity=".5"/><stop offset="1" stop-color="#ffb86b" stop-opacity="0"/></radialGradient>
			<radialGradient id="${ id }-haze"><stop offset="0" stop-color="#ffb070" stop-opacity=".8"/><stop offset="1" stop-color="#ff9a5a" stop-opacity="0"/></radialGradient>
			<linearGradient id="${ id }-glint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffdcae" stop-opacity=".9"/><stop offset="1" stop-color="#ffdcae" stop-opacity="0"/></linearGradient>
			<mask id="${ id }-moon"><circle r="5.4" fill="#fff"/><circle cx="2.7" cy="-1.9" r="4.5" fill="#000"/></mask>
			<clipPath id="${ id }-clip"><rect width="${ w }" height="${ h }" rx="10"/></clipPath>
		</defs>
		<g clip-path="url(#${ id }-clip)">
			<rect width="${ w }" height="${ cy + 1 }" fill="url(#${ id }-sky)"/>
			<g class="tw-tod-stars" fill="#fff">${ stars }</g>
			<ellipse class="tw-tod-haze" cx="${ cx }" cy="${ cy }" rx="96" ry="30" fill="url(#${ id }-haze)"/>
			<rect y="${ cy }" width="${ w }" height="${ h - cy }" fill="url(#${ id }-sea)"/>
			<ellipse class="tw-tod-glint" cx="${ cx }" cy="${ cy + 8 }" rx="5" ry="10" fill="url(#${ id }-glint)"/>
			<line class="tw-tod-horizon" x1="0" y1="${ cy + 0.5 }" x2="${ w }" y2="${ cy + 0.5 }"/>
			<path class="tw-tod-path" d="M${ cx - rx } ${ cy } A${ rx } ${ up } 0 0 1 ${ cx + rx } ${ cy }"/>
			<path class="tw-tod-path is-down" d="M${ cx + rx } ${ cy } A${ rx } ${ down } 0 0 1 ${ cx - rx } ${ cy }"/>
			<g class="tw-tod-ticks">${ ticks }</g>
			<g class="tw-tod-labels">${ labels }</g>
			<g class="tw-tod-moon"><circle r="5.4" fill="#e3ecff" mask="url(#${ id }-moon)"/></g>
			<g class="tw-tod-sun"><circle r="24" fill="url(#${ id }-glow)"/><circle class="tw-tod-disc" r="7"/></g>
		</g>
		<text class="tw-tod-phase" x="14" y="23"></text>
	</svg>`;

}

const TOD_TRACK_BG = ( () => {

	const stops = [];
	for ( let hr = 0; hr <= 24; hr ++ ) {

		const [ z, hz ] = skyAt( hr );
		stops.push( `${ mixHex( z, hz, 0.55 ) } ${ ( hr / 24 * 100 ).toFixed( 2 ) }%` );

	}

	return `linear-gradient(90deg, ${ stops.join( ', ' ) })`;

} )();

class TimeOfDayControl extends Control {

	constructor( parent, o ) {

		super( parent, Object.assign( {}, o, { label: o.label ?? 'Time of day' } ), 'time' );
		this._default = Number( this.value ) || 0;
		this.onFinishChange = o.onFinishChange || null;
		const id = uid( 'tw-tod' );

		const head = h( 'div', 'tw-row' );
		head.append( this._makeLabel( this.label, o.tooltip ) );
		this.valueEl = h( 'button', 'tw-value tw-clock', { type: 'button', tabindex: '-1', 'data-tip': 'Click to type a time' } );
		head.append( this.valueEl );

		const dial = h( 'div', 'tw-tod' );
		dial.innerHTML = todSVG( id );
		this.svg = dial.firstElementChild;
		const q = ( s ) => this.svg.querySelector( s );
		this.stopZ = q( `#${ id }-sky stop:first-child` );
		this.stopH = q( `#${ id }-sky stop:last-child` );
		this.stopSea = q( `#${ id }-sea stop:first-child` );
		this.stars = q( '.tw-tod-stars' );
		this.haze = q( '.tw-tod-haze' );
		this.glint = q( '.tw-tod-glint' );
		this.moon = q( '.tw-tod-moon' );
		this.sun = q( '.tw-tod-sun' );
		this.sunGlow = this.sun.firstElementChild;
		this.disc = q( '.tw-tod-disc' );
		this.phase = q( '.tw-tod-phase' );

		this.track = h( 'div', 'tw-tod-track' );
		this.bar = h( 'div', 'tw-tod-bar' );
		this.bar.style.background = TOD_TRACK_BG;
		this.knob = h( 'div', 'tw-tod-knob' );
		const scale = h( 'div', 'tw-tod-scale', { 'aria-hidden': 'true' } );
		scale.innerHTML = [ 0, 6, 12, 18, 24 ].map( ( hh ) => `<span style="left:${ hh / 24 * 100 }%">${ String( hh ).padStart( 2, '0' ) }</span>` ).join( '' );
		this.track.append( this.bar, this.knob, scale );

		this.el.append( head, dial, this.track );
		this._bind();
		this.update();

	}

	_set( hh ) {

		if ( differs( hh, Number( this.value ) ) ) this.setValue( hh );

	}

	_bind() {

		const svg = this.svg;
		const snap = ( hh, e ) => ( e.shiftKey ? Math.round( hh * 4 ) / 4 : Math.round( hh * 60 ) / 60 );
		const fromDial = ( e ) => {

			const r = svg.getBoundingClientRect();
			const hh = snap( todHours( ( e.clientX - r.left ) / r.width * TOD.w, ( e.clientY - r.top ) / r.height * TOD.h ), e );
			return hh >= 24 ? 0 : hh;

		};

		const fromTrack = ( e ) => {

			const r = this.bar.getBoundingClientRect();
			const hh = snap( clamp( ( e.clientX - r.left ) / Math.max( 1, r.width ), 0, 1 ) * 24, e );
			return Math.min( hh, 24 - 1 / 60 );

		};

		this._dragOn( svg, fromDial );
		this._dragOn( this.track, fromTrack );

		svg.addEventListener( 'keydown', ( e ) => {

			const step = e.shiftKey ? 1 : 0.25;
			let d = 0;
			switch ( e.key ) {

				case 'ArrowRight': case 'ArrowUp': d = step; break;
				case 'ArrowLeft': case 'ArrowDown': d = - step; break;
				case 'PageUp': d = 3; break;
				case 'PageDown': d = - 3; break;
				case 'Enter': this._edit(); break;
				default: return;

			}

			e.preventDefault();
			e.stopPropagation();
			if ( d ) this._set( ( ( ( Number( this.value ) || 0 ) + d ) % 24 + 24 ) % 24 );

		} );
		this.valueEl.addEventListener( 'click', () => this._edit() );

	}

	_dragOn( el, map ) {

		let id = null;
		el.addEventListener( 'pointerdown', ( e ) => {

			if ( ! this.enabled || e.button !== 0 || id !== null ) return;
			e.preventDefault();
			this.svg.focus( { preventScroll: true } );
			id = e.pointerId;
			try {

				el.setPointerCapture( id );

			} catch { /* ignore */ }

			this.el.classList.add( 'is-dragging' );
			this.ui._dragStart();
			this._set( map( e ) );

		} );
		el.addEventListener( 'pointermove', ( e ) => {

			if ( e.pointerId === id ) this._set( map( e ) );

		} );
		const end = ( e ) => {

			if ( e.pointerId !== id ) return;
			id = null;
			this.el.classList.remove( 'is-dragging' );
			this.ui._dragEnd();
			if ( this.onFinishChange ) {

				try {

					this.onFinishChange( this.value, this );

				} catch ( err ) {

					console.error( err );

				}

			}

		};

		el.addEventListener( 'pointerup', end );
		el.addEventListener( 'pointercancel', end );

	}

	// Type "14:30" or decimal hours "14.5".
	_edit() {

		if ( ! this.enabled || this._editing ) return;
		this._editing = true;
		const inp = h( 'input', 'tw-value-input', { type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': this.label, value: fmtClock( Number( this.value ) || 0 ) } );
		this.valueEl.replaceWith( inp );
		inp.focus();
		inp.select();
		const finish = ( commit ) => {

			if ( ! this._editing ) return;
			this._editing = false;
			if ( commit ) {

				const s = inp.value.trim();
				const m = /^(\d{1,2})\s*[:h]\s*(\d{1,2})$/i.exec( s );
				const hh = m ? Number( m[ 1 ] ) + Number( m[ 2 ] ) / 60 : parseFloat( s.replace( ',', '.' ) );
				if ( isFinite( hh ) ) this._set( ( ( hh % 24 ) + 24 ) % 24 );

			}

			inp.replaceWith( this.valueEl );
			this._h = null;
			this.update();

		};

		inp.addEventListener( 'keydown', ( e ) => {

			e.stopPropagation();
			if ( e.key === 'Enter' || e.key === 'Escape' ) {

				e.preventDefault();
				finish( e.key === 'Enter' );
				this.svg.focus( { preventScroll: true } );

			}

		} );
		inp.addEventListener( 'blur', () => finish( true ) );

	}

	isModified() {

		return differs( Number( this.value ) || 0, this._default );

	}

	update() {

		const v = Number( this.value );
		const hrs = isFinite( v ) ? ( ( v % 24 ) + 24 ) % 24 : 0;
		if ( hrs !== this._h ) {

			this._h = hrs;
			this._paint( hrs );

		}

		this._syncModified();
		return this;

	}

	_paint( hrs ) {

		const p = todPoint( hrs );
		const e = p.elev;
		const [ zen, hor ] = skyAt( hrs );
		const f = ( n ) => n.toFixed( 2 );
		this.stopZ.setAttribute( 'stop-color', zen );
		this.stopH.setAttribute( 'stop-color', hor );
		this.stopSea.setAttribute( 'stop-color', mixHex( hor, '#04121c', 0.72 ) );

		this.sun.setAttribute( 'transform', `translate(${ f( p.x ) } ${ f( p.y ) })` );
		this.disc.setAttribute( 'fill', e < 0 ? '#ffd2a0' : mixHex( '#ffe2b4', '#fff8ec', clamp( e * 2.2, 0, 1 ) ) );
		this.sunGlow.setAttribute( 'opacity', clamp( ( e + 0.12 ) / 0.25, 0.2, 1 ).toFixed( 3 ) );
		this.el.classList.toggle( 'is-night', e < - 0.02 );

		const night = clamp( ( 0.08 - e ) / 0.3, 0, 1 );
		this.stars.setAttribute( 'opacity', night.toFixed( 3 ) );
		const m = todPoint( hrs + 12 );
		this.moon.setAttribute( 'transform', `translate(${ f( m.x ) } ${ f( m.y ) })` );
		this.moon.setAttribute( 'opacity', ( night * 0.95 ).toFixed( 3 ) );

		const low = e > - 0.25 ? Math.pow( 1 - Math.min( 1, Math.abs( e ) / 0.6 ), 2 ) : 0;
		this.haze.setAttribute( 'cx', f( p.x ) );
		this.haze.setAttribute( 'opacity', ( low * 0.85 ).toFixed( 3 ) );

		// reflection streak on the water, strongest for a low sun
		const gry = 6 + ( 1 - clamp( e, 0, 1 ) ) * 16;
		this.glint.setAttribute( 'cx', f( p.x ) );
		this.glint.setAttribute( 'cy', f( TOD.cy + gry * 0.95 ) );
		this.glint.setAttribute( 'rx', f( 2.5 + ( 1 - clamp( e, 0, 1 ) ) * 3 ) );
		this.glint.setAttribute( 'ry', f( gry ) );
		this.glint.setAttribute( 'opacity', e > 0 ? ( 0.85 * Math.pow( 1 - e, 1.5 ) ).toFixed( 3 ) : '0' );

		const clock = fmtClock( hrs );
		const phase = phaseAt( hrs );
		this.valueEl.textContent = clock;
		this.phase.textContent = phase;
		this.knob.style.left = `${ ( hrs / 24 ) * 100 }%`;
		this.svg.setAttribute( 'aria-valuenow', hrs.toFixed( 2 ) );
		this.svg.setAttribute( 'aria-valuetext', `${ clock }, ${ phase }` );

	}

}

// ════════════════════════════════════════════════════════════════════════════
// Containers: Tab → Folder (nestable) → controls
// ════════════════════════════════════════════════════════════════════════════

class Container {

	constructor( ui, parent = null ) {

		this.ui = ui;
		this.parent = parent;
		this.children = [];
		this.body = null;

	}

	_append( el ) {

		this.body.append( el );

	}

	_add( c ) {

		this.children.push( c );
		return c;

	}

	addFolder( label, opts ) {

		return this._add( new Folder( this, label, opts ) );

	}

	addSlider( o ) {

		return this._add( new SliderControl( this, o ) );

	}

	addToggle( o ) {

		return this._add( new ToggleControl( this, o ) );

	}

	addSelect( o ) {

		return this._add( new SelectControl( this, o ) );

	}

	addColor( o ) {

		return this._add( new ColorControl( this, o ) );

	}

	addButton( o ) {

		return this._add( new ButtonControl( this, o ) );

	}

	addPresets( o ) {

		return this._add( new PresetsControl( this, o ) );

	}

	addTimeOfDay( o ) {

		return this._add( new TimeOfDayControl( this, o ) );

	}

	addInfo( o ) {

		return this._add( new InfoControl( this, o ) );

	}

	// All controls below this container, depth first.
	controls() {

		const out = [];
		for ( const c of this.children ) {

			if ( c instanceof Container ) out.push( ...c.controls() );
			else out.push( c );

		}

		return out;

	}

	refresh() {

		for ( const c of this.controls() ) c.update();
		return this;

	}

	// Resets every control below this container to its default.
	reset() {

		for ( const c of this.controls() ) c.reset();
		return this;

	}

}

class Folder extends Container {

	constructor( parent, label, { icon: iconName, open = true, tooltip } = {} ) {

		super( parent.ui, parent );
		this.label = String( label ?? '' );
		this.isOpen = true;
		this.el = h( 'section', 'tw-folder' + ( parent instanceof Folder ? ' is-nested' : '' ) );
		const bodyId = uid( 'tw-fb' );
		this.head = h( 'button', 'tw-folder-head', { type: 'button', 'aria-expanded': 'true', 'aria-controls': bodyId } );
		this.head.innerHTML = ( iconName ? icon( iconName, 'tw-folder-ico' ) : '' ) +
			`<span class="tw-folder-title">${ esc( this.label ) }</span>` + icon( 'chevron-down', 'tw-folder-chev' );
		if ( tooltip ) this.head.dataset.tip = tooltip;
		this.wrap = h( 'div', 'tw-folder-wrap', { id: bodyId } );
		this.body = h( 'div', 'tw-folder-body' );
		this.wrap.append( this.body );
		this.el.append( this.head, this.wrap );
		parent._append( this.el );
		this.head.addEventListener( 'click', () => this.toggle() );
		this.setOpen( open );

	}

	setOpen( b ) {

		this.isOpen = !! b;
		this.el.classList.toggle( 'is-open', this.isOpen );
		this.head.setAttribute( 'aria-expanded', String( this.isOpen ) );
		this.wrap.inert = ! this.isOpen;
		if ( this.isOpen ) this.refresh();
		return this;

	}

	open() {

		return this.setOpen( true );

	}

	close() {

		return this.setOpen( false );

	}

	toggle() {

		return this.setOpen( ! this.isOpen );

	}

	setVisible( b ) {

		this.el.hidden = ! b;
		return this;

	}

	setLabel( text ) {

		this.label = String( text );
		this.head.querySelector( '.tw-folder-title' ).textContent = this.label;
		return this;

	}

}

class Tab extends Container {

	constructor( ui, id, label, iconName ) {

		super( ui, null );
		this.isTab = true;
		this.isOpen = true;
		this.id = id;
		this.label = String( label );
		this.iconName = iconName;
		this._scroll = 0;
		const pageId = uid( 'tw-page' ), tabId = uid( 'tw-tab' );
		this.page = h( 'div', 'tw-page', { role: 'tabpanel', id: pageId, 'aria-labelledby': tabId, hidden: true } );
		this.body = this.page;
		this.btn = h( 'button', 'tw-tab', { type: 'button', role: 'tab', id: tabId, 'aria-selected': 'false', 'aria-controls': pageId, tabindex: '-1', 'data-tip': this.label } );
		this.btn.innerHTML = icon( iconName ) + `<span class="tw-tab-label">${ esc( this.label ) }</span>`;
		this.railBtn = h( 'button', 'tw-rail-btn', { type: 'button', 'aria-label': this.label, 'data-tip': this.label, 'data-tip-side': 'left' } );
		this.railBtn.innerHTML = icon( iconName );
		this.btn.addEventListener( 'click', () => ui.selectTab( id ) );
		this.railBtn.addEventListener( 'click', () => {

			ui.selectTab( id );
			ui.togglePanel( true );

		} );

	}

	get el() {

		return this.page;

	}

	select() {

		this.ui.selectTab( this.id );
		return this;

	}

	setVisible( b ) {

		this.btn.hidden = ! b;
		this.railBtn.hidden = ! b;
		if ( ! b && this.ui.activeTab === this ) {

			const next = [ ...this.ui.tabs.values() ].find( ( t ) => t !== this && ! t.btn.hidden );
			if ( next ) this.ui.selectTab( next.id );

		}

		return this;

	}

}

// ════════════════════════════════════════════════════════════════════════════
// UI
// ════════════════════════════════════════════════════════════════════════════

const NAV_KEYS = new Set( [ 'Space', 'Enter', 'NumpadEnter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Tab' ] );

export class UI {

	constructor( container = document.body ) {

		this.container = container || document.body;
		this.tabs = new Map();
		this.activeTab = null;
		this._controls = new Set();
		this._panelOpen = false;
		this._photo = false;
		this._help = false;
		this._start = false;
		this._overUI = false;
		this._drag = 0;
		this._menu = null;
		this._menuAnchor = null;
		this._toasts = [];
		this._spark = [];
		this._sparkAcc = 0;
		this._sparkT = 0;
		this._statsT = 0;
		this._lvl = 'good';
		this._lastAct = performance.now();
		this._idle = false;
		this._ac = new AbortController();

		// Hooks: assign a function (or an array of functions).
		this.onPhotoMode = null; // ( on ) photo mode entered / left (P key or setPhotoMode)
		this.onPanelInteract = null; // ( event ) pointerdown on the settings panel or rail
		this.onPanelToggle = null; // ( open )
		this.onHelpToggle = null; // ( open )
		this.onReplayGuide = null; // (): the fishing game's first-play guide
		// Opening the panel exits pointer lock so the cursor can reach it.
		this.releasePointerOnPanel = true;

		// index.html ships a temporary FPS counter; the HUD replaces it.
		document.getElementById( 'fps' )?.remove();

		this.root = h( 'div', 'tw-root', { 'data-panel': 'closed' } );
		this._buildHUD();
		this._buildPanel();
		this._buildHelp();
		this._buildStart();
		this.tipEl = h( 'div', 'tw-tip', { role: 'tooltip', 'aria-hidden': 'true' } );
		this.root.append( this.tipEl );
		this.container.append( this.root );

		this._bindGlobal();
		this._timer = setInterval( () => this._tick(), 250 );

	}

	// ── builders ────────────────────────────────────────────────────────────

	_buildHUD() {

		const hud = this.hud = h( 'div', 'tw-hud' );

		// top-left: frame rate, then brand + traversal mode
		const tl = h( 'div', 'tw-tl' );
		const stats = this.statsEl = h( 'div', 'tw-stats tw-glass', { 'data-level': 'good', 'aria-hidden': 'true' } );
		stats.innerHTML = `
			<div class="tw-stats-main"><span class="tw-fps">--</span><span class="tw-fps-unit">fps</span></div>
			<canvas class="tw-spark"></canvas>
			<div class="tw-stats-sub">
				<span class="tw-kv"><span class="tw-k">frame</span><span class="tw-v tw-ms">--</span></span>
				<span class="tw-kv tw-kv-gpu" hidden><span class="tw-k">gpu</span><span class="tw-v tw-gpu">--</span></span>
			</div>`;
		this.fpsEl = stats.querySelector( '.tw-fps' );
		this.msEl = stats.querySelector( '.tw-ms' );
		this.gpuEl = stats.querySelector( '.tw-gpu' );
		this.gpuKv = stats.querySelector( '.tw-kv-gpu' );
		this.sparkEl = stats.querySelector( '.tw-spark' );

		const brand = h( 'div', 'tw-brand' );
		brand.innerHTML = `${ brandMark() }<span class="tw-brand-name">TIDEWATER</span>`;
		this.modeEl = h( 'div', 'tw-mode is-empty', { role: 'status' } );
		this.modeIco = h( 'span', 'tw-mode-ico' );
		this.modeText = h( 'span', 'tw-mode-text' );
		this.modeEl.append( this.modeIco, this.modeText );
		brand.append( this.modeEl );
		tl.append( stats, brand );

		// top-centre: notifications
		this.toastsEl = h( 'div', 'tw-toasts', { 'aria-live': 'polite' } );

		// bottom-centre: interaction prompt
		this.promptEl = h( 'div', 'tw-prompt tw-glass', { 'aria-live': 'polite' } );
		this.promptKey = h( 'kbd', 'tw-prompt-key' );
		this.promptText = h( 'span', 'tw-prompt-text' );
		this.promptEl.append( this.promptKey, this.promptText );

		// bottom-left: boat instruments
		this.boatEl = this._buildBoat();

		// left: depth sounder
		this.depthEl = h( 'div', 'tw-depth tw-glass', { 'aria-hidden': 'true' } );
		this.depthEl.innerHTML = `
			<canvas class="tw-depth-tape"></canvas>
			<span class="tw-depth-mark"></span>
			<div class="tw-depth-read">
				<div class="tw-depth-line"><span class="tw-depth-num">0.0</span><span class="tw-unit">m</span></div>
				<span class="tw-g-lab">Depth</span>
			</div>`;
		this.depthCanvas = this.depthEl.querySelector( '.tw-depth-tape' );
		this.depthNum = this.depthEl.querySelector( '.tw-depth-num' );

		hud.append( tl, this.toastsEl, this.promptEl, this.boatEl, this.depthEl );

		// the one element that survives photo mode
		this.photoHint = h( 'div', 'tw-photo-hint' );
		this.photoHint.innerHTML = '<kbd>P</kbd><span>Exit photo mode</span>';

		this.root.append( hud, this.photoHint );

	}

	_buildBoat() {

		const el = h( 'div', 'tw-boat tw-glass', { 'aria-hidden': 'true' } );
		const P = ( cx, r, deg ) => {

			const a = deg * Math.PI / 180;
			return [ ( cx + r * Math.cos( a ) ).toFixed( 2 ), ( cx + r * Math.sin( a ) ).toFixed( 2 ) ];

		};

		// RPM arc: 270° sweep from 135° (lower left) clockwise to 45° (lower right)
		const ARC = 'M24.64 95.36A50 50 0 1 1 95.36 95.36';
		let ticks = '';
		for ( let i = 0; i <= 10; i ++ ) {

			const maj = i % 5 === 0;
			const [ x1, y1 ] = P( 60, maj ? 37.5 : 40.5, 135 + 27 * i );
			const [ x2, y2 ] = P( 60, 44, 135 + 27 * i );
			ticks += `<line class="${ maj ? 'maj' : '' }" x1="${ x1 }" y1="${ y1 }" x2="${ x2 }" y2="${ y2 }"/>`;

		}

		// compass card: ticks every 10°, cardinal letters every 90°
		let card = '';
		for ( let d = 0; d < 360; d += 10 ) {

			const maj = d % 30 === 0;
			const [ x1, y1 ] = P( 50, maj ? 37 : 40, d - 90 );
			const [ x2, y2 ] = P( 50, 44, d - 90 );
			card += `<line class="${ maj ? 'maj' : 'min' }" x1="${ x1 }" y1="${ y1 }" x2="${ x2 }" y2="${ y2 }"/>`;

		}

		for ( const [ t, d ] of [ [ 'N', 0 ], [ 'E', 90 ], [ 'S', 180 ], [ 'W', 270 ] ] ) {

			const [ x, y ] = P( 50, 29, d - 90 );
			card += `<text class="${ t === 'N' ? 'is-n' : '' }" x="${ x }" y="${ y }" transform="rotate(${ d } ${ x } ${ y })">${ t }</text>`;

		}

		const gid = uid( 'tw-rpm' );
		el.innerHTML = `
			<div class="tw-thr">
				<div class="tw-thr-bar"><span class="tw-thr-pos"></span><span class="tw-thr-neg"></span><span class="tw-thr-zero"></span></div>
				<span class="tw-thr-val">0%</span>
			</div>
			<div class="tw-dial">
				<svg viewBox="0 0 120 120">
					<defs><linearGradient id="${ gid }" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#3fc0d6"/><stop offset=".62" stop-color="#5fe3d4"/><stop offset="1" stop-color="#ffb86b"/></linearGradient></defs>
					<path class="tw-dial-bg" d="${ ARC }"/>
					<path class="tw-dial-red" d="${ ARC }" pathLength="100" stroke-dasharray="14 100" stroke-dashoffset="-86"/>
					<path class="tw-dial-val" d="${ ARC }" pathLength="100" stroke-dasharray="0 100" stroke="url(#${ gid })"/>
					<g class="tw-dial-ticks">${ ticks }</g>
					<circle class="tw-dial-head" r="3" cx="24.64" cy="95.36"/>
					<text class="tw-dial-rpm" x="60" y="105">rpm 0%</text>
				</svg>
				<div class="tw-dial-center"><span class="tw-speed">0.0</span><span class="tw-g-unit">knots</span></div>
			</div>
			<div class="tw-compass">
				<svg viewBox="0 0 100 100">
					<circle class="tw-compass-ring" cx="50" cy="50" r="47"/>
					<g class="tw-compass-card">${ card }</g>
					<path class="tw-lubber" d="M45.5 1.5h9L50 8.5z"/>
				</svg>
				<div class="tw-hdg"><span class="tw-hdg-num">000°</span><span class="tw-hdg-card">N</span></div>
			</div>`;
		this.bThrPos = el.querySelector( '.tw-thr-pos' );
		this.bThrNeg = el.querySelector( '.tw-thr-neg' );
		this.bThrText = el.querySelector( '.tw-thr-val' );
		this.bArc = el.querySelector( '.tw-dial-val' );
		this.bHead = el.querySelector( '.tw-dial-head' );
		this.bRpmText = el.querySelector( '.tw-dial-rpm' );
		this.bSpeed = el.querySelector( '.tw-speed' );
		this.bCard = el.querySelector( '.tw-compass-card' );
		this.bHdgText = el.querySelector( '.tw-hdg-num' );
		this.bHdgCard = el.querySelector( '.tw-hdg-card' );
		return el;

	}

	_buildPanel() {

		const panel = this.panel = h( 'aside', 'tw-panel tw-glass tw-interactive', { 'aria-label': 'Settings' } );
		panel.inert = true;

		const head = h( 'header', 'tw-panel-head' );
		head.append( h( 'div', 'tw-panel-title', { text: 'Settings' } ) );
		const actions = h( 'div', 'tw-panel-actions' );
		const action = ( name, tip, fn ) => {

			const b = h( 'button', 'tw-icon-btn', { type: 'button', 'aria-label': tip, 'data-tip': tip, html: icon( name ) } );
			b.addEventListener( 'click', fn );
			actions.append( b );

		};

		action( 'viewfinder', 'Photo mode (P)', () => this.setPhotoMode( true ) );
		action( 'help', 'Controls (F1)', () => this.toggleHelp() );
		action( 'chevrons-right', 'Collapse (H)', () => this.togglePanel( false ) );
		head.append( actions );

		this.tabBar = h( 'div', 'tw-tabs', { role: 'tablist', 'aria-label': 'Settings sections' } );
		this.tabBar.addEventListener( 'keydown', ( e ) => {

			const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? - 1 : 0;
			if ( ! d ) return;
			e.preventDefault();
			e.stopPropagation();
			const list = [ ...this.tabs.values() ].filter( ( t ) => ! t.btn.hidden );
			const i = list.indexOf( this.activeTab );
			const next = list[ ( i + d + list.length ) % list.length ];
			if ( next ) {

				this.selectTab( next.id );
				next.btn.focus();

			}

		} );

		this.pages = h( 'div', 'tw-pages' );

		const foot = h( 'footer', 'tw-panel-foot' );
		foot.innerHTML = '<span><kbd>H</kbd>Hide</span><span><kbd>F1</kbd>Controls</span><span><kbd>P</kbd>Photo mode</span>';
		panel.append( head, this.tabBar, this.pages, foot );

		// collapsed state: a slim rail of tab icons
		const rail = this.rail = h( 'nav', 'tw-rail tw-glass tw-interactive', { 'aria-label': 'Settings' } );
		const open = h( 'button', 'tw-rail-btn tw-rail-open', { type: 'button', 'aria-label': 'Open settings', 'data-tip': 'Settings (H)', 'data-tip-side': 'left', html: icon( 'sliders' ) } );
		open.addEventListener( 'click', () => this.togglePanel( true ) );
		this.railTabs = h( 'div', 'tw-rail-tabs' );
		const help = h( 'button', 'tw-rail-btn', { type: 'button', 'aria-label': 'Controls', 'data-tip': 'Controls (F1)', 'data-tip-side': 'left', html: icon( 'help' ) } );
		help.addEventListener( 'click', () => this.toggleHelp() );
		rail.append( open, h( 'span', 'tw-rail-sep' ), this.railTabs, h( 'span', 'tw-rail-sep' ), help );

		this.root.append( rail, panel );

	}

	_buildHelp() {

		const k = ( ...keys ) => keys.map( ( x ) => `<kbd>${ x }</kbd>` ).join( '' );
		const row = ( keys, text ) => `<div class="tw-help-row"><span class="tw-keys">${ keys }</span><span class="tw-help-text">${ text }</span></div>`;
		const wasd = '<span class="tw-wasd"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span>';
		const mouse = `<kbd class="tw-kbd-ico" aria-label="Mouse">${ icon( 'mouse' ) }</kbd>`;

		const el = this.helpEl = h( 'div', 'tw-help tw-interactive', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tw-help-title', hidden: true } );
		el.innerHTML = `
			<div class="tw-help-card tw-glass">
				<header class="tw-help-head">
					<div>
						<h2 id="tw-help-title">Controls</h2>
						<p>Click the view to capture the mouse. Esc releases it.</p>
					</div>
					<button type="button" class="tw-icon-btn tw-help-close" aria-label="Close" data-tip="Close (F1)">${ icon( 'close' ) }</button>
				</header>
				<div class="tw-help-grid">
					<section>
						<h3>Move</h3>
						${ row( wasd, 'Move' ) }
						${ row( mouse, 'Look around<small>Click to capture</small>' ) }
						${ row( k( 'Shift' ), 'Sprint, boat boost' ) }
						${ row( k( 'Space' ), 'Jump, swim up' ) }
						${ row( k( 'C' ), 'Crouch, dive' ) }
					</section>
					<section>
						<h3>Interact</h3>
						${ row( k( 'E' ), 'Interact<small>Board, helm, step ashore, trade</small>' ) }
						${ row( k( 'V' ), 'Boat camera<small>1st / 3rd person</small>' ) }
						${ row( k( 'R' ), 'Fishing rod<small>Take out / put away</small>' ) }
						${ row( k( 'LMB' ), 'Cast, strike, reel<small>Hold to wind up / reel</small>' ) }
						${ row( k( 'RMB' ), 'Reel in an empty line' ) }
						${ row( k( 'I' ), 'Cooler and fish log' ) }
						${ row( k( 'F' ), 'Free camera' ) }
						${ row( k( 'T' ), 'Pause time' ) }
						${ row( k( 'L' ), 'Flashlight' ) }
						${ row( k( 'M' ), 'Mute' ) }
					</section>
					<section>
						<h3>Interface</h3>
						${ row( k( 'H' ), 'Settings panel' ) }
						${ row( k( 'P' ), 'Photo mode<small>Hides all interface</small>' ) }
						${ row( k( 'F1' ) + k( '?' ), 'This sheet' ) }
						${ row( k( 'Esc' ), 'Release the mouse' ) }
					</section>
				</div>
				<div class="tw-help-guide">
					<span><b>How to play:</b> catch fish, sell them to Joe at the fish stand by the pier, and buy upgrades from Marta at the chandlery by the boathouse. Both are on the map (lower right).</span>
					<button type="button" class="gm-btn is-ghost tw-help-replay">Replay the guide</button>
				</div>
			</div>`;
		el.querySelector( '.tw-help-close' ).addEventListener( 'click', () => this.toggleHelp( false ) );
		el.querySelector( '.tw-help-replay' ).addEventListener( 'click', () => callHook( this.onReplayGuide ) );
		el.addEventListener( 'click', ( e ) => {

			if ( e.target === el ) this.toggleHelp( false );

		} );
		this.root.append( el );

	}

	_buildStart() {

		const el = this.startEl = h( 'div', 'tw-start tw-interactive', { hidden: true } );
		el.innerHTML = `
			<div class="tw-start-inner">
				${ brandMark( 'tw-start-mark' ) }
				<div class="tw-start-title">TIDEWATER</div>
				<button type="button" class="tw-start-cta"><span class="tw-start-pulse" aria-hidden="true"></span>${ icon( 'mouse' ) }<span>Click to explore</span></button>
				<div class="tw-start-keys">
					<span><span class="tw-wasd"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span>Move</span>
					<span><kbd class="tw-kbd-ico">${ icon( 'mouse' ) }</kbd>Look</span>
					<span><kbd>E</kbd>Interact</span>
					<span><kbd>H</kbd>Settings</span>
					<span><kbd>F1</kbd>All controls</span>
				</div>
			</div>`;
		this.root.append( el );

	}

	// ── global wiring ───────────────────────────────────────────────────────

	_bindGlobal() {

		const signal = this._ac.signal;
		for ( const el of [ this.panel, this.rail, this.helpEl, this.startEl ] ) this._isolate( el );

		const interact = ( e ) => {

			this._activity();
			callHook( this.onPanelInteract, e );

		};

		this.panel.addEventListener( 'pointerdown', interact );
		this.rail.addEventListener( 'pointerdown', interact );

		// Mouse-activated buttons give focus back so Space/Enter reach the game again.
		for ( const el of [ this.panel, this.rail, this.helpEl ] ) {

			el.addEventListener( 'click', ( e ) => {

				if ( e.detail === 0 ) return;
				const b = e.target.closest?.( 'button' );
				if ( b && ! b.classList.contains( 'tw-dd' ) ) b.blur();

			} );

		}

		window.addEventListener( 'keydown', ( e ) => {

			this._activity();
			this._onKey( e );

		}, { signal } );

		// any input (mouse-look included) keeps the HUD awake
		window.addEventListener( 'wheel', () => this._activity(), { passive: true, signal } );
		document.addEventListener( 'pointermove', ( e ) => {

			const locked = !! document.pointerLockElement;
			this._overUI = ! locked && !! e.target?.closest?.( '.tw-interactive' );
			this._activity();
			if ( this._photo && ! locked ) this._pokePhotoHint();

		}, { passive: true, signal } );

		document.addEventListener( 'pointerdown', ( e ) => {

			const inUI = !! e.target?.closest?.( '.tw-interactive' );
			this._overUI = inUI && ! document.pointerLockElement;
			if ( this._menu && ! this._menu.contains( e.target ) && ! this._menuAnchor?.contains( e.target ) ) this._closeMenu();
			if ( ! inUI ) {

				const a = document.activeElement;
				if ( a && a !== document.body && this.root.contains( a ) ) a.blur();

			}

			this._hideTip();

		}, { capture: true, signal } );

		document.addEventListener( 'pointerout', ( e ) => {

			if ( ! e.relatedTarget ) this._overUI = false;

		}, { signal } );

		document.addEventListener( 'pointerlockchange', () => {

			const locked = !! document.pointerLockElement;
			this.root.classList.toggle( 'is-locked', locked );
			if ( locked ) {

				this._overUI = false;
				this._closeMenu();
				this._hideTip();
				const a = document.activeElement;
				if ( a && this.root.contains( a ) ) a.blur();

			} else {

				this._activity();

			}

		}, { signal } );

		window.addEventListener( 'resize', () => {

			this._closeMenu();
			this._hideTip();
			if ( this._spark.length ) this._drawSpark();

		}, { signal } );

		window.addEventListener( 'blur', () => {

			this._overUI = false;
			this._hideTip();

		}, { signal } );

		this.pages.addEventListener( 'scroll', () => {

			this._closeMenu();
			this._hideTip();

		}, { passive: true } );

		this.root.addEventListener( 'pointerover', ( e ) => this._tipOver( e ) );
		this.root.addEventListener( 'pointerout', ( e ) => this._tipOut( e ) );

	}

	// Keeps UI pointer/wheel/keyboard input away from the canvas and the game.
	_isolate( el ) {

		const stop = ( e ) => e.stopPropagation();
		for ( const t of [ 'pointerdown', 'mousedown', 'click', 'dblclick', 'wheel', 'touchstart' ] ) el.addEventListener( t, stop, { passive: true } );
		el.addEventListener( 'contextmenu', ( e ) => {

			e.stopPropagation();
			if ( ! isTypingTarget( e.target ) ) e.preventDefault();

		} );
		el.addEventListener( 'keydown', ( e ) => {

			if ( NAV_KEYS.has( e.code ) && e.target !== el.ownerDocument.body ) e.stopPropagation();

		} );

	}

	_onKey( e ) {

		if ( isTypingTarget( e.target ) || e.ctrlKey || e.metaKey || e.altKey ) return;

		if ( e.code === 'F1' || e.key === '?' ) {

			e.preventDefault();
			if ( ! e.repeat ) {

				if ( this._photo ) this.setPhotoMode( false );
				this.toggleHelp();

			}

			return;

		}

		if ( e.code === 'Escape' ) {

			if ( this._menu ) this._closeMenu( true );
			else if ( this._help ) this.toggleHelp( false );
			return;

		}

		if ( e.repeat || this._start ) return;

		if ( e.code === 'KeyH' ) {

			if ( this._photo ) this.setPhotoMode( false );
			this.togglePanel();

		} else if ( e.code === 'KeyP' ) {

			this.setPhotoMode( ! this._photo );

		}

	}

	_tick() {

		// keep visible controls in sync with their objects; refreshes info rows ~4 Hz
		if ( this._panelOpen && ! this._photo ) {

			for ( const c of this._controls ) if ( c._isShown() ) c.update();

		}

		// the HUD recedes after a few seconds without any input
		const idle = performance.now() - this._lastAct > 5000;
		if ( idle !== this._idle ) {

			this._idle = idle;
			this.root.classList.toggle( 'is-idle', idle );

		}

	}

	_activity() {

		this._lastAct = performance.now();
		if ( this._idle ) {

			this._idle = false;
			this.root.classList.remove( 'is-idle' );

		}

	}

	_dragStart() {

		this._drag ++;
		this.root.classList.add( 'is-dragging' );
		this._hideTip();

	}

	_dragEnd() {

		this._drag = Math.max( 0, this._drag - 1 );
		if ( ! this._drag ) this.root.classList.remove( 'is-dragging' );

	}

	// ── tooltips ────────────────────────────────────────────────────────────

	_tipOver( e ) {

		const t = e.target.closest?.( '[data-tip]' );
		if ( t === this._tipT ) return;
		this._hideTip();
		if ( ! t || this._drag || document.pointerLockElement ) return;
		this._tipT = t;
		this._tipTimer = setTimeout( () => this._showTip( t ), t.closest( '.tw-rail' ) ? 220 : 520 );

	}

	_tipOut( e ) {

		if ( this._tipT && ! this._tipT.contains( e.relatedTarget ) ) this._hideTip();

	}

	_showTip( t ) {

		if ( ! t.isConnected || ( t.classList.contains( 'tw-tab' ) && t.classList.contains( 'is-active' ) ) ) return;
		const tip = this.tipEl;
		tip.innerHTML = esc( t.dataset.tip ) + ( t.dataset.tipHint ? `<small>${ esc( t.dataset.tipHint ) }</small>` : '' );
		tip.classList.add( 'is-on' );
		const r = t.getBoundingClientRect(), tr = tip.getBoundingClientRect();
		const left = t.dataset.tipSide === 'left';
		let x, y;
		if ( left ) {

			x = r.left - tr.width - 10;
			y = r.top + r.height / 2 - tr.height / 2;

		} else {

			x = r.left + r.width / 2 - tr.width / 2;
			y = r.top - tr.height - 8;
			if ( y < 8 ) y = r.bottom + 8;

		}

		x = clamp( x, 8, window.innerWidth - tr.width - 8 );
		y = clamp( y, 8, window.innerHeight - tr.height - 8 );
		tip.style.transform = `translate(${ Math.round( x ) }px, ${ Math.round( y ) }px)`;

	}

	_hideTip() {

		clearTimeout( this._tipTimer );
		this._tipT = null;
		this.tipEl.classList.remove( 'is-on' );

	}

	// ── dropdown menu (shared) ──────────────────────────────────────────────

	_openMenu( anchor, labels, index, onPick ) {

		this._closeMenu();
		const menu = h( 'div', 'tw-menu tw-interactive', { role: 'listbox' } );
		labels.forEach( ( text, i ) => {

			const it = h( 'button', 'tw-menu-item', { type: 'button', role: 'option', 'aria-selected': String( i === index ), tabindex: '-1' } );
			it.innerHTML = `<span>${ esc( text ) }</span>${ i === index ? icon( 'check' ) : '' }`;
			it.addEventListener( 'click', ( e ) => {

				onPick( i );
				this._closeMenu( e.detail === 0 );

			} );
			menu.append( it );

		} );
		menu.addEventListener( 'keydown', ( e ) => {

			const items = [ ...menu.children ];
			let j = items.indexOf( document.activeElement );
			switch ( e.key ) {

				case 'ArrowDown': j = Math.min( items.length - 1, j + 1 ); break;
				case 'ArrowUp': j = Math.max( 0, j - 1 ); break;
				case 'Home': j = 0; break;
				case 'End': j = items.length - 1; break;
				case 'Escape': case 'Tab':
					e.preventDefault();
					e.stopPropagation();
					this._closeMenu( true );
					return;
				default: return;

			}

			e.preventDefault();
			e.stopPropagation();
			items[ j ]?.focus();

		} );
		this._isolate( menu );
		this.root.append( menu );

		const r = anchor.getBoundingClientRect();
		menu.style.minWidth = `${ Math.round( r.width ) }px`;
		const mh = menu.offsetHeight, mw = menu.offsetWidth;
		let top = r.bottom + 6;
		if ( top + mh > window.innerHeight - 8 ) top = Math.max( 8, r.top - 6 - mh );
		const left = clamp( r.right - mw, 8, window.innerWidth - mw - 8 );
		menu.style.top = `${ Math.round( top ) }px`;
		menu.style.left = `${ Math.round( left ) }px`;
		anchor.setAttribute( 'aria-expanded', 'true' );
		this._menu = menu;
		this._menuAnchor = anchor;
		void menu.offsetWidth;
		menu.classList.add( 'is-on' );
		const sel = menu.children[ Math.max( 0, index ) ];
		if ( sel ) {

			menu.scrollTop = Math.max( 0, sel.offsetTop - ( menu.clientHeight - sel.offsetHeight ) / 2 );
			sel.focus( { preventScroll: true } );

		}

	}

	_closeMenu( refocus = false ) {

		if ( ! this._menu ) return;
		const anchor = this._menuAnchor;
		this._menu.remove();
		this._menu = null;
		this._menuAnchor = null;
		anchor?.setAttribute( 'aria-expanded', 'false' );
		if ( refocus ) anchor?.focus( { preventScroll: true } );

	}

	// ── panel & tabs ────────────────────────────────────────────────────────

	addTab( id, label, iconName ) {

		id = String( id );
		if ( this.tabs.has( id ) ) return this.tabs.get( id );
		const tab = new Tab( this, id, label ?? id, iconName ?? id );
		this.tabs.set( id, tab );
		this.tabBar.append( tab.btn );
		this.railTabs.append( tab.railBtn );
		this.pages.append( tab.page );
		let saved = null;
		try {

			saved = localStorage.getItem( 'tidewater.ui.tab' );

		} catch { /* storage unavailable */ }

		if ( ! this.activeTab || saved === id ) this.selectTab( id, false );
		return tab;

	}

	getTab( id ) {

		return this.tabs.get( String( id ) ) || null;

	}

	selectTab( id, remember = true ) {

		const tab = this.tabs.get( String( id ) );
		if ( ! tab ) return null;
		const prev = this.activeTab;
		if ( prev === tab ) return tab;
		if ( prev ) {

			prev._scroll = this.pages.scrollTop;
			prev.btn.setAttribute( 'aria-selected', 'false' );
			prev.btn.tabIndex = - 1;
			prev.btn.classList.remove( 'is-active' );
			prev.railBtn.classList.remove( 'is-active' );
			prev.page.hidden = true;

		}

		tab.btn.setAttribute( 'aria-selected', 'true' );
		tab.btn.tabIndex = 0;
		tab.btn.classList.add( 'is-active' );
		tab.railBtn.classList.add( 'is-active' );
		tab.page.hidden = false;
		this.activeTab = tab;
		this.pages.scrollTop = tab._scroll || 0;
		tab.refresh();
		this._closeMenu();
		this._hideTip();

		// keep the active tab visible when the strip overflows
		const bar = this.tabBar, b = tab.btn;
		requestAnimationFrame( () => {

			if ( b.offsetLeft < bar.scrollLeft ) bar.scrollLeft = b.offsetLeft - 4;
			else if ( b.offsetLeft + b.offsetWidth > bar.scrollLeft + bar.clientWidth ) bar.scrollLeft = b.offsetLeft + b.offsetWidth - bar.clientWidth + 4;

		} );

		if ( remember ) {

			try {

				localStorage.setItem( 'tidewater.ui.tab', tab.id );

			} catch { /* storage unavailable */ }

		}

		return tab;

	}

	// Re-reads every control from its bound object (e.g. after applying a preset).
	refresh() {

		for ( const c of this._controls ) c.update();
		return this;

	}

	resetAll() {

		for ( const c of this._controls ) c.reset();
		return this;

	}

	togglePanel( force ) {

		const open = force === undefined ? ! this._panelOpen : !! force;
		if ( open === this._panelOpen ) return open;
		this._panelOpen = open;
		this.root.dataset.panel = open ? 'open' : 'closed';
		this.panel.inert = ! open;
		this.rail.inert = open;
		this._overUI = false;
		this._closeMenu();
		this._hideTip();
		if ( open ) {

			this.activeTab?.refresh();
			if ( this.releasePointerOnPanel && document.pointerLockElement ) document.exitPointerLock?.();

		} else {

			const a = document.activeElement;
			if ( a && this.panel.contains( a ) ) a.blur();

		}

		this._activity();
		callHook( this.onPanelToggle, open );
		return open;

	}

	get panelOpen() {

		return this._panelOpen;

	}

	// ── HUD ─────────────────────────────────────────────────────────────────

	setMode( label ) {

		label = label == null ? '' : String( label );
		if ( label === this._mode ) return;
		this._mode = label;
		this.modeEl.classList.toggle( 'is-empty', ! label );
		this.modeText.textContent = label;
		const ic = modeIcon( label );
		if ( ic !== this._modeIc ) {

			this._modeIc = ic;
			this.modeIco.innerHTML = icon( ic );

		}

		this.modeEl.classList.remove( 'is-bump' );
		void this.modeEl.offsetWidth;
		this.modeEl.classList.add( 'is-bump' );
		this._activity();

	}

	// setPrompt( 'E', 'Board boat' ) shows it; setPrompt( null ) hides it.
	setPrompt( key, text ) {

		const on = key != null && key !== '';
		if ( on ) {

			const k = String( key ), t = text == null ? '' : String( text );
			if ( k !== this._pKey || t !== this._pText ) {

				this._pKey = k;
				this._pText = t;
				this.promptKey.textContent = k;
				this.promptKey.classList.toggle( 'is-wide', k.length > 1 );
				this.promptText.textContent = t;
				this.promptEl.classList.remove( 'is-bump' );
				void this.promptEl.offsetWidth;
				this.promptEl.classList.add( 'is-bump' );

			}

		}

		if ( on !== !! this._pOn ) {

			this._pOn = on;
			this.promptEl.classList.toggle( 'is-on', on );
			if ( on ) this._activity();

		}

	}

	setBoatGauges( g = {} ) {

		const vis = !! g.visible;
		if ( vis !== !! this._boatOn ) {

			this._boatOn = vis;
			this.boatEl.classList.toggle( 'is-on', vis );

		}

		if ( ! vis ) return;

		const spd = Math.abs( Number( g.speedKnots ) || 0 ).toFixed( 1 );
		if ( spd !== this._bSpd ) {

			this._bSpd = spd;
			this.bSpeed.textContent = spd;

		}

		const rpm = clamp( Number( g.rpm ) || 0, 0, 1 );
		const rq = Math.round( rpm * 1000 );
		if ( rq !== this._bRpm ) {

			this._bRpm = rq;
			this.bArc.setAttribute( 'stroke-dasharray', `${ ( rpm * 100 ).toFixed( 2 ) } 100` );
			const a = ( 135 + 270 * rpm ) * Math.PI / 180;
			this.bHead.setAttribute( 'cx', ( 60 + 50 * Math.cos( a ) ).toFixed( 2 ) );
			this.bHead.setAttribute( 'cy', ( 60 + 50 * Math.sin( a ) ).toFixed( 2 ) );
			this.boatEl.classList.toggle( 'is-redline', rpm > 0.86 );
			this.bRpmText.textContent = `rpm ${ Math.round( rpm * 100 ) }%`;

		}

		const thr = clamp( Number( g.throttle ) || 0, - 1, 1 );
		const tq = Math.round( thr * 100 );
		if ( tq !== this._bThr ) {

			this._bThr = tq;
			this.bThrPos.style.transform = `scaleY(${ Math.max( 0, thr ).toFixed( 3 ) })`;
			this.bThrNeg.style.transform = `scaleY(${ Math.max( 0, - thr ).toFixed( 3 ) })`;
			this.bThrText.textContent = tq === 0 ? '0%' : `${ tq > 0 ? '+' : '−' }${ Math.abs( tq ) }%`;
			this.boatEl.classList.toggle( 'is-reverse', tq < 0 );

		}

		const hdg = ( ( ( Number( g.heading ) || 0 ) % 360 ) + 360 ) % 360;
		const hq = Math.round( hdg * 10 );
		if ( hq !== this._bHdg ) {

			this._bHdg = hq;
			this.bCard.setAttribute( 'transform', `rotate(${ ( - hdg ).toFixed( 1 ) } 50 50)` );
			this.bHdgText.textContent = `${ String( Math.round( hdg ) % 360 ).padStart( 3, '0' ) }°`;
			this.bHdgCard.textContent = CARDINALS[ Math.round( hdg / 45 ) % 8 ];

		}

	}

	setDepth( d = {} ) {

		const vis = !! d.visible;
		if ( vis !== !! this._depthOn ) {

			this._depthOn = vis;
			this.depthEl.classList.toggle( 'is-on', vis );
			this._depthDrawn = null;

		}

		if ( ! vis ) return;
		const m = Math.max( 0, Number( d.meters ) || 0 );
		const s = m.toFixed( 1 );
		if ( s !== this._depthTxt ) {

			this._depthTxt = s;
			this.depthNum.textContent = s;

		}

		if ( this._depthDrawn == null || Math.abs( m - this._depthDrawn ) > 0.004 ) {

			this._depthDrawn = m;
			this._drawDepth( m );

		}

	}

	_ctx2d( c ) {

		const w = c.clientWidth, hh = c.clientHeight;
		if ( ! w || ! hh ) return null;
		const dpr = Math.min( 2, window.devicePixelRatio || 1 );
		const W = Math.round( w * dpr ), H = Math.round( hh * dpr );
		if ( c.width !== W || c.height !== H ) {

			c.width = W;
			c.height = H;

		}

		const g = c.getContext( '2d' );
		g.setTransform( dpr, 0, 0, dpr, 0, 0 );
		g.clearRect( 0, 0, w, hh );
		return { g, w, h: hh };

	}

	// Sounding tape: 14 m window centred on the current depth, fading at the ends.
	_drawDepth( m ) {

		const ctx = this._ctx2d( this.depthCanvas );
		if ( ! ctx ) return;
		const { g, w, h: hh } = ctx;
		const span = 14, ppm = hh / span, cy = hh / 2;
		const fade = ( y, p = 1.6 ) => Math.pow( 1 - Math.min( 1, Math.abs( y - cy ) / cy ), p );
		g.font = `500 ${ Math.max( 8, hh / 21 ).toFixed( 1 ) }px "JetBrains Mono", ui-monospace, monospace`;
		g.textAlign = 'right';
		g.textBaseline = 'middle';
		g.lineWidth = 1;

		const d0 = Math.max( 0, Math.floor( m - span / 2 ) ), d1 = Math.ceil( m + span / 2 );
		for ( let d = d0; d <= d1; d += 0.5 ) {

			const y = Math.round( cy + ( d - m ) * ppm ) + 0.5;
			const a = fade( y );
			if ( a <= 0.01 ) continue;
			const whole = d % 1 === 0, major = d % 5 === 0;
			const len = major ? w * 0.42 : whole ? w * 0.22 : w * 0.11;
			g.strokeStyle = `rgba(190, 238, 244, ${ ( major ? 0.9 : whole ? 0.5 : 0.28 ) * a })`;
			g.beginPath();
			g.moveTo( w - len, y );
			g.lineTo( w, y );
			g.stroke();
			if ( major ) {

				g.fillStyle = `rgba(222, 246, 250, ${ 0.85 * a })`;
				g.fillText( String( d ), w - len - 4, y );

			}

		}

		// the surface, drawn as a small swell line
		const ys = cy - m * ppm;
		if ( ys >= - 4 ) {

			g.strokeStyle = `rgba(95, 227, 212, ${ 0.95 * fade( ys, 1.2 ) })`;
			g.lineWidth = 1.5;
			g.beginPath();
			for ( let x = 0; x <= w; x += 2 ) {

				const y = ys + Math.sin( x * 0.45 ) * 1.4;
				if ( x ) g.lineTo( x, y );
				else g.moveTo( x, y );

			}

			g.stroke();

		}

	}

	setStats( s = {} ) {

		const num = ( v ) => ( typeof v === 'number' && isFinite( v ) ? v : NaN );
		let fps = num( s.fps ), frameMs = num( s.frameMs );
		const gpuMs = num( s.gpuMs );
		if ( ! ( fps > 0 ) && frameMs > 0 ) fps = 1000 / frameMs;
		if ( ! ( frameMs > 0 ) && fps > 0 ) frameMs = 1000 / fps;

		// sparkline: worst frame per 100 ms bucket, so hitches stay visible
		const now = performance.now();
		if ( frameMs > 0 ) this._sparkAcc = Math.max( this._sparkAcc, frameMs );
		if ( now - this._sparkT >= 100 && this._sparkAcc > 0 ) {

			this._sparkT = now;
			this._spark.push( this._sparkAcc );
			if ( this._spark.length > 60 ) this._spark.shift();
			this._sparkAcc = 0;
			this._drawSpark();

		}

		if ( now - this._statsT < 250 ) return;
		this._statsT = now;
		if ( fps > 0 ) {

			const f = String( Math.round( fps ) );
			if ( f !== this._fpsTxt ) {

				this._fpsTxt = f;
				this.fpsEl.textContent = f;

			}

			const lvl = fps >= 50 ? 'good' : fps >= 30 ? 'warn' : 'bad';
			if ( lvl !== this._lvl ) {

				this._lvl = lvl;
				this.statsEl.dataset.level = lvl;

			}

		}

		if ( frameMs > 0 ) this.msEl.textContent = `${ frameMs.toFixed( 1 ) } ms`;
		const hasGpu = gpuMs >= 0;
		if ( this.gpuKv.hidden === hasGpu ) this.gpuKv.hidden = ! hasGpu;
		if ( hasGpu ) this.gpuEl.textContent = `${ gpuMs.toFixed( 1 ) } ms`;

	}

	_drawSpark() {

		const ctx = this._ctx2d( this.sparkEl );
		if ( ! ctx ) return;
		const { g, w, h: hh } = ctx;
		const data = this._spark;
		const top = Math.max( 34, ...data ) * 1.1;
		const Y = ( ms ) => hh - 1.5 - ( Math.min( ms, top ) / top ) * ( hh - 4 );
		const X = ( i ) => w - 2 - ( data.length - 1 - i ) * ( ( w - 4 ) / 59 );

		// 60 fps reference
		g.strokeStyle = 'rgba(200, 230, 240, 0.18)';
		g.lineWidth = 1;
		g.setLineDash( [ 2, 3 ] );
		g.beginPath();
		const yr = Math.round( Y( 1000 / 60 ) ) + 0.5;
		g.moveTo( 0, yr );
		g.lineTo( w, yr );
		g.stroke();
		g.setLineDash( [] );
		if ( data.length < 2 ) return;

		const rgb = this._lvl === 'bad' ? '255, 122, 133' : this._lvl === 'warn' ? '255, 184, 107' : '95, 227, 212';
		const trace = () => {

			g.beginPath();
			data.forEach( ( v, i ) => ( i ? g.lineTo( X( i ), Y( v ) ) : g.moveTo( X( i ), Y( v ) ) ) );

		};

		const grad = g.createLinearGradient( 0, 0, 0, hh );
		grad.addColorStop( 0, `rgba(${ rgb }, 0.32)` );
		grad.addColorStop( 1, `rgba(${ rgb }, 0)` );
		trace();
		g.lineTo( X( data.length - 1 ), hh );
		g.lineTo( X( 0 ), hh );
		g.closePath();
		g.fillStyle = grad;
		g.fill();

		trace();
		g.strokeStyle = `rgba(${ rgb }, 0.95)`;
		g.lineWidth = 1.25;
		g.lineJoin = 'round';
		g.stroke();

		const last = data.length - 1;
		g.fillStyle = `rgb(${ rgb })`;
		g.beginPath();
		g.arc( X( last ), Y( data[ last ] ), 1.8, 0, TAU );
		g.fill();

	}

	// Brief notification. Returns a function that dismisses it early.
	toast( text, ms = 2500 ) {

		text = String( text ?? '' );
		if ( ! text ) return () => {};

		// repeated message: restart its timer instead of stacking duplicates
		const same = this._toasts.find( ( t ) => t.text === text && ! t.leaving );
		if ( same ) {

			clearTimeout( same.timer );
			same.timer = setTimeout( same.dismiss, ms );
			same.bar.style.setProperty( '--life', `${ ms }ms` );
			same.bar.style.animation = 'none';
			void same.bar.offsetWidth;
			same.bar.style.animation = '';
			same.el.classList.remove( 'is-bump' );
			void same.el.offsetWidth;
			same.el.classList.add( 'is-bump' );
			return same.dismiss;

		}

		const el = h( 'div', 'tw-toast tw-glass', { role: 'status' } );
		const bar = h( 'span', 'tw-toast-bar' );
		bar.style.setProperty( '--life', `${ ms }ms` );
		el.append( h( 'span', 'tw-toast-dot' ), h( 'span', 'tw-toast-text', { text } ), bar );
		this.toastsEl.append( el );
		void el.offsetWidth;
		el.classList.add( 'is-in' );

		const t = { text, el, bar, timer: 0, leaving: false };
		t.dismiss = () => {

			if ( t.leaving ) return;
			t.leaving = true;
			clearTimeout( t.timer );
			el.style.setProperty( '--h', `${ el.offsetHeight }px` );
			el.classList.remove( 'is-in' );
			el.classList.add( 'is-out' );
			const i = this._toasts.indexOf( t );
			if ( i >= 0 ) this._toasts.splice( i, 1 );
			setTimeout( () => el.remove(), 360 );

		};

		t.timer = setTimeout( t.dismiss, ms );
		this._toasts.push( t );
		while ( this._toasts.length > 4 ) this._toasts[ 0 ].dismiss();
		return t.dismiss;

	}

	// ── overlays ────────────────────────────────────────────────────────────

	toggleHelp( force ) {

		const open = force === undefined ? ! this._help : !! force;
		if ( open === this._help ) return open;
		this._help = open;
		const el = this.helpEl;
		clearTimeout( this._helpT );
		if ( open ) {

			this._closeMenu();
			this._hideTip();
			el.hidden = false;
			void el.offsetWidth;
			el.classList.add( 'is-on' );
			if ( ! document.pointerLockElement ) el.querySelector( '.tw-help-close' )?.focus( { preventScroll: true } );

		} else {

			el.classList.remove( 'is-on' );
			const a = document.activeElement;
			if ( a && el.contains( a ) ) a.blur();
			this._helpT = setTimeout( () => {

				if ( ! this._help ) el.hidden = true;

			}, 280 );

		}

		this._activity();
		callHook( this.onHelpToggle, open );
		return open;

	}

	get helpOpen() {

		return this._help;

	}

	setPhotoMode( on ) {

		on = !! on;
		if ( on === this._photo ) return;
		this._photo = on;
		this.root.classList.toggle( 'is-photo', on );
		if ( on ) {

			this.toggleHelp( false );
			this._closeMenu();
			this._hideTip();
			const a = document.activeElement;
			if ( a && this.root.contains( a ) ) a.blur();
			this._pokePhotoHint();

		} else {

			clearTimeout( this._photoT );
			this.photoHint.classList.remove( 'is-on' );
			this._activity();

		}

		this._overUI = false;
		callHook( this.onPhotoMode, on );

	}

	get photoMode() {

		return this._photo;

	}

	// The photo-mode hint shows briefly, then gets out of the shot.
	_pokePhotoHint() {

		if ( ! this._photo ) return;
		this.photoHint.classList.add( 'is-on' );
		clearTimeout( this._photoT );
		this._photoT = setTimeout( () => this.photoHint.classList.remove( 'is-on' ), 2400 );

	}

	// Resolves on the first click (or Enter / Space). onStart runs inside that
	// user gesture, so it may call requestPointerLock().
	showStartOverlay( onStart ) {

		if ( this._startPromise ) return this._startPromise;
		const el = this.startEl;
		this._start = true;
		this.root.classList.add( 'is-starting' );
		el.hidden = false;
		void el.offsetWidth;
		el.classList.add( 'is-on' );

		this._startPromise = new Promise( ( resolve ) => {

			const go = ( e ) => {

				if ( e.type === 'keydown' ) {

					if ( e.key !== 'Enter' && e.code !== 'Space' ) return;
					e.preventDefault();
					e.stopPropagation();

				}

				el.removeEventListener( 'click', go );
				window.removeEventListener( 'keydown', go, true );
				this._start = false;
				this._startPromise = null;
				this.root.classList.remove( 'is-starting' );
				el.classList.remove( 'is-on' );
				const a = document.activeElement;
				if ( a && el.contains( a ) ) a.blur();
				setTimeout( () => {

					if ( ! this._start ) el.hidden = true;

				}, 700 );
				this._overUI = false;
				this._activity();
				callHook( onStart );
				resolve();

			};

			el.addEventListener( 'click', go );
			window.addEventListener( 'keydown', go, true );

		} );

		return this._startPromise;

	}

	// ── loader (static markup in index.html) ────────────────────────────────
	//
	// setLoading( p, status, until ): a stage starts at progress p (0..1). While it runs the bar creeps
	// towards `until` (default p + 0.05) without reaching it, so a long stage never looks frozen while
	// scripts run. setLoadingDetail( done, total ): sub-progress of the current stage (e.g. pipelines
	// compiled / total), mapped between p and `until`. setLoadingError( message ).

	setLoading( progress01, status, until ) {

		const L = document.getElementById( 'loader' );
		if ( ! L ) return;
		const ld = this._loaderState();
		if ( typeof progress01 === 'number' && isFinite( progress01 ) ) {

			const p = clamp( progress01, 0, 1 );
			ld.from = Math.max( p, ld.shown );
			ld.until = clamp( typeof until === 'number' ? until : p + 0.05, ld.from, p >= 1 ? 1 : 0.995 );
			ld.stageT = performance.now();
			ld.tau = typeof until === 'number' ? 40000 : 6000;
			ld.detail = - 1;
			if ( p >= 1 ) ld.shown = 1;

		}

		if ( status != null ) {

			ld.status = String( status );
			if ( ld.statusEl ) ld.statusEl.textContent = ld.status;
			L.classList.toggle( 'is-compiling', /shader/i.test( ld.status ) );

		}

		this._loaderPaint();

	}

	setLoadingDetail( done, total ) {

		const ld = this._loaderState();
		if ( ! ( total > 0 ) ) return;
		ld.detail = clamp( done / total, 0, 1 );
		if ( ld.statusEl ) ld.statusEl.textContent = `${ ld.status.replace( /…$/, '' ) } · ${ done } / ${ total }`;
		this._loaderPaint();

	}

	setLoadingError( message ) {

		const L = document.getElementById( 'loader' );
		if ( ! L ) return;
		const ld = this._loaderState();
		L.classList.add( 'tw-error' );
		L.classList.remove( 'is-compiling' );
		ld.status = String( message );
		if ( ld.statusEl ) ld.statusEl.textContent = ld.status;
		ld.stopped = true;

	}

	_loaderState() {

		if ( this._ld ) return this._ld;
		const L = document.getElementById( 'loader' );
		const q = ( sel ) => L && L.querySelector( sel );
		const ld = this._ld = {
			from: 0, until: 0.05, shown: 0, stageT: performance.now(), tau: 6000, detail: - 1, status: '',
			t0: performance.now(), stopped: false,
			fill: q( '.loader-fill' ), pct: q( '.loader-pct' ), time: q( '.loader-time' ), statusEl: q( '.loader-status' ),
		};
		// eased bar + elapsed clock while scripts run (the CSS glint and tips keep moving when they don't)
		const tick = () => {

			if ( ld.stopped ) return;
			this._loaderPaint();
			ld.raf = requestAnimationFrame( tick );

		};

		ld.raf = requestAnimationFrame( tick );
		return ld;

	}

	_loaderPaint() {

		const ld = this._ld;
		if ( ! ld ) return;
		const now = performance.now();
		const goal = ld.detail >= 0
			? ld.from + ( ld.until - ld.from ) * ld.detail
			: ld.from + ( ld.until - ld.from ) * ( 1 - Math.exp( - ( now - ld.stageT ) / ld.tau ) );
		const dt = Math.min( 0.1, ( now - ( ld.lastT || now ) ) / 1000 );
		ld.lastT = now;
		// ease toward the goal; a jump after a blocked stretch settles in ~0.3 s instead of snapping
		ld.shown += ( Math.max( goal, ld.shown ) - ld.shown ) * ( dt > 0 ? 1 - Math.exp( - dt * 9 ) : 0 );
		if ( ld.fill ) ld.fill.style.transform = `scaleX(${ Math.max( 0.02, ld.shown ).toFixed( 4 ) })`;
		if ( ld.pct ) ld.pct.textContent = Math.floor( ld.shown * 100 ) + '%';
		if ( ld.time ) {

			const s = Math.floor( ( now - ld.t0 ) / 1000 );
			ld.time.textContent = Math.floor( s / 60 ) + ':' + String( s % 60 ).padStart( 2, '0' );

		}

	}

	// Fades the loader out; the returned promise resolves once it is gone.
	hideLoader() {

		const L = document.getElementById( 'loader' );
		if ( ! L ) return Promise.resolve();
		if ( this._loaderGone ) return this._loaderGone;
		this.setLoading( 1, 'Ready' );
		L.classList.remove( 'is-compiling' );
		L.classList.add( 'tw-hidden' );
		this._loaderGone = new Promise( ( resolve ) => setTimeout( () => {

			if ( this._ld ) {

				this._ld.stopped = true;
				cancelAnimationFrame( this._ld.raf );

			}

			L.style.display = 'none';
			resolve();

		}, 920 ) );
		return this._loaderGone;

	}

	// ── state ───────────────────────────────────────────────────────────────

	// True while the cursor is over the panel, rail, menus or a modal overlay,
	// or while a UI control is being dragged. Use it to skip pointer-lock clicks.
	get isPointerOverUI() {

		if ( this._drag > 0 || this._start || this._help ) return true;
		if ( document.pointerLockElement ) return false;
		return this._overUI;

	}

	dispose() {

		clearInterval( this._timer );
		this._ac.abort();
		for ( const t of this._toasts ) clearTimeout( t.timer );
		this._closeMenu();
		this.root.remove();
		this._controls.clear();
		this.tabs.clear();

	}

	// ── demo ────────────────────────────────────────────────────────────────

	// Fills every tab with sample controls of every type and animates the HUD,
	// so the look can be reviewed without the simulation. Returns stop().
	static demo( ui ) {

		const colorLike = ( hex ) => ( {
			r: 0, g: 0, b: 0,
			setHex( v ) {

				this.r = ( ( v >> 16 ) & 255 ) / 255;
				this.g = ( ( v >> 8 ) & 255 ) / 255;
				this.b = ( v & 255 ) / 255;
				return this;

			},
			getHexString() {

				return [ this.r, this.g, this.b ].map( ( x ) => Math.round( x * 255 ).toString( 16 ).padStart( 2, '0' ) ).join( '' );

			},
		} ).setHex( hex );

		const s = {
			windSpeed: 8, windDir: 210, choppiness: 1.1, swell: 0.35, fetch: 240,
			deepColor: '#04283a', scatter: colorLike( 0x2fa39b ), turbidity: 0.18, clarity: 22,
			foam: true, foamAmount: 0.45, foamDecay: 0.92, whitecaps: 0.4,
			shoreFoam: true, shoreBreak: 1.2, wetSand: 0.7, sand: '#d9c29a', caustics: 0.8, causticScale: 1.4,
			time: 17.4, timeScale: 60, advance: false, clouds: 0.35, fog: 0.0012, exposure: 0,
			camMode: 'third', fov: 62, lens: 'standard', sensitivity: 1, smoothing: 0.18, invertY: false,
			bloom: true, bloomStrength: 0.55, godRays: true, grade: 'filmic', vignette: 0.25, grain: 0.1, dof: false, focus: 12, lensDirt: false,
			quality: 'high', renderScale: 1, fftSize: 256, shadows: true, shadowRes: 2048,
		};
		const live = { fps: 60, frameMs: 16.7, gpuMs: 7.4 };
		const SEA = {
			Calm: { windSpeed: 2.5, choppiness: 0.6, swell: 0.12, foamAmount: 0.08, whitecaps: 0 },
			Breezy: { windSpeed: 8, choppiness: 1.1, swell: 0.35, foamAmount: 0.45, whitecaps: 0.4 },
			Choppy: { windSpeed: 14, choppiness: 1.5, swell: 0.55, foamAmount: 0.7, whitecaps: 0.75 },
			Storm: { windSpeed: 26, choppiness: 1.9, swell: 0.9, foamAmount: 1, whitecaps: 1 },
		};
		const log = ( name ) => ( v ) => console.debug( `[UI demo] ${ name }`, v );

		// Ocean
		const ocean = ui.addTab( 'ocean', 'Ocean', 'ocean' );
		const sea = ocean.addFolder( 'Sea state', { icon: 'wind' } );
		sea.addPresets( {
			label: 'Conditions', active: 'Breezy',
			presets: Object.keys( SEA ).map( ( k ) => ( { label: k, icon: k.toLowerCase(), apply: () => Object.assign( s, SEA[ k ] ) } ) ),
		} );
		sea.addSlider( { label: 'Wind speed', object: s, key: 'windSpeed', min: 0, max: 30, step: 0.1, unit: 'm/s', tooltip: 'Wind 10 m above the sea. Drives wave height and whitecaps.', onChange: log( 'windSpeed' ) } );
		sea.addSlider( { label: 'Wind direction', object: s, key: 'windDir', min: 0, max: 360, step: 1, unit: '°' } );
		sea.addSlider( { label: 'Choppiness', object: s, key: 'choppiness', min: 0, max: 2, step: 0.01 } );
		sea.addSlider( { label: 'Swell', object: s, key: 'swell', min: 0, max: 1, step: 0.01 } );
		sea.addSlider( { label: 'Fetch', object: s, key: 'fetch', min: 1, max: 2000, log: true, unit: 'km', tooltip: 'Distance the wind has blown over open water.' } );
		const water = ocean.addFolder( 'Water', { icon: 'droplet' } );
		water.addColor( { label: 'Deep color', object: s, key: 'deepColor', onChange: log( 'deepColor' ) } );
		water.addColor( { label: 'Scattering', object: s, key: 'scatter' } );
		water.addSlider( { label: 'Turbidity', object: s, key: 'turbidity', min: 0, max: 1, step: 0.01 } );
		water.addSlider( { label: 'Visibility', object: s, key: 'clarity', min: 1, max: 60, step: 0.5, unit: 'm' } );
		const foam = ocean.addFolder( 'Foam', { icon: 'foam', open: false } );
		const foamCtl = [];
		foam.addToggle( { label: 'Foam', object: s, key: 'foam', onChange: ( v ) => foamCtl.forEach( ( c ) => c.setEnabled( v ) ) } );
		foamCtl.push( foam.addSlider( { label: 'Coverage', object: s, key: 'foamAmount', min: 0, max: 1, step: 0.01 } ) );
		foamCtl.push( foam.addSlider( { label: 'Persistence', object: s, key: 'foamDecay', min: 0.5, max: 0.999, step: 0.001 } ) );
		const caps = foam.addFolder( 'Whitecaps', { open: false } );
		foamCtl.push( caps.addSlider( { label: 'Amount', object: s, key: 'whitecaps', min: 0, max: 1, step: 0.01 } ) );

		// Shore
		const shore = ui.addTab( 'shore', 'Shore', 'shore' );
		const surf = shore.addFolder( 'Surf', { icon: 'wave' } );
		surf.addToggle( { label: 'Shore foam', object: s, key: 'shoreFoam' } );
		surf.addSlider( { label: 'Breaking waves', object: s, key: 'shoreBreak', min: 0, max: 2, step: 0.05 } );
		const beach = shore.addFolder( 'Beach', { icon: 'palm' } );
		beach.addColor( { label: 'Sand', object: s, key: 'sand' } );
		beach.addSlider( { label: 'Wet sand', object: s, key: 'wetSand', min: 0, max: 1, step: 0.01 } );
		const light = shore.addFolder( 'Caustics', { icon: 'sun', open: false } );
		light.addSlider( { label: 'Intensity', object: s, key: 'caustics', min: 0, max: 2, step: 0.01 } );
		light.addSlider( { label: 'Scale', object: s, key: 'causticScale', min: 0.25, max: 4, log: true } );

		// Sky
		const sky = ui.addTab( 'sky', 'Sky', 'sky' );
		const sun = sky.addFolder( 'Sun', { icon: 'clock' } );
		sun.addTimeOfDay( { object: s, key: 'time', onChange: log( 'time' ) } );
		let scale = null;
		sun.addToggle( { label: 'Advance time', object: s, key: 'advance', onChange: ( v ) => scale.setVisible( v ) } );
		scale = sun.addSlider( { label: 'Time scale', object: s, key: 'timeScale', min: 1, max: 3600, log: true, unit: '×' } ).setVisible( false );
		const atmo = sky.addFolder( 'Atmosphere', { icon: 'cloud' } );
		atmo.addSlider( { label: 'Cloud cover', object: s, key: 'clouds', min: 0, max: 1, step: 0.01, format: ( v ) => `${ Math.round( v * 100 ) }%` } );
		atmo.addSlider( { label: 'Fog density', object: s, key: 'fog', min: 0.0001, max: 0.02, log: true } );
		atmo.addSlider( { label: 'Exposure', object: s, key: 'exposure', min: - 3, max: 3, step: 0.1, unit: 'EV' } );

		// Camera
		const cam = ui.addTab( 'camera', 'Camera', 'camera' );
		const view = cam.addFolder( 'View', { icon: 'camera' } );
		view.addSelect( { label: 'Boat camera', object: s, key: 'camMode', options: [ { label: '1st person', value: 'first' }, { label: '3rd person', value: 'third' }, { label: 'Free', value: 'free' } ] } );
		view.addSlider( { label: 'Field of view', object: s, key: 'fov', min: 30, max: 110, step: 1, unit: '°' } );
		view.addSelect( { label: 'Lens', object: s, key: 'lens', options: { 'Ultra wide 14 mm': 'uw', 'Wide 24 mm': 'wide', 'Standard 35 mm': 'standard', 'Portrait 85 mm': 'portrait', 'Telephoto 200 mm': 'tele' } } );
		const mouse = cam.addFolder( 'Mouse', { icon: 'mouse' } );
		mouse.addSlider( { label: 'Sensitivity', object: s, key: 'sensitivity', min: 0.1, max: 4, log: true, unit: '×' } );
		mouse.addSlider( { label: 'Smoothing', object: s, key: 'smoothing', min: 0, max: 0.5, step: 0.01, unit: 's' } );
		mouse.addToggle( { label: 'Invert vertical look', object: s, key: 'invertY' } );

		// Effects
		const fx = ui.addTab( 'effects', 'Effects', 'effects' );
		const post = fx.addFolder( 'Post-processing', { icon: 'sparkles' } );
		post.addToggle( { label: 'Bloom', object: s, key: 'bloom' } );
		post.addSlider( { label: 'Bloom strength', object: s, key: 'bloomStrength', min: 0, max: 2, step: 0.01 } );
		post.addToggle( { label: 'Sun shafts', object: s, key: 'godRays' } );
		post.addSelect( { label: 'Color grade', object: s, key: 'grade', options: { Neutral: 'neutral', Filmic: 'filmic', 'Golden hour': 'golden', Overcast: 'overcast', Tropical: 'tropical', Noir: 'noir' } } );
		post.addSlider( { label: 'Vignette', object: s, key: 'vignette', min: 0, max: 1, step: 0.01 } );
		post.addSlider( { label: 'Film grain', object: s, key: 'grain', min: 0, max: 0.5, step: 0.01 } );
		const lens = fx.addFolder( 'Lens', { icon: 'viewfinder', open: false } );
		lens.addToggle( { label: 'Depth of field', object: s, key: 'dof' } );
		lens.addSlider( { label: 'Focus distance', object: s, key: 'focus', min: 0.5, max: 500, log: true, unit: 'm' } );
		lens.addToggle( { label: 'Lens dirt', object: s, key: 'lensDirt' } );

		// Performance
		const perf = ui.addTab( 'performance', 'Performance', 'performance' );
		const stats = perf.addFolder( 'Live', { icon: 'gauge' } );
		stats.addInfo( { label: 'Frame rate', get: () => `${ live.fps.toFixed( 0 ) } fps` } );
		stats.addInfo( { label: 'Frame time', get: () => `${ live.frameMs.toFixed( 2 ) } ms` } );
		stats.addInfo( { label: 'GPU time', get: () => `${ live.gpuMs.toFixed( 2 ) } ms` } );
		stats.addInfo( { label: 'Significant wave height', get: () => `${ ( 0.0246 * s.windSpeed * s.windSpeed ).toFixed( 2 ) } m` } );
		stats.addInfo( { label: 'Render size', get: () => `${ Math.round( window.innerWidth * s.renderScale ) } × ${ Math.round( window.innerHeight * s.renderScale ) }` } );
		const quality = perf.addFolder( 'Quality', { icon: 'layers' } );
		quality.addSelect( { label: 'Preset', object: s, key: 'quality', options: { Low: 'low', Medium: 'medium', High: 'high', Ultra: 'ultra' } } );
		quality.addSlider( { label: 'Render scale', object: s, key: 'renderScale', min: 0.5, max: 2, step: 0.05, format: ( v ) => `${ Math.round( v * 100 ) }%` } );
		quality.addSelect( { label: 'Wave resolution', object: s, key: 'fftSize', options: [ 64, 128, 256, 512, 1024 ] } );
		let shadowRes = null;
		quality.addToggle( { label: 'Shadows', object: s, key: 'shadows', onChange: ( v ) => shadowRes.setEnabled( v ) } );
		shadowRes = quality.addSelect( { label: 'Shadow map', object: s, key: 'shadowRes', options: [ 1024, 2048, 4096 ] } );
		quality.addButton( { label: 'Apply recommended', icon: 'check', variant: 'primary', onClick: () => {

			Object.assign( s, { quality: 'high', renderScale: 1, fftSize: 256, shadows: true, shadowRes: 2048 } );
			shadowRes.setEnabled( true );
			ui.refresh();
			ui.toast( 'Recommended settings applied' );

		} } );
		quality.addButton( { label: 'Log settings to console', icon: 'info', onClick: () => console.table( s ) } );
		quality.addButton( { label: 'Reset all settings', icon: 'reset', variant: 'ghost', onClick: () => {

			ui.resetAll();
			ui.toast( 'All settings reset' );

		} } );

		// HUD: cycle through traversal modes so every contextual element shows up
		const MODES = [
			[ 'Boat · 3rd person', 'E', 'Leave boat' ],
			[ 'Boat · 1st person', 'V', 'Third-person camera' ],
			[ 'Walking', 'E', 'Board boat' ],
			[ 'Swimming', 'Space', 'Swim up' ],
			[ 'Diving', null, null ],
			[ 'Free camera', 'F', 'Leave free camera' ],
		];
		let mode = 0, next = 8, raf = 0;
		ui.setMode( MODES[ 0 ][ 0 ] );
		ui.setPrompt( MODES[ 0 ][ 1 ], MODES[ 0 ][ 2 ] );
		const t0 = performance.now();
		const loop = ( now ) => {

			// rAF timestamps can precede t0 by a frame
			const t = Math.max( 0, ( now - t0 ) / 1000 );
			if ( t >= next ) {

				mode = ( mode + 1 ) % MODES.length;
				next = t + 8;
				ui.setMode( MODES[ mode ][ 0 ] );
				ui.setPrompt( MODES[ mode ][ 1 ], MODES[ mode ][ 2 ] );

			}

			live.fps = 60 - Math.abs( Math.sin( t * 0.7 ) ) * 4 - ( Math.random() < 0.015 ? 22 : 0 );
			live.frameMs = 1000 / live.fps;
			live.gpuMs = live.frameMs * ( 0.55 + Math.sin( t * 0.3 ) * 0.05 );
			ui.setStats( live );

			const boat = MODES[ mode ][ 0 ].startsWith( 'Boat' );
			const thr = clamp( Math.sin( t * 0.35 ) * 0.65 + 0.35, - 1, 1 );
			ui.setBoatGauges( { visible: boat, speedKnots: Math.max( 0, thr ) * 26, rpm: clamp( 0.1 + Math.abs( thr ) * 0.9, 0, 1 ), throttle: thr, heading: ( 200 + t * 9 ) % 360 } );
			ui.setDepth( { visible: MODES[ mode ][ 0 ] === 'Diving', meters: 7 + Math.sin( t * 0.45 ) * 5 } );
			raf = requestAnimationFrame( loop );

		};

		raf = requestAnimationFrame( loop );
		ui.togglePanel( true );
		ui.toast( 'UI demo: every control is filled with sample data' );
		setTimeout( () => ui.toast( 'Press H to hide the panel, F1 for controls', 4000 ), 1200 );

		return () => {

			cancelAnimationFrame( raf );
			ui.setBoatGauges( { visible: false } );
			ui.setDepth( { visible: false } );
			ui.setPrompt( null );

		};

	}

}

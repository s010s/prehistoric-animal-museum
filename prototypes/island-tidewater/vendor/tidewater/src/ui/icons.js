// Inline SVG icon set for the Tidewater UI.
// 24×24 grid, 1.6 px strokes, round joins, currentColor. Unknown names fall back to a dot.

const WAVE_ROW = ( y, a = 2 ) => `<path d="M2 ${y}c1.67 0 1.67-${a} 3.33-${a}s1.67 ${a} 3.34 ${a} 1.66-${a} 3.33-${a} 1.67 ${a} 3.33 ${a} 1.67-${a} 3.34-${a} 1.66 ${a} 3.33 ${a}"/>`;

const PATHS = {

	// tabs
	wave: WAVE_ROW( 7 ) + WAVE_ROW( 12.5 ) + WAVE_ROW( 18 ),
	palm: '<path d="M12.5 21c-.4-4.2.2-8 1.8-11.2"/><path d="M14.3 9.8C13 7 10 6 7 7"/><path d="M14.3 9.8c.6-3 3.3-4.6 6.2-4"/><path d="M14.3 9.8c-3 .3-5.3 2.3-6 5"/><path d="M14.3 9.8c2.6.6 4.3 2.7 4.5 5.4"/><path d="M4 21h16"/>',
	sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
	camera: '<path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
	sparkles: '<path d="M11 3.5 12.6 8.4 17.5 10l-4.9 1.6L11 16.5l-1.6-4.9L4.5 10l4.9-1.6z"/><path d="M18.5 14.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
	gauge: '<path d="M4.5 18a9 9 0 1 1 15 0"/><path d="m12 13.5 3.5-4"/><circle cx="12" cy="13.5" r="1.2"/>',

	// chrome
	'chevron-down': '<path d="m6 9 6 6 6-6"/>',
	'chevron-right': '<path d="m9 6 6 6-6 6"/>',
	'chevron-left': '<path d="m15 6-6 6 6 6"/>',
	'chevrons-right': '<path d="m6 7 5 5-5 5M13 7l5 5-5 5"/>',
	close: '<path d="M6 6l12 12M18 6 6 18"/>',
	reset: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/>',
	panel: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M14.5 4.5v15M17 8.5h1.5M17 11.5h1.5"/>',
	help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.4"/><path d="M12 17h.01"/>',
	info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>',
	check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
	keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14h10"/>',
	mouse: '<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 7v3"/>',
	viewfinder: '<path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5"/><circle cx="12" cy="12" r="3"/>',
	sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
	play: '<path d="M7.5 4.5v15l12-7.5z"/>',
	pause: '<path d="M8 5v14M16 5v14"/>',
	volume: '<path d="M11 5 6.5 9H3.5v6h3L11 19z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
	mute: '<path d="M11 5 6.5 9H3.5v6h3L11 19z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
	eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
	clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
	bolt: '<path d="M13 2.5 5 13.5h6.5L11 21.5l8-11h-6.5z"/>',
	grid: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 9.2h17M3.5 14.8h17M9.2 3.5v17M14.8 3.5v17"/>',
	layers: '<path d="m12 3.5 9 4.5-9 4.5-9-4.5z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16 9 4.5 9-4.5"/>',
	cpu: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><path d="M9.5 9.5h5v5h-5zM9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>',
	monitor: '<rect x="3" y="4" width="18" height="12.5" rx="1.8"/><path d="M9 20h6M12 16.5V20"/>',
	palette: '<path d="M12 3a9 9 0 0 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.6-1-2.6 0-.9.7-1.5 1.7-1.5H17a4 4 0 0 0 4-4c0-4.5-4-8.2-9-8.2z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
	shadow: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M12 7h4.5M12 10.5h8M12 14h8M12 17.5h4.5"/>',

	// nature / world
	moon: '<path d="M12 3a6.5 6.5 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
	sunset: '<path d="M3 17.5h18"/><path d="M7 17.5a5 5 0 0 1 10 0"/><path d="M12 5v3.5M5.6 9.1l1.4 1.4M18.4 9.1 17 10.5M8.5 21h7"/>',
	cloud: '<path d="M7 18a4.5 4.5 0 1 1 .8-8.9A6 6 0 0 1 19 11a3.5 3.5 0 0 1-.5 7z"/>',
	wind: '<path d="M3 8.5h10a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 12.5h14.5a3 3 0 1 1-3 3"/><path d="M3 16.5h6"/>',
	droplet: '<path d="M12 3.5s6 6.2 6 10.5a6 6 0 0 1-12 0c0-4.3 6-10.5 6-10.5z"/>',
	foam: '<circle cx="8.5" cy="14.5" r="4"/><circle cx="16.5" cy="9" r="2.5"/><circle cx="16" cy="17" r="1.6"/><circle cx="9.5" cy="6" r="1.4"/>',
	mountain: '<path d="m3 19 6.5-11 4 6.5 2.5-3.5L21 19z"/>',
	compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8z"/>',
	anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M5 12H3a9 9 0 0 0 18 0h-2M8 10h8"/>',
	fog: '<path d="M4 8h13M3 12h18M6 16h14M9 20h7"/>',

	// sea states (preset chips)
	calm: '<path d="M8 13.5a4 4 0 0 1 8 0"/><path d="M3 16.5h18"/><path d="M7 20h10"/>',
	breezy: '<path d="M4 9.5h9a2 2 0 1 0-2-2"/>' + WAVE_ROW( 17, 2 ),
	choppy: '<path d="m2 10 2.5-3 2.5 3 2.5-3 2.5 3 2.5-3 2.5 3 2.5-3 2.5 3"/><path d="m2 16.5 2.5-3 2.5 3 2.5-3 2.5 3 2.5-3 2.5 3 2.5-3 2.5 3"/>',
	storm: '<path d="M7 16.5a4.2 4.2 0 1 1 .8-8.3A5.8 5.8 0 0 1 18.8 10a3.3 3.3 0 0 1 .2 6.5"/><path d="m13 12.5-2.5 4h3l-2.5 4"/>',

	// traversal modes
	walk: '<circle cx="13.5" cy="4.5" r="1.8"/><path d="M13 8 11.8 14"/><path d="M12.9 8.6 9.5 11M12.9 8.6l3.2 2.6"/><path d="M11.8 14 9.5 20.5M11.8 14l3 2.8.6 3.7"/>',
	swim: '<circle cx="16.5" cy="6.5" r="1.8"/><path d="M4.5 12.5 9 9l3.2 2.3L15 9.8"/>' + WAVE_ROW( 17, 1.5 ),
	dive: '<path d="M12 3v9"/><path d="m8.5 8.5 3.5 3.5 3.5-3.5"/>' + WAVE_ROW( 17, 1.5 ) + '<path d="M6 21h12"/>',
	boat: '<path d="M2.5 14.5h19l-2.6 4.5H5.4z"/><path d="M6.5 14.5v-3H14l2.5 3"/><path d="M9 11.5V9"/>',
	move: '<path d="M12 3v18M3 12h18"/><path d="m9.5 5.5 2.5-2.5 2.5 2.5M9.5 18.5l2.5 2.5 2.5-2.5M5.5 9.5 3 12l2.5 2.5M18.5 9.5 21 12l-2.5 2.5"/>',

	dot: '<circle cx="12" cy="12" r="3.5"/>',

};

const ALIASES = {
	ocean: 'wave', waves: 'wave', water: 'wave', sea: 'wave',
	shore: 'palm', beach: 'palm', island: 'palm', coast: 'palm',
	sky: 'sun', day: 'sun', light: 'sun', lighting: 'sun', atmosphere: 'sun',
	effects: 'sparkles', fx: 'sparkles', sparkle: 'sparkles', post: 'sparkles', bloom: 'sparkles', quality: 'sparkles',
	performance: 'gauge', perf: 'gauge', speed: 'gauge', fps: 'gauge', stats: 'gauge',
	photo: 'viewfinder', 'photo-mode': 'viewfinder', lens: 'viewfinder', aperture: 'viewfinder',
	settings: 'sliders', tune: 'sliders', controls: 'sliders',
	time: 'clock', 'time-of-day': 'clock',
	refresh: 'reset', undo: 'reset', 'rotate-ccw': 'reset',
	sound: 'volume', audio: 'volume', music: 'volume',
	terrain: 'mountain', gpu: 'cpu', display: 'monitor', screen: 'monitor', render: 'monitor',
	question: 'help', x: 'close', cam: 'camera', color: 'palette', colors: 'palette', grade: 'palette',
	walking: 'walk', swimming: 'swim', diving: 'dive', underwater: 'dive',
	free: 'move', 'free-camera': 'move', fly: 'move', drone: 'move',
	bubbles: 'foam', spray: 'foam', clouds: 'cloud', weather: 'cloud', rain: 'storm',
	night: 'moon', dusk: 'sunset', dawn: 'sunset', sunrise: 'sunset',
	heading: 'compass', navigation: 'compass', harbor: 'anchor', dock: 'anchor', pier: 'anchor',
	haze: 'fog', mist: 'fog', shadows: 'shadow', lightning: 'bolt', energy: 'bolt',
};

export function hasIcon( name ) {

	return !! PATHS[ ALIASES[ name ] || name ];

}

// Returns an inline <svg> string. Raw '<svg…' strings pass through untouched.
export function icon( name, className = '' ) {

	if ( typeof name === 'string' && name.trim().startsWith( '<svg' ) ) return name;
	const body = PATHS[ ALIASES[ name ] || name ] || PATHS.dot;
	return `<svg class="tw-ico${className ? ' ' + className : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

}

// Brand mark: a low sun over a swell line inside a ring. Gradient ids are
// suffixed so several marks can coexist in one document.
let brandId = 0;
export function brandMark( className = '' ) {

	const id = `tw-bm-${ ++ brandId }`;
	return `<svg class="tw-mark${className ? ' ' + className : ''}" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
		<defs>
			<linearGradient id="${id}-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a8fbf1"/><stop offset="1" stop-color="#3fb4d6"/></linearGradient>
			<linearGradient id="${id}-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd8a6"/><stop offset="1" stop-color="#ff9f5a"/></linearGradient>
		</defs>
		<circle cx="16" cy="16" r="14" fill="none" stroke="url(#${id}-a)" stroke-width="1.4" opacity=".55"/>
		<circle cx="16" cy="13" r="4.2" fill="url(#${id}-s)"/>
		<path d="M5.5 18.5c2.1 0 2.9-2.6 5.2-2.6s3.1 2.6 5.3 2.6 3.1-2.6 5.3-2.6 3 2.6 5.2 2.6" fill="none" stroke="url(#${id}-a)" stroke-width="2" stroke-linecap="round"/>
		<path d="M8.5 23c1.6 0 2.2-1.8 3.9-1.8s2.3 1.8 3.9 1.8 2.3-1.8 3.9-1.8 2.2 1.8 3.8 1.8" fill="none" stroke="url(#${id}-a)" stroke-width="1.6" stroke-linecap="round" opacity=".6"/>
	</svg>`;

}

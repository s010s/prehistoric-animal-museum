import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
export const SR = 48000;
// decode -> array of Float32Array channels at 48 kHz
export function decode( file, ch = 1, from = 0, dur = 0, filters = '' ) {
	const args = [ '-v', 'error' ];
	if ( from ) args.push( '-ss', String( from ) );
	if ( dur ) args.push( '-t', String( dur ) );
	args.push( '-i', file );
	if ( filters ) args.push( '-af', filters );
	args.push( '-ac', String( ch ), '-ar', String( SR ), '-f', 'f32le', '-' );
	const buf = execFileSync( 'ffmpeg', args, { maxBuffer: 1 << 30 } );
	const all = new Float32Array( buf.buffer, buf.byteOffset, buf.length / 4 );
	const n = all.length / ch;
	const out = [];
	for ( let c = 0; c < ch; c ++ ) {
		const a = new Float32Array( n );
		for ( let i = 0; i < n; i ++ ) a[ i ] = all[ i * ch + c ];
		out.push( a );
	}
	return out;
}
export function writeWav( file, chans ) {
	const ch = chans.length, n = chans[ 0 ].length;
	const b = Buffer.alloc( 44 + n * ch * 4 );
	b.write( 'RIFF', 0 ); b.writeUInt32LE( 36 + n * ch * 4, 4 ); b.write( 'WAVE', 8 ); b.write( 'fmt ', 12 );
	b.writeUInt32LE( 16, 16 ); b.writeUInt16LE( 3, 20 ); b.writeUInt16LE( ch, 22 ); b.writeUInt32LE( SR, 24 );
	b.writeUInt32LE( SR * ch * 4, 28 ); b.writeUInt16LE( ch * 4, 32 ); b.writeUInt16LE( 32, 34 ); b.write( 'data', 36 ); b.writeUInt32LE( n * ch * 4, 40 );
	for ( let i = 0; i < n; i ++ ) for ( let c = 0; c < ch; c ++ ) b.writeFloatLE( chans[ c ][ i ], 44 + ( i * ch + c ) * 4 );
	fs.writeFileSync( file, b );
}
export function env( x, win = 240 ) { // RMS envelope, one value per `win` samples
	const n = Math.floor( x.length / win ), e = new Float32Array( n );
	for ( let k = 0; k < n; k ++ ) { let s = 0; for ( let i = k * win; i < ( k + 1 ) * win; i ++ ) s += x[ i ] * x[ i ]; e[ k ] = Math.sqrt( s / win ); }
	return e;
}
export const db = ( v ) => 20 * Math.log10( Math.max( v, 1e-9 ) );
export function peak( chans ) { let p = 0; for ( const c of chans ) for ( const v of c ) p = Math.max( p, Math.abs( v ) ); return p; }
export function rms( chans ) { let s = 0, n = 0; for ( const c of chans ) { for ( const v of c ) s += v * v; n += c.length; } return Math.sqrt( s / n ); }
export function gain( chans, g ) { for ( const c of chans ) for ( let i = 0; i < c.length; i ++ ) c[ i ] *= g; return chans; }
export function lufs( file ) { // integrated loudness via ffmpeg ebur128
	const r = execFileSync( 'ffmpeg', [ '-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-' ], { stdio: [ 'ignore', 'pipe', 'pipe' ] } );
	return r;
}
export function lufsOf( file ) {
	try {
		const out = execFileSync( 'sh', [ '-c', `ffmpeg -hide_banner -nostats -i "${ file }" -af ebur128=peak=true -f null - 2>&1 | grep -A12 Summary` ] ).toString();
		const I = Number( ( out.match( /I:\s+(-?[\d.]+) LUFS/ ) || [] )[ 1 ] );
		const LRA = Number( ( out.match( /LRA:\s+(-?[\d.]+) LU/ ) || [] )[ 1 ] );
		const TP = Number( ( out.match( /Peak:\s+(-?[\d.]+) dBFS/ ) || [] )[ 1 ] );
		return { I, LRA, TP };
	} catch ( e ) { return { I: NaN }; }
}
// equal-power crossfaded loop: segment [0, L+X) -> length L, tail crossfaded into head
export function makeLoop( chans, L, X ) {
	return chans.map( ( s ) => {
		const o = new Float32Array( L );
		for ( let i = 0; i < L; i ++ ) o[ i ] = s[ i ];
		for ( let i = 0; i < X; i ++ ) {
			const t = ( i + 0.5 ) / X;
			o[ i ] = s[ i ] * Math.sin( t * Math.PI / 2 ) + s[ L + i ] * Math.cos( t * Math.PI / 2 );
		}
		return o;
	} );
}
export function fade( chans, inS, outS ) {
	for ( const c of chans ) {
		const n = c.length;
		for ( let i = 0; i < Math.min( inS, n ); i ++ ) c[ i ] *= Math.sin( ( i / inS ) * Math.PI / 2 ) ** 2;
		for ( let i = 0; i < Math.min( outS, n ); i ++ ) c[ n - 1 - i ] *= Math.sin( ( i / outS ) * Math.PI / 2 ) ** 2;
	}
	return chans;
}
export function encode( wav, out, kbps, ch ) {
	execFileSync( 'ffmpeg', [ '-v', 'error', '-y', '-i', wav, '-ac', String( ch ), '-c:a', 'libopus', '-b:a', kbps + 'k', '-vbr', 'on', '-application', 'audio', out ] );
}
// onset/event detection on a mono signal. returns [{s, e, pk}] in samples
export function events( x, { from = 0, to = Infinity, minGap = 0.25, maxLen = 0.5, minLen = 0.06, thrDb = 12, relEnd = 30, pre = 0.012 } = {} ) {
	const W = 240, e = env( x, W );
	const k0 = Math.floor( from * SR / W ), k1 = Math.min( e.length, Math.floor( to * SR / W ) );
	const seg = Array.from( e.slice( k0, k1 ) ).sort( ( a, b ) => a - b );
	const floor = Math.max( seg[ Math.floor( seg.length * 0.2 ) ], 1e-5 );
	const thr = floor * 10 ** ( thrDb / 20 );
	const out = [];
	let k = k0, last = - 1e9;
	while ( k < k1 ) {
		if ( e[ k ] > thr && ( k - last ) * W / SR > minGap ) {
			let pk = 0, kp = k;
			const kmax = Math.min( k1, k + Math.floor( maxLen * SR / W ) );
			for ( let j = k; j < Math.min( kmax, k + 30 ); j ++ ) if ( e[ j ] > pk ) { pk = e[ j ]; kp = j; }
			const endThr = Math.max( floor * 2, pk * 10 ** ( - relEnd / 20 ) );
			let ke = kp;
			while ( ke < kmax && ! ( e[ ke ] < endThr && e[ ke + 1 ] < endThr && e[ ke + 2 ] < endThr ) ) ke ++;
			const s = Math.max( 0, k * W - Math.floor( pre * SR ) ), en = ke * W;
			if ( ( en - s ) / SR >= minLen ) out.push( { s, e: en, pk, t: s / SR, len: ( en - s ) / SR, pkDb: db( pk ) } );
			last = k; k = ke + 1;
		} else k ++;
	}
	return { list: out, floorDb: db( floor ) };
}
// BS.1770 K-weighting (48 kHz coefficients) + loudness helpers
function biq( x, b0, b1, b2, a1, a2 ) { const y = new Float32Array( x.length ); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for ( let i = 0; i < x.length; i ++ ) { const v = b0 * x[ i ] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[ i ]; y2 = y1; y1 = v; y[ i ] = v; } return y; }
export function kw( x ) { return biq( biq( x, 1.53512485958697, - 2.69169618940638, 1.19839281085285, - 1.69065929318241, 0.73248077421585 ), 1.0, - 2.0, 1.0, - 1.99004745483398, 0.99007225036621 ); }
// momentary (400 ms) loudness series of summed channels (100 ms hop)
export function momentary( chans ) {
	const k = chans.map( kw ), n = k[ 0 ].length, win = 19200, hop = 4800, out = [];
	for ( let s = 0; s + win <= Math.max( n, win ); s += hop ) { let ms = 0; for ( const c of k ) { for ( let i = s; i < Math.min( n, s + win ); i ++ ) ms += c[ i ] * c[ i ]; } out.push( - 0.691 + 10 * Math.log10( ms / win + 1e-12 ) ); }
	return out;
}

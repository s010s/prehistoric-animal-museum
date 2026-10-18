// node search.mjs "query" [pages]  -> CC0-only Freesound results: id user duration title
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const q = process.argv[ 2 ], pages = Number( process.argv[ 3 ] || 1 );
for ( let p = 1; p <= pages; p ++ ) {
	const url = `https://freesound.org/search/?q=${ encodeURIComponent( q ) }&f=license:%22Creative+Commons+0%22&page=${ p }`;
	const h = await ( await fetch( url, { headers: { 'User-Agent': UA } } ) ).text();
	const re = /data-sound-id="(\d+)"\s+data-username="([^"]+)"[\s\S]*?data-title="([^"]*)"\s+data-duration="([\d.]+)"[\s\S]*?data-num-downloads="(\d+)"/g;
	const seen = new Set();
	let m;
	while ( ( m = re.exec( h ) ) ) {
		if ( seen.has( m[ 1 ] ) ) continue;
		seen.add( m[ 1 ] );
		console.log( `${ m[ 1 ] }:${ m[ 2 ] }  ${ Number( m[ 4 ] ).toFixed( 1 ) }s  dl ${ m[ 5 ] }  ${ m[ 3 ] }` );
	}
	if ( ! seen.size ) console.log( '(no parse)', h.length, ( h.match( /sounds\/\d+/g ) || [] ).slice( 0, 5 ) );
}

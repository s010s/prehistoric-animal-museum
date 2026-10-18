// node dl.mjs id:user ...  -> raw/<id>.ogg + raw/<id>.json (title, author, license, url, description)
import fs from 'node:fs';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const items = process.argv.slice( 2 ).map( ( s ) => s.split( ':' ) );
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
async function one( [ id, user ] ) {
	if ( fs.existsSync( `raw/${ id }.ogg` ) ) return `${ id } cached`;
	const url = `https://freesound.org/people/${ user }/sounds/${ id }/`;
	let h = '';
	for ( let k = 0; k < 4; k ++ ) {
		h = await ( await fetch( url, { headers: { 'User-Agent': UA } } ) ).text();
		if ( h.includes( 'data-ogg' ) ) break;
		await sleep( 1500 );
	}
	const g = ( k ) => ( h.match( new RegExp( k + '="([^"]*)"' ) ) || [] )[ 1 ];
	const ogg = ( g( 'data-ogg' ) || '' ).replace( '-lq.ogg', '-hq.ogg' );
	if ( ! ogg ) return `${ id } FAILED page`;
	const lic = ( h.match( /href="(https?:\/\/creativecommons\.org\/[^"]+)"/ ) || [] )[ 1 ] || '?';
	const licName = ( h.match( /(Creative Commons 0|Attribution NonCommercial[^<]*|Attribution [0-9.]+|Attribution)/ ) || [] )[ 1 ] || '?';
	const desc = ( ( h.match( /<div id="soundDescriptionSection"[\s\S]*?<\/div>/ ) || h.match( /<meta name="description" content="([^"]*)"/ ) || [ '' ] )[ 0 ] ).replace( /<[^>]+>/g, ' ' ).replace( /\s+/g, ' ' ).trim().slice( 0, 900 );
	const title = g( 'data-title' );
	const buf = Buffer.from( await ( await fetch( ogg, { headers: { 'User-Agent': UA } } ) ).arrayBuffer() );
	fs.writeFileSync( `raw/${ id }.ogg`, buf );
	fs.writeFileSync( `raw/${ id }.json`, JSON.stringify( { id, user, title, url, preview: ogg, license: lic, licName, desc }, null, 1 ) );
	return `${ id } ${ user } ${ ( buf.length / 1e6 ).toFixed( 2 ) }MB ${ licName } ${ lic } | ${ title }`;
}
const out = [];
for ( let i = 0; i < items.length; i += 3 ) {
	const r = await Promise.all( items.slice( i, i + 3 ).map( ( it ) => one( it ).catch( ( e ) => `${ it[ 0 ] } ERR ${ e.message }` ) ) );
	for ( const s of r ) console.log( s );
	await sleep( 400 );
}

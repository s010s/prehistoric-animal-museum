// Tidewater's peeling crests use a coordinate in metres along the wavefront.
// Projecting kilometre-scale positions onto a direction that turns between
// adjacent texels shreds the front. This chart stays fixed as the swell bends.
// The existing tidal outlet keeps its authored phase throughout the inner bank.
export function coastalAlong(x, z) {
  const dx = x + 550;
  const outer = Math.max(Math.abs(dx) - 700, 0);
  return z + .09 * dx + .82 * outer * outer / (outer + 950);
}

// Unresolved short-period sea and refracted energy still reach lee shores.
// Keep calm water in the island shadow while allowing a small breaking face.
export function coastalExposure(raw) {
  if (raw <= 0) return 0;
  const swell = Math.min(1, raw * 1.4);
  return swell + .32 * (1 - swell) ** 2;
}

// A wave index is shared with the audio scheduler. Integer mixing also avoids
// a different wave height on JS and WGSL sin() implementations far from zero.
function waveHash(m) {
  let h = Math.imul(m | 0, 1597334677) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0;
  return ((h ^ (h >>> 13)) >>> 8) / 16777216;
}

function coastalBar(along) {
  const w = Math.sin(along * .021 + 1.9) * 1.4 + Math.sin(along * .009 + .3) * .9;
  const width = .8 + Math.sin(along * .017 + 4.1) * .08;
  const t = Math.max(0, Math.min(1, (Math.sin(along * .059 + w) - width) / (.985 - width)));
  const rip = t * t * (3 - 2 * t);
  const bar = .9 + (Math.sin(along * .031 + 7.3) * .6 + Math.sin(along * .083 + 1.1) * .4) * .14;
  return { rip, strength: bar * (1 - rip * .58) };
}

export function coastalWaveWobble(along) {
  return Math.sin(along * .029 + .7) * .07 + Math.sin(along * .083 + 2.1) * .035 +
    Math.sin(along * .19 + .4) * .022 + Math.sin(along * .37 + 2.6) * .011 + coastalBar(along).rip * .045;
}

export function coastalWaveAmplitude(m, along, amplitude, variation) {
  const set = Math.abs(Math.sin(m * Math.PI / 7)) * .6 + .55;
  const warp = Math.sin(along * .016 + m * .9) * 1.6;
  const shoulders = Math.sin(along * .062 + m * 1.7 + warp) * .6 +
    Math.sin(along * .13 + m * 4.1 + 1.3 - warp * .7) * .4;
  const short = Math.sin(along * .29 + m * 2.3 + warp * .5) * .6 +
    Math.sin(along * .47 + m * 5.9 + .8) * .4;
  return Math.max(.02, amplitude * set *
    (1 + (waveHash(m) * 2 - 1) * variation * .5 + (shoulders + short * .28) * variation * .7) *
    coastalBar(along).strength);
}

export const coastalClimateWGSL = `
fn museumCoastalAlong(p:vec2f)->f32{
 let dx=p.x+550.0;let outer=max(abs(dx)-700.0,0.0);
 return p.y+.09*dx+.82*outer*outer/(outer+950.0);
}
// The lee-side wave carries less height as it reaches the bar. Its lip
// must not break at the same depth as a fully exposed plunging wave.
fn museumBreakerScale(e:f32)->f32{return sqrt(clamp(e*1.4,0.0,1.0));}
fn museumCoastalField(f:vec4f)->vec4f{
 let e=length(f.yz);
 if(e<=.00001||f.x>=10000.0){return f;}
 let swell=min(e*1.4,1.0);let lee=1.0-swell;
 let magnitude=max(e,(swell+.32*lee*lee)/1.4);
 return vec4f(f.x,f.yz*(magnitude/e),f.w);
}
`;

export function installCoastalPhase(shore) {
  const along = 'let along = dot( xz, vec2f( - dir.y, dir.x ) );';
  const hash = 'return fract( sin( x * 127.1 + 311.7 ) * 43758.5453 );';
  const foam = 'o.foam = s0.z * env * mix( 0.3, 1.0, wwPatch );';
  if (![along,hash,foam].every(text=>shore.module.code.includes(text))) throw Error('Tidewater crest phase changed');
  shore.module.code = shore.module.code.replace(along, 'let along = museumCoastalAlong(xz);')
    .replaceAll('let A0 = shoreWaveAmp( m, along );','let A0 = shoreWaveAmp( m, along )*museumBreakerScale(exposure);')
    .replaceAll('let An = shoreWaveAmp( m + sign( u ), along );','let An = shoreWaveAmp( m + sign( u ), along )*museumBreakerScale(exposure);')
    .replace('let A = shoreWaveAmp( m, ph.along );','let A = shoreWaveAmp( m, ph.along )*museumBreakerScale(ph.exposure);')
    // A long, shallow bar may carry several already-broken bores. They spend
    // energy as they run in. Inject fresh air principally at the collapsing
    // shoulders, then let the native advection carry and disperse that foam.
    .replaceAll(foam,`o.foam=s0.z*env*mix(.30,1.0,wwPatch);
    if(o.foam>.0){
      let ordinary=smoothstep(320.0,425.0,distance(xz,vec2f(-875.0,125.0)))*
        (1.0-museumMainTidalWeight(xz));
      let packet=.53*wwPatch+.25*sin(along*.071+m*1.7+sin(along*.027))+
        .14*sin(along*.23+m*.91)+.10;
      let shoulder=smoothstep(.10,.67,packet);
      let spent=smoothstep(.95,3.45,s0.w);
      let injection=mix(.09,.98,shoulder)*mix(1.0,.40,spent);
      o.foam=mix(o.foam,s0.z*env*injection,ordinary);
    }`)
    .replace(hash, `var h=bitcast<u32>(i32(x))*1597334677u;
      h=(h^(h>>16u))*2246822519u;
      return f32((h^(h>>13u))>>8u)/16777216.0;`);
}

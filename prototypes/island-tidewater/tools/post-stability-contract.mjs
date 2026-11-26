// Stabilize half-res GTAO across near and far distances without modifying
// vendor/tidewater/:
// 1. Upgrade aoDepth to r32float (eliminating FP16 depth stair-steps on
//    distant mountains) and downsample with the 2x2 lower-median depth so
//    jittering sub-pixel grass blades and needles don't flash 2.2m AO halos.
// 2. Make GTAO temporally deterministic (no per-frame white noise or dead
//    out-of-radius steps), guard depth-normal reconstruction against NaN, and
//    fade smoothly into baked terrain AO before half-res depth turns coarse.
// 3. Make aoBlurX/Y slope-aware (planar bilateral) so grazing near slopes get
//    full 5x5 denoising without halo bleeding across real depth edges.
// 4. Prevent negative Lanczos-2 weights from stamping a dot grid in TAAU at
//    renderScale <= 0.7.
function replaceOnce(code, original, updated) {
  if (code.split(original).length !== 2) throw Error('Pinned post stability contract changed: ' + original.slice(0, 60));
  return code.replace(original, updated);
}

export function postStabilityContract() {
  return {
    name: 'museum-post-stability-contract',
    enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/vendor/tidewater/src/post/PostFX.js')) {
        code = replaceOnce(
          code,
          "this.aoDepth = new RenderTarget( 1, 1, { colors: [ 'r16float' ], label: 'aoDepth' } );",
          "this.aoDepth = new RenderTarget( 1, 1, { colors: [ 'r32float' ], label: 'aoDepth' } );",
        );
        code = replaceOnce(
          code,
          `\t\tthis._aoDepthPass = new FullscreenPass( {
\t\t\tlabel: 'AO depth',
\t\t\tcolorFormats: [ 'r16float' ],
\t\t\tbindings: { aoFullDepth: { texture: () => this.opaqueDepth }, aoFinalDepth: { texture: () => this.finalDepth } },
\t\t\tcode: /* wgsl */\`
// negative where the water covers the opaque surface: its AO is never shown (the beauty pass skips
// covered pixels), so GTAO leaves those texels alone; everything else reads the magnitude
fn fragment( in: FSIn ) -> vec4f {
\tlet s = vec2i( textureDimensions( aoFullDepth ) );
\tlet p = min( vec2i( in.pos.xy ) * 2, s - 1 );
\tlet d = textureLoad( aoFullDepth, p, 0 );
\tlet covered = textureLoad( aoFinalDepth, p, 0 ) > d + 1e-7;
\treturn vec4f( select( d, - d, covered ), 0.0, 0.0, 1.0 );
}
\`,
\t\t} );`,
          `\t\tthis._aoDepthPass = new FullscreenPass( {
\t\t\tlabel: 'AO depth',
\t\t\tcolorFormats: [ 'r32float' ],
\t\t\tbindings: { aoFullDepth: { texture: () => this.opaqueDepth }, aoWaterMask: { texture: () => sceneRenderer.waterMaskTexture } },
\t\t\tcode: /* wgsl */\`
// Lower-median (2nd-smallest in reversed-Z = 2nd-farthest) of the 2x2 full-res
// block: suppresses single-pixel foliage/needle pops under TAA jitter while
// preserving solid silhouettes and smooth continuous terrain slopes. Only mark
// full water blocks as covered so late-pass grass blades never toggle terrain AO.
fn fragment( in: FSIn ) -> vec4f {
\tlet s = vec2i( textureDimensions( aoFullDepth ) ) - vec2i( 1 );
\tlet p0 = min( vec2i( in.pos.xy ) * 2, s );
\tlet p1 = min( p0 + vec2i( 1, 0 ), s );
\tlet p2 = min( p0 + vec2i( 0, 1 ), s );
\tlet p3 = min( p0 + vec2i( 1, 1 ), s );
\tlet d0 = textureLoad( aoFullDepth, p0, 0 );
\tlet d1 = textureLoad( aoFullDepth, p1, 0 );
\tlet d2 = textureLoad( aoFullDepth, p2, 0 );
\tlet d3 = textureLoad( aoFullDepth, p3, 0 );
\tlet loA = min( d0, d1 ); let hiA = max( d0, d1 );
\tlet loB = min( d2, d3 ); let hiB = max( d2, d3 );
\tlet d = min( max( loA, loB ), min( hiA, hiB ) );
\tlet w0 = textureLoad( aoWaterMask, p0, 0 ).g > 0.5;
\tlet w1 = textureLoad( aoWaterMask, p1, 0 ).g > 0.5;
\tlet w2 = textureLoad( aoWaterMask, p2, 0 ).g > 0.5;
\tlet w3 = textureLoad( aoWaterMask, p3, 0 ).g > 0.5;
\tlet covered = w0 && w1 && w2 && w3;
\treturn vec4f( select( d, - d, covered ), 0.0, 0.0, 1.0 );
}
\`,
\t\t} );`,
        );
        code = replaceOnce(
          code,
          `\t\tconst aoBlur = ( src, dx, dy ) => {

\t\t\tlet taps = '';
\t\t\tfor ( let k = - 2; k <= 2; k ++ ) taps += /* wgsl */\`
\t{
\t\tlet uvK = in.uv + vec2f( \${ dx * k }.0, \${ dy * k }.0 ) / size;
\t\tlet rel = abs( postDepthOpaque( uvK ) - dC ) / max( dC, 1e-7 );
\t\tlet w = 1.0 / pow2( rel * 40.0 + 1.0 );
\t\tsum += textureSampleLevel( aoSrc, smpLinearClamp, uvK, 0.0 ).r * w;
\t\twSum += w;
\t}\`;
\t\t\treturn new FullscreenPass( {
\t\t\t\tlabel: 'AO blur ' + ( dx ? 'x' : 'y' ),
\t\t\t\tcolorFormats: [ 'r16float' ],
\t\t\t\t// the half resolution depth copy (one texel per AO texel): the full resolution depth taps
\t\t\t\t// were mostly cache misses
\t\t\t\tbindings: { aoSrc: { texture: src }, postAODepth: { texture: () => this.aoDepth.texture } },
\t\t\t\tcode: /* wgsl */\`
fn postDepthOpaque( uv: vec2f ) -> f32 {
\tlet s = vec2i( textureDimensions( postAODepth ) );
\treturn abs( textureLoad( postAODepth, clamp( vec2i( floor( uv * vec2f( s ) ) ), vec2i( 0 ), s - 1 ), 0 ).r );
}
fn fragment( in: FSIn ) -> vec4f {
\tlet size = vec2f( textureDimensions( aoSrc ) );
\tlet dC = postDepthOpaque( in.uv );
\tvar sum = 0.0; var wSum = 0.0;
\${ taps }
\treturn vec4f( sum / wSum, 0.0, 0.0, 1.0 );
}
\`,
\t\t\t} );

\t\t};`,
          `\t\tconst aoBlur = ( src, dx, dy ) => {

\t\t\tlet taps = '';
\t\t\tconst gauss = [ 0.25, 0.65, 1.0, 0.65, 0.25 ];
\t\t\tfor ( let k = - 2; k <= 2; k ++ ) taps += /* wgsl */\`
\t{
\t\tlet uvK = in.uv + vec2f( \${ dx * k }.0, \${ dy * k }.0 ) / size;
\t\tlet dT = postDepthOpaque( uvK );
\t\tlet dExp = max( dC + slope * \${ k }.0, 0.0 );
\t\tlet rel = abs( dT - dExp ) / max( dC, 1e-7 );
\t\tlet w = \${ gauss[ k + 2 ] } / pow2( rel * 28.0 + 1.0 );
\t\tsum += textureSampleLevel( aoSrc, smpLinearClamp, uvK, 0.0 ).r * w;
\t\twSum += w;
\t}\`;
\t\t\treturn new FullscreenPass( {
\t\t\t\tlabel: 'AO blur ' + ( dx ? 'x' : 'y' ),
\t\t\t\tcolorFormats: [ 'r16float' ],
\t\t\t\tbindings: { aoSrc: { texture: src }, postAODepth: { texture: () => this.aoDepth.texture } },
\t\t\t\tcode: /* wgsl */\`
fn postDepthOpaque( uv: vec2f ) -> f32 {
\tlet s = vec2i( textureDimensions( postAODepth ) );
\treturn abs( textureLoad( postAODepth, clamp( vec2i( floor( uv * vec2f( s ) ) ), vec2i( 0 ), s - 1 ), 0 ).r );
}
fn fragment( in: FSIn ) -> vec4f {
\tlet size = vec2f( textureDimensions( aoSrc ) );
\tlet stepUv = vec2f( \${ dx }.0, \${ dy }.0 ) / size;
\tlet dC = postDepthOpaque( in.uv );
\tlet dM1 = postDepthOpaque( in.uv - stepUv );
\tlet dP1 = postDepthOpaque( in.uv + stepUv );
\tlet slope = select( dP1 - dC, dC - dM1, abs( dC - dM1 ) < abs( dP1 - dC ) );
\tvar sum = 0.0; var wSum = 0.0;
\${ taps }
\treturn vec4f( clamp( sum / max( wSum, 1e-5 ), 0.0, 1.0 ), 0.0, 0.0, 1.0 );
}
\`,
\t\t\t} );

\t\t};`,
        );
        return { code, map: null };
      }

      if (id.endsWith('/vendor/tidewater/src/post/GTAO.js')) {
        code = replaceOnce(
          code,
          '\treturn normalize( cross( dpdx, dpdy ) );',
          '\tlet nRaw = cross( dpdx, dpdy );\n\tlet nLen = length( nRaw );\n\treturn select( vec3f( 0.0, 0.0, 1.0 ), nRaw / nLen, nLen > 1e-12 );',
        );
        code = replaceOnce(
          code,
          `\t// Sidestep the nearest-rounding during depth access for the unjittered center pixel to avoid banding
\tvar depth: f32;
\tif ( gtao.resolutionScaleU < 1.0 ) {
\t\tlet g = abs( textureGather( \${ this.depthIsColor ? '0, ' : '' }gtaoDepth, smpNearestClamp, uvNode ) );
\t\tdepth = min( min( g.x, g.y ), min( g.z, g.w ) );
\t} else {
\t\tdepth = gtaoSampleDepth( uvNode );
\t}`,
          `\tvar depth: f32;
\t\${ this.depthIsColor
\t\t? 'depth = gtaoSampleDepth( uvNode );'
\t\t: 'if ( gtao.resolutionScaleU < 1.0 ) { let g = abs( textureGather( gtaoDepth, smpNearestClamp, uvNode ) ); depth = min( min( g.x, g.y ), min( g.z, g.w ) ); } else { depth = gtaoSampleDepth( uvNode ); }' }`,
        );
        code = replaceOnce(
          code,
          `\tlet viewPosition = gtaoViewPosition( uvNode, depth );
\tlet viewNormal = gtaoNormalFromDepth( uvNode );
\tlet radius = gtao.radius;`,
          `\tlet viewPosition = gtaoViewPosition( uvNode, depth );
\tlet radius = gtao.radius;
\tlet viewDist = max( - viewPosition.z, 1e-4 );
\tlet screenRadiusPx = radius * abs( gtao.proj[ 1 ][ 1 ] ) * 0.5 * gtao.resolution.y / viewDist;
\tlet radiusFade = min( smoothstep( 5.0, 14.0, screenRadiusPx ), 1.0 - smoothstep( 65.0, 145.0, viewDist ) );
\tif ( radiusFade <= 0.0 ) { return vec4f( 1.0 ); }
\tlet viewNormal = gtaoNormalFromDepth( uvNode );`,
        );
        // Remove per-frame white noise and out-of-radius dead steps, start at
        // >= 1.35 half-res texels so flat slopes never self-occlude, and add a
        // small horizon-angle bias against depth-reconstructed normal noise.
        code = replaceOnce(
          code,
          `\t// Per-step phase jitter for spatio-temporal decorrelation.
\tlet noiseJitterIdx = gtao.temporalDirection * 0.02;
\tlet stepJitter = interleavedGradientNoise( in.pos.xy + gtao.temporalOffset ) + gtaoRand( ( uvNode + noiseJitterIdx ) * 2.0 - 1.0 );

\t// Each iteration analyzes one vertical "slice" of the 3D space around the fragment.
\tfor ( var i = 0; i < GTAO_DIRECTIONS; i++ ) {
\t\tlet angle = f32( i ) / f32( GTAO_DIRECTIONS ) * PI + gtao.temporalDirection;`,
          `\t// Deterministic spatial-only step phase in (0.10, 0.90); start beyond 1.35 texels
\t// so flat terrain slopes never self-occlude or boil under TAA sub-pixel jitter.
\tlet stepJitter = mix( 0.10, 0.90, interleavedGradientNoise( in.pos.xy ) );
\tlet minT = sqrt( clamp( 1.35 / max( screenRadiusPx, 1.35 ), 0.0, 0.85 ) );

\t// Each iteration analyzes one vertical "slice" of the 3D space around the fragment.
\tfor ( var i = 0; i < GTAO_DIRECTIONS; i++ ) {
\t\tlet angle = f32( i ) / f32( GTAO_DIRECTIONS ) * PI;`,
        );
        code = replaceOnce(
          code,
          '\t\t\tlet t = ( f32( j ) + 1.0 + stepJitter ) * invSteps;',
          '\t\t\tlet t = mix( minT, 1.0, ( f32( j ) + stepJitter ) * invSteps );',
        );
        code = replaceOnce(
          code,
          '\t\t\tlet sHX = dot( viewDir, viewDeltaX ) / max( lenX, 0.0001 );',
          '\t\t\tlet sHX = dot( viewDir, viewDeltaX ) / max( lenX, 0.0001 ) - 0.04;',
        );
        code = replaceOnce(
          code,
          '\t\t\tlet sHY = dot( viewDir, viewDeltaY ) / max( lenY, 0.0001 );',
          '\t\t\tlet sHY = dot( viewDir, viewDeltaY ) / max( lenY, 0.0001 ) - 0.04;',
        );
        code = replaceOnce(
          code,
          `\tao = pow( ao, gtao.scale );
\treturn vec4f( ao, 0.0, 0.0, 1.0 );`,
          `\tao = mix( 1.0, pow( ao, gtao.scale ), radiusFade );
\treturn vec4f( ao, 0.0, 0.0, 1.0 );`,
        );
        return { code, map: null };
      }

      if (id.endsWith('/vendor/tidewater/src/post/TemporalUpscale.js')) {
        code = replaceOnce(
          code,
          'let maxKernelWeight = min( 1.99, 1.0 + ( 1.0 / downscale.x - 1.0 ) );',
          'let maxKernelWeight = min( 1.15, 1.0 + ( 1.0 / downscale.x - 1.0 ) );',
        );
        code = replaceOnce(
          code,
          `\tif ( upsampledWeight > TAAU_EPS ) {
\t\t// deringing: the Lanczos lobes can't leave the neighbourhood's range
\t\tupsampled = clamp( colorSum / upsampledWeight, aabbMin, aabbMax );
\t\tupsampledWeight *= TAAU_LANCZOS_WEIGHT_SCALE;
\t}`,
          `\tif ( upsampledWeight > TAAU_EPS ) {
\t\t// deringing: the Lanczos lobes can't leave the neighbourhood's range
\t\tupsampled = clamp( colorSum / upsampledWeight, aabbMin, aabbMax );
\t\tupsampledWeight *= TAAU_LANCZOS_WEIGHT_SCALE;
\t} else {
\t\tupsampled = clamp( boxCenter, aabbMin, aabbMax );
\t\tupsampledWeight = TAAU_AVG_LANCZOS_WEIGHT_PER_FRAME;
\t}`,
        );
        return { code, map: null };
      }

      return null;
    },
  };
}

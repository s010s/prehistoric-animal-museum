// Reuse the native velocity attachment and reactive history for fast,
// alpha-blended detail. Velocity.xy still carries motion; z carries coverage.
function replaceOnce(code, original, updated) {
  if (code.split(original).length !== 2) throw Error('Pinned temporal coverage contract changed');
  return code.replace(original, updated);
}

export function temporalCoverageContract() {
  return {
    name: 'museum-temporal-coverage-contract',
    enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/vendor/tidewater/src/engine/render/MeshShader.js')) {
        return { code: replaceOnce(code, 'out.velocity = vec4f( r.velocity.xy * a, 0.0, a );',
          'out.velocity = vec4f( r.velocity.xy * a, r.velocity.z, a );'), map: null };
      }
      if (!id.endsWith('/vendor/tidewater/src/post/TemporalUpscale.js')) return null;

      code = replaceOnce(code, 'let historyUV = uv - velocity;', `let historyUV = uv - velocity;
  let currentBlendCoverage = sat( textureLoad( taauVelocity, clamp( closestTap, vec2i( 0 ), vs - 1 ), 0 ).z );
  var previousBlendCoverage = 0.0;`);
      code = replaceOnce(code, 'temporalReactive = sat( abs( ls.z ) );', `let historyReactive = abs( ls.z );
    previousBlendCoverage = sat( historyReactive - 1.0 );
    temporalReactive = select( sat( historyReactive ), 0.0, historyReactive > 1.0 );`);
      code = replaceOnce(code, 'var thisFrameReactive = temporalReactive;', `let blendReactivity = max( currentBlendCoverage, previousBlendCoverage );
  var thisFrameReactive = max( temporalReactive, blendReactivity );`);
      code = replaceOnce(code, 'var outColor: vec3f;', `if ( blendReactivity > 0.0 ) {
    accumulation = min( accumulation, upsampledWeight * ( 1.0 - blendReactivity ) );
  }
  var outColor: vec3f;`);
      code = replaceOnce(code, 'out.lock = vec4f( lockStatus, newReactive,', `// Native history is in [-1, 1]; higher values carry one frame of blended coverage.
  if ( currentBlendCoverage > 0.0 ) {
    newReactive = 1.0 + 2.0 * currentBlendCoverage;
  } else if ( previousBlendCoverage > 0.0 ) {
    newReactive = sign( newReactive ) * min( abs( newReactive ), 0.25 );
  }
  out.lock = vec4f( lockStatus, newReactive,`);
      return { code, map: null };
    },
  };
}

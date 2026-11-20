// Apply the camera sample offset after projection. Folding it into the world
// matrix loses part of a pixel when the large island coordinates cancel.
const original = `\to.clip = frame.viewProj * vec4f( wp, 1.0 );
#if PASS_MAIN
\to.curClip = frame.viewProjNoJitter * vec4f( wp, 1.0 );
\to.prevClip = frame.prevViewProjNoJitter * vec4f( pwp, 1.0 );
#endif`;

const stable = `#if !PASS_MAIN || !MUSEUM_CLIP_SPACE_JITTER
\to.clip = frame.viewProj * vec4f( wp, 1.0 );
#endif
#if PASS_MAIN
\to.curClip = frame.viewProjNoJitter * vec4f( wp, 1.0 );
#if MUSEUM_CLIP_SPACE_JITTER
\to.clip = vec4f( o.curClip.xy + frame.jitter * o.curClip.w, o.curClip.zw );
#endif
\to.prevClip = frame.prevViewProjNoJitter * vec4f( pwp, 1.0 );
#endif`;

export function meshJitterContract() {
  return {name:'museum-mesh-jitter-contract', enforce:'pre', transform(code, id) {
    if (id.endsWith('/vendor/tidewater/src/engine/render/MeshShader.js')) {
      if (code.split(original).length !== 2) throw Error('Pinned mesh jitter contract changed');
      return {code:code.replace(original, stable), map:null};
    }
    if (id.endsWith('/vendor/tidewater/src/engine/render/SceneRenderer.js')) {
      const mainPass = "depthFormat: DEPTH_FORMAT, kind: 'main' }";
      if (code.split(mainPass).length !== 2) throw Error('Pinned scene main pass changed');
      return {code:code.replace(mainPass, "depthFormat: DEPTH_FORMAT, kind: 'main', defines: this.mainPassDefines }"), map:null};
    }
    return null;
  }};
}

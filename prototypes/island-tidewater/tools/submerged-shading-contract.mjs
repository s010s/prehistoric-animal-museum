// Application integration seam for Tidewater 4811ba48 (MIT).
// Its main-pass deep-bed shortcut assumes every water ray uses refraction.
// Museum inland/sea compositions can legitimately fall back to opaque colour;
// those receivers must retain their real substrate. Keep upstream bytes intact.
export function submergedShadingContract() {
  return {name:'museum-submerged-shading-contract',enforce:'pre',transform(code,id){
    if(!id.endsWith('/vendor/tidewater/src/engine/render/MeshShader.js'))return null;
    const guard='#if PASS_MAIN && !PASS_LATE && LIT && !IS_WATER && !ALPHA_TEST && !STUDIO_LIGHTING';
    if(code.split(guard).length!==3)throw Error('Pinned submerged shader contract changed');
    return {code:code.replaceAll(guard,guard+' && !MUSEUM_FULL_SUBMERGED_SHADING'),map:null};
  }};
}

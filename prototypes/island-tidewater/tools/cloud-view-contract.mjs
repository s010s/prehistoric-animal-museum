// Narrow extension of the pinned native update. Its underwater branch already
// invalidates view history while retaining the panorama, shadows and weather.
export function cloudViewContract() {
 return {name:'museum-cloud-view-contract',enforce:'pre',transform(code,id){
  if(!id.endsWith('/vendor/tidewater/src/sky/SkyProClouds.js'))return null;
  const branch='if ( underwater ) {';
  if(code.split(branch).length!==2)throw Error('Pinned cloud view contract changed');
  return {code:code.replace(branch,'if ( underwater || this.isViewHidden?.( camera ) ) {')
   .replace('// the sky is only seen through Snell\'s window (panorama)',
    '// The view is unseen; retain the panorama for indirect sky queries.'),map:null};
 }};
}

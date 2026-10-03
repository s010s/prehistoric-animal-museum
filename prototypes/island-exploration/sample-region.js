// Authored desktop sample. All terrain, ecology, route and collision consumers
// use this one geography version. No northern-source or main-river relocation.
export const REGION_VERSION = 'side-spring-woodland-v1';
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp((x-a)/(b-a)); return t*t*(3-2*t); };
export function regionWeight(x,z) {
  return smooth(-960,-830,z)*(1-smooth(-440,-340,z))*smooth(-2370,-2280,x)*(1-smooth(-1870,-1790,x));
}

// Three unequal headlands, recessed drainage and a low bench. The parent ridge
// survives at the outside shoulder; the local giant wall is actually recut.
export function sculptRegion(x,z,h,riverX,riverLevel,halfWidth,noise) {
  const mask = regionWeight(x,z); if (!mask) return h;
  const west = riverX(z)-x-halfWidth(z);
  if (west<5) return h;
  const foot = riverLevel(z)+.45+Math.max(0,west)*.15;
  const bench = (8+2.5*noise(x/29,z/43))*smooth(22,37,west);
  const heads = 30*Math.exp(-1*((z+808)/59)**2)+40*Math.exp(-1*((z+604)/63)**2)+24*Math.exp(-1*((z+463)/48)**2);
  const face = heads*smooth(57+6*Math.sin(z/39),70+6*Math.sin(z/39),west);
  const shoulder = Math.max(0,west-116)*.42;
  const bedding = (noise(x/13,z/21)-.5)*3.1*smooth(45,80,west);
  const seepShoulder = 4.4*Math.exp(-1*((z+731)/22)**2)*smooth(26,37,west)*(1-smooth(72,106,west));
  const target = foot+bench+face+shoulder+bedding+seepShoulder;
  const outer = 1-smooth(205,310,west);
  return h+(target-h)*mask*outer;
}

// A narrow creek loop: enter beside the upper pool, descend to the lower
// stream, visit the clearing's side and rear, and return on the creekward path.
// The start is a camera pose, not a series of teleports. Coordinates in metres.
export const REGION_ROUTE = {
  id:'side-spring-loop',version:REGION_VERSION,seconds:225,
  points:[[-2047,-714],[-2054,-721],[-2043,-708],[-2030,-691],[-2012,-676],[-1998,-651],[-1981,-625],[-1979,-586],[-1983,-564],[-1978,-549],[-1964,-546],[-1957,-566],[-1968,-590],[-1989,-625],[-1997,-668],[-2010,-675],[-2028,-681],[-2042,-698],[-2047,-714]],
  gaze:[[-2051,-720,31],[-2051,-720,30.5],[-2048,-712,28],[-2038,-700,25],[-2004,-665,17],[-1980,-634,22],[-1949,-605,26],[-1969,-560,25],[-1969,-560,24.5],[-1969,-560,25],[-1969,-560,25],[-1969,-560,25],[-1949,-605,26],[-1999,-624,17],[-2010,-675,16],[-2022,-681,20],[-2032,-693,24],[-2045,-708,27],[-2051,-720,31]],
};
export const REGION_PATHS = [REGION_ROUTE.points, [[-2042,-714],[-2055,-710],[-2059,-722],[-2058,-733]]];
function distanceToRun(x,z,points) {
  let distance=Infinity;
  for(let i=1;i<points.length;i++) {const [ax,az]=points[i-1],[bx,bz]=points[i],dx=bx-ax,dz=bz-az,t=clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)); distance=Math.min(distance,Math.hypot(x-ax-dx*t,z-az-dz*t));}
  return distance;
}
export const regionPathDistance = (x,z) => Math.min(...REGION_PATHS.map(p=>distanceToRun(x,z,p)));
export const regionPathWeight = (x,z) => 1-smooth(.85,2.35,regionPathDistance(x,z));

// Keep the canopy open at the seep, at the two animal pads and over the path.
export function regionOpening(x,z,treeRadius=0) {
  if (!regionWeight(x,z)) return false;
  if (regionPathDistance(x,z)<2.5+treeRadius*.36) return true;
  return Math.hypot((x+2045)/27,(z+708)/26)<1+treeRadius*.015 ||
    Math.hypot((x+1969)/37,(z+560)/31)<1+treeRadius*.015 ||
    Math.hypot((x+1949)/18,(z+605)/17)<1+treeRadius*.015;
}

// Bake this small distance field once at startup. Evaluating every path segment
// in every terrain pixel made the first open-woodland candidate too expensive.
export function regionPathField(size=512){
  const data=new Float32Array(size*size);
  for(let z=0;z<size;z++)for(let x=0;x<size;x++)data[z*size+x]=regionPathDistance(-2130+x/(size-1)*320,-785+z/(size-1)*320);
  return {data,size};
}
export const regionPathGLSL = `
uniform sampler2D regionTrailDistance;
float regionTrail(vec2 p){vec2 uv=(p-vec2(-2130.,-785.))/320.;
if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return 0.;
float d=texture2D(regionTrailDistance,uv*(511./512.)+.5/512.).r;
return 1.-smoothstep(.85,2.35,d);}
`;

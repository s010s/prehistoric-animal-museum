// Museum-owned old-growth stand. Openings and cohorts stay fixed in the world.
import {ShaderModule} from '../vendor/tidewater/src/engine/gpu/Shader.js';
export const GROVE={center:[1400,-2120],inner:520,outer:820,zScale:.88,near:190,margin:34,matureTarget:1800,
 path:[[1360,-2090],[1378,-2102],[1390,-2098],[1407,-2097],[1430,-2094],[1465,-2069],[1490,-2128],[1520,-2200],[1530,-2260],[1510,-2320],[1435,-2300],[1372,-2220],[1360,-2090]],
 gaps:[{center:[1410,-2096],radius:[15,20]},{center:[1524,-2265],radius:[24,20]}],
 clearing:[1410,-2096],heroes:[{x:1390,z:-2116,height:68,seed:.31,yaw:1.1},{x:1446,z:-2128,height:63,seed:.72,yaw:3.8},
 {x:1458,z:-2180,height:84,seed:.43,yaw:2.4,search:true},{x:1570,z:-2276,height:88,seed:.18,yaw:.6,search:true},{x:1390,z:-2352,height:82,seed:.55,yaw:2.1,search:true},{x:1295,z:-2245,height:76,seed:.84,yaw:1.4,search:true},{x:1685,z:-2150,height:80,seed:.68,yaw:3.2,search:true},{x:1336,z:-2145,height:82,seed:.94,yaw:4.5,search:true}],
 scientificStatus:'Wet giant-conifer forest ecological analogy; larger emergents use living old-growth scale, not a measured fossil forest reconstruction'};
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function groveWeight(x,z){return 1-smooth(GROVE.inner,GROVE.outer,Math.hypot(x-GROVE.center[0],(z-GROVE.center[1])*GROVE.zScale));}
export function grovePathDistance(x,z){let d=1e9;for(let i=1;i<GROVE.path.length;i++){const a=GROVE.path[i-1],b=GROVE.path[i],vx=b[0]-a[0],vz=b[1]-a[1],u=Math.max(0,Math.min(1,((x-a[0])*vx+(z-a[1])*vz)/(vx*vx+vz*vz)));d=Math.min(d,Math.hypot(x-a[0]-u*vx,z-a[1]-u*vz));}return d;}
export function groveOpening(x,z){return Math.max(...GROVE.gaps.map(g=>1-smooth(.65,1.2,Math.hypot((x-g.center[0])/g.radius[0],(z-g.center[1])/g.radius[1]))));}
export function grovePatch(x,z){return .5+.27*Math.sin(x*.043+Math.sin(z*.031)*1.7)+.18*Math.sin(z*.067+x*.019);}
export const groveModule=new ShaderModule({name:'museumOldGrowth',code:`
fn museumGroveWeight(p:vec2f)->f32{return 1.0-smoothstep(${GROVE.inner}.0,${GROVE.outer}.0,length((p-vec2f(1400.0,-2120.0))*vec2f(1.0,${GROVE.zScale})));}
fn museumGroveSegment(p:vec2f,a:vec2f,b:vec2f)->f32{let ab=b-a;return length(p-a-ab*clamp(dot(p-a,ab)/dot(ab,ab),0.0,1.0));}
fn museumGrovePath(p:vec2f)->f32{
 var d=10000.0;
 ${GROVE.path.slice(1).map((b,i)=>{const a=GROVE.path[i];return `d=min(d,museumGroveSegment(p,vec2f(${a[0]}.0,${a[1]}.0),vec2f(${b[0]}.0,${b[1]}.0)));`;}).join('\n')}
 return d;
}
fn museumGroveOpening(p:vec2f)->f32{var w=0.0;${GROVE.gaps.map(g=>`w=max(w,1.0-smoothstep(.65,1.2,length((p-vec2f(${g.center[0]}.0,${g.center[1]}.0))/vec2f(${g.radius[0]}.0,${g.radius[1]}.0))));`).join('')}return w;}
fn museumGrovePatch(p:vec2f)->f32{return .5+.27*sin(p.x*.043+sin(p.y*.031)*1.7)+.18*sin(p.y*.067+p.x*.019);}
fn museumGroveFloor(p:vec2f)->vec3f{
 let w=museumGroveWeight(p);if(w<=.001){return vec3f(0.0);}
 let path=1.0-smoothstep(1.5,3.4,museumGrovePath(p));let open=museumGroveOpening(p);
 return vec3f(w,max(path,open*.7),clamp(museumGrovePatch(p),0.0,1.0));
}
`});

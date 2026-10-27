// One root-anchored WORLD shear for geometry, proxy and depth. Unlike a local
// offset it keeps its direction across instance yaw/nonuniform scale. An affine
// approximation admits an exact inverse for the static atlas's camera rays.
// A modest <0.63 degree envelope makes slow canopy motion legible against the
// 280m/2048 shadow grid. This changes displacement, not shadow antialiasing.
// Compile-time constants apply to near geometry, depth, proxy and CPU audits.
export const treeWindConfig=Object.freeze({amplitudeMultiplier:4,frequencyMultiplier:1,flutterMultiplier:1});
const slopeX=.002*treeWindConfig.amplitudeMultiplier,slopeZ=.0007*treeWindConfig.amplitudeMultiplier;
export const treeWindFieldGLSL=`
vec3 treeWindSlope(vec3 root){
 float gust=sin(treeTime*.61+root.x*.031+root.z*.024)+.32*sin(treeTime*1.37+root.z*.071);
 return vec3(gust*${slopeX},0.,sin(treeTime*.47+root.z*.029)*${slopeZ});
}`;
export const treeWindGLSL=treeWindFieldGLSL+`
vec3 treeWindOffset(vec3 p,vec3 root,float leaf,mat3 worldBasis){
 float height=max(0.,p.y);
 vec3 worldPoint=worldBasis*p;
 vec3 offset=inverse(worldBasis)*(treeWindSlope(root)*worldPoint.y);
 float flutter=sin(treeTime*2.7+root.x*.17+p.x*2.3+p.z*3.1)*sin(treeTime*1.9+p.y*1.7);
 offset+=vec3(.014,.005,.009)*flutter*leaf*smoothstep(1.,5.,height);
 return offset;
}`;

// Deterministic reference for evidence checks, never per-tree CPU animation.
export function treeWindSlopeAt(root,time){
 const gust=Math.sin(time*.61+root[0]*.031+root[2]*.024)+.32*Math.sin(time*1.37+root[2]*.071);
 return [gust*slopeX,0,Math.sin(time*.47+root[2]*.029)*slopeZ];
}
export function bendTreePoint(point,root,time){
 const slope=treeWindSlopeAt(root,time),height=point[1]-root[1];
 return point.map((v,i)=>v+slope[i]*height);
}
export function unbendTreeDirection(direction,slope){
 return direction.map((v,i)=>v-slope[i]*direction[1]);
}

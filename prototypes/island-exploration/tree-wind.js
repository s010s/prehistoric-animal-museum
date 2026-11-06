// Root-anchored bend follows Tidewater's squared-height sway. The colour and
// shadow passes evaluate the same displacement; leaf flutter is spatially phased.
export const treeWindGLSL=`
vec3 treeWindOffset(vec3 p,vec3 root,float leaf){
 float height=max(0.,p.y),bend=height*min(1.,height/18.);
 float gust=sin(treeTime*.61+root.x*.031+root.z*.024)+.32*sin(treeTime*1.37+root.z*.071);
 vec3 offset=vec3(gust*bend*.002,0.,sin(treeTime*.47+root.z*.029)*bend*.0007);
 float flutter=sin(treeTime*2.7+root.x*.17+p.x*2.3+p.z*3.1)*sin(treeTime*1.9+p.y*1.7);
 offset+=vec3(.014,.005,.009)*flutter*leaf*smoothstep(1.,5.,height);
 return offset;
}`;

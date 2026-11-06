// Small-radius depth occlusion anchors stones and vegetation to the riverbank.
// Uses the existing opaque depth buffer, with no second geometry pass.
export const contactOcclusionGLSL=`
uniform mat4 inverseProjection;uniform vec2 screenSize;
vec3 viewPoint(vec2 uv){float d=texture2D(sceneDepth,uv).r;vec4 p=inverseProjection*vec4(uv*2.-1.,d*2.-1.,1.);return p.xyz/p.w;}
float contactAO(vec2 uv){vec3 p=viewPoint(uv);if(-p.z>350.)return 1.;
 vec3 px=viewPoint(uv+vec2(1./screenSize.x,0.))-p,py=viewPoint(uv+vec2(0.,1./screenSize.y))-p;vec3 n=normalize(cross(px,py));if(n.z<0.)n=-n;
 vec2 radius=vec2(1./inverseProjection[0][0],1./inverseProjection[1][1])*1.8/max(2.,-p.z)*.5;float occ=0.;
 for(int i=0;i<12;i++){float f=float(i),angle=f*2.399963;vec2 offset=vec2(cos(angle),sin(angle))*radius*(.22+.78*(f+.5)/12.);vec3 delta=viewPoint(clamp(uv+offset,.001,.999))-p;float len=length(delta);occ+=max(0.,dot(n,delta)/max(.01,len)-.12)*(1.-smoothstep(.15,2.4,len));}
 return 1.-min(.48,occ/12.*2.3)*(1.-smoothstep(170.,350.,-p.z));}
`;

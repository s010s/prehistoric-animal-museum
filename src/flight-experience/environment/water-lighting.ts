/** GGX alpha is slope roughness (perceptual roughness squared). F0=.02 for water.
 * Unresolved slopes and screen derivatives add variance to alpha squared.
 * This is the direct-light BRDF times N.L, not a second reflected solar disc.
 */
export const WATER_LIGHTING_GLSL = `
float waterSun(vec3 n,vec3 v,vec3 l,float variance){
 float nl=dot(n,l),nv=dot(n,v);if(nl<=0.||nv<=0.||l.y<=0.)return 0.;
 vec3 sum=v+l;if(dot(sum,sum)<.000001)return 0.;vec3 h=normalize(sum);
 float nh=max(0.,dot(n,h)),vh=max(0.,dot(v,h));
 float a2=clamp(.00024+variance,.00024,.25);
 float d=nh*nh*(a2-1.)+1.;float D=a2/(3.14159265*max(d*d,.000001));
 float gv=2.*nv/(nv+sqrt(a2+(1.-a2)*nv*nv));
 float gl=2.*nl/(nl+sqrt(a2+(1.-a2)*nl*nl));
 float F=.02+.98*pow(1.-vh,5.);
 return F*D*gv*gl/max(4.*nv,.0001);
}`

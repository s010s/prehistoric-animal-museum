// Authored pool/riffle succession, in metres and approximate m/s. Shared by
// terrain, surface motion and obstacles; independent of camera and quality.
const bell=(z,c,w)=>Math.exp(-1*((z-c)/w)**2)
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x))
export function riverReach(z){
 let depth=2.8+.5*Math.sin(z/417+.8)
 for(const[c,w,a]of[[-2520,130,2.2],[-1750,150,2],[-1120,100,2.7],[-665,95,3],[-210,100,2.2],[650,140,2.4],[1480,180,2.8]])depth+=bell(z,c,w)*a
 for(const[c,w,a]of[[-2250,80,1.4],[-1370,70,1.25],[-875,65,1.3],[-420,68,1.6],[180,95,1.35],[970,100,1.35]])depth-=bell(z,c,w)*a
 depth=clamp(depth,1.05,6.2)
 const speed=clamp(2.1/depth,.32,2.2)
 return {depth,speed,agitation:clamp((2.6-depth)/1.8,0,1)}
}
export function obstacleFlow(x,z,base,rocks){let ux=base[0],uz=base[1],foam=0;const speed=Math.hypot(...base),vx=base[0]/Math.max(.01,speed),vz=base[1]/Math.max(.01,speed)
 for(const r of rocks){const qx=x-r.x,qz=z-r.z,rr=r.radius*.8,d2=qx*qx+qz*qz,along=qx*vx+qz*vz,across=qx*vz-qz*vx
  if(d2<rr*rr*32){const d=Math.max(d2,rr*rr),a=rr*rr/d;ux+=a*base[0]-2*a*qx*(qx*base[0]+qz*base[1])/d;uz+=a*base[1]-2*a*qz*(qx*base[0]+qz*base[1])/d}
  if(along>-rr*2&&along<rr*15){const wake=Math.exp(-Math.max(0,along)/(rr*5.5))*clamp((along+rr)/(rr*2),0,1)*Math.exp(-((across/(rr*.65+Math.max(0,along)*.11))**2)),rim=Math.exp(-1*((Math.sqrt(d2)-rr)/(rr*.22))**2)*clamp(-along/rr+.2,0,1);foam=Math.max(foam,(wake*.8+rim*.55)*(r.strength??1));const curl=Math.sin(along/(rr*1.4))*wake*.22*speed;ux+=vz*curl;uz-=vx*curl}
 }
 const len=Math.hypot(ux,uz);if(len>3){ux*=3/len;uz*=3/len}return {velocity:[ux,uz],foam:clamp(foam,0,1)}
}

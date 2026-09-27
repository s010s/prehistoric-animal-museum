import {terrainHeight,smooth,bankAt,riverLevel,noise,waterLevelAt,tributaryX,tributaryLevel,tributaryWidth} from './field.js'

export function surfaceSample(x,z){
 const h=terrainHeight(x,z),dx=terrainHeight(x-2,z)-terrainHeight(x+2,z),dz=terrainHeight(x,z-2)-terrainHeight(x,z+2),len=Math.hypot(dx,4,dz)
 const steep=1-4/len,rock=Math.max(smooth(.18,.48,steep),smooth(920,1250,h)*.4),bank=bankAt(x,z),r=riverLevel(z)
 const main=(1-smooth(75,220,bank))*(1-smooth(3900,4100,Math.abs(z))),tb=Math.abs(x-tributaryX(z))-tributaryWidth(z)
 const tributary=(1-smooth(55,150,tb))*smooth(100,500,z)*(1-smooth(4900,5300,z))
 const sedimentHeight=1.3+2.1*noise(x/150,z/185),shore=(1-smooth(r+.15,r+sedimentHeight,h))*main,ts=(1-smooth(tributaryLevel(z)+.1,tributaryLevel(z)+sedimentHeight,h))*tributary
 const sand=(1-rock)*Math.max(1-smooth(2,13,h),shore,ts)
 const shade=(.88+.12*noise(x/70,z/70))*(1-.19*smooth(.3,.65,noise(x/270,z/340))*(1-smooth(1020,1240,h))*smooth(12,50,h))
 return [h,dx/len,4/len,dz/len,rock,sand,1-rock-sand,shade,waterLevelAt(x,z)].map(Math.fround)
}

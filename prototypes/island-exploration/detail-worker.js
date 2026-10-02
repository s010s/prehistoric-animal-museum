import {makeGrassRenderPacket} from './grass-render-packet.js'
import {springAt,springOrigin,forestSpring} from './spring.js'
import {hash,noise,terrainHeight,slopeAt,bankAt,riverX,halfWidth,riverLevel,waterLevelAt,biomeAt,woodland} from './field.js'
import {trailWeight,trailX} from './habitat.js'
const rand=(i,n)=>hash(i*1.71+n*14.19,n*7.38-i*.31)
// Coordinates and identities belong to fixed world cells; moving the window never reseeds plants.
self.onmessage=e=>{const workerStart=performance.now();const {requestId,cx,cz,fine,habitat,rockWidth,fernHeight}=e.data;const rocks=[],pebbles=[],ferns=[],grass=[],reeds=[],debris=[],litter=[];
 const forestCache=new Map(),forestAt=(x,z)=>{const gx=Math.floor(x/8),gz=Math.floor(z/8),key=gx+","+gz;if(!forestCache.has(key))forestCache.set(key,woodland(gx*8,gz*8));return forestCache.get(key)};
 for(let gz=Math.floor((cz-185)/10);gz<=Math.ceil((cz+185)/10);gz++)for(let gx=Math.floor((cx-185)/10);gx<=Math.ceil((cx+185)/10);gx++){
 const i=gx*1973+gz*7919;if(!fine&&hash(gx,gz)>.60)continue;
 const x=(gx+.1+hash(gx+1,gz)*.8)*10,z=(gz+.1+hash(gz+2,gx)*.8)*10,y=terrainHeight(x,z),b=bankAt(x,z),s=slopeAt(x,z),water=waterLevelAt(x,z);
 if(y<-3||s<.7)continue;const bank=b>-12&&b<40;
 if(bank||y>water+.5&&rand(i,92)>.84){const radius=.25+rand(i,23)**3*3.1;rocks.push({x,z,y:y-radius*.28,scale:radius*2/rockWidth,yaw:rand(i,24)*6.28,sy:.55+rand(i,25)*.5,tint:.68+rand(i,26)*.4});pebbles.push({x:x+.3,z:z+.4,y:y-.06,scale:.09+rand(i,27)*.23,yaw:rand(i,28)*6.28,sy:.45,tint:.7+rand(i,29)*.5})}
 if(y>water+.35&&trailWeight(x,z)<.1&&s>.73&&(b>7&&b<200||woodland(x,z)>.25)&&rand(i,30)<.72)ferns.push({x,z,y:y-.06,scale:(.9+rand(i,31)**2*1.8)/fernHeight,yaw:rand(i,32)*6.28,tint:.72+rand(i,33)*.3});
 }
 for(let row=Math.floor((cz-160)/3);row<=Math.ceil((cz+160)/3);row++)for(let column=0;column<(fine?10:5);column++){
 const i=row*97+column,z=row*3+rand(i,61)*2,side=column%2?1:-1,x=riverX(z)+side*(halfWidth(z)-1+rand(i,62)**1.8*20);if(z< -3890||Math.hypot(x-cx,z-cz)>190)continue;
 const y=terrainHeight(x,z),radius=.12+rand(i,63)**2*.65;rocks.push({x,z,y:y-radius*.18,scale:radius*2/rockWidth,yaw:rand(i,64)*6.28,sy:.55+rand(i,65)*.55,tint:.75+rand(i,66)*.55});
 if(column%3===0&&y>riverLevel(z)+.1)ferns.push({x:x+side*3,z,y:terrainHeight(x+side*3,z)-.1,scale:(.65+rand(i,67)*.8)/fernHeight,yaw:rand(i,68)*6.28,tint:.76+rand(i,69)*.25});
 }
 // Fern colonies fill moist trail margins in coherent, varied-height patches.
 for(let gz=Math.floor((cz-70)/3.6);gz<=Math.ceil((cz+70)/3.6);gz++)for(let gx=Math.floor((cx-70)/3.6);gx<=Math.ceil((cx+70)/3.6);gx++){
 const x=(gx+hash(gx+9,gz))*3.6,z=(gz+hash(gz+7,gx))*3.6,d=Math.abs(x-trailX(z));
 if(z< -1550||z>300||d<2.5||d>40||noise(x/13,z/17)<.37||hash(gx,gz)>.62)continue;
 const y=terrainHeight(x,z);if(y<waterLevelAt(x,z)+.25||slopeAt(x,z)<.75)continue;
 ferns.push({x,z,y:y-.025,scale:(.48+hash(gx+1,gz)**2*.86)/fernHeight,yaw:hash(gz,gx)*6.28,tint:.94+hash(gx,gz+2)*.35});
 }
 // Fine stones interrupt the smooth path without impeding the walking surface.
 for(let gz=Math.floor((cz-40)/1.2);gz<=Math.ceil((cz+40)/1.2);gz++)for(let k=0;k<5;k++){
 const z=(gz+hash(gz,k))*1.2,x=trailX(z)+(hash(k,gz)-.5)*7;
 if(z< -1540||z>260||Math.hypot(x-cx,z-cz)>46||hash(gz+17,k)<.58)continue;
 const y=terrainHeight(x,z);pebbles.push({x,z,y:y-.014,scale:.035+hash(k+3,gz)**2*.14,sy:.35+hash(gz,k+7)*.4,yaw:hash(gz,k)*6.28,tint:.8+hash(gz,k+1)*.4});
 }
 // Small fallen twigs and stones remain tied to world cells, not camera distance.
 for(let gz=Math.floor((cz-65)/3.7);gz<=Math.ceil((cz+65)/3.7);gz++)for(let gx=Math.floor((cx-65)/3.7);gx<=Math.ceil((cx+65)/3.7);gx++){
 const x=(gx+hash(gx,gz))*3.7,z=(gz+hash(gz,gx))*3.7,b=bankAt(x,z);if(b<9||b>180||z<-1650||z>430||hash(gx+17,gz)<.62)continue;
 const y=terrainHeight(x,z),s=slopeAt(x,z);if(y<waterLevelAt(x,z)+.4||s<.78)continue;const yaw=hash(gx,gz+41)*6.28,len=.4+hash(gz,gx+21)*1.4;
 const rise=terrainHeight(x+Math.cos(yaw)*len*.5,z-Math.sin(yaw)*len*.5)-terrainHeight(x-Math.cos(yaw)*len*.5,z+Math.sin(yaw)*len*.5);
 debris.push({x,z,y:y+.015,scale:len,yaw,roll:Math.atan2(rise,len),tint:.7+hash(gx+22,gz)*.5});
 if(hash(gx-3,gz)>.7)pebbles.push({x:x+.5,z,y:y-.015,scale:.055+hash(gx,gz)*.11,sy:.46,yaw,tint:.75});}
 // Fallen fan leaves add centimetre-scale relief under the canopy and along path edges.
 for(let gz=Math.floor((cz-32)/.9);gz<=Math.ceil((cz+32)/.9);gz++)for(let gx=Math.floor((cx-32)/.9);gx<=Math.ceil((cx+32)/.9);gx++){
 const x=(gx+hash(gx,gz))*.9,z=(gz+hash(gz,gx))*.9,path=trailWeight(x,z);
 if(!fine&&hash(gx+8,gz)<.65||forestAt(x,z)<.25&&path<.05||hash(gx+3,gz)<(.35+path*.52)||Math.hypot(x-cx,z-cz)>34)continue;
 const y=terrainHeight(x,z);if(y<waterLevelAt(x,z)+.3||slopeAt(x,z)<.78)continue;
 const age=hash(gx,gz+5);litter.push({x,z,y:y+.018,scale:.08+hash(gx,gz+2)*.15,yaw:hash(gz+4,gx)*6.28,tilt:(terrainHeight(x,z+.2)-terrainHeight(x,z-.2))/- .4,roll:(terrainHeight(x+.2,z)-terrainHeight(x-.2,z))/.4,color:[.19+age*.16,.12+age*.13,.047+age*.055]});
 }
 const spacing=habitat?.57:3.8,radius=habitat?95:180;
 for(let gz=Math.floor((cz-radius)/spacing);gz<=Math.ceil((cz+radius)/spacing);gz++)for(let gx=Math.floor((cx-radius)/spacing);gx<=Math.ceil((cx+radius)/spacing);gx++){
 const i=gx*1973+gz*7919;if(!fine&&hash(gx,gz)>.44)continue;const x=(gx+hash(gx,gz+7))*spacing,z=(gz+hash(gz,gx+3))*spacing,y=terrainHeight(x,z),b=bankAt(x,z),eco=biomeAt(x,z),dune=x>8000&&z>0&&z<3600&&y>2.5&&y<26;
 if(y<waterLevelAt(x,z)+.12||y>950||hash(gx+71,gz-29)>(.24+.70*noise(x/13,z/18))||trailWeight(x,z)>.28||((b<4||b>200)&&eco.grass<.15&&eco.marsh<.1&&eco.heath<.15&&!dune&&forestAt(x,z)<.25))continue;
 const springPatch=habitat?1-Math.min(1,((x-forestSpring.x-22)/85)**2+((z-forestSpring.z-23)/75)**2):0;
 if(springPatch>0&&(slopeAt(x,z)<.83||hash(gx+127,gz-63)<springPatch*(.25+.25*(1-noise(x/5,z/7)))))continue;
 grass.push({x,z,y,scale:(habitat?(.52+rand(i,43)*.50)*(1+eco.grass*.28):(.6+rand(i,43)*1.2)*(1+eco.grass*1.7+eco.heath*.6))*(1-springPatch*(.55+rand(i,719)*.12)),sy:1+eco.grass*(.4+noise(x/9,z/13)*.55),sx:1+eco.grass*.24,sz:1+eco.grass*.24,yaw:rand(i,44)*6.28,tint:.65+rand(i,45)*.55});
 }
 for(let gz=Math.floor((cz-150)/8);gz<=Math.ceil((cz+150)/8);gz++)for(let gx=Math.floor((cx-150)/8);gx<=Math.ceil((cx+150)/8);gx++){
 const x=(gx+hash(gx,gz))*8,z=(gz+hash(gz,gx))*8,eco=biomeAt(x,z);if(eco.marsh<.3)continue;const y=terrainHeight(x,z),wl=waterLevelAt(x,z);if(y<wl-.5||y>wl+1.6||noise(x/35,z/28)<.38)continue;
 for(let j=0;j<(fine?9:5);j++){const i=gx*97+gz*113+j,rx=x+(rand(i,50)-.5)*6,rz=z+(rand(i,51)-.5)*6;reeds.push({x:rx,z:rz,y:terrainHeight(rx,rz)-.04,scale:.75+rand(i,52)*.9,yaw:rand(i,53)*6.28,tint:.7+rand(i,54)*.5})}
 }
 // Moist fern colonies and gravel at the spring; no plants in the pool.
 if(Math.hypot(cx-springOrigin.x,cz-springOrigin.z)<200)for(let i=0;i<260;i++){
  const x=springOrigin.x+(rand(i,710)-.5)*70,z=springOrigin.z-18+rand(i,711)*100,s=springAt(x,z);if(!s)continue;
  const y=terrainHeight(x,z);if(s.edge>.6&&s.edge<8&&y>s.level+.08&&rand(i,712)<.65)ferns.push({x,z,y:y-.03,scale:(.25+rand(i,713)*.55)/fernHeight,yaw:rand(i,714)*6.28,tint:.65+rand(i,715)*.27});
  if(s.edge<3&&s.edge>-.8)pebbles.push({x,z,y:y-.035,scale:.08+rand(i,716)*.27,sy:.45,yaw:rand(i,717)*6.28,tint:.6+rand(i,718)*.3});
 }
 // Short colonies occupy moist ledges beside the side spring, not its pools.
 if(habitat&&Math.hypot(cx-forestSpring.x,cz-forestSpring.z)<200)for(let i=0;i<520;i++){
  const x=forestSpring.x-14+rand(i,720)*70,z=forestSpring.z-10+rand(i,721)*72,s=springAt(x,z);if(!s?.forest||s.edge<.65||s.edge>7||noise(x/5,z/6)<.32)continue;
  const y=terrainHeight(x,z);if(y<=s.level+.12||slopeAt(x,z)<.8)continue;
  ferns.push({x,z,y:y-.025,scale:(.24+rand(i,722)**2*.58)/fernHeight,yaw:rand(i,723)*6.28,tint:.8+rand(i,724)*.28});
 }
 const grassPacket=habitat?makeGrassRenderPacket(grass):null,transfer=grassPacket?[grassPacket.raw.buffer,grassPacket.matrices.buffer,grassPacket.colors.buffer]:[];
 self.postMessage({requestId,fine,cx,cz,rocks,pebbles,ferns,grass:grassPacket?null:grass,grassPacket,reeds,debris,litter,workerMs:performance.now()-workerStart},transfer)
}
self.postMessage({ready:true});

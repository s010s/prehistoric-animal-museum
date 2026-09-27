import {hash,noise,terrainHeight,slopeAt,bankAt,riverX,halfWidth,riverLevel,waterLevelAt,biomeAt} from './field.js'
const rand=(i,n)=>hash(i*1.71+n*14.19,n*7.38-i*.31)
// Coordinates and identities belong to fixed world cells; moving the window never reseeds plants.
self.onmessage=e=>{const {cx,cz,fine,rockWidth,fernHeight}=e.data;const rocks=[],pebbles=[],ferns=[],grass=[],reeds=[];
 for(let gz=Math.floor((cz-185)/10);gz<=Math.ceil((cz+185)/10);gz++)for(let gx=Math.floor((cx-185)/10);gx<=Math.ceil((cx+185)/10);gx++){
 const i=gx*1973+gz*7919;if(!fine&&hash(gx,gz)>.60)continue;
 const x=(gx+.1+hash(gx+1,gz)*.8)*10,z=(gz+.1+hash(gz+2,gx)*.8)*10,y=terrainHeight(x,z),b=bankAt(x,z),s=slopeAt(x,z),water=waterLevelAt(x,z);
 if(y<-3||s<.7)continue;const bank=b>-12&&b<40;
 if(bank){const radius=.25+rand(i,23)**3*3.1;rocks.push({x,z,y:y-radius*.28,scale:radius*2/rockWidth,yaw:rand(i,24)*6.28,sy:.55+rand(i,25)*.5,tint:.68+rand(i,26)*.4});pebbles.push({x:x+.3,z:z+.4,y:y-.06,scale:.09+rand(i,27)*.23,yaw:rand(i,28)*6.28,sy:.45,tint:.7+rand(i,29)*.5})}
 if(b>7&&b<140&&y>water+.35&&rand(i,30)<.3)ferns.push({x,z,y:y-.06,scale:(.8+rand(i,31)*.9)/fernHeight,yaw:rand(i,32)*6.28,tint:.72+rand(i,33)*.3});
 }
 for(let row=Math.floor((cz-160)/3);row<=Math.ceil((cz+160)/3);row++)for(let column=0;column<(fine?10:5);column++){
 const i=row*97+column,z=row*3+rand(i,61)*2,side=column%2?1:-1,x=riverX(z)+side*(halfWidth(z)-1+rand(i,62)**1.8*20);if(Math.hypot(x-cx,z-cz)>190)continue;
 const y=terrainHeight(x,z),radius=.12+rand(i,63)**2*.65;rocks.push({x,z,y:y-radius*.18,scale:radius*2/rockWidth,yaw:rand(i,64)*6.28,sy:.55+rand(i,65)*.55,tint:.75+rand(i,66)*.55});
 if(column%3===0&&y>riverLevel(z)+.1)ferns.push({x:x+side*3,z,y:terrainHeight(x+side*3,z)-.1,scale:(.65+rand(i,67)*.8)/fernHeight,yaw:rand(i,68)*6.28,tint:.76+rand(i,69)*.25});
 }
 const spacing=3.8;
 for(let gz=Math.floor((cz-180)/spacing);gz<=Math.ceil((cz+180)/spacing);gz++)for(let gx=Math.floor((cx-180)/spacing);gx<=Math.ceil((cx+180)/spacing);gx++){
 const i=gx*1973+gz*7919;if(!fine&&hash(gx,gz)>.44)continue;const x=(gx+hash(gx,gz+7))*spacing,z=(gz+hash(gz,gx+3))*spacing,y=terrainHeight(x,z),b=bankAt(x,z),eco=biomeAt(x,z);
 if(y<waterLevelAt(x,z)+.12||y>950||noise(x/13,z/18)<.24||((b<4||b>200)&&eco.grass<.15&&eco.marsh<.1&&eco.heath<.15))continue;
 grass.push({x,z,y,scale:(.6+rand(i,43)*1.2)*(1+eco.grass*1.7+eco.heath*.6),yaw:rand(i,44)*6.28,tint:.65+rand(i,45)*.55});
 }
 for(let gz=Math.floor((cz-150)/8);gz<=Math.ceil((cz+150)/8);gz++)for(let gx=Math.floor((cx-150)/8);gx<=Math.ceil((cx+150)/8);gx++){
 const x=(gx+hash(gx,gz))*8,z=(gz+hash(gz,gx))*8,eco=biomeAt(x,z);if(eco.marsh<.3)continue;const y=terrainHeight(x,z),wl=waterLevelAt(x,z);if(y<wl-.5||y>wl+1.6||noise(x/35,z/28)<.38)continue;
 for(let j=0;j<(fine?9:5);j++){const i=gx*97+gz*113+j,rx=x+(rand(i,50)-.5)*6,rz=z+(rand(i,51)-.5)*6;reeds.push({x:rx,z:rz,y:terrainHeight(rx,rz)-.04,scale:.75+rand(i,52)*.9,yaw:rand(i,53)*6.28,tint:.7+rand(i,54)*.5})}
 }
 self.postMessage({cx,cz,rocks,pebbles,ferns,grass,reeds})
}
self.postMessage({ready:true});

import sharp from 'sharp'
import {writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const size=512, seed=193706, data=new Uint8Array(size*size*4)
const hash=(x,y,n)=>{let h=Math.imul((x%n+n)%n+seed,374761393)^Math.imul((y%n+n)%n,668265263);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295}
const noise=(x,y,n)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);return (hash(ix,iy,n)*(1-u)+hash(ix+1,iy,n)*u)*(1-v)+(hash(ix,iy+1,n)*(1-u)+hash(ix+1,iy+1,n)*u)*v}
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
 let value=0,weight=0
 for(let o=0;o<6;o++){const n=4*2**o,w=2**(-o*.85);value+=noise(x/size*n,y/size*n,n)*w;weight+=w}
 const i=(y*size+x)*4;data[i]=Math.round(value/weight*255);data[i+1]=Math.round(noise(x/size*32,y/size*32,32)*255);data[i+2]=0;data[i+3]=255
}
const png=await sharp(data,{raw:{width:size,height:size,channels:4}}).png({compressionLevel:9,adaptiveFiltering:true}).toBuffer()
await writeFile('src/flight-experience/assets/weather/cloud-density.png',png)
await writeFile('src/flight-experience/assets/weather/manifest.json',JSON.stringify({version:1,seed,source:'Original deterministic periodic value noise; prepare-cloud-density.mjs',license:'AGPL-3.0-only',size:[size,size],channels:{R:'linear base density',G:'linear detail',B:'unused',A:'opaque'},colorSpace:'linear data / NoColorSpace',wrap:'repeat',mipmaps:true,gpuBytesIncludingMipmaps:Math.ceil(size*size*4*4/3),sha256:createHash('sha256').update(png).digest('hex')},null,2)+'\n')

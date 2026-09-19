import fs from 'node:fs/promises';import sharp from 'sharp';import crypto from 'node:crypto'
const source='.flight-evidence/r6/tree-views',out='src/flight-experience/assets/tree-views';await fs.mkdir(out,{recursive:true});const report=[]
for(const id of ['tree-0-0','tree-0-1','tree-1-0','tree-1-1']){
 const cells=[]
 for(let row=0;row<3;row++)for(let col=0;col<8;col++){
  const {data}=await sharp(`${source}/${id}-${row}-${col}.png`).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  // Dilate RGB into transparent border; alpha is untouched.
  for(let pass=0;pass<4;pass++){const old=Buffer.from(data);for(let y=1;y<255;y++)for(let x=1;x<255;x++){const i=(y*256+x)*4;if(old[i+3]===0){for(const j of [i-4,i+4,i-1024,i+1024])if(old[j+3]>0||old[j]+old[j+1]+old[j+2]>0){data[i]=old[j];data[i+1]=old[j+1];data[i+2]=old[j+2];break}}}}
  let covered=0;for(let i=3;i<data.length;i+=4)if(data[i]>107)covered++
  cells.push({data,coverage:covered/(256*256)})
 }
 const levels=[]
 for(let level=0;level<=8;level++){
  const size=256>>level,parts=[],coverage=[]
  for(let i=0;i<24;i++){
   const cell=cells[i],data=await sharp(cell.data,{raw:{width:256,height:256,channels:4}}).resize(size,size,{kernel:'lanczos3'}).raw().toBuffer()
   let lo=0,hi=8,best=1,error=Infinity
   for(let it=0;it<24;it++){const scale=(lo+hi)/2;let n=0;for(let j=3;j<data.length;j+=4)if(data[j]*scale>107)n++;const value=n/(size*size),d=Math.abs(value-cell.coverage);if(d<error){error=d;best=scale}if(value<cell.coverage)lo=scale;else hi=scale}
   for(let j=3;j<data.length;j+=4)data[j]=Math.min(255,Math.round(data[j]*best))
   let n=0;for(let j=3;j<data.length;j+=4)if(data[j]>107)n++
   coverage.push({view:i,target:cell.coverage,actual:n/(size*size),error:Math.abs(n/(size*size)-cell.coverage)})
   parts.push({input:await sharp(data,{raw:{width:size,height:size,channels:4}}).png().toBuffer(),left:i%8*size,top:Math.floor(i/8)*size})
  }
  const file=`${id}-mip${level}.png`;await sharp({create:{width:8*size,height:3*size,channels:4,background:'#00000000'}}).composite(parts).png().toFile(`${out}/${file}`);levels.push({file,width:8*size,height:3*size,coverage})
 }
 // Complete the legal GPU mip chain; at subpixel size view identity is no longer resolved.
 let width=8,height=3,level=9,previous=`${id}-mip8.png`
 while(width>1||height>1){width=Math.max(1,width>>1);height=Math.max(1,height>>1);const file=`${id}-mip${level++}.png`;await sharp(`${out}/${previous}`).resize(width,height).png().toFile(`${out}/${file}`);levels.push({file,width,height});previous=file}
 for(const l of levels){const data=await fs.readFile(`${out}/${l.file}`);l.bytes=data.length;l.sha256=crypto.createHash('sha256').update(data).digest('hex')}
 report.push({id,alphaTest:.42,azimuths:8,elevations:[-45,0,45],source:'ecology-r5 LOD0',reviewStatus:'needs_review',levels})
}
await fs.writeFile(`${out}/manifest.json`,JSON.stringify(report,null,2)+'\n');console.log('Four 24-view atlases with explicit coverage-preserving mip chains.')

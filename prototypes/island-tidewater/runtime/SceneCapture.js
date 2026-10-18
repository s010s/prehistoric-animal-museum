// One explicit visitor action: snapshot the submitted scene, then encode a
// detached 2D canvas. Later camera motion cannot change these image pixels.
export function sceneImage(canvas,packet){
 const scale=Math.min(1,3840/canvas.width,2160/canvas.height),width=Math.round(canvas.width*scale),height=Math.round(canvas.height*scale);
 const image=document.createElement('canvas');image.width=width;image.height=height+72;
 const ctx=image.getContext('2d',{alpha:false});if(!ctx)throw Error('无法生成截图');
 ctx.drawImage(canvas,0,0,width,height);
 ctx.fillStyle='#101e1b';ctx.fillRect(0,height,width,72);ctx.fillStyle='#e4ece3';ctx.font='13px system-ui';
 const c=packet.camera,p=c.position.map(n=>Number(n).toFixed(2));
 ctx.fillText(`${packet.id} · ${packet.place.title} · 版本 ${packet.sourceHash.slice(0,12)}`,14,height+24,width-28);
 ctx.fillStyle='#bbcdbc';ctx.font='12px ui-monospace,monospace';
 ctx.fillText(`XYZ ${p.join(' / ')} m · 朝向 ${c.headingDegrees.toFixed(2)}° · 俯仰 ${c.pitchDegrees.toFixed(2)}° · 帧 ${packet.frame.gpu}`,14,height+49,width-28);
 packet.image={filename:`museum-${packet.id}.png`,width:image.width,height:image.height,scenePixels:[width,height],scope:'submitted scene canvas with provenance footer; browser chrome and controls excluded'};
 return new Promise((resolve,reject)=>image.toBlob(blob=>blob?resolve(blob):reject(Error('截图编码失败')),'image/png'));
}

export async function imageBase64(blob){
 const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
 for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 return btoa(binary);
}

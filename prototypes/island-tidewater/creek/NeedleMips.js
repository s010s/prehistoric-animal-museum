// Preserve the silhouette area of alpha-tested sprays as they become smaller.
// RGB is averaged in linear light, weighted by unscaled alpha, to avoid dark
// fringes. Coverage scaling affects each uploaded alpha level only; it never
// feeds back into the next downsample or changes the original image.
export function uploadNeedleMips(texture,image,cutoff=.36) {
  const linear=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};
  const srgb=v=>Math.round(255*(v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055));
  let width=image.width,height=image.height,raw=new Float32Array(width*height*4),covered=0;
  for(let i=0;i<raw.length;i+=4){
    const a=image.data[i+3]/255;covered+=a>=cutoff?1:0;
    raw.set([linear(image.data[i])*a,linear(image.data[i+1])*a,linear(image.data[i+2])*a,a],i);
  }
  const target=covered/(width*height),levels=[{mip:0,width,height,coverage:target,scale:1}];
  texture.getGPU();
  for(let mip=1;mip<texture.mipLevelCount;mip++){
    const w=Math.max(1,width>>1),h=Math.max(1,height>>1),next=new Float32Array(w*h*4),hist=new Uint32Array(256);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const k=(y*w+x)*4;
      // Normalized texel centres also matter for our non-power-of-two source.
      // Dropping the final odd row/column would shift UV features at every mip.
      const sx=(x+.5)*width/w-.5,sy=(y+.5)*height/h-.5,ix=Math.floor(sx),iy=Math.floor(sy),u=sx-ix,v=sy-iy;
      for(let j=0;j<2;j++)for(let i=0;i<2;i++){
        const src=(Math.min(height-1,iy+j)*width+Math.min(width-1,ix+i))*4,weight=(i?u:1-u)*(j?v:1-v);
        for(let c=0;c<4;c++)next[k+c]+=raw[src+c]*weight;
      }
      hist[Math.round(next[k+3]*255)]++;
    }
    const filteredCoverage=hist.reduce((sum,count,i)=>sum+(i/255>=cutoff?count:0),0)/(w*h);
    let sum=0,threshold=255;
    for(;threshold>0;threshold--){sum+=hist[threshold];if(sum>=target*w*h)break;}
    // Bound the boost in sub-pixel levels; they cannot represent the original
    // fractional area exactly. Never make fully transparent texels opaque.
    const scale=Math.min(4,cutoff/Math.max(1/255,threshold/255)),bytes=new Uint8Array(w*h*4);
    let count=0;
    for(let i=0;i<next.length;i+=4){
      const a=next[i+3];for(let c=0;c<3;c++)bytes[i+c]=srgb(a>1e-6?next[i+c]/a:0);
      bytes[i+3]=Math.round(Math.min(1,a*scale)*255);count+=bytes[i+3]/255>=cutoff?1:0;
    }
    texture.upload(bytes,{mip,width:w,height:h});levels.push({mip,width:w,height:h,filteredCoverage,coverage:count/(w*h),scale});
    raw=next;width=w;height=h;
  }
  texture.coverageMips=levels;
}

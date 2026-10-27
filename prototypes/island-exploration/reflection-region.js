// Conservative support of the existing planar-water shader. No Three/GL state,
// no quality/cadence change. Geometry bounds are built once and remain bounded.
const finite=values=>{for(let i=0;i<values.length;i++)if(!Number.isFinite(values[i]))return false;return true;};
export function buildWaterRegions(positions,indices,grid=null) {
  if(!ArrayBuffer.isView(positions)||positions.length%3||!positions.length)return null;
  for(const n of positions)if(!Number.isFinite(n))return null;
  const regions=[],count=positions.length/3;
  const empty=()=>new Float64Array([Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity]);
  const include=(b,k)=>{for(let a=0;a<3;a++){b[a]=Math.min(b[a],positions[k*3+a]);b[a+3]=Math.max(b[a+3],positions[k*3+a]);}};
  if(grid){
    const {cols,rows}=grid;
    if(!Number.isSafeInteger(cols)||!Number.isSafeInteger(rows)||cols<1||rows<1||(cols+1)*(rows+1)!==count||Math.ceil(cols/8)*Math.ceil(rows/8)>16384)return null;
    for(let z=0;z<rows;z+=8)for(let x=0;x<cols;x+=8){const b=empty();for(let zz=z;zz<=Math.min(rows,z+8);zz++)for(let xx=x;xx<=Math.min(cols,x+8);xx++)include(b,zz*(cols+1)+xx);regions.push(b);}
  }else{
    const n=indices?.length??count;if(n%3||n>12000000)return null;
    if(indices)for(const k of indices)if(!Number.isInteger(k)||k<0||k>=count)return null;
    for(let i=0;i<n;i+=384){const b=empty();for(let j=i;j<Math.min(n,i+384);j++)include(b,indices?indices[j]:j);regions.push(b);}
  }
  return regions.length&&regions.length<=16384?regions:null;
}

// Tighten an AABB using necessary halfspace conditions. The maximum possible
// contribution of the other two coordinates produces an outward bound, even
// when the intersection's vertices are on three newly introduced planes.
export function restrictBounds(bounds,planes,out=new Float64Array(6),validated=false) {
  if(!validated&&(!bounds||bounds.length!==6||!finite(bounds)||planes.some(p=>p.length!==4||!finite(p))))return null;
  out.set(bounds);const epsilon=1e-6;
  for(let pass=0;pass<3;pass++)for(const p of planes){
    let max=p[3];for(let a=0;a<3;a++)max+=p[a]*(p[a]>=0?out[a+3]:out[a]);
    if(max< -epsilon)return null;
    for(let a=0;a<3;a++){
      const v=p[a];if(Math.abs(v)<1e-12)continue;
      let other=p[3]+epsilon;for(let k=0;k<3;k++)if(k!==a)other+=p[k]*(p[k]>=0?out[k+3]:out[k]);
      const edge=-other/v;if(v>0)out[a]=Math.max(out[a],edge);else out[a+3]=Math.min(out[a+3],edge);
      if(out[a]>out[a+3])return null;
    }
  }
  return out;
}

const polygonStorage=new WeakMap();
function readablePolygon(bounds,planes,m,level,sign,scratch){
  let storage=polygonStorage.get(scratch);if(!storage){storage={a:new Float64Array(64),b:new Float64Array(64),count:0,points:null};polygonStorage.set(scratch,storage);}
  let a=storage.a,b=storage.b,n=4;a[0]=bounds[0];a[1]=bounds[2];a[2]=bounds[3];a[3]=bounds[2];a[4]=bounds[3];a[5]=bounds[5];a[6]=bounds[0];a[7]=bounds[5];
  const clip=(x,z,c)=>{
    if(!n)return;c+=1e-7;let out=0,px=a[(n-1)*2],pz=a[(n-1)*2+1],pd=x*px+z*pz+c;
    for(let i=0;i<n;i++){
      const qx=a[i*2],qz=a[i*2+1],qd=x*qx+z*qz+c;
      if((pd>=0)!==(qd>=0)){const t=pd/(pd-qd);if(out>=32){n=-1;return;}b[out*2]=px+(qx-px)*t;b[out*2+1]=pz+(qz-pz)*t;out++;}
      if(qd>=0){if(out>=32){n=-1;return;}b[out*2]=qx;b[out*2+1]=qz;out++;}
      px=qx;pz=qz;pd=qd;
    }
    n=out;const old=a;a=b;b=old;
  };
  for(const p of planes){clip(p[0],p[2],p[3]+Math.max(p[1]*bounds[1],p[1]*bounds[4]));if(n<=0)break;}
  const wx=m[3],wz=m[11],wc=m[7]*level+m[15],ux=m[0],uz=m[8],uc=m[4]*level+m[12],vx=m[1],vz=m[9],vc=m[5]*level+m[13],low=-.051,high=1.051;
  if(n>0)clip(sign*wx,sign*wz,sign*wc);
  if(n>0)clip(sign*(ux-low*wx),sign*(uz-low*wz),sign*(uc-low*wc));
  if(n>0)clip(sign*(high*wx-ux),sign*(high*wz-uz),sign*(high*wc-uc));
  if(n>0)clip(sign*(vx-low*wx),sign*(vz-low*wz),sign*(vc-low*wc));
  if(n>0)clip(sign*(high*wx-vx),sign*(high*wz-vz),sign*(high*wc-vc));
  storage.count=n;storage.points=a;return storage;
}
export function reflectionRegion(regions,planes,textureMatrix,level,width,height,scratch=new Float64Array(6)) {
  const full=reason=>({mode:'full',reason,x:0,y:0,width,height,areaRatio:1});
  if(!regions||!textureMatrix||textureMatrix.length!==16||!finite(textureMatrix)||!Number.isFinite(level)||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||planes.some(p=>p.length!==4||!finite(p)))return full('unknown-support');
  let minU=Infinity,minV=Infinity,maxU=-Infinity,maxV=-Infinity,contributors=0;
  const m=textureMatrix;
  for(const b of regions){
    if(!b||b.length!==6||!finite(b))return full('unknown-bound');
    if(!restrictBounds(b,planes,scratch,true))continue;
    for(let sign=-1;sign<=1;sign+=2){
      const polygon=readablePolygon(scratch,planes,m,level,sign,scratch);
      if(polygon.count<0)return full('polygon-capacity');if(!polygon.count)continue;contributors++;
      for(let i=0;i<polygon.count;i++){
        const x=polygon.points[i*2],z=polygon.points[i*2+1],w=m[3]*x+m[7]*level+m[11]*z+m[15];
        if(Math.abs(w)<=1e-5)return full('near-homogeneous-bound');
        const u=(m[0]*x+m[4]*level+m[8]*z+m[12])/w,v=(m[1]*x+m[5]*level+m[9]*z+m[13])/w;
        minU=Math.min(minU,u);maxU=Math.max(maxU,u);minV=Math.min(minV,v);maxV=Math.max(maxV,v);
      }
    }
  }
  if(!contributors)return full('no-possible-support');
  // Shader maximum normal shift .005+.018+.043, maximum tap spread .018+.003.
  // Two more texels cover bilinear footprints and outward raster rounding.
  const pad=.087,x=Math.max(0,Math.floor((minU-pad)*width-2)),y=Math.max(0,Math.floor((minV-pad)*height-2)),right=Math.min(width,Math.ceil((maxU+pad)*width+2)),top=Math.min(height,Math.ceil((maxV+pad)*height+2));
  if(right<=x||top<=y)return full('no-readable-texels');
  const w=right-x,h=top-y;if(w===width&&h===height)return full('full-support');
  return {mode:'crop',reason:'bounded-water-sampling',x,y,width:w,height:h,areaRatio:w*h/(width*height),contributors,paddingUV:pad,filterPaddingPixels:2};
}

// A cropped projection into the matching sub-viewport has exactly the same
// global texel positions and depth as the original full-target projection.
export function cropProjection(projection,region,width,height,out=new Float64Array(16)) {
  out.set?.(projection);if(!out.set)for(let i=0;i<16;i++)out[i]=projection[i];
  const sx=width/region.width,sy=height/region.height,tx=(width-2*region.x-region.width)/region.width,ty=(height-2*region.y-region.height)/region.height;
  for(let c=0;c<4;c++){const i=c*4;out[i]=sx*projection[i]+tx*projection[i+3];out[i+1]=sy*projection[i+1]+ty*projection[i+3];}
  return out;
}

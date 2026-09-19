/** RGBA rows from canvas are top-first; WebGL array layers require bottom-first. */
export function flipRgbaRows(source:Uint8Array|Uint8ClampedArray,width:number,height:number){
  if(source.length!==width*height*4)throw new Error('Invalid RGBA image dimensions')
  const result=new Uint8Array(source.length),rowBytes=width*4
  for(let y=0;y<height;y++)result.set(source.subarray((height-1-y)*rowBytes,(height-y)*rowBytes),y*rowBytes)
  return result
}

/** Extract the padded delivery atlas into isolated layers before GPU mip generation. */
export function unpackMaterialAtlas(source:Uint8Array|Uint8ClampedArray,width:number,height:number,layerCount:number,tile=512,pad=16,columns=3){
  const cell=tile+2*pad,rows=Math.ceil(layerCount/columns)
  if(width!==columns*cell||height!==rows*cell||source.length!==width*height*4)throw new Error('Invalid material atlas dimensions')
  const result=new Uint8Array(layerCount*tile*tile*4)
  for(let layer=0;layer<layerCount;layer++){
    const x0=layer%columns*cell+pad,y0=Math.floor(layer/columns)*cell+pad
    for(let y=0;y<tile;y++){
      const from=((y0+tile-1-y)*width+x0)*4,to=(layer*tile*tile+y*tile)*4
      result.set(source.subarray(from,from+tile*4),to)
    }
  }
  return result
}

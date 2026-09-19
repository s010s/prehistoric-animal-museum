import {describe,expect,it} from 'vitest'
import {flipRgbaRows,unpackMaterialAtlas} from '../../src/flight-experience/lookdev/material-array'

describe('isolated terrain material layers',()=>{
  it('flips standalone canvas rows to WebGL array order',()=>{
    expect([...flipRgbaRows(Uint8Array.from([1,2,3,4,5,6,7,8]),1,2)]).toEqual([5,6,7,8,1,2,3,4])
  })

  it('extracts each source without its neighbours or periodic atlas padding',()=>{
    const tile=2,pad=1,columns=3,layers=6,cell=4,width=columns*cell,height=2*cell
    const atlas=new Uint8Array(width*height*4)
    for(let layer=0;layer<layers;layer++){
      const x0=layer%columns*cell+pad,y0=Math.floor(layer/columns)*cell+pad
      for(let y=0;y<tile;y++)for(let x=0;x<tile;x++)atlas[((y0+y)*width+x0+x)*4]=layer*10+y*2+x+1
    }
    const unpacked=unpackMaterialAtlas(atlas,width,height,layers,tile,pad,columns)
    for(let layer=0;layer<layers;layer++){
      const red=[]
      for(let pixel=0;pixel<tile*tile;pixel++)red.push(unpacked[(layer*tile*tile+pixel)*4])
      expect(red).toEqual([layer*10+3,layer*10+4,layer*10+1,layer*10+2])
    }
  })

  it('rejects an atlas with a missing layer row',()=>{
    expect(()=>unpackMaterialAtlas(new Uint8Array(12*4*4),12,4,6,2,1,3)).toThrow('Invalid material atlas dimensions')
  })
})

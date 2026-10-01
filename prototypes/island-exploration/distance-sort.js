// Preserve native ascending distance order and stable ties without comparison sorting
// large windows. Non-negative IEEE-754 keys have the same numeric and bit order.
export function createDistanceSorter() {
  const probe=new Float64Array([1]),littleEndian=new Uint32Array(probe.buffer)[1]===0x3ff00000
  let keys=new Float64Array(0),words=new Uint32Array(0),from=new Uint32Array(0),to=new Uint32Array(0)
  const offsets=new Uint32Array(256),native=items=>items.sort((a,b)=>a.viewDistanceSquared-b.viewDistanceSquared)
  return {
    scratchBytes:()=>keys.byteLength+from.byteLength+to.byteLength+offsets.byteLength,
    sort(items) {
      const n=items.length
      if(n<8192)return native(items)
      if(keys.length<n){const capacity=2**Math.ceil(Math.log2(n));keys=new Float64Array(capacity);words=new Uint32Array(keys.buffer);from=new Uint32Array(capacity);to=new Uint32Array(capacity)}
      for(let i=0;i<n;i++){
        const value=items[i].viewDistanceSquared
        if(typeof value!=='number'||Number.isNaN(value)||value<0)return native(items)
        keys[i]=value===0?0:value;from[i]=i
      }
      for(let byte=0;byte<8;byte++){
        const word=(byte<4)===littleEndian?0:1,shift=(byte%4)*8
        offsets.fill(0)
        for(let i=0;i<n;i++)offsets[(words[from[i]*2+word]>>>shift)&255]++
        let total=0
        for(let i=0;i<256;i++){const count=offsets[i];offsets[i]=total;total+=count}
        for(let i=0;i<n;i++){const index=from[i],bucket=(words[index*2+word]>>>shift)&255;to[offsets[bucket]++]=index}
        const previous=from;from=to;to=previous
      }
      const original=items.slice()
      for(let i=0;i<n;i++)items[i]=original[from[i]]
      return items
    },
  }
}

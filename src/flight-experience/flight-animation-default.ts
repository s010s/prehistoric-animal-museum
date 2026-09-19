/** Source clip is the only automatic animation; derived clips are review-only. */
export function animationWeights(mode:'auto'|'source'|'powered'|'glide'){
 return {source:mode==='auto'||mode==='source'?1:0,powered:mode==='powered'?1:0,glide:mode==='glide'?1:0}
}

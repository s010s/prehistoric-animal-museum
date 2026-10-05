// Failure inventory is recorded before reflection range implementation.
// Necessary CPU isolation: small arrays and an independent per-vertex plane oracle.
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';import {dirname,resolve} from 'node:path';
const cases=[];let api;
try{api=await import('../reflection-range.js');}catch(error){cases.push({name:'range implementation available',passed:false,error:String(error)});}
function check(name,fn){try{fn();cases.push({name,passed:true});}catch(error){cases.push({name,passed:false,error:String(error)});}}
const positions=new Float32Array([0,-8,0, 1,-7,0, 0,-9,1, 0,0,0, 1,0,0, 0,0,1, 0,2,0, 1,2,0, 0,2,1, 0,-2,0, 1,3,0, 0,-2,1]);
const ix=new Uint32Array([6,7,8, 0,1,2, 9,10,11, 3,4,5]);
if(api){
 const {buildReflectionRange,reflectionDrawStart}=api;
 check('inputs and each triangle winding stay unchanged',()=>{const a=ix.slice(),p=positions.slice(),r=buildReflectionRange(ix,positions);assert.deepEqual(ix,a);assert.deepEqual(positions,p);const triples=v=>Array.from({length:v.length/3},(_,i)=>Array.from(v.slice(i*3,i*3+3)).join(',')).sort();assert.deepEqual(triples(r.indices),triples(ix));});
 check('fully negative triangles are omitted but plane contacts and crossing faces remain',()=>{const r=buildReflectionRange(ix,positions),start=reflectionDrawStart(r,{x:0,y:1,z:0,w:0});assert.equal(start,3);assert.deepEqual(Array.from(r.indices.slice(0,start)),[0,1,2]);});
 check('fractional heights round conservatively',()=>{const p=new Float32Array([0,.1,0,1,.2,0,0,.3,1]),r=buildReflectionRange(new Uint32Array([0,1,2]),p);assert.equal(reflectionDrawStart(r,{x:0,y:1,z:0,w:-.5}),0);});
 check('all excluded vertices are outside biased tilted planes',()=>{let removed=0;for(const plane of [{x:.08,y:.99,z:-.03,w:0},{x:-.04,y:1,z:.07,w:-1},{x:.001,y:1,z:.002,w:5}]){const r=buildReflectionRange(ix,positions),start=reflectionDrawStart(r,plane);removed+=start;for(const k of r.indices.slice(0,start)){const j=k*3;assert.ok(plane.x*positions[j]+plane.y*positions[j+1]+plane.z*positions[j+2]+plane.w<0);}}assert.ok(removed>0);});
 check('actual XZ bounds include vertices outside nominal chunk',()=>{const p=new Float32Array([100,-2,0,101,-2,0,100,-2,1]),r=buildReflectionRange(new Uint32Array([0,1,2]),p);assert.equal(reflectionDrawStart(r,{x:.1,y:1,z:0,w:0}),0);});
 check('empty input is finite and retains nothing',()=>{const r=buildReflectionRange(new Uint32Array(),new Float32Array());assert.equal(reflectionDrawStart(r,{x:0,y:1,z:0,w:0}),0);});
 check('bad geometry retains an unfiltered fallback',()=>{for(const p of [new Float32Array([NaN,0,0]),new Float32Array([0,0])])assert.equal(buildReflectionRange(new Uint32Array([0,0,0]),p),null);assert.equal(buildReflectionRange(new Uint32Array([99,1,2]),positions),null);assert.equal(buildReflectionRange(new Uint32Array([0,1]),positions),null);});
 check('extreme height cannot allocate unbounded bins',()=>{const p=positions.slice();p[1]=1e9;assert.equal(buildReflectionRange(ix,p),null);});
 check('invalid downward or horizontal planes do not cull',()=>{const r=buildReflectionRange(ix,positions);for(const plane of [null,{x:0,y:0,z:1,w:0},{x:0,y:-1,z:0,w:0},{x:NaN,y:1,z:0,w:0}])assert.equal(reflectionDrawStart(r,plane),0);});
 check('repeat lookup reuses indices and buckets',()=>{const r=buildReflectionRange(ix,positions),a=r.indices,b=r.heights,c=r.starts;for(let i=0;i<100;i++)reflectionDrawStart(r,{x:0,y:1,z:0,w:i/10});assert.equal(r.indices,a);assert.equal(r.heights,b);assert.equal(r.starts,c);});
 check('16-bit indices retain their supported type',()=>{const r=buildReflectionRange(new Uint16Array(ix),positions);assert.ok(r.indices instanceof Uint16Array);});
 check('independent seeded triangle oracle including oblique projection terms',()=>{const p=[],indices=[];let seed=719;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};for(let i=0;i<3000;i++){p.push((random()-.5)*4096,(random()-.5)*80,(random()-.5)*4096);indices.push(i);}const positions=new Float32Array(p),r=buildReflectionRange(new Uint32Array(indices),positions);let skipped=0;for(let n=0;n<30;n++){const plane={x:(random()-.5)*.002,y:.999,z:(random()-.5)*.002,w:(random()-.5)*40},start=reflectionDrawStart(r,plane);skipped+=start;for(let i=0;i<start;i++){const j=r.indices[i]*3;assert.ok(plane.x*positions[j]+plane.y*positions[j+1]+plane.z*positions[j+2]+plane.w<0);}}assert.ok(skipped>0);});
}
const result={schema:'island-reflection-range-offline-v1',scope:'CPU arrays and independent plane oracle; no browser/WebGL/GPU',cases,passed:cases.length>1&&cases.every(x=>x.passed)};
if(process.argv[2]){const p=resolve(process.argv[2]);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify({passed:result.passed,cases:cases.length,failed:cases.filter(x=>!x.passed)}));if(!result.passed)process.exitCode=1;


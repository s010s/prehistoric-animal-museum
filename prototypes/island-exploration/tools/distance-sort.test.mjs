import test from 'node:test'
import assert from 'node:assert/strict'
import {createDistanceSorter} from '../distance-sort.js'

const native = items => items.sort((a,b)=>a.viewDistanceSquared-b.viewDistanceSquared)
function check(sorter, values) {
  const items=values.map((viewDistanceSquared,id)=>({viewDistanceSquared,id})),expected=native([...items])
  assert.equal(sorter.sort(items),items)
  assert.equal(items.length,expected.length)
  for(let i=0;i<items.length;i++)assert.equal(items[i],expected[i],`identity/order at ${i}`)
}
test('keeps literal nearest order and input identities',()=>{
  const s=createDistanceSorter(),items=[{id:'far',viewDistanceSquared:9},{id:'first-near',viewDistanceSquared:1},{id:'mid',viewDistanceSquared:4},{id:'second-near',viewDistanceSquared:1}]
  s.sort(items);assert.deepEqual(items.map(p=>p.id),['first-near','second-near','mid','far'])
})
test('preserves exact Float64 and stable ties across a large list',()=>{
  const values=[0,-0,Number.MIN_VALUE,Number.MIN_VALUE*2,1e-300,1e-100,1,1+Number.EPSILON,2,65536,65536+Number.EPSILON*65536,1e100,Number.MAX_VALUE,Infinity]
  check(createDistanceSorter(),Array.from({length:32768},(_,i)=>values[(i*11)%values.length]))
})
test('matches legacy nearest selection for deterministic finite distances',()=>{
  let state=193706
  const values=Array.from({length:70013},(_,i)=>{state^=state<<13;state^=state>>>17;state^=state<<5;return i%13===0?42:(state>>>0)/4294967296*10**(-300+i%601)})
  check(createDistanceSorter(),values)
})
test('keeps legacy handling for exceptional distance values',()=>{
  const s=createDistanceSorter()
  check(s,Array.from({length:17001},(_,i)=>[NaN,undefined,-1,-Infinity,Infinity,3,2,0][i%8]))
})
test('does not leak prior indices or grow scratch on repeated smaller windows',()=>{
  const s=createDistanceSorter()
  check(s,Array.from({length:65539},(_,i)=>65539-i));const maximum=s.scratchBytes()
  assert.ok(maximum<=32*65539+2048,'bounded scratch budget')
  for(const n of [0,1,4,18003,32001,9001,65538,0,16002])check(s,Array.from({length:n},(_,i)=>(i*7919)%1009))
  assert.equal(s.scratchBytes(),maximum)
})
test('keeps stable order for already sorted, reversed and identical keys',()=>{
  const s=createDistanceSorter()
  for(const values of [Array.from({length:20003},(_,i)=>i),Array.from({length:20003},(_,i)=>20003-i),Array(20003).fill(7)])check(s,values)
})

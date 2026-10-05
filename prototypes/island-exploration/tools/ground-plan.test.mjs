// Written before reachable-anchor and fine-edge planner correction.
// Failure inventory: disconnected closest anchor, excessive snaps, broken return,
// steep sub-node strip missed by four probes, unbounded search, relaxed slopes.
import assert from 'node:assert/strict';import {writeFileSync,mkdirSync} from 'node:fs';import{dirname,resolve}from'node:path';import {makeGroundNavigation} from '../ground-navigation.js';
const cases=[];function check(name,fn){try{fn();cases.push({name,passed:true});}catch(error){cases.push({name,passed:false,error:String(error)});}}
const nav=heightAt=>makeGroundNavigation({heightAt,waterAt:()=>-100,rockAt:()=>false,animal:{constrain:()=>false}});
check('choose a reachable nearby anchor when closest node is isolated',()=>{const r=nav((x,z)=>Math.hypot(x-10,z)<2?20:0).plan([[0,0],[10,0]]);assert.equal(r.passed,true);assert.ok(Math.hypot(r.points.at(-1)[0]-10,r.points.at(-1)[1])<=6);assert.ok(r.segments[0].offsetMetres<=6);});
check('closed route returns to the actual starting point',()=>{const r=nav((x,z)=>Math.hypot(x-10,z)<2?20:0).plan([[0,0],[10,0],[0,0]]);assert.equal(r.passed,true);assert.deepEqual(r.points.at(-1),r.points[0]);});
check('fine movement probes reject a steep strip missed at quarter-node intervals',()=>{const r=nav(x=>x>.08&&x<.18?.24:0).plan([[0,0],[20,0]]);assert.equal(r.passed,false);assert.ok(r.visited<=8000);});
check('unreachable regions stop within the existing search cap',()=>{const r=nav(x=>x>=-1&&x<=3?50:0).plan([[0,0],[10,0]]);assert.equal(r.passed,false);assert.ok(r.visited<=8000);});
check('gentle ground retains normal walking and bounded anchor offsets',()=>{const r=nav(x=>x*.2).plan([[0,0],[20,0],[0,0]]);assert.equal(r.passed,true);assert.ok(r.segments.every(s=>s.offsetMetres<=6&&s.visited<=8000));assert.deepEqual(r.points.at(-1),r.points[0]);assert.equal(r.seconds,Math.ceil(r.length/1.55));});
check('close a bounded loop over already traversed edges when the direct box misses the detour',()=>{const r=nav((x,z)=>Math.abs(x)<=2&&z>=-60?40:0).plan([[-8,0],[-8,-75],[8,-75],[8,0],[-8,0]]);assert.equal(r.passed,true);assert.deepEqual(r.points.at(-1),r.points[0]);assert.equal(r.segments.at(-1).mode,'traversed-edges');assert.ok(r.segments.at(-1).visited<=8000);assert.ok(r.length>160);assert.equal(r.seconds,Math.ceil(r.length/1.55));});
const result={schema:'island-ground-plan-offline-v1',scope:'CPU fixture terrain only; not museum motion or GPU performance',cases,passed:cases.every(x=>x.passed)};
if(process.argv[2]){const p=resolve(process.argv[2]);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify({passed:result.passed,cases:cases.length,failed:cases.filter(x=>!x.passed)}));if(!result.passed)process.exitCode=1;

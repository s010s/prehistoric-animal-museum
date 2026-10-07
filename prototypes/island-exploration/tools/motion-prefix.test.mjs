// Real failure written BEFORE bounded-prefix/setup repair: planning the full
// 605 m loop blocked a headed click for 18.17 s; no FPS window was measured.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import * as api from '../motion-observation.js';
const cases=[];function check(name,fn){try{fn();cases.push({name,passed:true});}catch(error){cases.push({name,passed:false,error:String(error)});}}
const anchors=[[0,0],[5,0],[10,5],[10,25],[25,25],[200,300],[0,0]];
check('prefix keeps original bends and interpolates only final anchor',()=>{const p=api.measurementPrefixAnchors(anchors,38.75);assert.deepEqual(p.anchors.slice(0,4),anchors.slice(0,4));assert(p.anchors.length<anchors.length);assert(Math.abs(p.requestedMetres-38.75)<1e-10);assert.equal(p.sourceAnchorCount,anchors.length);assert(Math.abs(p.anchors.at(-1)[0]-(10+38.75-5-Math.sqrt(50)-20))<1e-10);});
check('prefix refuses invalid, zero or insufficient paths rather than implying full route',()=>{for(const [a,n]of [[anchors,0],[anchors,NaN],[[[0,0],[1,1]],38.75],[[[0,0],[NaN,1]],20]])assert.throws(()=>api.measurementPrefixAnchors(a,n));});
check('P3 requests prefix and limits setup separately from FPS',()=>{const s=readFileSync(new URL('../workload-review.js',import.meta.url),'utf8');assert.match(s,/prefixMetres:MOTION_POLICY\.routeSeconds\*1\.55/);assert.match(s,/setupMs/);assert.match(s,/5000/);assert.match(s,/overrideDeadlineRemaining[^\n]*25/);assert.match(s,/await new Promise\(resolve=>setTimeout\(resolve,0\)\)/);});
check('benchmark prefix is explicit and full-route default still exists',()=>{const s=readFileSync(new URL('../benchmark.js',import.meta.url),'utf8');assert.match(s,/prefixMetres=null/);assert.match(s,/side-spring-performance-prefix/);assert.match(s,/planRegion\(prefix\.anchors\)/);assert.match(s,/prefix\?planRegion\(prefix\.anchors\):planRegion\(\)/);});
check('main forwards caller anchors but defaults to full original anchors',()=>{const s=readFileSync(new URL('../main.js',import.meta.url),'utf8');assert.match(s,/planRegion:\(anchors=WALK_ROUTE\.anchors\)=>groundNav\.plan\(anchors\)/);});
check('moving boundary checks rendered readiness without rejecting worker pending',()=>{assert.equal(api.motionRenderedReady({skyCache:{ready:true},programErrors:0,terrain:{pending:true},vegetation:{pending:true},flow:{pending:true}}),true);assert.equal(api.motionRenderedReady({skyCache:{ready:false},programErrors:0}),false);assert.equal(api.motionRenderedReady({skyCache:{ready:true},programErrors:1}),false);});
const result={schema:'island-motion-prefix-offline-v1',scope:'prewritten bounded-prefix/setup checks; no browser/GPU',cases,passed:cases.every(c=>c.passed)};if(process.argv[2]){mkdirSync(dirname(resolve(process.argv[2])),{recursive:true});writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');}console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;

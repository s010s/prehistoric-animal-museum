import * as T from 'three';

// Ordinary input and the review walk use the same visible ground and obstacles.
// No physics backlog: at most 0.33m for a walking submission, including boost.
export function makeGroundNavigation({heightAt,waterAt,rockAt,animal}) {
  let last={blocked:null,distance:0};
  const probe=(x,z,from)=>{
    const h=heightAt(x,z),distance=from?Math.hypot(x-from.x,z-from.z):0;
    if(waterAt(x,z)-h>.65)return 'deep-water';
    if(rockAt(x,z,h))return 'rock';
    if(from&&distance>1e-5&&Math.abs(h-heightAt(from.x,from.z))>distance*.8+1e-4)return 'slope';
    for(const [dx,dz] of [[-.32,0],[.32,0],[0,-.32],[0,.32]])if(heightAt(x+dx,z+dz)>h+.65)return 'footprint';
    return null;
  };
  function move(position,previous,maxDistance=.33){
    let dx=position.x-previous.x,dz=position.z-previous.z,span=Math.hypot(dx,dz);
    if(span>maxDistance){dx*=maxDistance/span;dz*=maxDistance/span;span=maxDistance;}
    const n=Math.max(1,Math.ceil(span/.12)),p=previous.clone();let blocked=null;
    for(let i=0;i<n;i++){
      const x=p.x+dx/n,z=p.z+dz/n,reason=probe(x,z,p);
      if(!reason){p.x=x;p.z=z;continue;}
      blocked=reason;
      // Sliding retains the traversed distance and still probes the terrain.
      if(Math.abs(dx)>=Math.abs(dz)&&!probe(x,p.z,p))p.x=x;
      else if(!probe(p.x,z,p))p.z=z;
      else if(!probe(x,p.z,p))p.x=x;
    }
    p.y=heightAt(p.x,p.z)+1.75;
    if(animal.constrain(p,previous))blocked='animal';
    p.y=heightAt(p.x,p.z)+1.75;position.copy(p);
    last={blocked,distance:Math.hypot(p.x-previous.x,p.z-previous.z)};return last;
  }
  function plan(anchors){
    if(!anchors?.length||anchors.some(a=>a.length!==2||!a.every(Number.isFinite)))return {passed:false,reason:'Invalid review anchors',points:[]};
    const cache=new Map(),point=(x,z)=>{const key=x+','+z;if(!cache.has(key))cache.set(key,{x,z,h:heightAt(x,z),bad:probe(x,z)});return cache.get(key);};
    const candidates=([x,z])=>{const out=[];for(let dz=-6;dz<=6;dz++)for(let dx=-6;dx<=6;dx++){const p=point(Math.round(x)+dx,Math.round(z)+dz),distance=Math.hypot(p.x-x,p.z-z);if(!p.bad&&distance<=6)out.push({p,distance});}return out.sort((a,b)=>a.distance-b.distance);};
    const edges=new Map(),directions=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    const edgeAllowed=(p,q)=>{
      const a=p.x+','+p.z,b=q.x+','+q.z,key=a<b?a+'|'+b:b+'|'+a;
      if(edges.has(key))return edges.get(key);
      const dx=q.x-p.x,dz=q.z-p.z,d=Math.hypot(dx,dz),steps=Math.ceil(d/.05);
      let allowed=!p.bad&&!q.bad&&Math.abs(q.h-p.h)<=d*.8+1e-4;
      for(let j=1;allowed&&j<=steps;j++){
        if(probe(p.x+dx*j/steps,p.z+dz*j/steps,{x:p.x+dx*(j-1)/steps,z:p.z+dz*(j-1)/steps})||probe(q.x-dx*j/steps,q.z-dz*j/steps,{x:q.x-dx*(j-1)/steps,z:q.z-dz*(j-1)/steps}))allowed=false;
      }
      edges.set(key,allowed);return allowed;
    };
    const first=candidates(anchors[0]).find(c=>directions.some(([dx,dz])=>edgeAllowed(c.p,point(c.p.x+dx,c.p.z+dz))))?.p;
    if(!first)return {passed:false,reason:'No accessible start',points:[]};
    const path=[[first.x,first.z]],segments=[];let a=first;
    for(let k=1;k<anchors.length;k++){
      const [ax,az]=anchors[k],closing=k===anchors.length-1&&Math.hypot(ax-anchors[0][0],az-anchors[0][1])<.001;
      const goals=closing?[{p:first,distance:Math.hypot(first.x-ax,first.z-az)}]:candidates(anchors[k]);
      if(!goals.length)return {passed:false,reason:'No accessible anchor',segment:k,points:path};
      const key=p=>p.x+','+p.z,goalScores=new Map(goals.map(g=>[key(g.p),g.distance]));
      const open=[{p:a,g:0,f:0}],scores=new Map([[key(a),0]]),parents=new Map();let best=null,visited=0;
      while(open.length&&visited<8000){
        visited++;let at=0;for(let i=1;i<open.length;i++)if(open[i].f<open[at].f)at=i;
        const node=open.splice(at,1)[0],p=node.p;if(node.g!==scores.get(key(p)))continue;
        const offset=goalScores.get(key(p));
        if(offset!==undefined&&(!best||offset<best.distance)){best={p,distance:offset};if(offset<=goals[0].distance+1e-9)break;}
        for(const [dx,dz] of directions){
          const x=p.x+dx,z=p.z+dz;if(x<Math.min(a.x,ax)-18||x>Math.max(a.x,ax)+18||z<Math.min(a.z,az)-18||z>Math.max(a.z,az)+18)continue;
          const q=point(x,z),d=Math.hypot(dx,dz);if(!edgeAllowed(p,q))continue;
          const g=node.g+d;if(g>=(scores.get(key(q))??Infinity))continue;scores.set(key(q),g);parents.set(q,p);open.push({p:q,g,f:g+Math.hypot(ax-x,az-z)});
        }
      }
      if(!best)return {passed:false,reason:'Bounded path search could not join anchors',segment:k,visited,points:path};
      const b=best.p,run=[];for(let p=b;p!==a;p=parents.get(p))run.push([p.x,p.z]);path.push(...run.reverse());segments.push({anchor:k,visited,requested:[ax,az],selected:[b.x,b.z],offsetMetres:best.distance});a=b;
    }
    let length=0;for(let i=1;i<path.length;i++)length+=Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1]);
    return {passed:true,points:path,length,seconds:Math.ceil(length/1.55),segments,groundSamples:cache.size,edgeSamples:edges.size};
  }
  function audit(anchors,rocks){
    const route=plan(anchors),checks={boundedPlan:route.passed,visibleRockCollision:rocks.some(r=>probe(r.x,r.z)==='rock')};
    let blocked=0,travel=0,maxStep=0;const p=new T.Vector3();
    if(route.passed){p.set(route.points[0][0],heightAt(...route.points[0])+1.75,route.points[0][1]);for(const [x,z] of route.points.slice(1)){
      const target=new T.Vector3(x,heightAt(x,z)+1.75,z);while(p.distanceTo(target)>.03&&Math.hypot(p.x-x,p.z-z)>.01){const q=target.clone(),result=move(q,p,.055);if(result.distance<.001){blocked++;break;}travel+=result.distance;maxStep=Math.max(maxStep,result.distance);p.copy(q);if(!p.toArray().every(Number.isFinite)){blocked++;break;}if(travel>route.length*1.1){blocked++;break;}}
    }}
    checks.routeUsesOrdinaryConstraints=route.passed&&blocked===0;checks.boundedSteps=maxStep<=.055001;
    return {passed:Object.values(checks).every(Boolean),checks,route,blocked,travel,maxStep,collision:'visible rock bounds, exact rendered terrain, hero crags, animated animals'};
  }
  return {move,probe,plan,audit,status:()=>({...last,maxSlope:.8,eyeHeight:1.75})};
}

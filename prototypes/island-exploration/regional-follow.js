import * as T from 'three';

// Navigation distance follows checked edges, independently of the world clock.
// Late frames lose movement time; there is no backlog to consume after a pause.
export function makeRegionalFollower(points,move,speed=1.55){
  if(!points?.length||points.some(p=>p.length!==2||!p.every(Number.isFinite))||typeof move!=='function')throw Error('Invalid regional walking path');
  let length=0;for(let i=1;i<points.length;i++)length+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);
  let next=1,distance=0,blocked=null;const previous=new T.Vector3(),candidate=new T.Vector3();
  const status=()=>({distance,length,progress:length?Math.min(1,distance/length):1,complete:next>=points.length,blocked,next,speed,maxStep:.05,maxDeltaSeconds:.1});
  function advance(position,dt){
    let budget=Number.isFinite(dt)?speed*Math.max(0,Math.min(.1,dt)):0;
    while(budget>1e-8&&next<points.length&&!blocked){
      const [x,z]=points[next],dx=x-position.x,dz=z-position.z,remaining=Math.hypot(dx,dz);
      if(remaining<1e-7){next++;continue;}
      const step=Math.min(.05,budget,remaining);previous.copy(position);candidate.set(position.x+dx/remaining*step,position.y,position.z+dz/remaining*step);
      const expectedX=candidate.x,expectedZ=candidate.z,result=move(candidate,previous,step);position.copy(candidate);
      const error=Math.hypot(position.x-expectedX,position.z-expectedZ);
      if(result.blocked||result.distance<step-1e-5||error>1e-5){blocked=result.blocked??'path-deviation';break;}
      distance+=step;budget-=step;if(remaining-step<1e-7)next++;
    }
    return status();
  }
  return {advance,status};
}

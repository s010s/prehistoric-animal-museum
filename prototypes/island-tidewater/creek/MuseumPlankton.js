// Native procedural neighbourhood and tiny discs; inland water has neither
// sea-level depth nor ocean swell. Give slow freshwater drift a previous pose.
import {MarineSnow} from '../vendor/tidewater/src/fx/MarineSnow.js';
export class MuseumPlankton extends MarineSnow{
 constructor(options){super(options);const m=this.material;
  m.vertex=m.vertex.replace('let depth = max( frame.seaLevel - p.y, 0.0 );','let mediumHeight=waterQueryHeightAtXZ(p.xz);let inland=smoothstep(.1,.6,mediumHeight-frame.seaLevel);let depth=max(mediumHeight-p.y,0.0);');
  // Low-energy shallow-water advection with an analytic previous pose. The
  // native orbital texture has no previous-state binding; pretending its
  // moving positions are static left bright strings in the temporal history.
  m.vertex=m.vertex.replace('p += vec3f( sway.x, sway.y * 0.5, sway.z ) * 0.8;',`let anchor=p;
 let phase=frame.time*.27+h2*6.283+anchor*.09;
 let swayScale=mix(.09,.025,inland)*exp(-depth*.025);
 p+=sin(phase)*swayScale;`);
  m.vertex=m.vertex.replace('let size = mix( 0.003, 0.008, h2.x * h2.x ) + select( 0.0, 0.008, h2.y > 0.98 );','let size=mix(.001,.0035,h2.x*h2.x)+select(0.0,.0025,h2.y>.985);');
  m.vertex+=`\nlet current=vec3f(.05,-.012,.03)+(h2-.5)*.02;
 let oldAnchor=anchor-current*frame.dt;
 let oldPhase=(frame.time-frame.dt)*.27+h2*6.283+oldAnchor*.09;
 let oldP=oldAnchor+sin(oldPhase)*swayScale;
 v.prevWorldPos=oldP+right*q.x+up*q.y;`;
  m.needsUpdate=true;
 }
}

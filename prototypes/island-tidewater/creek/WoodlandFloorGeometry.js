import {BufferAttribute, BufferGeometry, Float32BufferAttribute, Vector3} from '../vendor/tidewater/src/engine/index.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {woodlandBranchScan} from './WoodlandBranchScan.js';

export const WOODLAND_FLOOR_FORMS = {
  'fallen-branch': {reach:34, flex:0, floorShadow:false},
  'split-bough':   {reach:34, flex:0, floorShadow:false},
  'needle-litter': {reach:32, flex:0, floorShadow:false},
  'moss-hummock':  {reach:35, flex:0, floorShadow:false},
};

function linearByte(v) {
  const s = v / 255;
  return Math.round(255 * (s <= .04045 ? s/12.92 : ((s + .055)/1.055)**2.4));
}

function colour(r,g,b) {
  return (linearByte(r) << 16) | (linearByte(g) << 8) | linearByte(b);
}

// Bark against mineral soil is appreciably darker than freshly exposed
// wood, especially on the damp underside of a fallen shoot.
function barkColour(r,g,b) {
  return colour(r*.53,g*.56,b*.59);
}

function scannedFork(lod) {
  const bytes = Uint8Array.from(atob(woodlandBranchScan[lod]), c => c.charCodeAt(0));
  const view = new DataView(bytes.buffer), count = view.getUint16(0,true), faceIndices = view.getUint16(2,true);
  const pos = [], normal = [], data = [], indices = new Uint16Array(faceIndices);
  let offset = 4;
  for (let i=0; i<count; i++,offset+=13) {
    pos.push(view.getInt16(offset,true)*.001, view.getInt16(offset+2,true)*.001, view.getInt16(offset+4,true)*.001);
    normal.push(view.getInt8(offset+6)/127,view.getInt8(offset+7)/127,view.getInt8(offset+8)/127);
    data.push(0,colour(bytes[offset+9]*.61,bytes[offset+10]*.59,bytes[offset+11]*.57),.47+.53*bytes[offset+12]/255,0);
  }
  for (let i=0; i<faceIndices; i++) indices[i]=view.getUint16(offset+2*i,true);
  const g = new BufferGeometry();
  g.setAttribute('position',new Float32BufferAttribute(pos,3));
  g.setAttribute('normal',new Float32BufferAttribute(normal,3));
  g.setAttribute('aData',new Float32BufferAttribute(data,4));
  g.setIndex(new BufferAttribute(indices,1));
  return g;
}

function woodyDebris(name, lod) {
  const pos=[], data=[], indices=[];
  const random=mulberry32(name==='split-bough' ? 92743 : 570347);
  const vec=(p)=>new Vector3(...p);
  function vertex(p, shade, ao=1) {
    pos.push(...p); data.push(0,shade,ao,0);
    return pos.length/3-1;
  }
  // Broken timber has a pale end grain ring and a darker ribbon of bark
  // below. Each fork narrows continuously into its terminal growth.
  function stem(points, radii, segments, bark) {
    const base=pos.length/3;
    for(let k=0;k<points.length;k++) {
      const tangent=vec(points[Math.min(k+1,points.length-1)]).sub(vec(points[Math.max(k-1,0)])).normalize();
      const side=new Vector3(-tangent.z,0,tangent.x).normalize();
      const normal=new Vector3().crossVectors(side,tangent);
      for(let j=0;j<segments;j++) {
        const a=2*Math.PI*j/segments;
        const thickness=radii[k]*(1+.12*Math.sin(3*a+.7*k)+.05*Math.cos(2*a-k));
        const p=vec(points[k]).addScaledVector(side,Math.cos(a)*thickness).addScaledVector(normal,Math.sin(a)*thickness);
        if(!k && radii[k]>.020)p.addScaledVector(tangent,radii[k]*Math.sin(2.1*a)*1.05);
        vertex(p.toArray(),bark[j%bark.length],.77+.18*Math.sin(a));
        if(k) {
          const b=base+k*segments+j,c=base+k*segments+(j+1)%segments;
          indices.push(b-segments,b,c,c,c-segments,b-segments);
        }
      }
    }
    for(const k of [0,points.length-1]){
      if(radii[k]<.006)continue;
      const centre=vertex(points[k],barkColour(166,123,88));
      for(let j=0;j<segments;j++) {
        const a=base+k*segments+j,b=base+k*segments+(j+1)%segments;
        if(k)indices.push(centre,b,a); else indices.push(centre,a,b);
      }
    }
  }
  function ribbon(x,z,y,angle,length,width,curve,shade,curl,steps=lod?2:3) {
    const ca=Math.cos(angle),sa=Math.sin(angle),base=pos.length/3;
    for(let j=0;j<=steps;j++) {
      const t=j/steps,arch=Math.sin(Math.PI*t), offset=curve*t*t;
      const breadth=width*(.10+.90*arch);
      for(const s of [-1,1]){
        const cross=offset+s*breadth;
        vertex([x+ca*length*t-sa*cross,y+arch*curl+s*arch*breadth*.32,z+sa*length*t+ca*cross],shade,.75+.22*arch);
      }
      if(j) {
        const a=base+2*j;
        indices.push(a-2,a-1,a,a-1,a+1,a);
      }
    }
  }
  const bark=[barkColour(83,65,46),barkColour(105,82,54),barkColour(123,98,68),barkColour(92,70,48),barkColour(70,56,43)];
  function curledBark(x,z,angle,len,width,bend) {
    const ca=Math.cos(angle),sa=Math.sin(angle),base=pos.length/3;
    // Split, irregular ends and a cupped edge expose a sliver of inner bark.
    const sections=[[-.06,.17,.62],[.17,.87,.88],[.49,1,.76],[.78,.74,1],[1,.15,.31]];
    for(let j=0;j<sections.length;j++) {
      const [t,l,r]=sections[j],offset=Math.sin(t*Math.PI)*bend;
      for(const [e,dy,shade] of [[-l,.018+.019*l,bark[0]],[0,0,bark[3]],[r,(1-t)*.056+.013,bark[2]]]) {
        const shift=t*len+e*.022;
        vertex([x+ca*shift-sa*(offset+e*width),.023+dy,z+sa*shift+ca*(offset+e*width)],shade,.84);
      }
      if(j)for(let k=0;k<2;k++) {
        const a=base+3*j+k;
        indices.push(a-3,a-2,a,a-2,a+1,a);
      }
    }
  }
  function shedShoot(x,z,angle,len,spread) {
    const ca=Math.cos(angle),sa=Math.sin(angle);
    const point=(t,w,h)=>[x+ca*len*t-sa*w,h,z+sa*len*t+ca*w];
    const spine=t=>spread*.18*t*t;
    const axis=[point(0,0,.045),point(.34,spine(.34),.078),point(.68,spine(.68),.070),point(1,spine(1),.041)];
    stem(axis,[.016,.012,.009,.003],lod?3:5,bark);
    const tips=[barkColour(89,75,50),barkColour(104,90,56),barkColour(121,93,58)];
    for(let i=0;i<8;i++) {
      const t=.16+i*.099;
      if(lod && i%2)continue;
      const width=spread*(.34+.66*Math.sin(t*Math.PI));
      for(const side of [-1,1]) {
        const foot=t+(side===1?.034:0),mid=point(foot,spine(foot),.048+Math.sin(t*Math.PI)*.024);
        const tip=point(foot+.16,spine(foot)+width*side,.037);
        const theta=Math.atan2(tip[2]-mid[2],tip[0]-mid[0]);
        const length=Math.hypot(tip[0]-mid[0],tip[2]-mid[2]);
        ribbon(mid[0],mid[2],mid[1],theta,length,.014,side*.018,tips[i%3],.012,2);
        if(!lod)ribbon(mid[0]+(tip[0]-mid[0])*.35,mid[2]+(tip[2]-mid[2])*.35,mid[1]+.004,
          theta+side*.59,length*.61,.009,side*.012,tips[(i+1)%3],.008,2);
      }
    }
  }
  if(name==='split-bough') {
    const axis=[[-.68,.047,-.06],[-.41,.085,-.025],[-.12,.10,.025],[.18,.072,.02],[.48,.067,.11],[.70,.049,.17]];
    stem(axis,[.048,.04,.032,.026,.014,.006],lod?4:7,bark);
    // Like the island's standing conifers, successive side shoots alternate
    // along a main limb. A snapped tip or two leave short, blunt stubs.
    for(let i=0;i<5;i++) {
      const p=axis[i+1], sign=i%2?-1:1, reach=[.31,.43,.34,.19,.23][i];
      const mid=[p[0]+.11,p[1]+.026,p[2]+sign*reach*.53];
      const tip=[p[0]+.20,p[1]-.018,p[2]+sign*reach];
      stem([p,mid,tip],[.019-i*.002,.012-i*.001,.004],lod?3:5,bark);
      if(!lod && i!==3)stem([mid,[mid[0]+.16,mid[1]-.012,mid[2]+sign*.08]],[.008,.002],4,bark);
    }
  } else if (name === 'moss-hummock') {
    // Low earthy woodland moss & humus hummock with fallen needles/bark bits.
    // Grounded via dark base vertex AO; casts no CSM shadows.
    const moss = [colour(38, 49, 25), colour(52, 60, 31), colour(46, 42, 27), colour(58, 66, 35)];
    const rings = lod ? 2 : 3, segs = lod ? 7 : 10;
    const lobe = (r, a) => r * (1 + .25 * Math.cos(a * 2 + .4) + .16 * Math.sin(a * 3 - .7));
    const mounds = [
      [0, 0, .58, .12, 0],
      [.34, .18, .36, .08, 1],
      [-.28, .22, .31, .065, 2],
    ];
    for (const [cx, cz, rx, hy, mIdx] of mounds) {
      if (lod && mIdx === 2) continue;
      const top = vertex([cx, hy, cz], moss[3], .90);
      const ringStarts = [];
      for (let r = 1; r <= rings; r++) {
        const t = r / rings;
        const start = pos.length / 3;
        ringStarts.push(start);
        const y = hy * Math.cos(t * Math.PI * .52);
        const ao = .38 + .50 * (1 - t * t);
        for (let s = 0; s < segs; s++) {
          const a = 2 * Math.PI * s / segs;
          const rad = lobe(rx * t, a + mIdx * 1.1);
          const shade = moss[(s + mIdx * 2 + r) % moss.length];
          vertex([cx + Math.cos(a) * rad, Math.max(-.014, y + (random() - .5) * .022 * (1 - t * .5)), cz + Math.sin(a) * rad * .86], shade, ao);
        }
      }
      for (let s = 0; s < segs; s++) {
        const s1 = (s + 1) % segs;
        indices.push(top, ringStarts[0] + s1, ringStarts[0] + s);
      }
      for (let r = 0; r < rings - 1; r++) {
        const a0 = ringStarts[r], b0 = ringStarts[r + 1];
        for (let s = 0; s < segs; s++) {
          const s1 = (s + 1) % segs;
          indices.push(a0 + s, a0 + s1, b0 + s, a0 + s1, b0 + s1, b0 + s);
        }
      }
    }
    if (!lod) {
      const needles = [barkColour(110, 86, 50), barkColour(88, 70, 44)];
      stem([[-.48, .032, -.18], [-.16, .072, -.05], [.14, .054, .12], [.42, .026, .24]], [.024, .019, .014, .006], 4, bark);
      curledBark(.18, -.26, .65, .28, .048, .05);
      for (let j = 0; j < 6; j++) {
        const a = random() * Math.PI * 2, d = random() * .34;
        ribbon(Math.cos(a) * d, Math.sin(a) * d, .06 + (1 - d / .4) * .05, random() * Math.PI * 2, .11 + random() * .10, .008, .02, needles[j % 2], .012, 2);
      }
    }
  } else {
    // Shed laterals retain sprays of dead needles. Loose needles and strips
    // of bark pool around the older, partly broken limb with soil between.
    const needles=[barkColour(117,91,53),barkColour(138,103,57),barkColour(95,75,46),barkColour(81,66,46)];
    shedShoot(-.52,-.08,.55,.63,.19);
    shedShoot(.12,.29,-1.32,.39,.12);
    stem([[-.59,.041,.26],[-.33,.074,.18],[-.12,.061,.17],[.16,.042,.21]],[.031,.024,.021,.013],lod?4:6,bark);
    stem([[-.33,.074,.18],[-.25,.11,.08],[-.17,.09,.005]],[.014,.010,.004],lod?3:4,bark);
    for(let i=0;i<4;i++) {
      const a=random()*Math.PI*2, reach=i===0?0:.23+random()*.51;
      const x=Math.cos(a)*reach,z=Math.sin(a)*reach*.69, direction=random()*Math.PI*2;
      for(let j=0;j<9;j++){
        const args=[x+(random()-.5)*.34,z+(random()-.5)*.26,.025+random()*.014,direction+(random()-.5)*2.55,
          .085+random()*.15,.006+random()*.007,(random()-.5)*.055,needles[j%needles.length],.010+random()*.013];
        if(!lod || j%3===0)ribbon(...args);
      }
      curledBark(x,z,direction+1.4,.20+random()*.22,.039+random()*.041,(random()-.5)*.13);
    }
  }
  const g=new BufferGeometry();
  g.setAttribute('position',new Float32BufferAttribute(pos,3));
  g.setAttribute('aData',new Float32BufferAttribute(data,4));
  g.setIndex(new BufferAttribute(new Uint32Array(indices),1));
  g.computeVertexNormals();
  return g;
}

export function woodlandFloorGeometry(name,lod) {
  return name==='fallen-branch' ? scannedFork(lod) : woodyDebris(name,lod);
}

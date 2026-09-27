import {swellGLSL,oceanGeometry,makeRockSpray} from './water-motion.js'
import * as T from 'three'
import {skyGLSL} from './sky.js'
import {contactOcclusionGLSL} from './contact-occlusion.js'
import {riverReach} from './hydrology.js'
import {makeFlowField} from './flow-field.js'
import {Reflector} from 'three/addons/objects/Reflector.js'
import {SEA,riverX,halfWidth,riverLevel,lake,wetland,wetlandLevel,tarn,tributaryX,tributaryLevel,waterLevelAt,terrainHeight} from './field.js'
export function makeWater(renderer,camera,rocks,skyUniforms,getFine=()=>false){
 const field=makeFlowField(rocks),rippleMap=new T.TextureLoader().load("./assets/river-ripples.png");rippleMap.wrapS=rippleMap.wrapT=T.RepeatWrapping;rippleMap.anisotropy=8
 const resolution=new T.Vector2(),opaque=new T.WebGLRenderTarget(1,1,{samples:0,type:T.HalfFloatType,depthTexture:new T.DepthTexture(1,1,T.UnsignedIntType)})
 const reflector=new Reflector(new T.PlaneGeometry(60000,60000),{textureWidth:384,textureHeight:384,clipBias:.001});reflector.rotation.x=-Math.PI/2
 const coastDepth=new T.DataTexture(new Uint8Array([255]),1,1,T.RedFormat);coastDepth.needsUpdate=true;
 // Exact piecewise-linear footprint of the river mesh: one owner at each point.
 const coverageData=new Float32Array(851*4);for(let i=0;i<=850;i++){const z=-4000+i*8;coverageData.set([riverX(z),halfWidth(z)+25,0,1],i*4)}
 const coverage=new T.DataTexture(coverageData,851,1,T.RGBAFormat,T.FloatType);coverage.minFilter=coverage.magFilter=T.NearestFilter;coverage.needsUpdate=true;
 const waterScene=new T.Scene(),u={riverCoverage:{value:coverage},coastDepth:{value:coastDepth},terrainSpan:{value:20480},oceanCenter:{value:new T.Vector2()},...skyUniforms,aoEnabled:{value:getFine()?1:0},opaque:{value:opaque.texture},sceneDepth:{value:opaque.depthTexture},reflection:{value:reflector.getRenderTarget().texture},reflectionMatrix:{value:new T.Matrix4()},debug:{value:({normal:1,reflection:2,depth:3,foam:4,body:5}[new URLSearchParams(location.search).get('water')]??0)},reflectionY:{value:0},time:{value:0},resolution:{value:resolution},cameraNear:{value:camera.near},cameraFar:{value:camera.far},sunDir:{value:new T.Vector3(-.55,.72,.31).normalize()},rippleMap:{value:rippleMap},viewToWorld:{value:camera.matrixWorld},inverseProjection:{value:camera.projectionMatrixInverse},screenSize:{value:resolution},flowMap:{value:field.texture},flowOrigin:{value:field.origin},flowSpan:{value:field.span}}
 const mat=new T.ShaderMaterial({uniforms:u,depthTest:false,depthWrite:false,transparent:true,
 vertexShader:`${swellGLSL}
 attribute float waterKind;varying float kind;attribute vec2 velocity;attribute vec2 riverCoord;varying vec2 channel;varying vec3 wp;varying float vd,seaMask;varying vec2 flow;
 void main(){wp=position;flow=velocity;channel=riverCoord;kind=waterKind;seaMask=1.-step(.5,kind);
 if(kind<.5)wp.xz+=oceanCenter;
 float tidal=kind<.5?1.:(kind<1.5?smoothstep(1900.,2800.,wp.z):0.);
 wp.y+=swell(wp.xz).x*tidal;
 vec4 p=viewMatrix*vec4(wp,1.);vd=-p.z;gl_Position=projectionMatrix*p;}`,
 fragmentShader:`
 #include <common>
 #include <packing>
 varying float kind;uniform sampler2D riverCoverage;uniform sampler2D opaque,sceneDepth,reflection;uniform mat4 reflectionMatrix,viewToWorld;uniform vec2 resolution;uniform float cameraNear,cameraFar,reflectionY,debug;uniform vec3 sunDir;uniform sampler2D rippleMap,flowMap;uniform vec2 flowOrigin;uniform float flowSpan;varying vec3 wp;varying float vd,seaMask;varying vec2 flow;varying vec2 channel;
 ${swellGLSL}
 ${contactOcclusionGLSL}
 uniform float aoEnabled;
 ${skyGLSL}
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
 // Analytic derivatives of band-limited noise; no repeating sine-wave rows.
 vec2 gradNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f),du=6.*f*(1.-f);float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+1.);return du*vec2(mix(b-a,d-c,u.y),mix(c-a,d-b,u.x));}
 vec2 filteredGradient(vec2 p){float footprint=max(length(dFdx(p)),length(dFdy(p)));return gradNoise(p)*(1.-smoothstep(.45,1.7,footprint));}
 vec2 riverSurface(vec2 p){mat2 r=mat2(.8,.6,-.6,.8);return filteredGradient(p*.48)*.65+transpose(r)*filteredGradient(r*p*1.37+17.)*.28+filteredGradient(p*3.73+vec2(53.,9.))*.10;}
 float sceneZ(vec2 uv){return -perspectiveDepthToViewZ(texture2D(sceneDepth,uv).x,cameraNear,cameraFar);}
 void main(){
 if(kind<.5&&wp.z>=-4000.&&wp.z<2800.){float row=(wp.z+4000.)/8.;vec2 a=texture2D(riverCoverage,vec2((floor(row)+.5)/851.,.5)).rg,b=texture2D(riverCoverage,vec2((floor(row)+1.5)/851.,.5)).rg;vec2 bounds=mix(a,b,fract(row));if(abs(wp.x-bounds.x)<bounds.y)discard;}
 // Wetland owns its footprint above the sea; never let the ocean show through it.
 if((kind<.5||kind>2.5&&wp.z>=4800.)&&wp.x>945.&&wp.x<6255.&&wp.z>3630.&&wp.z<7170.)discard;
 vec2 screen=gl_FragCoord.xy/resolution;float thick=sceneZ(screen)-vd;if(thick<=.015)discard;
 vec3 eye=normalize(cameraPosition-wp);float speed=length(flow);float tidal=kind<.5?1.:(kind<1.5?smoothstep(1900.,2800.,wp.z):0.);float backwater=kind>2.5&&wp.z>0.?1.-smoothstep(4100.,4800.,wp.z):1.;float river=step(.3,speed)*(1.-tidal)*backwater;
 float depth=max(0.,wp.y-(viewToWorld*vec4(viewPoint(screen),1.)).y);
 vec2 fuv=(wp.xz-flowOrigin)/flowSpan;float local=1.-smoothstep(.34,.49,max(abs(fuv.x-.5),abs(fuv.y-.5)));vec4 ff=texture2D(flowMap,clamp(fuv,0.,1.));
 vec2 velocity=mix(flow,(ff.rg-.5)*6.,local*river);float current=length(velocity);
 // Longitudinal travel time is integrated once in mesh coordinates. No reset/crossfade.
 vec2 direction=normalize(flow+vec2(.00001));vec2 across=vec2(direction.y,-direction.x);
 vec2 deformation=vec2(dot(velocity-flow,across),dot(velocity-flow,direction))*.45;
 vec2 adv=channel-vec2(0.,time)+deformation;
 float riffle=(1.-smoothstep(1.2,3.5,depth))*smoothstep(.45,1.6,current);
 float strength=.023+riffle*.14+ff.b*local*.24;
 vec2 localNormal=riverSurface(adv)*strength;vec2 moving=across*localNormal.x+direction*localNormal.y;
 mat2 turn=mat2(.6,.8,-.8,.6);vec2 windP=wp.xz-vec2(.82,.31)*time;
 float gust=.25+.75*smoothstep(.20,.8,noise(wp.xz/190.-time*.006));
 vec2 wind=filteredGradient(windP*.035)*.07+transpose(turn)*filteredGradient(turn*windP*.13+13.)*.033+filteredGradient(windP*.58+vec2(28.,9.))*.012;
 float exposedSea=tidal;wind*=mix(.34,1.,exposedSea)*gust*mix(.38,1.,smoothstep(.15,5.,depth));
 // Shallow-water wave packets break unevenly along the coast, not in full rings.
 float shoal=(1.-smoothstep(.25,.85,depth))*smoothstep(.035,.16,depth)*exposedSea;
 float coastCrest=wavePacket(wp.xz,-.44,137.,1.,.57,1.2).x;
 float pulse=smoothstep(.38,.64,coastCrest)*smoothstep(.36,.68,noise(wp.xz*.27-vec2(.2,.1)*time));
 wind+=filteredGradient(wp.xz*.8-vec2(.9,.28)*time)*shoal*pulse*.045;
 float footprint=max(length(dFdx(wp.xz)),length(dFdy(wp.xz)));vec2 seaSlope=oceanSlope(wp.xz,footprint)*exposedSea;vec2 slope=mix(wind-seaSlope,moving,river);vec3 surfaceNormal=normalize(cross(dFdx(wp),dFdy(wp)));surfaceNormal*=surfaceNormal.y<0.?-1.:1.;vec3 normal=normalize(mix(vec3(0.,1.,0.),surfaceNormal,river)+vec3(slope.x,0.,slope.y));
 float fresnel=.02+.98*pow(1.-max(0.,dot(eye,normal)),5.);
 vec2 distort=normal.xz*.008*smoothstep(.02,1.8,thick);vec2 refrUv=clamp(screen+distort,vec2(.002),vec2(.998));if(sceneZ(refrUv)<vd)refrUv=screen;
 vec3 bottom=texture2D(opaque,refrUv).rgb;
 float opticalPath=max(0.,thick)*length(cameraPosition-wp)/max(.1,vd);
 vec3 transmission=exp(-vec3(.22,.095,.075)*opticalPath);
 vec3 body=bottom*transmission+mix(vec3(.018,.075,.105),vec3(.021,.069,.054),river)*(1.-transmission);
 vec4 rc=reflectionMatrix*vec4(wp.x,reflectionY,wp.z,1.);vec2 ruv=rc.xy/rc.w+normal.xz*.005;
 vec3 mirror=texture2D(reflection,clamp(ruv,vec2(.002),vec2(.998))).rgb;
 float localReflection=(1.-smoothstep(1.,12.,abs(wp.y-reflectionY)))*(1.-smoothstep(280.,650.,vd));
 if(localReflection<.999){vec3 sky=skyRadiance(reflect(-eye,normal),wp);// Sloped rivers cannot use a distant horizontal mirror. Rough unresolved
 // banks retain the river's environment tint instead of a chalk-white sky strip.
 vec3 riverEnvironment=mix(body,sky, .30);sky=mix(sky,riverEnvironment,river);
 mirror=mix(sky,mirror,localReflection);}
 vec3 col=mix(body,mirror,fresnel*.78);
 float glint=pow(max(0.,dot(normal,normalize(eye+sunDir))),110.);col+=vec3(1.,.9,.7)*glint*.16*smoothstep(.1,1.,thick);
 float foam=ff.b*local*river;
 float filaments=smoothstep(.43,.72,noise(adv*3.8));
 float broken=smoothstep(.40,.70,noise(adv*.85+vec2(noise(adv/4.))*2.));
 float white=(foam*.65*filaments*mix(.2,1.,broken)+riffle*river*broken*.085+shoal*pulse*.22)*smoothstep(.03,.22,depth)*(1.-smoothstep(180.,750.,vd));
 float springRun=(1.-smoothstep(-3985.,-3972.,wp.z))*step(-4011.,wp.z)*step(2.5,speed);
 white=max(white,springRun*(.18+.42*filaments)*smoothstep(.03,.18,depth));
 col=mix(col,vec3(.81,.88,.83),white);
 vec3 ray=normalize(wp-cameraPosition);float distanceToEye=length(wp-cameraPosition);float mist=1.-exp(-distanceToEye*.00011);col=mix(col,skyGradient(normalize(vec3(ray.x,max(.025,ray.y),ray.z))),mist);col=mix(col,seaDistance(ray),smoothstep(4500.,11000.,distanceToEye));
 if(debug==1.)col=normal*.5+.5;if(debug==2.)col=mirror;if(debug==3.)col=vec3(thick*.15);if(debug==4.)col=vec3(white);if(debug==5.)col=body;
 gl_FragColor=vec4(col,smoothstep(.015,max(.23,vd*.0007),thick));
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`})
 function add(g,flow,kind=2){g.setAttribute('waterKind',new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(kind),1));if(!g.attributes.velocity)g.setAttribute('velocity',new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2).map((_,i)=>flow[i%2]),2));if(!g.attributes.riverCoord)g.setAttribute('riverCoord',new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));const m=new T.Mesh(g,mat);m.frustumCulled=false;waterScene.add(m);return m}
 add(oceanGeometry(),[.11,.06],0)
 const p=[],v=[],rc=[],idx=[],segments=850,acrossSegments=24;let travel=0,previousX=riverX(-4000),previousZ=-4000
 for(let i=0;i<=segments;i++){const z=-4000+i*8,x=riverX(z),w=halfWidth(z)+25,y=riverLevel(z),dx=(riverX(z+1)-riverX(z-1))/2,len=Math.hypot(dx,1);travel+=Math.hypot(x-previousX,z-previousZ)/riverReach(z).speed;previousX=x;previousZ=z;
 for(let k=0;k<=acrossSegments;k++){const offset=w*(k/acrossSegments*2-1);rc.push(offset,travel);p.push(x+offset,y,z);v.push(dx/len*riverReach(z).speed,1/len*riverReach(z).speed);if(i<segments&&k<acrossSegments){const j=i*(acrossSegments+1)+k;idx.push(j,j+acrossSegments+1,j+1,j+1,j+acrossSegments+1,j+acrossSegments+2)}}}
 const river=new T.BufferGeometry();river.setAttribute('position',new T.Float32BufferAttribute(p,3));river.setAttribute('velocity',new T.Float32BufferAttribute(v,2));river.setAttribute('riverCoord',new T.Float32BufferAttribute(rc,2));river.setIndex(idx);add(river,[0,.8],1);mat.side=T.DoubleSide
 // A narrow spring run over the source bedrock, flowing into the wider basin.
 const sp=[],sv=[],sc=[],si=[];
 for(let i=0;i<=40;i++){const z=-4010+i,x=riverX(z)+Math.sin(i*.15)*.8,y=Math.max(riverLevel(z)+.035,terrainHeight(x,z)+.32),w=2.2+i*.055;for(const side of [-1,1]){sp.push(x+side*w,y,z);sv.push(.5,2.8);sc.push(side*w,i/2.8)}if(i<40){const j=i*2;si.push(j,j+2,j+1,j+1,j+2,j+3)}}
 const sg=new T.BufferGeometry();sg.setAttribute('position',new T.Float32BufferAttribute(sp,3));sg.setAttribute('velocity',new T.Float32BufferAttribute(sv,2));sg.setAttribute('riverCoord',new T.Float32BufferAttribute(sc,2));sg.setIndex(si);add(sg,[.5,2.8],3);
 const pool=new T.PlaneGeometry(lake.rx*3.5,lake.rz*3.5);pool.rotateX(-Math.PI/2);pool.translate(lake.x,lake.level,lake.z);add(pool,[.1,.04])
 for(const body of [wetland,tarn]){const g=new T.PlaneGeometry(body.rx*(body===wetland?2.36:3.5),body.rz*(body===wetland?2.36:3.5),body===wetland?32:1,body===wetland?64:1);g.rotateX(-Math.PI/2);g.translate(body.x,body.level,body.z);if(body===wetland){const a=g.attributes.position;for(let i=0;i<a.count;i++)a.setY(i,wetlandLevel(a.getZ(i)))}add(g,[.04,.01])}
 const tp=[],tv=[],tc=[],ti=[];for(let i=0;i<=588;i++){const z=100+i*8,x=tributaryX(z),dx=(tributaryX(z+1)-tributaryX(z-1))/2;for(const side of [-1,1]){tc.push(side*50,z/.7);tp.push(x+side*50,tributaryLevel(z),z);tv.push(dx*.7,.7)}if(i<588){const j=i*2;ti.push(j,j+2,j+1,j+1,j+2,j+3)}}const tg=new T.BufferGeometry();tg.setAttribute('position',new T.Float32BufferAttribute(tp,3));tg.setAttribute('velocity',new T.Float32BufferAttribute(tv,2));tg.setAttribute('riverCoord',new T.Float32BufferAttribute(tc,2));tg.setIndex(ti);add(tg,[0,.7],3);
 const copyScene=new T.Scene(),copyCamera=new T.OrthographicCamera(-1,1,1,-1,0,1),copy=new T.ShaderMaterial({uniforms:{aoEnabled:u.aoEnabled,map:{value:opaque.texture},sceneDepth:{value:opaque.depthTexture},inverseProjection:{value:camera.projectionMatrixInverse},screenSize:{value:resolution}},depthTest:false,depthWrite:false,vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`uniform sampler2D map,sceneDepth;uniform float aoEnabled;varying vec2 vUv;${contactOcclusionGLSL}
void main(){gl_FragColor=texture2D(map,vUv);if(aoEnabled>.5)gl_FragColor.rgb*=contactAO(vUv);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`});copyScene.add(new T.Mesh(new T.PlaneGeometry(2,2),copy))
 let spray=null,lastW=0,lastH=0,lastFine=null,lastReflection=-1;const reflectionPosition=new T.Vector3(1e8,1e8,1e8)
 return {setTerrainDepth(data,size,span){const tx=new T.DataTexture(data,size,size,T.RedFormat);tx.minFilter=tx.magFilter=T.LinearFilter;tx.needsUpdate=true;u.coastDepth.value.dispose();u.coastDepth.value=tx;u.terrainSpan.value=span;},render(scene,camera,time){if(!spray){spray=makeRockSpray(rocks,u);waterScene.add(spray)}u.oceanCenter.value.set(camera.position.x,camera.position.z);const fine=getFine();u.aoEnabled.value=fine?1:0;if(fine!==lastFine){opaque.samples=0;opaque.dispose();reflector.getRenderTarget().setSize(fine?768:384,fine?768:384);lastFine=fine;lastReflection=-1}renderer.getDrawingBufferSize(resolution);if(resolution.x!==lastW||resolution.y!==lastH){opaque.setSize(resolution.x,resolution.y);lastW=resolution.x;lastH=resolution.y}u.time.value=time;field.update(camera);
 const level=waterLevelAt(camera.position.x,camera.position.z);
 if(lastReflection<0||time-lastReflection>(fine?1/60:1/12)||reflectionPosition.distanceTo(camera.position)>18||Math.abs(level-u.reflectionY.value)>1){
 u.reflectionY.value=level;reflector.position.y=level;reflector.updateMatrixWorld();const shadowUpdate=renderer.shadowMap.autoUpdate;renderer.shadowMap.autoUpdate=false;reflector.onBeforeRender(renderer,scene,camera);renderer.shadowMap.autoUpdate=shadowUpdate;u.reflectionMatrix.value.copy(reflector.material.uniforms.textureMatrix.value).multiply(new T.Matrix4().copy(reflector.matrixWorld).invert());lastReflection=time;reflectionPosition.copy(camera.position);
 }
 renderer.setRenderTarget(opaque);renderer.clear();renderer.render(scene,camera);renderer.setRenderTarget(null);renderer.render(copyScene,copyCamera);renderer.autoClear=false;renderer.render(waterScene,camera);renderer.autoClear=true;
 }}
}

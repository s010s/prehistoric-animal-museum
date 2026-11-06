// A daylight world keeps one exposure when the visitor turns or walks.
// Metering the rendered image introduced delayed composition-dependent pumping.
export function makeExposureMeter(){
 const exposure=1.35;
 return {status:()=>({valid:true,pending:false,desired:exposure,mean:null,error:null,mode:'fixed-daylight'}),
 update(renderer){renderer.toneMappingExposure=exposure;}};
}

import {build} from 'vite';import{fileURLToPath}from'node:url';await build({configFile:false,root:fileURLToPath(new URL('.',import.meta.url)),base:'./',worker:{format:'es'},build:{outDir:process.argv.includes('--publish')?'../river-realism/dist':'.review-dist',emptyOutDir:true,assetsInlineLimit:0,chunkSizeWarningLimit:950}})
// Serve only the assets the accepted scene uses; all rejected experiments stay private.
const {readdir,rm}=await import('node:fs/promises');
const out=fileURLToPath(new URL(`${process.argv.includes('--publish')?'../river-realism/dist':'.review-dist'}/assets/`,import.meta.url));
const keep=new Set(['meadow-grass.glb','pine-b-atlas.webp','scanned-props.glb','fir-a-atlas.webp','fir-a-spatial-near-layered.glb','cloud-weather-r4.png','river-ripples.png',...['cliff','ganges_river_pebbles','rocky_terrain_02','leafy_grass','sandy_gravel_02'].flatMap(n=>['albedo','normal','arm'].map(c=>`${n}-${c}.webp`))]);
for(const name of await readdir(out))if(!keep.has(name)&&!name.endsWith('.js')&&!name.endsWith('.css'))await rm(`${out}/${name}`,{force:true,recursive:true});

// Metric spans are the in-world extent of a colony on the shelf.
export const CORALS = [
  {id:'acrocyathus',span:[.30,.52]},
  {id:'favosites',span:[.34,.75]},
  {id:'halysites',span:[.32,.62]},
  {id:'flabellum',span:[.11,.23]},
  {id:'micrabacia',span:[.05,.11]},
  {id:'thecosmilia',span:[.28,.54]},
];
export const SHELLS = ['trigonia','naticarius','siphocypraea'];
export const SPONGES = ['pirania'];
export const REEF_URLS = {
  acrocyathus:new URL('./assets/acrocyathus-lowpoly-vault.glb',import.meta.url).href,
  favosites:new URL('./assets/favosites-lowpoly-vault.glb',import.meta.url).href,
  halysites:new URL('./assets/halysites-lowpoly-vault.glb',import.meta.url).href,
  flabellum:new URL('./assets/flabellum-lowpoly-vault.glb',import.meta.url).href,
  micrabacia:new URL('./assets/micrabacia-lowpoly-vault.glb',import.meta.url).href,
  thecosmilia:new URL('./assets/thecosmilia-lowpoly-vault.glb',import.meta.url).href,
  trigonia:new URL('./assets/trigonia-lowpoly-vault.glb',import.meta.url).href,
  naticarius:new URL('./assets/naticarius-lowpoly-vault.glb',import.meta.url).href,
  siphocypraea:new URL('./assets/siphocypraea-lowpoly-vault.glb',import.meta.url).href,
  pirania:new URL('./assets/pirania-lowpoly-vault.glb',import.meta.url).href,
};

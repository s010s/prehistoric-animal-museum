import json, urllib.request, os, sys
op=urllib.request.build_opener(); op.addheaders=[('User-Agent','tidewater-asset-fetch/1.0')]; urllib.request.install_opener(op)
import pathlib
OUT=str(pathlib.Path(__file__).parent/'.raw')
TEX=['weathered_brown_planks','weathered_planks','worn_corrugated_iron','weathered_peeling_timber']
MOD=['wooden_crate_02','wooden_crate_01','wooden_bucket_01','fish_knife','wooden_cutting_board','lifebuoy','wooden_lantern_01','fishermans_hat','WoodenTable_03','metal_jerrycan_green','plastic_jerrycan','life_jacket','metal_toolbox','wooden_display_shelves_01']
def get(url, path):
    if os.path.exists(path): return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    urllib.request.urlretrieve(url, path)
def files(i): return json.load(urllib.request.urlopen('https://api.polyhaven.com/files/'+i))
for t in TEX:
    f=files(t)
    for m in ['Diffuse','nor_gl','arm']:
        u=f[m]['1k']['jpg']['url']; get(u, f'{OUT}/tex/{t}/{t}_{m}.jpg')
    print('tex',t)
for m in MOD:
    g=files(m)['gltf']['1k']['gltf']
    get(g['url'], f'{OUT}/mod/{m}/{m}.gltf')
    for k,v in g['include'].items(): get(v['url'], f'{OUT}/mod/{m}/{k}')
    print('mod',m)

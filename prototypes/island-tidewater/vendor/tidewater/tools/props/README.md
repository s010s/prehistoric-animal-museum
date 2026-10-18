# Vendor stall assets

Builds `public/models/props/` (Joe's fish stand and Marta's chandlery, see `src/game/StallKit.js`)
from Poly Haven CC0 downloads.

```sh
python3 tools/props/fetch.py                                             # downloads into tools/props/.raw (git-ignored)
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/props/decimate.py   # decimated copies in .raw/dec
node tools/props/build.mjs                                               # needs ImageMagick (magick)
```

`build.mjs` packs every model into `props.bin` / `props.json` (position, normal, uv and texture layer per
vertex), writes 512 px prop textures and 1K surface textures, and draws `signs.png` (signs, chalk prices,
the scale dial) with the fonts in `fonts/` (Apache 2.0 / SIL OFL 1.1, licence texts included).
To add a prop: add its Poly Haven id to `MOD` in fetch.py, `MODELS` in build.mjs and `BUDGET` in
decimate.py, rebuild, then place it with `KitBuilder.prop( name, matrix )`.

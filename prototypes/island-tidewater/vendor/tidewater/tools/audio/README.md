# Audio build (fishing sounds)

Rebuilds the fishing sounds in `public/audio/` from CC0 Freesound previews. Needs node and ffmpeg
(libopus). Nothing is synthesised: every sound is a real recording (sources and licences in
`public/audio/CREDITS.md`).

```sh
cd tools/audio
node search.mjs "fishing reel"          # CC0-only Freesound search: id:user duration downloads title
node dl.mjs 509902:tosha73 507070:paulprit 450849:kyles 371313:Mrthenoronha 725426:mwchristian95 \
  523282:MrFossy 464697:BranndyBottle 849752:JoelMcDaniel 537084:khenshom 507094:paulprit \
  507093:paulprit 649003:ramattahatta 570208:RatBird 336585:Anthousai
                                         # -> raw/<id>.ogg + raw/<id>.json (prints each licence; check CC0)
node build-fishing.mjs                   # -> out/*.ogg + fishing-bank.json
cp out/*.ogg ../../public/audio/         # then copy the entries of fishing-bank.json into src/audio/soundBank.js
```

- Loops (`reel_wind`, `reel_drag`, `line_strain`): excerpt, equal-power crossfade at the wrap, loudness-normalised
  to -23 LUFS integrated; `lufs` in the bank is the median momentary loudness.
- Sprites (all others): slices peak-normalised to -1 dBFS; `lufs` is each slice's maximum momentary loudness.
- The mixer (`src/audio/SoundScape.js`, `MIX`) turns target loudness into gains with those measurements.

`raw/`, `work/` and `out/` are build scratch (not committed).

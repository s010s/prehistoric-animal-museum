# Animal package authoring guide

This guide is the maintainer workflow for adding or replacing a public
prehistoric-animal presentation. Multiple high-risk animals may advance in
parallel when the owner explicitly chooses that tradeoff. Give every animal an
independent run directory, review contract, model lock, evidence package and
promotion transaction so one animal's exception or failure cannot unlock
another. A package is not published merely because it renders locally.

## 1. Package layout

Copy an existing package with similar presentation needs and keep this
canonical layout:

```text
src/content/animals/<animal-id>/
  animal.ts
  content.zh-CN.ts
  content.en.ts
  package.ts
  provenance.ts
  model/model.glb
  images/poster.webp
  images/poster-portrait.webp
  images/thumbnail.webp
  images/preview-*.webp
  images/model-preview.manifest.json
  backgrounds/landscape.webp
  backgrounds/portrait.webp
  audio/narration.zh-CN.mp3
  audio/narration.en.mp3
  provenance/LICENSES/
    model-license.txt
    model-source.txt
    background-generation.txt
    derived-images.txt
    narration-rights.txt
```

Use a stable lowercase ASCII kebab-case ID. The directory name, package ID,
collection entry, local asset records, and URLs must agree.

## 2. Intake before editing

Discover candidates with broad terms such as `dinosaur`, `prehistoric bird`,
and `pterosaur` before narrowing to a genus. Apply downloadable and reusable
licence filters, then look at the model from more than one angle. Prioritise a
convincing silhouette, surface quality, a calm presentation for children, and
variety against the existing collection. A low triangle count or an older
plausible reconstruction is a reason to inspect the asset, not to discard it
without seeing it.

Check the uploader's own description before investing in a download or model
work. A CC BY label records the uploader's licence claim; when the description
identifies a third-party film or game model, establish that the original rights
holder permits redistribution before using it publicly. Once an asset has a
clear source and looks promising, inspect the actual files, motion and mobile
view. Gather a small set of primary science sources to write defensible child
facts and note artistic reconstruction; do not require a specimen-level audit
for every model.

Retain private source material outside tracked runtime paths:

- original model archive and untouched source GLB;
- source page/API evidence, author, URL, access date, licence, and download
  variant;
- original generated images and prompt records;
- Blender or material workspaces and processing reports;
- narration masters, exact script, generation settings, metrics, and listening
  decision.

These belong in the ignored project work areas such as `assets/candidates`,
`.handoff`, `prototypes`, or `spikes`. Never use `git add -f` to publish them.

Reject an input when its direct source, author, licence, or modification chain
cannot be explained. Prefer CC0, CC BY 4.0, public-domain material, or
project-authored/generated work with a retained rights basis.

## 3. Model preparation

The runtime model must be a self-contained glTF 2.0 GLB. Preserve the original
file, then normalize a derivative:

```sh
cd tools/model-pipeline
npm ci
node normalize-glb.mjs \
  ../../assets/candidates/<source>/original.glb \
  ../../assets/candidates/<source>/normalized.glb \
  --clip Idle
node validate-glb.mjs \
  ../../assets/candidates/<source>/normalized.glb
```

Use `--clip none` for a static exhibit. Do not retain root-travelling or
frightening animation merely to make the model animated.

The onboarding tool owns one three-tier model budget contract. Targets are
optimisation goals, review ceilings are the normal automated gate, and the
absolute column is available only through a profile-bound exception recording
the affected metrics, reason, risk owner and date.

| Metric | Target | Normal review ceiling | Absolute exception ceiling |
| --- | ---: | ---: | ---: |
| Encoded GLB | 12 MiB | 20 MiB | 20 MiB |
| Triangles | 100,000 | 120,000 | 250,000 |
| Draw calls | 12 | 24 | 32 |
| Materials | 8 | 16 | 16 |
| Bones | 120 | 160 | 200 |

Exceeding a target produces an optimisation warning. Exceeding a normal review
ceiling without `model.budgetException` is invalid even if the model looks
acceptable. An exception never waives self-containment, the exact eight-second
Idle contract, full-loop visual review or the absolute ceiling. The complete
animal package target/hard ceiling remains 14/23 MiB. Use no external buffers
or textures; keep textures normally at or below 2K and review decoded memory on
a real phone.

Record every transformation: removed animations or props, material conversion,
texture resizing, geometry or pose changes, and the final byte count and hash.

Do not let the shared normalizer choose biological or presentation semantics.
The onboarding profile must explicitly select habitat, motion, tail direction,
initial view, shadow policy and a processing strategy after source inspection.
`replace-with-project-morph` is the only strategy implemented by the shared
normalizer; replacing an existing armature or animation requires an explicit
destructive-replacement record. Use a dedicated L3 Blender operation for
`preserve-source-rig-retime` or `custom-rebuild` so an existing rig or 7.5-second
clip is never silently baked away.

## 4. Content and presentation

`content.zh-CN.ts` and `content.en.ts` each contain two child-facing narration
sentences, a visible feature, cautious parent facts, pronunciation entries,
uncertainty notes, and one to three authoritative sources. They describe the
same reviewed facts but remain complete locale records; never fill a missing
English field from Chinese or vice versa. Published packages require both.
Drafts may be incomplete while work is in progress.

Write natural international English for children aged roughly 2–6 and their
parents, with consistent British spelling rather than literal translation.
Generate English measurements from the metric facts so the UI can show metric
first with approximate imperial units. Do not infer species, sex, colour, diet,
sound, or behaviour from a model.

Calibrate scientific review to this museum's young-child audience. Require the
broad identity, classification, period, habitat context and child-facing facts
to be defensible, and keep the features that make the animal recognisable. Do
not require a specimen-level reconstruction audit or reject a usable model
only because one proportion follows an older plausible interpretation. Colour,
soft tissue, skin texture, posture, expression and gentle display motion may use
clear artistic interpretation or exaggeration. Keep uncertain details out of
the child-facing fact layer, describe them as reconstruction choices for
parents when material, and never turn a disputed hypothesis into a unique
fact.

Choose the correct size semantic:

- `body-length`;
- `wingspan`;
- `shoulder-height`;
- `group-range`, with a note that it is not the displayed individual's size.

`package.ts` declares framing and behaviour. Start conservatively:

```ts
presentation: {
  initialYawDegrees: -90,
  safeAreaPadding: 0.12,
  shadow: 'ground',
}
```

Water and flying exhibits usually use `shadow: 'none'`. Add exposure,
camera-light, offset, or portrait padding only after checking all five required
viewports.

## 5. Scene, generated model previews, poster, and thumbnail

Landscape and portrait backgrounds are separate compositions, not runtime
crops. Keep the central model area quiet and do not bake animals, text, UI,
logos, or watermarks into the scene.

Choose the scene exposure only after inspecting the accepted runtime material
and lighting. The habitat, weather, colour temperature and model should feel
like one visual world: a dark animal must not look pasted into a bright noon
scene, while a pale animal must not disappear into pale ground or sky. Preserve
enough local contrast to read the silhouette, keep a continuous ground patch
under land animals, and give landscape and portrait backgrounds the same mood
and palette.

Capture the poster from the accepted runtime presentation, then derive a
readable square thumbnail. Current ceilings are:

- poster: 500 KiB;
- thumbnail: 120 KiB.

The landscape and portrait posters and the thumbnail must show the same model,
material, pose direction, and matching scene as the published package.

The transparent images used while WebGL loads are generated artifacts, not
animal-authored layout. Capture candidate evidence and clean derivative sources
through the already-open headed Browser or Chrome workflow in the onboarding
Skill. Its local report validates hashes, declared state effects and artifact
completeness, while browser provenance remains explicitly collector-attested
because the control surface supplies no signed receipt. Use a separate task for
the agent visual review. Then run its model-lock-guarded deterministic
derivative command. Do not
run the current `generate:model-previews` or `generate:review-model-previews`
scripts while they depend on a headless browser; the workspace browser policy
prohibits that path. Validate any retained preview manifest against the final
model hash and presentation signature. Do not add per-animal media queries, CSS
offsets, or hand-cropped loading images.

## 6. Narration

Narration never autoplays. Generate the exact two approved sentences for each
locale offline, normalize each to a compact 48 kHz mono MP3, and listen to both
complete results. Check names, geological periods, polyphonic characters or
English scientific-name pronunciation, omissions, duplicated words, artifacts,
silence, loudness, pacing, and age suitability.

The onboarding profile records a separate language entry for `zh-CN` and `en`.
Both use Qwen3-TTS 0.6B CustomVoice with its built-in Serena speaker. The
`zh-CN` entry declares `Chinese`, while the `en` entry declares `English`;
another speaker or a locale/language mismatch is a publication error. The
wrapper loads the shared local checkpoint and can generate one or both
configured locales:

```sh
<qwen-venv-python> \
  tools/animal-onboarding/audio/generate_narration.py \
  <profile.json> --locale zh-CN --locale en
```

Each locale entry uses `path`, `scriptPath`, optional `metricsPath`, `speaker`,
`language`, and `humanReviewStatus`. Use `Chinese` for `zh-CN` and `English`
for `en`; the loader rejects a mismatched locale/language pair. The profile
also needs `assets.posterPortraitPath`. After the explicit owner decision,
`approval record` writes both locale approvals under
`approvals.audioByLocale`.

Keep separate `narration.<locale>.metrics.json` records. Public notices must say
that the scripts were reviewed by humans and synthesized offline with AI.
Retain model/licence links, script hashes, output hashes, declared voices and
independent listening decisions. A Chinese-only legacy profile is readable as
a draft but is deliberately blocked from publication.

The scale-encounter guide has an additional continuity rule. Treat `intro`,
`transition`, and `arrival` as one narration in each locale. Author the three
phases in `src/scale-encounter/audio/narration-scripts.json`, submit their
newline-separated text to Qwen in one input, normalize the resulting lossless
master once, and only then cut the three runtime MP3s at natural pauses. Never
generate the three phases as independent batch items, and never normalize the
three slices separately.

Run the local candidate generator with the shared Qwen environment.

```sh
../../../../../.runtime/qwen3-tts/venv/bin/python \
  scripts/generate-scale-encounter-continuous-narration.py
```

The ignored handoff evidence retains the raw runs, normalized 48 kHz mono WAV
masters, listening previews, detected pauses, and exact cut samples. The
checked-in candidate manifest records the same master hash on all three slices,
their contiguous sample ranges, script hash, final MP3 hash, and pending human
review. The four shared view-switch prompts remain standalone tracks because
they are not phases of an animal narration.

## 7. Provenance and publication

`provenance.ts` must record every runtime asset:

- `model/model.glb`;
- both backgrounds;
- landscape poster, portrait poster and thumbnail;
- both narration MP3s.

For each record, include source, author/tool, direct URL where applicable,
licence, original and runtime hashes/bytes, modifications, attribution,
redistribution decision, and evidence paths. Run:

```sh
npm run generate:credits
npm run validate:content
```

For candidates managed by the project onboarding profile, do not copy the
review files or hand-edit provenance. Prepare and dry-run the manifest first:

```sh
node --import tsx tools/animal-onboarding/src/cli.ts review prepare <profile.json>
node --import tsx tools/animal-onboarding/src/cli.ts promote <profile.json> --dry-run
```

Only after the owner explicitly approves science, visuals, motion, complete
listening, public redistribution, and production, record that decision and
regenerate the manifest:

```sh
node --import tsx tools/animal-onboarding/src/cli.ts approval record \
  <profile.json...> --by <owner> --on <YYYY-MM-DD>
node --import tsx tools/animal-onboarding/src/cli.ts review prepare <profile.json>
```

Remove any “review pending” wording from both approved content modules, confirm
that `poster-portrait.webp`, both narration files and both locale listening
decisions are present, run an approved batch dry-run, then promote the entire
approved order in one transaction:

```sh
node --import tsx tools/animal-onboarding/src/cli.ts promote-batch \
  <profile.json...> --dry-run --collection main --out <dry-run.json>
node --import tsx tools/animal-onboarding/src/cli.ts promote-batch \
  <profile.json...> --collection main --out <promotion-result.json>
```

The transaction copies only manifest-hashed reviewed outputs, generates typed
production definitions and licence records, stages complete packages, exposes
`animal.ts` last, updates the collection once, regenerates credits/notices,
validates content, and rolls back on failure. Same-hash reruns are idempotent;
different or partial targets hard-fail. Run `promote verify <profile.json>` for
each installed animal. Never run `approval record` from an automated pass or
an inferred owner preference.

For packages outside that workflow, only set `status: 'published'` and add the
ID to `src/content/collections/main.ts` after content, model, scene, narration,
rights, responsive, and owner checks pass. Update the collection count and
canonical names in both `README.md` and `README.zh-CN.md`; the verification
suite compares both public collection tables with `mainCollection`. The
collection order is explicit and loops.

## 8. Complete verification

From the repository root:

```sh
npm ci
npm run lint
npm run typecheck
npm test -- --run
npm run validate:content
npm run validate:model-previews
npm run build
```

Use the already-open headed Browser or Chrome control surface for responsive
interaction verification. Do not substitute the repository's headless E2E path
for visual review in this workspace.

Set the declared base camera before applying zoom, orbit or pan. Record the
observed post-interaction camera rather than copying the planned base values;
the onboarding gate compares closest and initial distance and rejects identical
screenshots. Every capture plan must also retain the passing production-golden
report digest.

Check 360×640, 390×844, 844×390, 768×1024, and 1440×900. Confirm:

- the full animal remains inside the composition-safe frame;
- phone-landscape navigation shows complete cards in the vertical rail;
- touch targets remain at least 48×48 CSS pixels;
- switching animals or languages is latest-request-wins and stops old
  narration;
- loading, failure, retry, reset, focus mode, drawer, and URL selection work;
- repeated switching does not retain stale audio, scenes, or GPU resources;
- the production boundary contains only declared public assets.

## 9. Troubleshooting

- **`CANONICAL_PATH_MISSING`** — restore the exact canonical filename.
- **`ASSET_HASH_MISMATCH` / `ASSET_SIZE_MISMATCH`** — update provenance only
  after confirming the new file is the intended reviewed runtime output.
- **`PROVENANCE_MISSING`** — add a record; do not weaken validation.
- **`REDISTRIBUTION_NOT_ALLOWED`** — resolve the rights basis or keep the
  package out of production.
- **`GLB_EXTERNAL_URI`** — repack textures and buffers into the GLB.
- **missing `Idle`** — correct the declared clip or publish as a reviewed
  static exhibit.
- **animal clipped on phones** — increase safe-area padding before adding a
  small orientation-specific offset.
- **static model looks stuck** — improve the scene/pose and copy; do not add a
  bad animation.
- **build contains private paths** — remove the import and rerun the production
  boundary scan.

When a quality, scientific, rights, or real-phone check fails, keep the
existing public package usable and fix the candidate outside tracked runtime
paths.

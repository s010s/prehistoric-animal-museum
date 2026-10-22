# Workflow contract

Run every command from the `prehistoric-animal-museum` repository root. Create
one isolated run and candidate workspace from the exact source file:

```sh
node --import tsx tools/animal-onboarding/src/cli.ts run init \
  <animal-id> --source <source-model-path>
```

The default `<run>` is `.handoff/animal-onboarding-runs/<animal-id>`. The
initializer refuses overwrites, hashes the source and creates
`source-record.json`, `review-contract.json`, `asset-inspection.json`,
`capture-plan-input.json` and `profile.json`. Every placeholder is deliberately
blocking; replace it with verified facts. In `source-record.json`, mark the four
canonical blockers resolved only after their named fields are complete. The
requirements blocker additionally requires new task-specific target issues,
invariants and evidence beyond the starter template. Never copy a neighbouring
animal's profile or evidence.

## 1. Portable preflight

```sh
node --import tsx tools/animal-onboarding/src/cli.ts doctor \
  --out <run>/doctor.json
node --import tsx tools/animal-onboarding/src/cli.ts baseline verify
```

On a fresh worktree the Git-ignored golden record is normally absent. After
`baseline verify` passes, create that local immutable record once, then regress:

```sh
node --import tsx tools/animal-onboarding/src/cli.ts golden capture
node --import tsx tools/animal-onboarding/src/cli.ts golden regress
```

If the record already exists, run only `golden regress`; `golden capture`
refuses to overwrite it.

`doctor` checks the current worktree, tracked Skill/tool runtime, Node/tsx,
Blender, private write boundaries and the absence of a headless-browser path.
Do not continue on exit code 4.

## 2. Requirements and risk route

Edit the initialized records; replace every placeholder and keep the source
digest created by `run init`.

```sh
node --import tsx tools/animal-onboarding/src/cli.ts contract validate \
  <run>/review-contract.json --out <run>/review-contract.json
node --import tsx tools/animal-onboarding/src/cli.ts stage-lock create \
  <animal-id> <run>/review-contract.json --workspace <run> \
  --out <run>/stage-lock.json
```

The review contract must contain target issues, invariants, Given/When/Then
interaction states and evidence references. A full-loop requirement must say so
explicitly. `stage-lock create` also loads the canonical sibling
`source-record.json`, verifies the live source SHA, rejects symlinks and refuses
unchanged starter requirement sections. The risk result preserves the
underlying L0-L3 level even when the candidate is blocked.

Routes:

| Level | Normal route | Start condition |
| --- | --- | --- |
| L0 | Direct runtime validation | Rights and source package complete |
| L1 | Deterministic normalization | Bounded axis, scale, material or retime work |
| L2 | Bounded structural repair | Target region and before/after structure evidence defined |
| L3 | Isolated expert rebuild | Explicit owner investment acceptance plus isolated workspace and independent stage lock |

Each `knownIssues[]` item in `asset-inspection.json` needs a
`reviewContractBinding` containing its exact subject type, subject ID and full
evidence-requirement ID set. Merge the stage-lock command's returned
`inspectionBindings` into `asset-inspection.json.executionControls`. Route once
after the source inspection and planned operations are complete:

```sh
node --import tsx tools/animal-onboarding/src/cli.ts risk route \
  <run>/asset-inspection.json --out <run>/asset-risk-route.json
```

An unaccepted L3 result is expected to be blocked while preserving
`underlyingRiskLevel: L3`. Owner-requested parallel L3 work is valid when the
per-animal controls are true. An explicit request to advance named L3 animals
in parallel is itself the investment decision for those animals; record it and
do not ask again. After that explicit decision, place the returned
`inspectionAcceptance` object at
`asset-inspection.json.executionControls.l3Acceptance`:

```sh
node --import tsx tools/animal-onboarding/src/cli.ts l3-acceptance record \
  <animal-id> <run>/review-contract.json --workspace <run> \
  --out <run>/l3-acceptance.json --by <owner> --on <YYYY-MM-DD>
```

This accepts investment risk only. Do not serialize valid parallel work merely
because it is risky. Set `parallelRequested: true`, then rerun `risk route`; the
final route must say `canStart: true` before model work begins.

## 3. Model candidate

```sh
blender --background --factory-startup \
  --python tools/animal-onboarding/blender/normalize_animal.py -- \
  --profile <profile.json>

node --import tsx tools/animal-onboarding/src/cli.ts qa \
  <profile.json> --model-only
```

Model-only QA writes `qa.json`, `report.md` and `report.html`; it does not create
a promotion manifest. Retain the normalized `.blend`, runtime GLB,
`normalization.json`, `landmarks.json`, validator output and Blender render
evidence. `profile.model.inputPath` must equal the exact rights-verified
`profile.source.sourceModelPath`; put every derived revision at `outputPath` and
bind it through the processing log. QA cross-checks the source path/hash and the
profile/log/risk-route processing strategy.

Before Blender, replace the profile's blocked habitat, motion, tail, initial
view and shadow values and choose both model strategies. The shared normalizer
supports only this explicit replacement mode:

```json
"normalizationStrategy": "replace-with-project-morph",
"animationStrategy": {
  "mode": "replace-with-project-morph",
  "sourceArmature": "present",
  "sourceAnimation": "present",
  "destructiveReplacementAccepted": true,
  "reason": "Why replacing the inspected source rig and animation is correct for this candidate."
}
```

If the correct route is `preserve-source-rig-retime` or `custom-rebuild`, do not
run the shared normalizer. Use a dedicated L3 Blender operation that preserves
the contract and writes equivalent normalization, landmark and render evidence.
The verified L3 route must include `source-rig-animation` plus
`animation-retime` for preserve/retime, or a matching new-rig, rebind, anatomy,
transparency or mouth reconstruction operation for custom rebuild.

`run init` creates `<run>/profile.json`; fill its source/science/model and
presentation placeholders before using it as `<profile.json>`. When this
candidate keeps 167 bones and 134,666 triangles, the exception is explicit and
metric-scoped:

```json
"budgetException": {
  "metrics": ["bones", "triangles"],
  "reason": "Explain why reduction damages the reviewed result.",
  "acceptedBy": "<risk-owner>",
  "acceptedOn": "<YYYY-MM-DD>"
}
```

The model budget contract is:

| Metric | Target | Normal review ceiling | Absolute exception ceiling |
| --- | ---: | ---: | ---: |
| GLB bytes | 12 MiB | 20 MiB | 20 MiB |
| Triangles | 100,000 | 120,000 | 250,000 |
| Draw calls | 12 | 24 | 32 |
| Materials | 8 | 16 | 16 |
| Bones | 120 | 160 | 200 |

Targets produce optimisation warnings. A requested ceiling above the normal
column requires a `model.budgetException` naming exactly the affected metrics,
reason, `acceptedBy` and `acceptedOn`. The absolute column and the executor's
eight-second Idle contract are not waivable. The shared executor expects a
single-clip output; preservation repairs with required Walk, Swim or other clips
need the dedicated processing/validation route described in `SKILL.md`.

## 4. Headed-browser evidence

Edit the initialized `capture-plan-input.json`. Use five viewports, the actual
camera values and the exact final GLB path. The default `review-efficient` mode
captures five initial viewport frames, 0/2/4/6/8 at every declared primary and
auxiliary angle, and declared interaction states. It avoids the much larger
viewport × angle × time Cartesian product. Use `exhaustive` only for a focused
investigation.

Include the actual default gallery and phone fixed side-view comparison when
those modes exist. Judge local motion in their rendered projection, including
all relevant feet, tail, fins, foreclaws and mouth components. See the motion
section of [experience-quality.md](experience-quality.md). Check any proposed
capture/preview command before execution; a legacy screenshot helper may still
launch a prohibited headless browser.

For known alpha flicker or feather overlap, make the transparency evidence
requirement `fullCycle: true`, declare at least two camera perspectives, and
replace the five-point plan input with a dense 0.25-second sequence (or
`sampleIntervalSeconds: 0.25`). The contract must list the same declared sample
times. The planner still requires 0/2/4/6/8, allows at most 257 ordered unique
samples and applies the dense sequence to every declared angle.

```sh
node --import tsx tools/animal-onboarding/src/cli.ts capture plan \
  <run>/capture-plan-input.json --out <run>/browser-capture-plan.json
```

Start the validated local review server without opening a browser process:

```sh
npm run review -- --host 127.0.0.1 --port 4175
```

Load the available headed Browser or Chrome control Skill, open the review URL,
then execute every request in `browser-capture-plan.json` in order. Record only
values read back from the live page; never copy expected values into actual
fields. For each request, reset the viewer, set the declared base camera, then
apply the requested interaction. Applying the base camera after a zoom or orbit
invalidates the interaction proof. The control workflow writes screenshots beside
`browser-capture-evidence.json`. It must report the actually loaded GLB SHA,
exact viewport/camera/state, requested and actual paused animation time, applied
interactions, PNG dimensions, bytes and SHA. It must also name the collector,
record the collector's Codex task identity and include the exact attestation
emitted by the schema. The validator rejects uniform placeholder images,
unchanged closest-view pixels and camera metadata that does not reflect the
declared zoom/orbit/pan. Include a passing global production baseline; the plan
schema requires it and binds its digest. Never launch a browser process from
this tool.

Verify that the server and the actual loaded model both serve the final SHA.
Restart review servers that snapshot catalogs or buffers at startup, and replace
stale automation expectations before recording. A new filename or a successful
save cannot close a version mismatch. Preserve rejected captures separately.

Browser/Chrome control currently emits no cryptographically signed capture
receipt. Therefore `capture ingest` verifies file/hash/metadata/state integrity
but records provenance assurance as `collector-attested` and
`cryptographicallyVerified: false`. Never call that provenance machine-verified.
The independent visual-review task is the second authority boundary.

```sh
node --import tsx tools/animal-onboarding/src/cli.ts capture ingest \
  <run>/browser-capture-plan.json <run>/browser-capture-evidence.json \
  --out <run>/browser-capture-validation.json
```

## 5. Agent review and owner model lock

```sh
node --import tsx tools/animal-onboarding/src/cli.ts review agent init \
  <profile.json> <run>/browser-capture-evidence.json \
  --out <run>/agent-review.json
```

The agent inspects the screenshots and fills the template, including both
`reviewer` and `reviewerTaskId`. Every applicable row
needs `pass` or `fail`, a concrete finding and existing evidence paths. Animated
animals require 0/2/4/6/8-second samples at every perspective named by the
contract. The validator checks camera, state and time metadata for every
combination, so repeated files or one favourable angle cannot close a
multi-angle requirement. A PNG sequence cannot satisfy `full-loop-video`.
Land contact and enabled mouth motion cannot be marked not-applicable. Fill
every contract proof with its exact declared evidence. Machine proofs use
`verifiedBy: "animal-onboarding-machine-gates"`; agent proofs use the named
reviewer. Owner-authority proofs keep `status: "pending"` during agent review,
but their evidence bindings must already be complete so the one-page packet can
ask for the precise remaining decision.

Do not label an arbitrary file as machine evidence. Until a dedicated semantic
verifier exists, machine-authority requirements support only `still`,
`frame-sequence` and `runtime-state` backed by current capture artifacts.
`metric`, `rig-report`, `structure-inventory`, `topology-report` and
`source-record` requirements cannot receive machine pass from file existence or
a generic validation JSON. Candidate/runtime `human-review` evidence must cover
every declared perspective × time combination before the owner packet is ready.

Delegate this visual pass to a different agent/task from both the model author
and capture collector. The executable gate rejects a reviewer task or identity
that equals the collector record. It still cannot cryptographically prove who
operated Codex, so truthful task identity remains an explicit workflow
invariant.

```sh
node --import tsx tools/animal-onboarding/src/cli.ts review agent validate \
  <profile.json> <run>/browser-capture-evidence.json \
  <run>/agent-review.json
node --import tsx tools/animal-onboarding/src/cli.ts review owner prepare \
  <profile.json> <run>/browser-capture-evidence.json \
  <run>/agent-review.json
```

Before owner preparation, complete `<run>/risk-evidence-manifest.json` for every
ID emitted by the verified risk route. Full QA and owner/model-lock preparation
verify each artifact's run/candidate containment, non-symlink path, bytes, hash
and typed control identity. Missing route evidence blocks the decision packet,
not the earlier model-work start route.

```sh
node --import tsx tools/animal-onboarding/src/cli.ts risk evidence prepare \
  <run>/asset-inspection.json <run>/asset-risk-route.json \
  --out <run>/risk-evidence-manifest.json
# Fill only the still-empty artifact lists with real generated evidence.
node --import tsx tools/animal-onboarding/src/cli.ts risk evidence verify \
  <run>/asset-inspection.json <run>/asset-risk-route.json \
  --manifest <run>/risk-evidence-manifest.json
```

`prepare` automatically binds known control records and never invents a missing
rig, deformation, target-region or before/after proof.

The owner sees `<run>/owner-model-review.md`, including measured budgets, QA
warnings, L3 owner/date, route-evidence completion, capture-provenance boundary
and 3–5 concrete agent findings. Owner preparation reruns strict model-only QA
and persists `<run>/owner-model-qa.json`; it never trusts a prewritten `qa.json`.
Only after an explicit acceptance:

```sh
node --import tsx tools/animal-onboarding/src/cli.ts model-lock record \
  <profile.json> <run>/browser-capture-evidence.json \
  <run>/agent-review.json --by <owner> --on <YYYY-MM-DD>
node --import tsx tools/animal-onboarding/src/cli.ts model-lock verify \
  <profile.json>
```

The schema-v2 lock binds the model contract, GLB, fresh owner QA decision,
normalization log, normalized `.blend`, landmarks, validator report, risk
evidence manifest, capture and agent review hashes. Verification reruns the
model QA instead of trusting the snapshot. Editing narration metadata later
does not stale it; editing source, science scope, model, presentation or bound
evidence does. `model-lock record` records the explicit owner-authority contract
proofs inside the lock using the supplied owner/date; it never turns them into
publication approval.

## 6. Finishing and complete review

Only after the model lock, generate backgrounds, posters, thumbnail, localized
content and narration. Apply [experience-quality.md](experience-quality.md) to
family-facing copy, distinct landscape/portrait compositions and synchronized
thumbnails. Narration must use the pinned Qwen3-TTS 0.6B CustomVoice
Serena chain independently for `zh-CN`/Chinese and `en`/English, with two byte-
identical seeded raw runs per locale. System TTS and cross-language fallback
hard-fail.

```sh
node --import tsx tools/animal-onboarding/src/cli.ts derive backgrounds \
  <profile.json>
node --import tsx tools/animal-onboarding/src/cli.ts derive images \
  <profile.json> --desktop <clean-desktop-capture.png> \
  --portrait <clean-phone-capture.png> --bounds <x,y,width,height>
<qwen-venv-python> \
  tools/animal-onboarding/audio/generate_narration.py <profile.json>
node --import tsx tools/animal-onboarding/src/cli.ts review prepare \
  <profile.json>
node --import tsx tools/animal-onboarding/src/cli.ts promote \
  <profile.json> --dry-run
```

The derivative and narration commands require the current model lock. They use
deterministic local processing and never launch a browser.

The producer listens to complete final encoded files in both locales and records
actual listening against their SHAs; ASR is a supporting check. Resolve awkward
name spacing, polyphonic readings and prosody before owner review. For animals
with comparison mode, follow the guide's continuous-master protocol for
`intro`/`transition`/`arrival`, then verify actual App registration, locale,
play/pause/resume and phase timing. A populated manifest is insufficient.

`review prepare` requires a current model lock, complete derivative assets,
headed-browser validation and all automated gates. Pre-approval dry-run exit
code 3 is expected.

## 7. Final approval and atomic promotion

Use an explicit owner decision covering scientific identity, visual
quality, motion/child comfort, complete listening in both locales and public
distribution. When the owner has already approved this final packet and action,
record that existing decision and proceed without another confirmation:

```sh
node --import tsx tools/animal-onboarding/src/cli.ts approval record \
  <profile.json...> --by <owner> --on <YYYY-MM-DD>
node --import tsx tools/animal-onboarding/src/cli.ts review prepare \
  <profile.json>
node --import tsx tools/animal-onboarding/src/cli.ts promote-batch \
  <profile.json...> --dry-run --collection main --out <dry-run.json>
node --import tsx tools/animal-onboarding/src/cli.ts promote-batch \
  <profile.json...> --collection main --out <promotion-result.json>
node --import tsx tools/animal-onboarding/src/cli.ts promote verify \
  <profile.json>
node --import tsx tools/animal-onboarding/src/cli.ts golden regress
```

`approval record` does not trust an existing `qa.json`. It recomputes the exact
complete gate set, writes `approval-qa.json`, and records a canonical digest of
the runtime files plus decisive source, model-lock, headed-capture, agent-review,
background, derivative, narration and review-package evidence. Changing the
model, narration, capture, backgrounds, posters, thumbnail, derivative record,
review or any evidence nested under those records invalidates the approval and
requires a new explicit owner decision.

Legacy schema-v1 approval records are intentionally rejected. Re-run
`approval record` after the owner reconfirms the current packet to create the
schema-v2 asset-and-evidence binding.

Promotion requires `derivative-images.json`, the three motion renders under
`<run>/motion-renders/`, and, when mouth motion is enabled, all three mouth
renders under `<run>/mouth-renders/`, in addition to the headed-browser motion
screenshots already required by the complete gate set. These are exact
role-to-path bindings, not interchangeable attachments.

Promotion validates the batch before writing, stages full packages, exposes
`animal.ts` last, updates the collection once and rolls back the batch on
failure. Same-hash reruns are idempotent; differing partial targets fail.

## 8. Post-release cleanup when requested

Verify the installed release before deleting its process artifacts. Inventory
only the authorized animal/batch intermediates, stop their local consumers and
check that active product references use formal assets. Preserve the released
packages, required source/licence records, unrelated work and shared model/TTS
caches. Follow [experience-quality.md](experience-quality.md) for scope and
reporting; existing cleanup authorization does not require another permission
round.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Requested deterministic operation passed |
| 1 | Candidate gate, route, capture or review failed |
| 2 | Invocation or structured input is invalid |
| 3 | Required owner production approval is absent |
| 4 | Doctor, production baseline, golden sample or promotion target changed |

## Repository verification

During development, run the targeted validators for the changed stage. Run the
applicable complete verification once after the final package is frozen; do not
repeat a full suite for routine edits. Inspect commands for prohibited browser
launches before executing them.

```sh
npm --prefix tools/animal-onboarding run typecheck
npm --prefix tools/animal-onboarding test
blender --background --factory-startup \
  --python tools/animal-onboarding/tests/test_motion_profiles.py
blender --background --factory-startup \
  --python tools/animal-onboarding/tests/test_normalization_strategy.py
npm run lint
npm run typecheck
npm test -- --run
npm run validate:content
npm run build
```

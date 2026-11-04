# Animal onboarding tool

Portable, local-only tooling for turning a licensed prehistoric-animal source
into a hash-bound review packet and, only after explicit owner approval, an
atomic production package.

The workflow is staged:

```text
doctor
  → review contract
  → source inspection and L0-L3 route
  → Blender model candidate and model-only QA
  → collector-attested headed Browser/Chrome capture integrity check
  → agent visual review
  → owner model lock
  → derivatives, bilingual narration and complete QA
  → final owner approval and atomic promotion
```

Run from the repository root:

```sh
node --import tsx tools/animal-onboarding/src/cli.ts help
node --import tsx tools/animal-onboarding/src/cli.ts doctor
```

Tracked examples under `examples/` show the structured contract, inspection and
capture inputs; `run init` also creates the source record and profile:

- `review-contract.json` declares target defects, invariants, interaction
  semantics and required evidence;
- `asset-inspection.json` drives deterministic L0-L3 routing;
- `capture-plan-input.json` defines review-efficient headed-browser evidence.

JSON Schemas live under `schemas/`. Candidate assets remain under ignored
`assets/candidates/`; evidence remains under ignored
`.handoff/animal-onboarding-runs/<animal-id>/`. The tool source, schemas, tests
and examples are tracked so a fresh linked worktree has the same executor. GLB
validation and image derivation are implemented inside `tools/animal-onboarding`;
the workflow does not depend on an ignored or separately installed sibling tool.

Start with `run init`; it creates both isolated directories and five editable
records with the exact source hash and deliberately blocking placeholders. It
refuses to overwrite an existing run.

The requirements lock consumes the canonical `source-record.json`: all four
blockers must be resolved, the live source SHA must still match, and the review
contract must add task-specific issues, invariants and evidence beyond the
starter sections. Every source-inspection issue is then bound to one exact
contract subject and complete evidence set.

Golden records are intentionally local and Git-ignored. In a fresh worktree,
run `baseline verify`, then `golden capture` once and `golden regress`; an
existing golden record is read-only.

## Commands

```text
run init <animal-id> --source <source-model-path> [--run <run-directory>]
doctor [--out doctor.json]
baseline verify
golden capture
golden regress
intake score <intake.json> [--out ranking.json]
contract validate <review-contract.json> [--out normalized.json]
stage-lock create <animal-id> <review-contract.json> --workspace <run> --out <stage-lock.json>
l3-acceptance record <animal-id> <review-contract.json> --workspace <run> --out <record.json> --by <owner> --on <date>
risk route <asset-inspection.json> [--out asset-risk-route.json]
risk evidence prepare <asset-inspection.json> <asset-risk-route.json> [--out risk-evidence-manifest.json]
risk evidence verify <asset-inspection.json> <asset-risk-route.json> [--manifest risk-evidence-manifest.json]
capture plan <capture-plan-input.json> [--out browser-capture-plan.json]
capture ingest <plan.json> <evidence.json> [--out validation.json]
derive backgrounds <profile.json>
derive images <profile.json> --desktop <capture.png> --portrait <capture.png> --bounds <x,y,width,height>
qa <profile.json> [--model-only]
review agent init <profile.json> <capture-evidence.json> --out <agent-review.json>
review agent validate <profile.json> <capture-evidence.json> <agent-review.json>
review owner prepare <profile.json> <capture-evidence.json> <agent-review.json>
model-lock record <profile.json> <capture-evidence.json> <agent-review.json> --by <owner> --on <date>
model-lock verify <profile.json>
review prepare <profile.json>
approval record <profile.json...> --by <owner> --on <date>
promote <profile.json> --dry-run
promote-batch <profile.json...> [--dry-run] [--collection main]
promote verify <profile.json>
```

`risk evidence prepare` writes the canonical checklist without inventing
evidence. It hash-binds known source, rights, contract, stage-lock, acceptance
and agent-review records when present, and leaves every remaining artifact list
empty for the model/review agent to fill. `risk evidence verify` rejects missing,
stale, linked or out-of-scope artifacts before full QA and owner model lock.

The initialized profile intentionally has no usable habitat, motion,
normalization, initial-view or shadow defaults. Select them from inspected
facts. The shared Blender normalizer implements only an explicitly accepted
`replace-with-project-morph`; preserving a source rig/animation or doing a
custom rebuild is a dedicated L3 operation and cannot silently fall through to
destructive baking. `model.inputPath` must be the exact rights-verified
`source.sourceModelPath`; derived revisions belong at `outputPath`. QA verifies
that the profile, normalization log and verified L3 route agree on the strategy
and required operation set.

`capture plan` defaults to `review-efficient`: five initial viewport frames,
one full 0/2/4/6/8-second loop at every primary and auxiliary angle, plus
declared interaction states. It emits instructions but never launches a
browser. The persisted plan always includes the hash-bound passing production
golden report. Evidence must come from the already-open headed Browser or Chrome
control surface, name its collector and collector task, and include the schema's
exact attestation. Instructions establish the base camera before applying zoom,
orbit or pan; ingest rejects unchanged interaction pixels, unchanged zoom
distance and visually uniform placeholders. Contract proof checks use the
integrity-validated camera/state/time metadata, not screenshot counts.
`exhaustive` is available only when a targeted investigation needs the full
Cartesian product.

The Browser/Chrome control surface currently supplies no signed receipt. The
validation report therefore says `collector-attested` and
`cryptographicallyVerified: false`: hashes and state effects are machine-
checked, capture origin is not. The agent-review record requires a separate
reviewer task identity and rejects reuse of the capture collector task.

For a transparency full-cycle contract, declare at least two angles and a
dense sequence with no gap above 0.25 seconds. The planner accepts an ordered
superset of the mandatory 0/2/4/6/8 samples, up to 257 points, and the proof
validator checks every declared angle × time pair.

Machine-authority contract proofs currently accept only capture kinds with a
dedicated semantic verifier (`still`, `frame-sequence`, `runtime-state`). A
generic JSON or PNG cannot impersonate `metric`, `rig-report`,
`structure-inventory`, `topology-report` or `source-record`; those kinds block
machine pass until a dedicated verifier is implemented. Candidate/runtime
`human-review` evidence must cover every declared perspective and time, not one
representative screenshot.

Before owner preparation, `risk-evidence-manifest.json` must close every
`requiredEvidence` ID emitted by the active route with contained, non-symlink,
hash-bound artifacts. Full QA and owner/model-lock preparation verify it; the
pre-model route does not require future evidence and therefore does not create
a workflow cycle.

`model-lock record` is a finishing decision, not publication approval. Owner
preparation strictly parses the canonical model-only `qa.json`, reruns the same
gates, writes `owner-model-qa.json`, and shows actual metrics, warnings, L3
acceptance, route-evidence completion, capture-provenance limits and key agent
findings. Schema-v2 model lock binds that QA decision plus the normalization
log, normalized Blend, landmarks, GLB validator, final GLB, risk manifest,
capture and agent review hashes. Complete review and promotion remain blocked
until the later production approval record.

`approval record` reruns the complete exact QA gate set instead of trusting the
stored `qa.json`. It snapshots that result and locks a canonical digest of the
runtime assets and decisive transitive evidence. Any later change to the model,
narration, headed capture, background, poster, thumbnail, derivative record or
review evidence requires a fresh explicit approval. Promotion also requires the
canonical `derivative-images` record, three motion renders and, when mouth
motion is enabled, three mouth renders; runtime and evidence roles are bound to
their exact profile source and production paths.

Legacy schema-v1 approval records are rejected; an owner must reconfirm the
current packet and run `approval record` again to create the schema-v2 binding.

## Budget semantics

The executable policy in `src/budget-policy.ts` distinguishes optimisation
targets, normal review ceilings and absolute exception ceilings. A profile may
tighten any limit. Raising a normal ceiling requires a metric-scoped exception
with reason, risk owner and date; no exception may cross the absolute ceiling.
The exact single eight-second Idle contract is never an exception.

## Verification

```sh
npm --prefix tools/animal-onboarding run typecheck
npm --prefix tools/animal-onboarding test
python3 -m py_compile \
  tools/animal-onboarding/audio/generate_narration.py \
  tools/animal-onboarding/audio/qwen_serena_runtime.py
/opt/homebrew/bin/blender --background --factory-startup \
  --python tools/animal-onboarding/tests/test_normalization_strategy.py
```

The tool reports machine pass, agent visual pass, model lock and final owner
approval separately. It never turns one into another.

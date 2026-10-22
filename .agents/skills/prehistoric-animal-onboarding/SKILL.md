---
name: prehistoric-animal-onboarding
description: Onboard or repair licensed 3D animals for prehistoric-animal-museum, from source and risk contracts through believable Idle motion, parent-facing bilingual copy and narration, headed runtime evidence, derivatives and atomic promotion. Use for new animal packages or defects in anatomy, motion visibility, grounding, speech, stale assets or review bindings. Keep machine checks, actual visual and listening review, and scoped owner authorization distinct.
---

# Prehistoric Animal Onboarding

Turn a licensed source into a small, hash-bound review packet. The agent should
find defects before the owner sees the asset; the owner should decide tradeoffs,
taste and release boundaries, not manually rediscover every engineering error.

## Authority boundaries

Keep these states separate:

1. **Machine pass** proves rights fields, file structure, budgets, clip timing,
   hashes and evidence completeness.
2. **Agent visual pass** proves the contract's anatomy, deformation, full-loop,
   presentation and child-comfort checks against the exact GLB.
3. **Owner decision** may accept L3 investment, lock a model for finishing, and
   later approve public distribution. Never infer or auto-record it.

A model lock authorizes derivative and narration work for one GLB SHA. It does
not authorize publication. Production approval remains a later separate record.
Use explicit authorization already given for the current final packet. Record
its scope accurately and proceed; do not ask the owner to confirm the same
model, listening review or publication decision again. Narration-only approval
does not imply approval of unrelated model or release changes.

## Load only what the task needs

Always read `references/workflow-contract.md` before running commands.

Also read `references/failure-regressions.md` when repairing an existing asset,
handling L2/L3 work, defining a review contract, or explaining a budget/Idle
deviation. Reuse its regression checks rather than relying on memory.

Read [references/experience-quality.md](references/experience-quality.md) when
writing public copy or speech, repairing motion visibility, finishing a batch,
or verifying a release and its authorized cleanup. It covers producer listening,
comparison phases, actual camera projection and stale-runtime evidence.

The tracked tool and this Skill are the portable source of truth. Do not depend
on ignored `docs/specification/` files or another worktree's local scripts.

## Stage order and locks

Run from the `prehistoric-animal-museum` repository root. Every animal gets its
own candidate directory and `.handoff/animal-onboarding-runs/<animal-id>/`.
Create both from the tracked source model with `run init`; its deliberately
blocking placeholders must be replaced with verified source, science, model and
presentation facts before their respective gates can pass.

1. **Environment lock.** Run `doctor`, baseline verification and golden
   regression. On a fresh worktree, capture the local golden record only after
   production baseline verification passes, then regress it. Stop on a doctor
   or baseline failure.
2. **Requirement lock.** Resolve all four `source-record.json` blockers, then
   write and validate `review-contract.json` before model edits. Add real
   task-specific issues, invariants and evidence beyond the starter template.
   Name target defects, unchanged invariants, Given/When/Then interaction
   semantics and the exact evidence that closes each item. Every
   `asset-inspection.json` known issue must bind one exact contract subject and
   its complete evidence set.
3. **Source/risk lock.** Record `asset-inspection.json`; route it to L0-L3.
   Rights or identity blockers stop work. L3 and owner-requested parallel work
   may proceed only with explicit acceptance, an isolated animal workspace and
   an independent stage lock. An explicit owner instruction to advance named
   L3 animals in parallel already accepts that named L3 investment; record it
   without asking the same question again. A generic preference for concurrency
   does not.
4. **Model lock candidate.** Inspect the source rig and animation, then select
   the processing strategy explicitly. The shared Blender normalizer implements
   only `replace-with-project-morph`; it may discard a source rig or animation
   only when that destructive replacement is recorded. Use a dedicated L3
   operation for `preserve-source-rig-retime` or `custom-rebuild`. Retain
   structure/rig/log/landmark evidence and run model-only QA. The model input
   must be the exact rights-verified source path; derived revisions belong in
   the output path and hash-bound processing log. Profile, normalization log,
   risk route and accepted L3 operations must name the same processing
   strategy. Use the smallest bounded operation consistent with the contract.
   Complete `risk-evidence-manifest.json` for every route-required proof before
   owner review. Do not create backgrounds, posters, narration or editorial
   packages yet.
5. **Runtime evidence lock.** Create a review-efficient capture plan and execute
   it through the already-open headed Browser or Chrome control Skill. Load that
   Skill at this stage, start the documented local review server, and execute
   every emitted request in order. Never
   launch Playwright, Puppeteer, Chrome, Chromium or another headless browser.
   The collector must record a name, Codex task identity and the exact
   collector attestation. The local validator proves internal consistency,
   state effects and hashes; because Browser/Chrome control does not provide a
   signed receipt, it must describe capture origin as collector-attested, never
   cryptographically verified. Ingest the evidence so every screenshot is
   bound to the final and actually loaded GLB SHA, viewport, observed camera,
   state, exact paused animation time and file digest. Set the base camera
   before applying interaction actions; a closest-state capture must show a
   smaller observed distance and different pixels than its paired initial
   state. In review-efficient mode, every primary and auxiliary angle covers
   0/2/4/6/8 seconds; the validator proves each contract perspective × time
   combination rather than counting files. A transparency full-cycle contract
   requires at least two angles and no sampling gap above 0.25 seconds. The
   production golden baseline is mandatory and hash-bound in the persisted
   plan; it cannot be omitted after planning.
6. **Agent visual lock.** Generate the agent-review template, inspect the actual
   evidence and fill every category with a concrete finding and evidence path.
   For animated animals inspect 0/2/4/6/8 seconds at every declared primary and
   auxiliary angle. Static stills cannot prove a full loop, and PNG sequences
   cannot be labelled as continuous video. For L3, use an agent/task other than
   the model author and the capture collector. Record both reviewer name and
   reviewer task identity; the machine rejects reuse of the collector task.
   The producer first checks its own complete motion and speech outputs;
   independent review adds a second check and does not replace producer review.
7. **Owner model lock.** Generate the one-page owner packet only after machine
   and agent checks pass. Owner preparation reruns strict model-only QA into
   `owner-model-qa.json` and shows measured budgets, warnings, L3 acceptance,
   route-evidence completion, capture-provenance limits and key agent findings.
   Record `model-lock.json` only from an explicit owner decision. The lock binds
   that fresh QA decision plus normalization log, normalized Blend, landmarks,
   validator, risk manifest and capture/review evidence. Any bound change
   reopens the model stage.
8. **Finishing lock.** After the model lock, generate landscape/portrait
   backgrounds, poster, portrait poster, thumbnail, localized editorial records
   and independent `zh-CN`/`en` Qwen3-TTS Serena narration. Run complete QA and
   prepare the promotion manifest. Apply the audience, voice, phase-continuity
   and distinct-background rules in `references/experience-quality.md`.
9. **Publication lock.** Record final approval only after the owner accepts
   science, visual quality, motion, both complete narration listening reviews
   and public distribution. Dry-run the whole batch, promote atomically, then
   verify baseline, installed hashes and original collection order.

Do not advance downstream artifacts while the preceding lock is missing or
stale. A failure in one parallel animal never unlocks or invalidates another.

## Model contract

Use the target, normal review and absolute exception budgets from
`ANIMAL_AUTHORING_GUIDE.md`; the executable values live in
`tools/animal-onboarding/src/budget-policy.ts`. A profile may tighten a limit. Raising a normal ceiling
requires a metric-scoped `budgetException` with reason, risk owner and date, and
may never exceed the absolute ceiling.

The default onboarding executor checks a self-contained, single `Idle` lasting
eight seconds at 24 fps, continuous at 0/8 seconds and without root drift.
Retiming a 7.5-second clip is mandatory; it is not a budget exception. During a
preservation repair, retain existing Walk, Swim or other required clips exactly;
use the dedicated processing and validation route for that clip set rather than
deleting them to satisfy the single-clip normalizer. Clip metadata, joint angles
and world-space motion metrics alone do not prove visible or natural motion.
Review the default gallery and the actual phone comparison camera through the
complete loop, including each relevant foot, tail, fin, foreclaw and mouth.

For mouth motion, use `source-rig` only with a verified weighted jaw/tongue
chain, or `curated-components` with an exact per-model hinge and bounded vertex
selection. Otherwise record `disabled`. Never move a guessed broad head region.

## Repair rule

On failure, repair the smallest deterministic region and rerun that stage plus
all downstream locks whose hashes changed. Do not weaken shared gates to make a
candidate pass. Convert recurring visual failures into contract invariants and
evidence requirements using `failure-regressions.md`.

If a repair needs new rigging, full rebind, anatomy reconstruction, complex
transparency work or mouth reconstruction, route it as L3. Owner acceptance
allows the investment; it does not make the result acceptable.

## Handoff

Give the owner one compact packet per animal with:

- risk level, route and any explicitly accepted exception;
- exact model SHA and machine gate result;
- agent findings with full-loop and multi-view evidence links;
- unresolved blockers only;
- the precise decision requested: accept model for finishing, or approve final
  public promotion.

Say “machine pass”, “agent visual pass”, “model locked for finishing”, or
“owner-approved for promotion” precisely. Never collapse them into “approved”.
After a successful release, perform process-file cleanup only within the user's
authorized scope. Preserve formal assets, required provenance and shared model
caches; follow the release/cleanup section of `references/experience-quality.md`.

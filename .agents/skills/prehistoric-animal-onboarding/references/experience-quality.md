# Experience quality

Read the relevant section while authoring public text, speech, animation or
batch derivatives. Use the workflow contract for commands and authority records;
this reference defines the observable result those records must support.

## Public copy belongs to the family

Write exhibit text, narration, comparison labels, accessible descriptions and
search snippets for families with children aged 2–6. Describe the animal and
what the child can notice. Keep internal specimen selection, model identity
audits, reconstruction choices, scale calibration and production notes in their
appropriate source or processing records. Do not paste those notes into a
visitor-facing introduction or use them as filler.

Keep meaningful scientific uncertainty in ordinary language. For example,
“Scientists are still learning what the crest was used for” explains an open
question; a model-identification disclaimer does not help a child understand
the animal. Avoid claiming a precise species, appearance or size when the
evidence supports only a broader or approximate statement. Keep the supporting
science sources, attribution and licence information in the appropriate
credits/provenance surfaces. Editing family copy must not erase those records.

Review each locale as a complete visitor experience. Its visible text, spoken
script, animal name and measurements must agree; an English voice over Chinese
copy is not a complete English implementation.

## Speech must be distinct and actually heard

Choose a different point of interest for each animal: a visible body feature,
an evidence-supported habit, a scale contrast, or a small observation the child
can make. Vary openings, sentence rhythm and invitations across a batch. Repeated
“Look at…” openings or the same question with a different animal name are a
reason to rewrite, even when each individual script is grammatical. Keep the
voice calm, brief and natural; use an invitation only when it adds something
specific to that animal.

Keep display text in normal characters and keep synthesis-only pronunciation
text or overrides separately. Check names, polyphonic characters, numbers,
units and English scientific names in context. Chinese examples include
`生长 zhǎng` versus `长度/体长 cháng`, and the pronunciation of `栉` in
`副栉龙`. Check a compound name such as `剑射鱼` as one spoken name: correct
syllables separated by an unnatural pause still fail. For an invitation to
trace a crest with a finger, listen for misplaced stress, an awkward first
sentence or unintended question intonation. Correct transcription alone will
not reveal these problems.

The producer must listen to every final encoded track completely and verify
wording, omissions, repetition, pronunciation, pauses, prosody, artefacts and
age suitability. Record the actual file SHA, listener, result and any relevant
time points. Use another listener when a name, polyphonic reading or prosody
remains uncertain. ASR helps find missing or misplaced words; identical written
characters do not prove a correct sound or tone. If the available surface does
not permit actual hearing, state that listening remains pending and arrange an
authorized listening review; never report an ASR pass as a listening pass.
An existing explicit listening decision for the same final bytes can be used
within its recorded scope without asking for it again.

### Comparison narration is one performance in three phases

For each animal that supports comparison, author both locales for:

| Phase | Purpose | Runtime check |
| --- | --- | --- |
| `intro` | Introduce this animal and its particular scale or feature | Plays at the introduction in the selected locale |
| `transition` | Accompany the actual movement toward the animal | Scene waiting, captions and renderer timing accommodate the real audio duration |
| `arrival` | Reward the closer view with a specific observation | Starts after arrival and contains its complete intended text |

Generate the newline-separated phase text as one continuous performance per
locale with the project's pinned voice pipeline. Normalize the lossless master
once, then cut at natural pauses into contiguous sample ranges. Never synthesize
or normalize each phase independently. Check the final encoded files as well as
the master; if a gain correction is needed, apply it to the complete master and
recut all phases together.

Listen to each slice's start and end and to the joined sequence. A silence
detector or word-count estimate can cut into a word or move the next phase's
first sentence into the previous phase. Use the same master to repair such a
boundary, then recheck the new final files and their hashes. ASR should cover
each actual slice, not an earlier version. Keep shared view-switch prompts
separate, and do not invent comparison narration for animals without that mode.

Verify both locales in the actual App: gallery play/pause/resume and comparison
intro/transition/arrival, with the expected script, locale, phase, duration and
audio SHA. A static listening page or populated manifest alone does not prove
phase registration or timing. For a targeted voice repair, bind only the named
animal/locale/phase and verify that unrelated tracks and models remain unchanged.

## Motion must survive the camera

Inspect the actual default gallery and a phone portrait comparison at its fixed
side view. Follow every relevant planted foot, tail, repeated fin or appendage,
foreclaw, jaw, tooth group and mouth lining through complete loops. Whole-body
motion must not hide a stationary local part. The producer checks its own
outputs before handing the exact version to an independent reviewer.

A large lateral tail swing can point toward the camera and appear almost
motionless. Use projected landmark travel or image comparisons to diagnose
this, then judge the actual rendered silhouette at the intended display size.
World displacement and joint degrees are supporting measurements, not a visual
acceptance rule. Improve the species' own motion with coherent follow-through
and suitable compound components. For example, a gentle vertical arc can make a
depth-dominant sway readable. A nearly grounded tail may need an upward-only
arc; a heavy tail club needs restrained follow-through and torso clearance.
Avoid moving the global camera or rocking the root to disguise a static tail.

Repair the smallest suitable joint or vertex region. Coordinate translations
as well as rotations when tail joints are siblings; rotating each around a
different fixed pivot can kink the base. Retain smooth skin influence across
the transition, and verify local geometry rather than treating a larger rig as
the solution. Preserve planted feet, connected teeth/tongue/lining, required
other clips, and the initial Idle pose when the repair contract requires them.

Sample final geometry through the complete cycle at the declared frame rate,
including the endpoint. Check finite vertices, face orientation/area and edge
changes, coincident seams, ground and body clearance, fixed-foot drift, loop
position and velocity continuity, and required other-clip equivalence. Inspect
the actual phone-camera loop plus useful tail-root/tip or mouth extrema at a
larger scale. Reuse a sufficient view; do not generate redundant views merely
to increase the evidence count. Recompute final-hash contact samples and the
motion footprint after deformation changes.

## Distinct backgrounds and consistent derivatives

Create a distinct landscape composition and portrait composition for each
animal in a batch. Changing the filename, aspect ratio or crop is not a new
composition. Keep the habitat plausible and protect silhouette contrast and
ground continuity. Inspect the complete batch for accidental repeated scenery.

Regenerate the thumbnail against that animal's final landscape background.
Check it together with the landscape and portrait backgrounds, poster and
responsive stills so that an old thumbnail cannot survive a background change.
Keep source/tool and component licences accurate when a model render and
background have different terms.

## Evidence follows exact bytes and actual loaded state

Freeze and identify the candidate before capture. Record animal, mode, locale,
viewport, camera, clip/time, loaded model SHA and screenshot/video digest. For
continuous recordings, bind initial and final state and check real animation
progress, wraps, gaps and pauses. Fully decoding and hashing a video is a
technical check. A sampled contact sheet proves only its actual sample coverage;
never describe it as every encoded frame being visually inspected.

When a local review server snapshots its catalog or asset buffers at startup,
editing files on disk does not update that process. Restart it, reload the page
and verify the exact new loaded SHA before accepting captures. In persistent
automation, use one current state object or redefine helpers; an old REPL
closure can retain a previous expected hash or cases array. Derive expectations
from the current final manifest and compare with actual initial/final canvas
state. A successful “saved” message is insufficient. Reject stale captures;
keep their history separate from the final selected index.

After a repair, bind contacts/calibration and current shared-file hashes to the
new model. Reuse unchanged recordings only after rechecking their model, video,
metadata and decoded-artifact hashes. Retain old hold findings as history rather
than overwriting them. A static Idle0 still may be retained only with an exact
old/new deformed-world vertex and normal comparison plus unchanged materials,
textures and presentation, followed by truthful manifest rebinding. That proof
does not permit reusing an old dynamic loop for a changed animation.

## Release and authorized cleanup

Use the owner's existing decision for the exact final version and requested
publication action. Do not invent approval or ask for the same authorization
again. Complete local preparation and applicable promotion checks, then verify
the installed release before cleanup.

If the user requests post-release cleanup, inventory only the named animals'
production/review intermediates and remove those within the authorized scope.
Stop processes that still depend on them. Preserve formal animal packages,
runtime assets, source/licence records required by the release, unrelated work
and shared model/checkpoint caches. A request to remove one batch's process
files does not authorize a repository-wide cache purge. Check for broken active
references and report what was removed; do not leave obsolete review routes in
the public product to keep deleted evidence reachable.

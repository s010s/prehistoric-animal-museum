# Failure regressions

Use this table while writing the per-animal review contract. Each past defect
must reappear as a named invariant or evidence requirement when the same risk is
present. A build, typecheck, GLB validator pass or isolated still image never
substitutes for the listed evidence.

| Regression | What escaped review | Contract requirement | Minimum proof |
| --- | --- | --- | --- |
| Carnotaurus teeth detached | A broad head/jaw edit moved or failed to move connected geometry coherently | Teeth, tongue and mouth lining remain attached for the complete loop | Baseline mouth close-up plus candidate close-ups at 0/2/4/6/8 seconds and both side views |
| Carnotaurus forelimb duplicated or reversed | A local structural repair was judged from a favourable angle | Limb count, left/right identity and shoulder-to-wrist direction are invariants | Structure inventory plus left, right and front views through the complete loop |
| Tail appeared static in the actual phone view | Clip metadata and large world-depth sway passed, but projection hid the motion | Tail visibility and loop continuity hold in the default gallery and fixed phone side view | Actual full-loop runtime evidence plus projected-region diagnostics; use suitable natural compound motion, not only more yaw |
| Anomalocaris appendages were static or spiked | Whole-body motion hid local appendage failure and deformation spikes | Every repeated appendage group must move without topology spikes | Ventral, dorsal and side full-loop evidence plus appendage-region motion coverage |
| Archaeopteryx wings clipped or flickered | Static captures missed a transient transparency/deformation defect | Wing overlap, alpha stability and silhouette continuity hold for the whole cycle | Full-cycle frame scan from both sides with at most 0.25 seconds between samples; no single still may close the issue |
| Spinosaurus started too close | “Can approach more closely” was implemented as “starts closer” | Initial distance and minimum reachable distance are different state assertions | Given/When/Then runtime state record showing both the initial and closest states |
| Closest capture silently reset to the initial camera | The collector applied zoom before reapplying the planned base camera | Establish base camera first, then apply interaction and record observed post-state camera | Closest distance must be smaller than initial and its screenshot bytes must differ |
| Synthetic PNGs claimed headed-browser provenance | Local JSON could self-report Browser/headed without a signed control receipt | Capture provenance is collector-attested, visibly non-uniform, and reviewed by a separate task | Named collector/task attestation, explicit unsigned-provenance warning, state-effect checks and different reviewer task |
| Candidate passed code checks with a visual defect | Engineering tests did not encode the semantic acceptance criterion | Machine pass, agent visual pass and owner approval remain distinct authorities | Structured agent review bound to the exact profile, GLB and collector-attested capture hashes |
| Review used a different model revision | Disk assets changed while a server snapshot or automation closure retained the old catalog/hash | Loaded runtime SHA equals the final GLB SHA in every capture | Restart snapshot-based review servers; compare current manifest, actual initial/final canvas state and capture digests; reject stale saves |
| Public copy exposed production notes | Internal specimen/model identification and calibration prose reached visitor text | Family copy explains the animal and useful scientific uncertainty | Review both locales across gallery, comparison, narration and search text; keep appropriate science sources and licences in credits/provenance |
| A batch sounded like one repeated template | Correct individual scripts reused the same opening and question for every animal | Each animal has a distinct evidence-supported observation and natural rhythm for ages2–6 | Read the batch together, rewrite repetitive structures, then have the producer listen to every final track |
| Name or invitation sounded unnatural despite correct ASR | A compound name had an excessive internal pause or a crest-tracing sentence acquired awkward stress/intonation | Names, polyphonic readings and sentence prosody are correct to the ear | Complete final-file listening with SHA/time points; check `生长 zhǎng`, `长度 cháng`, `剑射鱼` spacing and crest-invitation prosody; use another listener when uncertain |
| Comparison narration was missing, split or truncated | Gallery audio existed but phase lookup, locale binding, cut points or transition duration was wrong | Each supported comparison plays complete localized intro/transition/arrival at its real stage | One continuous master per locale, natural contiguous cuts and actual App play/phase checks; phase ASR supplements listening |
| Tail-root repair damaged preserved motion | Independent pivots or new weights introduced a kink, floor collision, foot drift or changed Walk | Coherent local deformation preserves planted feet, attached mouth parts, required other clips and contracted Idle0 | Full-cycle geometry and useful closeups plus exact other-clip/Idle0 checks and regenerated final-hash contact/footprint evidence |
| Background changes left stale thumbnails | Different filenames concealed repeated scenery or a thumbnail retained an old habitat | Each animal has distinct landscape/portrait compositions and consistent derivatives | Review the batch's backgrounds, thumbnails and posters together, with current hashes and component licences |
| Cleanup removed reusable or released data | A batch cleanup expanded to shared checkpoints or formal packages | Cleanup follows the user's named scope after release verification | Path inventory, active-reference check and removal summary; retain formal assets, required provenance and shared caches |

Read [experience-quality.md](experience-quality.md) for the corresponding
authoring and review decisions. Do not turn one recorded pixel amplitude or
joint angle into a universal visual threshold.

## Parallel high-risk work

Parallel L3 work is not itself a failure. The owner may deliberately accept the
cost and uncertainty. When parallel work is requested, each animal must have an
isolated workspace, independent review contract, independent stage lock and
hash-bound evidence. A failure or exception for one animal never changes the
state of another.

## Contract deviations and their practical effects

The old authoring guide exposed 250,000 triangles and 200 bones as hard caps,
while the executor also carried quieter 120,000-triangle and 160-bone review
defaults. Saying that a candidate “broke the onboarding default” was therefore
ambiguous. The current three-tier policy names optimisation targets, normal
review ceilings and absolute exception ceilings explicitly and uses the same
values in the guide, Skill and executable gate.

The shared onboarding executor's normal output is one `Idle` clip lasting eight
seconds at 24 fps, with the first and final state continuous and no root drift.
For a repair that must preserve existing Walk, Swim or other clips, use the
dedicated preservation route and verify those clips exactly; deleting them to
satisfy the normalizer is not a repair.
A 7.5-second clip is not automatically ugly, but it breaks deterministic sample
times, makes 0/2/4/6/8-second comparisons impossible without special casing,
and can reset half a second earlier than the viewer, narration or review clock
expects. Retiming is required; this is not a budget exception.

The model budget has three tiers documented in `ANIMAL_AUTHORING_GUIDE.md`.
Crossing a target is an optimisation warning. Crossing the normal review ceiling
requires a profile-bound exception. Crossing the absolute ceiling fails.

- 167 bones is seven above the normal 160-bone review ceiling but below the
  200-bone absolute ceiling. The likely costs are more transform/skin work,
  a larger rig to audit and more opportunities for stray weights. It does not,
  by itself, prove a visible defect.
- 134,666 triangles is 14,666 above the normal 120,000-triangle review ceiling
  and below the 250,000 absolute ceiling. The likely costs are GPU vertex work,
  memory/bandwidth and mobile thermal headroom. It does not, by itself, prove
  that the asset must be rejected.

For both cases, retain the measured value, record why further reduction would
damage the reviewed result, bind the exception to the candidate profile, and
keep the normal mobile and visual evidence. Never raise a shared default merely
to make one candidate pass.

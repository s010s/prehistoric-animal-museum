# Contributing

Thank you for helping make the museum more useful to children and grown-ups.
Code, original museum content, brand identifiers, and third-party assets have
different legal boundaries, so please read this page and
[LICENSING.md](LICENSING.md) before submitting a contribution.

## Your copyright stays yours

You retain copyright in every original contribution you create. Submitting a
contribution does **not** transfer its copyright to the project owner, and this
project does not require a blanket copyright assignment.

By intentionally submitting material for inclusion, you agree to publish that
contribution under the repository's applicable outbound license:

- software code is contributed under **AGPL-3.0-only**;
- original animal copy, narration, exhibit backgrounds, illustrations, and
  similar museum content are contributed under **CC BY-NC-SA 4.0**, with the
  contributor's attribution preserved;
- third-party or mixed material remains subject to every applicable
  third-party license and provenance requirement.

The project owner receives no additional right to relicense your contribution.
Without your separate agreement, the project owner cannot place your code
contribution under a proprietary or otherwise incompatible license, or offer
your original content under a separate commercial license. You remain free to
license your own contribution elsewhere because you still own it. Licenses
already granted to the public under AGPL-3.0-only or CC BY-NC-SA 4.0 remain in
effect according to their terms.

## Code contributions

AGPL-3.0 is a genuine open-source software license. It allows studying,
modifying, distributing, operating, and commercially using the software.
Its copyleft conditions still apply: in particular, a modified version used
to provide a network service must offer its users the Corresponding Source
required by section 13.

Before opening a pull request:

1. keep private work areas and unreviewed assets out of Git;
2. make the smallest coherent change; keep or change a test only when it proves
   a product assumption, a domain rule, or a build and release requirement;
3. run the relevant checks listed in the README;
4. explain any user-visible, privacy, accessibility, or license impact.

A retained test must show a concrete consequence if its assumption is broken.
Prefer an end-to-end scenario over another check of the same behavior in
isolation. Do not add tests that lock source text, markup, styling, internal
calls, rendering parameters, or the configuration of a past prototype.
TypeScript compilation and checks of actual release artifacts remain part of
the build.

## New animals and original museum content

Start with [ANIMAL_AUTHORING_GUIDE.md](ANIMAL_AUTHORING_GUIDE.md). A proposal
does not enter the released collection until its science, presentation,
sound, child comfort, performance, and redistribution rights have been
reviewed.

For every original text, narration recording, background, illustration, or
similar contribution, include:

- the contributor name or requested attribution;
- confirmation that the contributor created it and may license it;
- any source material used to create it;
- a clear indication that it is submitted under CC BY-NC-SA 4.0.

The maintainers may edit an accepted contribution within that license and the
normal review process, but acceptance does not transfer its copyright or give
the project owner a unilateral commercial-relicensing right.

## Third-party and mixed material

Do not submit a model, texture, font, recording, image, or derived asset merely
because it is downloadable. For every third-party component, preserve:

- author and required attribution;
- canonical source URL;
- exact license and license URL or included license text;
- redistribution evidence when the source page may change;
- a concise record of modifications and generated derivatives.

Do not replace, narrow, or hide an upstream license. Mixed poster and thumbnail
images must preserve the model's applicable terms as recorded in the animal
package's `provenance/LICENSES/` directory and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Brand and forks

The [brand policy](BRAND_POLICY.md) exists to prevent confusion about the
official source. It does not stop anyone from forking, renaming, modifying, or
developing the project under the applicable software and content licenses.
Forks should use a distinct name and visual identity and may accurately state
that they are based on this project.

## 中文说明

- 贡献者保留自己原创贡献的著作权，提交贡献不代表把版权转让给项目方。
- 代码贡献按 `AGPL-3.0-only` 发布。它是真正的开源软件许可，允许商业
  使用；修改后通过网络提供服务时，仍须按 AGPL 第 13 条提供对应源代码。
- 原创动物文案、旁白、展厅背景和类似内容按 `CC BY-NC-SA 4.0` 发布，
  保留贡献者署名，只授权符合该许可的非商业共享与演绎。
- 未经贡献者另行同意，项目方不能把其代码贡献改成专有或不兼容许可，也
  不能把其原创内容另行作为商业许可出售。
- 品牌政策只用于避免冒充官方，不妨碍改名 Fork、正常修改和二次开发。
- 第三方动物素材必须保留作者、来源、原许可、再分发依据和修改记录。

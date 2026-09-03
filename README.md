<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="Prehistoric Animal Museum, a free 3D world for children and grown-ups to explore together">
</p>

<p align="center">
  <strong>For curious children and the grown-ups willing to sit beside them.</strong><br>
  Explore prehistoric animal exhibits in English or Simplified Chinese, with short narration and a parent guide for the questions that follow.
</p>

<p align="center">
  <strong><a href="https://leon-made-this.work/museum/en/">Official website →</a></strong>
  · <a href="https://leon-made-this.work/">Leon Made This</a>
  · <strong>English</strong>
  · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">Free to visit · No account · No ads · No analytics scripts</p>

| Sea · Mosasaurus | Land · Stegosaurus | Sky · Tupandactylus |
| :---: | :---: | :---: |
| ![Mosasaurus against its underwater exhibit background](./src/content/animals/mosasaurus/images/thumbnail.webp) | ![Stegosaurus against its prehistoric forest exhibit background](./src/content/animals/stegosaurus/images/thumbnail.webp) | ![Tupandactylus against its lakeside sky exhibit background](./src/content/animals/tupandactylus/images/thumbnail.webp) |

## A quiet place to look closely

When my daughter was three, dinosaurs on television made her uneasy. The stories often centred on chases, fights, and “defeating the dinosaur”, leaving little room to simply look at the animal itself.

I wanted to give her a place with no winning or losing and no frightening scene waiting around the corner. A child can choose an animal, turn it around, and listen to a short introduction. A grown-up can add a thought, ask a question, or simply stay beside them.

This museum is not designed to keep children on the screen. Discovering one interesting detail is enough.

## Explore together

- **Look from every side:** drag with a finger or mouse to turn a model, then pinch or scroll to zoom.
- **Listen when you choose:** short English and Mandarin narration never auto-plays.
- **Follow the questions:** the parent guide covers when an animal lived, fossil discovery regions, size, diet, classification, and source references.
- **Use it comfortably:** the responsive layout adapts to phone, tablet, and desktop screen sizes, supports keyboard navigation, and respects reduced-motion settings.

The museum follows the device language on a first visit. You can switch between English and Simplified Chinese at any time; the choice is remembered, and each language has a shareable link.

It is designed mainly for children aged 2-6 with a grown-up nearby, but curiosity matters more than the age label. If an image or sound feels uncomfortable, choose another animal or close the page.

## Exhibits across sea, land, and sky

<details>
<summary><strong>See the full collection</strong></summary>

- **Land:** Stegosaurus, Pachycephalosaurus, Tyrannosaurus rex, Triceratops, Apatosaurus, Gigantoraptor, Woolly mammoth, Maiasaura, Sauropelta, Dilophosaurus, Spinosaurus, Lystrosaurus, Baryonyx, and Carnotaurus.
- **Sky:** Pteranodon, Rhamphorhynchus, Tupandactylus, Meganeura, and Archaeopteryx.
- **Sea:** Ichthyosaurs, Plesiosaurs, Megalodon, Mosasaurus, and Anomalocaris.

</details>

The ichthyosaur and plesiosaur exhibits represent broader groups of related animals rather than one exact species. Fossils do not preserve every answer, so colours, soft tissue, and some movement are evidence-informed artistic reconstructions rather than exact portraits.

## A calm, private visit

- The application has no sign-in or user profile and does not ask for names or contact details. In “Compare with me,” a parent may optionally choose boy or girl and enter an approximate height solely to set the current page’s 3D character scale and viewpoint; these choices are not placed in the URL, uploaded, or sent to analytics, and disappear when the page closes.
- It contains no advertising or analytics scripts, membership, knowledge unlock, or paywall.
- The museum experience makes no runtime calls to AI, advertising, or analytics services; models, images, and narration are prepared static assets.
- No autoplay and no pressure to “finish” the museum.

## Run and contribute

### Local development

Node.js 20.19 or newer is required.

```sh
npm ci
npm run dev
```

<details>
<summary><strong>Run the project checks</strong></summary>

```sh
npm run lint
npm run typecheck
npm test -- --run
npm run build
npm run test:e2e
```

</details>

### Contributing

To propose a new animal, start with the [animal authoring guide](ANIMAL_AUTHORING_GUIDE.md). For code, content, or asset changes, read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Licences and sources

This repository has several clear legal layers:

- Software code uses [GNU AGPL-3.0-only](LICENSE).
- Original museum writing, narration, exhibit backgrounds, and similar content use [CC BY-NC-SA 4.0](LICENSES/CC-BY-NC-SA-4.0.txt).
- Third-party libraries, fonts, 3D models, and mixed assets retain their own recorded terms.
- “Leon做了个 / Leon Made This”, the project names, logos, and source-identifying brand elements are reserved to prevent confusion about the official source; renamed and rebranded forks remain welcome within the applicable licences.

See the [licensing guide](LICENSING.md), [brand policy](BRAND_POLICY.md), [contribution terms](CONTRIBUTING.md), and [third-party notices](THIRD_PARTY_NOTICES.md) for licensing boundaries and recorded attributions, sources, and modifications.

<br><br>

<p align="center">
  <a href="https://github.com/s010s/prehistoric-animal-museum/stargazers">
    <img src="https://badges.leon-made-this.work/github-stars.svg" height="54" alt="GitHub Stars">
  </a>
  &nbsp;
  <a href="https://atomgit.com/leonleung/prehistoric-animal-museum">
    <img src="https://atomgit.com/leonleung/prehistoric-animal-museum/star/new_badge.svg" height="54" alt="AtomGit G-Star">
  </a>
</p>

<p align="center">
  <sub>
    <a href="https://github.com/s010s/prehistoric-animal-museum"><strong>GitHub</strong></a> is the primary repository for development, Issues, and pull requests.<br>
    <a href="https://atomgit.com/leonleung/prehistoric-animal-museum"><strong>AtomGit</strong></a> is the official mirror for visitors in Mainland China.
  </sub>
</p>

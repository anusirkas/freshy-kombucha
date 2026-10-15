# Freshy · sparkling kombucha

A launch page for a fictional kombucha brand, built from my own Figma design (wireframes, UI kit and hero prototype). The hero can is a real photo turned into a WebGL shader: it takes on each flavour's colour and spins round to a new label.

**Live:** https://freshy-kombucha.vercel.app/
**Original Figma hero prototype:** https://www.figma.com/proto/49sBruaZKoTAve9GXSCQG1/Kombucha?node-id=16-27&starting-point-node-id=16%3A153

## What's in it

- **Photo can as a shader.** One quad in three.js with a custom `ShaderMaterial`. The photo of a grey can supplies the light, shadows and condensation droplets. The shader tints the metal in the flavour colour and wraps the flat label around it with a cylindrical (`asin`) mapping.
- **Flavour switch.** The can spins a full turn and swaps its label while the label faces away. A colour wipe grows from the can, the big word slides out letter by letter and the fruit flies out and springs back in.
- **Controls.** Flavour tabs, a click on the left or right half of the hero, swipe on phones, arrow keys, and autoplay every 5 s that pauses off screen. `prefers-reduced-motion` is respected.
- **Asset pipeline.** `scripts/prepare-assets.mjs` (sharp) does three jobs:
  - cuts the flat labels out of the Figma exports;
  - splits each fruit composite into separate pieces with connected-component masks;
  - removes the can photo's background and floor shadow with an edge flood fill.
- **Page.** A gradient that follows the flavour, using `@property` so it can transition, and a shop with selectable 6, 12 and 24 packs drawn in the current flavour. It also has testimonials with arrows and swipe, scroll reveals, and a demo contact form.

## Stack

TypeScript · Vite · three.js (GLSL) · CSS (`@property`, spring easing) · sharp · Figma

## Run

```bash
npm install
npm run dev
```

To rebuild the images from `assets/`, run `node scripts/prepare-assets.mjs`.

## Credits

Design: Anu Sirkas (Figma). Fruit photos are free stock images. Testimonials and resellers are made up. This is a demo, so there's no checkout.

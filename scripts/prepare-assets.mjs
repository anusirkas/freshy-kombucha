// Prepares the Figma exports for the web:
// - the flat can labels become WebP textures, with their background colour recorded;
// - each "flying fruit" composite is split into separate pieces (one per fruit or leaf) by
//   finding connected areas of opaque pixels, so every piece can move on its own.
// Writes public/img/* and src/assets.json.
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const SRC = "assets";
const OUT = "public/img";
await mkdir(`${OUT}/pieces`, { recursive: true });

const FLAVOURS = [
  { id: "orange", label: "orange (1).png", fruit: "flying oranges.png" },
  { id: "apple", label: "apple.png", fruit: "flying apples.png" },
  { id: "lemon", label: "lemon (1).png", fruit: "flying lemons.png" },
];

/** Finds bounding boxes of opaque blobs on a downscaled alpha mask. */
async function blobs(file, scale = 0.25) {
  const meta = await sharp(file).metadata();
  const w = Math.round(meta.width * scale);
  const h = Math.round(meta.height * scale);
  const { data } = await sharp(file).ensureAlpha().extractChannel("alpha").resize(w, h).raw().toBuffer({ resolveWithObject: true });
  const seen = new Uint8Array(w * h);
  const boxes = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || data[start] < 40) continue;
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0;
    const members = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i - x) / w;
      area++;
      members.push(i);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const n of [i - 1, i + 1, i - w, i + w]) {
        if (n < 0 || n >= w * h || seen[n] || data[n] < 40) continue;
        if (Math.abs((n % w) - x) > 1) continue; // don't wrap across rows
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (area > 60) {
      const mask = new Uint8Array(w * h);
      for (const i of members) mask[i] = 255;
      boxes.push({ x: minX / scale, y: minY / scale, w: (maxX - minX + 1) / scale, h: (maxY - minY + 1) / scale, area, mask });
    }
  }
  return { boxes, width: meta.width, height: meta.height, maskW: w, maskH: h };
}

const manifest = {};
for (const f of FLAVOURS) {
  // label: keep full size, note its background colour from the top-left pixel
  const label = `${SRC}/${f.label}`;
  const { data } = await sharp(label).ensureAlpha().extract({ left: 4, top: 4, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  const bg = `#${[data[0], data[1], data[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  await sharp(label).webp({ quality: 90 }).toFile(`${OUT}/label-${f.id}.webp`);

  // fruit pieces
  const file = `${SRC}/${f.fruit}`;
  const { boxes, width, height, maskW, maskH } = await blobs(file);
  const pieces = [];
  let n = 0;
  for (const b of boxes.sort((a, z) => z.area - a.area)) {
    const pad = 6;
    const left = Math.max(0, Math.floor(b.x - pad));
    const top = Math.max(0, Math.floor(b.y - pad));
    const w = Math.min(width - left, Math.ceil(b.w + pad * 2));
    const h = Math.min(height - top, Math.ceil(b.h + pad * 2));
    const name = `${f.id}-${++n}.webp`;
    // keep only this blob's pixels: scale its mask up to full size, soften the edge, and
    // multiply it into the alpha, so neighbouring fruit inside the box is cut away
    const fullMask = await sharp(Buffer.from(b.mask), { raw: { width: maskW, height: maskH, channels: 1 } })
      .resize(width, height, { kernel: "nearest" })
      .blur(3)
      .extract({ left, top, width: w, height: h })
      .extractChannel(0) // blur widens a one-channel image to three; keep exactly one
      .raw()
      .toBuffer();
    const { data: rgba } = await sharp(file).extract({ left, top, width: w, height: h }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let rSum = 0, gSum = 0, aSum = 0;
    for (let i = 0; i < w * h; i++) {
      const a = Math.round((rgba[i * 4 + 3] * fullMask[i]) / 255);
      rgba[i * 4 + 3] = a;
      rSum += rgba[i * 4] * a;
      gSum += rgba[i * 4 + 1] * a;
      aSum += a;
    }
    await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: 88 }).toFile(`${OUT}/pieces/${name}`);
    // leaves are mostly green: they get a different, floatier motion
    const leafy = gSum > rSum * 1.05 && aSum > 0;
    pieces.push({ src: `/img/pieces/${name}`, x: (left + w / 2) / width, y: (top + h / 2) / height, w: w / width, h: h / height, leaf: leafy });
  }
  manifest[f.id] = { label: `/img/label-${f.id}.webp`, labelBg: bg, pieces };
  console.log(f.id, "bg", bg, "pieces", pieces.length, "leaves", pieces.filter((p) => p.leaf).length);
}

await writeFile("src/assets.json", JSON.stringify(manifest, null, 2));

// ---------- the can photo: cut the white studio background away ----------
// Flood-fill near-white pixels from the edges, so white highlights inside the can stay.
{
  const file = `${SRC}/can 1.png`;
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const background = new Uint8Array(w * h);
  // near-white anywhere; in the bottom strip also the light grey contact shadow under the
  // base, which the shader would otherwise tint into a coloured halo
  const isWhite = (i) => {
    const limit = i / w > h * 0.93 ? 196 : 238;
    return data[i * 4] > limit && data[i * 4 + 1] > limit && data[i * 4 + 2] > limit;
  };
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop();
    if (background[i] || !isWhite(i)) continue;
    background[i] = 1;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i < w * (h - 1)) stack.push(i + w);
  }
  const alpha = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = background[i] ? 0 : 255;
  // soften the cut edge by a pixel so it doesn't look jagged
  const soft = await sharp(alpha, { raw: { width: w, height: h, channels: 1 } }).blur(0.8).extractChannel(0).raw().toBuffer();
  for (let i = 0; i < w * h; i++) data[i * 4 + 3] = soft[i];
  await sharp(data, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: 92, alphaQuality: 100 }).toFile(`${OUT}/can.webp`);
  console.log("can: background removed");
}

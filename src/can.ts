import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const RADIUS = 1;
const HEIGHT = 4.7; // a standard can, about 2.35 times as tall as it is wide

type Label = { src: string; bg: string };

/**
 * Paints the label onto a texture that wraps the whole can. The canvas has the can's own
 * proportions (circumference : height), so the art isn't stretched; the label is centred and
 * the rest of the can is filled with the label's background colour.
 */
async function wrapTexture(label: Label) {
  const img = new Image();
  img.src = label.src;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.height = 1024;
  canvas.width = Math.round(canvas.height * ((Math.PI * 2 * RADIUS) / HEIGHT));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = label.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // the label image is padded top and bottom, so draw it a little taller than the can
  const h = canvas.height * 1.18;
  const w = (img.width / img.height) * h;
  ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * The hero can. Switching flavour spins it once and swaps the label while the front faces
 * away, so the new label comes round from behind. It tilts gently towards the pointer.
 */
export class Can {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  private can = new THREE.Group();
  private body: THREE.Mesh;
  private textures = new Map<string, THREE.Texture>();
  private spin: { from: number; start: number; next: THREE.Texture; swapped: boolean } | null = null;
  private pointer = new THREE.Vector2();
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // neutral tone mapping keeps the label colours true; ACES would bleach them
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    host.appendChild(this.renderer.domElement);
    // a soft studio environment, so the metal lid and base have something to reflect
    this.scene.environment = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x886644, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-3, 4, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 1.8);
    rim.position.set(4, 1, -2);
    this.scene.add(rim);

    // body: an open cylinder, so the label shows only on the side
    this.body = new THREE.Mesh(
      new THREE.CylinderGeometry(RADIUS, RADIUS, HEIGHT, 96, 1, true),
      new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.15, envMapIntensity: 0.35 }),
    );
    // three.js puts u = 0 at the front of a cylinder, so the label (middle third, u = 0.5)
    // starts at the back; half a turn brings it round to face us
    this.body.rotation.y = Math.PI;
    const metal = new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.25, metalness: 0.95 });
    // shoulders and lid: a short taper to a slightly smaller rim, like a real can
    const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS * 0.86, RADIUS, 0.22, 96, 1, true), metal);
    shoulder.position.y = HEIGHT / 2 + 0.11;
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS * 0.86, RADIUS * 0.86, 0.06, 96), metal);
    lid.position.y = HEIGHT / 2 + 0.25;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS * 0.9, RADIUS, 0.16, 96), metal);
    base.position.y = -HEIGHT / 2 - 0.08;
    this.can.add(this.body, shoulder, lid, base);
    this.scene.add(this.can);

    this.camera.position.set(0, 0, 13.6);
    new ResizeObserver(() => this.fit()).observe(host);
    this.fit();
    window.addEventListener("pointermove", (e) => {
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    });
    this.loop();
  }

  private async texture(label: Label) {
    let t = this.textures.get(label.src);
    if (!t) {
      t = await wrapTexture(label);
      this.textures.set(label.src, t);
    }
    return t;
  }

  /** Shows a flavour straight away, without the spin. */
  async show(label: Label) {
    const t = await this.texture(label);
    (this.body.material as THREE.MeshStandardMaterial).map = t;
    (this.body.material as THREE.MeshStandardMaterial).needsUpdate = true;
  }

  /** Spins to a new flavour, swapping the label halfway round. */
  async switchTo(label: Label) {
    const next = await this.texture(label);
    if (this.reducedMotion) return this.show(label);
    this.spin = { from: this.can.rotation.y, start: performance.now(), next, swapped: false };
  }

  /** Preloads labels so the first switch doesn't wait for a decode. */
  preload(labels: Label[]) {
    for (const l of labels) void this.texture(l);
  }

  private fit() {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    const t = performance.now();
    if (this.spin) {
      const p = Math.min(1, (t - this.spin.start) / 1100);
      const ease = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
      this.can.rotation.y = this.spin.from + ease * Math.PI * 2;
      if (!this.spin.swapped && p > 0.42) {
        // the front is facing away now: swap the label
        const material = this.body.material as THREE.MeshStandardMaterial;
        material.map = this.spin.next;
        material.needsUpdate = true;
        this.spin.swapped = true;
      }
      if (p >= 1) {
        this.can.rotation.y = this.spin.from;
        this.spin = null;
      }
    } else if (!this.reducedMotion) {
      // idle: a slow sway and a tilt towards the pointer
      this.can.rotation.y += (this.pointer.x * 0.35 + Math.sin(t / 2200) * 0.12 - this.can.rotation.y) * 0.05;
    }
    if (!this.reducedMotion) {
      this.can.rotation.z += (-this.pointer.x * 0.08 - 0.06 - this.can.rotation.z) * 0.05;
      this.can.rotation.x += (this.pointer.y * 0.1 - this.can.rotation.x) * 0.05;
      this.can.position.y = Math.sin(t / 1400) * 0.08;
    }
    this.renderer.render(this.scene, this.camera);
  };
}

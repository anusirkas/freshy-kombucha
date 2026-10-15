import * as THREE from "three";

/*
 * The hero can is a single quad drawn by a shader, built from the photo of a real can.
 * The photo supplies the light: its highlights, shadows and condensation droplets. The shader
 * tints the whole can in the flavour colour and wraps the flat label round it with a cylindrical
 * mapping (asin of the horizontal position), so turning the can is just sliding the label round.
 * Switching flavour spins it a full turn and swaps the label while it faces away.
 */

const SPIN_MS = 1250;

type Label = { src: string; bg: string };

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uPhoto;
  uniform sampler2D uLabel;
  uniform vec3 uTint;
  uniform float uTurn;       // how far the can has turned, in turns
  uniform float uLabelWidth; // label width as a share of the circumference
  uniform float uLabelTop;   // label's vertical extent on the body, in uv
  uniform float uLabelBottom;
  varying vec2 vUv;

  void main() {
    vec4 photo = texture2D(uPhoto, vUv);
    if (photo.a < 0.02) discard;

    // the photo is a grey can: its brightness, relative to mid grey, is our lighting
    float light = dot(photo.rgb, vec3(0.299, 0.587, 0.114));
    float shade = light / 0.62;

    // cylindrical wrap: screen x across the can body (-1..1) to angle round the can
    float x = clamp((vUv.x - 0.5) * 2.0 / 0.94, -1.0, 1.0);
    float angle = asin(x) / 6.2831853;           // -0.25..0.25 turns across the visible half
    float u = fract(angle + uTurn + 0.5) - 0.5;  // label centred on u = 0
    float lu = u / uLabelWidth + 0.5;
    float lv = (vUv.y - uLabelBottom) / (uLabelTop - uLabelBottom);

    vec3 base = uTint;
    if (lu > 0.0 && lu < 1.0 && lv > 0.0 && lv < 1.0) {
      vec4 label = texture2D(uLabel, vec2(lu, lv));
      base = mix(base, label.rgb, label.a);
    }

    vec3 colour = base * shade;
    // droplets and the brightest metal highlights stay bright, like water catching the light
    colour += vec3(smoothstep(0.78, 0.98, light)) * 0.45;
    gl_FragColor = vec4(colour, photo.a);
    #include <colorspace_fragment>
  }
`;

export class Can {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private photoAspect = 228 / 601;
  private textures = new Map<string, THREE.Texture>();
  private spin: { start: number; direction: number; next: { texture: THREE.Texture; tint: THREE.Color }; swapped: boolean } | null = null;
  private turn = 0;
  private pointerX = 0;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private loader = new THREE.TextureLoader();

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);

    const photo = this.loader.load("/img/can.webp");
    photo.colorSpace = THREE.SRGBColorSpace;
    photo.anisotropy = 8;

    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      uniforms: {
        uPhoto: { value: photo },
        uLabel: { value: null },
        uTint: { value: new THREE.Color("#ffaa28") },
        uTurn: { value: 0 },
        // label is 288 x 798; on a body ~214 px wide (π·214 round) and ~544 px tall that is
        // 0.29 of the circumference, so the art keeps its proportions
        uLabelWidth: { value: 0.29 },
        // the label spans most of the body, between the shoulder and the base
        uLabelTop: { value: 0.955 },
        uLabelBottom: { value: 0.05 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.scene.add(this.mesh);

    new ResizeObserver(() => this.fit()).observe(host);
    this.fit();
    window.addEventListener("pointermove", (e) => (this.pointerX = (e.clientX / window.innerWidth) * 2 - 1));
    this.loop();
  }

  private async texture(src: string) {
    let t = this.textures.get(src);
    if (!t) {
      t = await this.loader.loadAsync(src);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      this.textures.set(src, t);
    }
    return t;
  }

  preload(labels: Label[]) {
    for (const l of labels) void this.texture(l.src);
  }

  /** Shows a flavour straight away. */
  async show(label: Label) {
    this.material.uniforms.uLabel.value = await this.texture(label.src);
    (this.material.uniforms.uTint.value as THREE.Color).set(label.bg);
  }

  /** Spins a full turn to a new flavour; direction 1 turns one way, -1 the other. */
  async switchTo(label: Label, direction = 1) {
    const next = { texture: await this.texture(label.src), tint: new THREE.Color(label.bg) };
    if (this.reducedMotion) return this.show(label);
    this.spin = { start: performance.now(), direction, next, swapped: false };
  }

  private fit() {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.left = -aspect;
    this.camera.right = aspect;
    this.camera.updateProjectionMatrix();
    // fill the height, keep the photo's proportions
    this.mesh.scale.set(1.78 * this.photoAspect, 1.78, 1);
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    const t = performance.now();
    let spinTurn = 0;
    if (this.spin) {
      const p = Math.min(1, (t - this.spin.start) / SPIN_MS);
      // slow start, fast middle, a soft landing
      const ease = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
      spinTurn = ease * this.spin.direction;
      const tint = this.material.uniforms.uTint.value as THREE.Color;
      // the label changes while it's round the back, and the colour of the can follows
      if (!this.spin.swapped && p > 0.5) {
        this.material.uniforms.uLabel.value = this.spin.next.texture;
        this.spin.swapped = true;
      }
      if (p > 0.3 && p < 0.7) tint.lerp(this.spin.next.tint, 0.18);
      if (p >= 1) {
        tint.copy(this.spin.next.tint);
        this.spin = null;
        spinTurn = 0;
      }
    }
    if (!this.reducedMotion) {
      // idle: the can turns a little towards the pointer and sways
      this.turn += (this.pointerX * 0.06 + Math.sin(t / 2400) * 0.025 - this.turn) * 0.06;
      this.mesh.rotation.z = -0.06 - this.pointerX * 0.03;
      this.mesh.position.y = 0.05 + Math.sin(t / 1500) * 0.02;
    }
    this.material.uniforms.uTurn.value = this.turn + spinTurn;
    this.renderer.render(this.scene, this.camera);
  };
}

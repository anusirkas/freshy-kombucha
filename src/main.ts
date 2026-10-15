import assets from "./assets.json";
import { Can } from "./can";
import "./style.css";

type Piece = { src: string; x: number; y: number; w: number; h: number; leaf: boolean };
type FlavourAssets = { label: string; labelBg: string; pieces: Piece[] };

const FLAVOURS = [
  { id: "orange", word: "Orange", colour: "#ffa93a", tag: "Zesty orange · probiotic sparkling tea" },
  { id: "apple", word: "Apple", colour: "#ff8989", tag: "Crisp apple · probiotic sparkling tea" },
  { id: "lemon", word: "Lemon", colour: "#f8ed8c", tag: "Tangy lemon · probiotic sparkling tea" },
] as const;
type Flavour = (typeof FLAVOURS)[number];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const hero = $("hero");
const wipe = $("hero-wipe");
const word = $("word");
const fruitsEl = $("fruits");
const tag = $("hero-tag");
const dots = $("dots");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const can = new Can($("can"));
const label = (f: Flavour) => ({ src: (assets as Record<string, FlavourAssets>)[f.id].label, bg: (assets as Record<string, FlavourAssets>)[f.id].labelBg });
can.preload(FLAVOURS.map(label));

let current = 0;
let busy = false;

// ---------- the big word: letters roll up out, the new ones roll up in ----------
function setWord(text: string, animate: boolean) {
  const oldLine = word.querySelector<HTMLElement>(".word-line");
  if (oldLine) {
    [...oldLine.children].forEach((l, i) => {
      (l as HTMLElement).style.transitionDelay = `${i * 35}ms`;
      l.classList.add("out");
    });
    window.setTimeout(() => oldLine.remove(), animate ? 800 : 0);
  }
  word.setAttribute("aria-label", text);
  const line = document.createElement("span");
  line.className = "word-line";
  line.setAttribute("aria-hidden", "true");
  [...text].forEach((ch, i) => {
    const l = document.createElement("span");
    l.className = "letter" + (animate ? " in" : "");
    l.textContent = ch;
    l.style.transitionDelay = `${180 + i * 45}ms`;
    line.appendChild(l);
  });
  word.appendChild(line);
  if (animate) requestAnimationFrame(() => requestAnimationFrame(() => line.querySelectorAll(".in").forEach((l) => l.classList.remove("in"))));
}

// ---------- fruit: each piece flies out away from the can, the new ones spring in ----------
function setFruit(f: Flavour, animate: boolean) {
  const old = [...fruitsEl.querySelectorAll<HTMLElement>(".piece")];
  old.forEach((p, i) => {
    p.style.transitionDelay = `${i * 30}ms`;
    p.classList.add("leaving");
  });
  window.setTimeout(() => old.forEach((p) => p.remove()), animate ? 900 : 0);

  const pieces = (assets as Record<string, FlavourAssets>)[f.id].pieces;
  pieces.forEach((piece, i) => {
    const img = document.createElement("img");
    img.src = piece.src;
    img.alt = "";
    img.className = "piece" + (piece.leaf ? " leaf" : "");
    // depth: big pieces sit in front and drift more with the pointer
    const depth = piece.leaf ? 0.6 : 0.4 + piece.w * 2.2;
    img.style.setProperty("--x", `${piece.x * 100}%`);
    img.style.setProperty("--y", `${10 + piece.y * 78}%`);
    img.style.setProperty("--w", `${piece.w * 100}%`);
    img.style.setProperty("--depth", depth.toFixed(2));
    img.style.setProperty("--spin", `${(i % 2 ? 1 : -1) * (20 + i * 9)}deg`);
    // fly in from outside, on the side the piece belongs to
    img.style.setProperty("--from-x", `${(piece.x - 0.5) * 140}vw`);
    img.style.setProperty("--from-y", `${(piece.y - 0.5) * 60 - 30}vh`);
    img.style.zIndex = String(depth > 0.9 ? 4 : 1);
    img.style.transitionDelay = `${120 + i * 55}ms`;
    if (animate) img.classList.add("arriving");
    fruitsEl.appendChild(img);
    if (animate) requestAnimationFrame(() => requestAnimationFrame(() => img.classList.remove("arriving")));
  });
}

function setControls() {
  [...dots.children].forEach((d, i) => {
    d.setAttribute("aria-selected", String(i === current));
    (d as HTMLElement).tabIndex = i === current ? 0 : -1;
  });
}

function show(index: number, animate = true) {
  if (busy && animate) return;
  const f = FLAVOURS[(index + FLAVOURS.length) % FLAVOURS.length];
  current = FLAVOURS.indexOf(f);
  const motion = animate && !reducedMotion;

  // the colour washes in from the can as a growing circle, then becomes the page colour
  if (motion) {
    busy = true;
    wipe.style.background = f.colour;
    wipe.classList.remove("open");
    void wipe.offsetWidth;
    wipe.classList.add("open");
    window.setTimeout(() => {
      document.documentElement.style.setProperty("--flavour", f.colour);
      wipe.classList.remove("open");
      busy = false;
    }, 950);
    void can.switchTo(label(f));
  } else {
    document.documentElement.style.setProperty("--flavour", f.colour);
    void can.show(label(f));
  }
  setWord(f.word, motion);
  setFruit(f, motion);
  tag.textContent = f.tag;
  hero.dataset.flavour = f.id;
  setControls();
  document.dispatchEvent(new CustomEvent("flavour", { detail: f }));
}

// ---------- controls: dots, arrows, the can itself, keys, swipe and a gentle autoplay ----------
FLAVOURS.forEach((f, i) => {
  const b = document.createElement("button");
  b.type = "button";
  b.role = "tab";
  b.className = "dot";
  b.style.setProperty("--c", f.colour);
  b.setAttribute("aria-label", f.word);
  b.addEventListener("click", () => {
    stopAutoplay();
    if (i !== current) show(i);
  });
  dots.appendChild(b);
});
$("next").addEventListener("click", () => (stopAutoplay(), show(current + 1)));
$("prev").addEventListener("click", () => (stopAutoplay(), show(current - 1)));
$("can").addEventListener("click", () => (stopAutoplay(), show(current + 1)));
hero.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") (stopAutoplay(), show(current + 1));
  if (e.key === "ArrowLeft") (stopAutoplay(), show(current - 1));
});
let touchX = 0;
hero.addEventListener("touchstart", (e) => (touchX = e.touches[0].clientX), { passive: true });
hero.addEventListener("touchend", (e) => {
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50) (stopAutoplay(), show(current + (dx < 0 ? 1 : -1)));
});

let autoplay = reducedMotion ? 0 : window.setInterval(() => show(current + 1), 6000);
function stopAutoplay() {
  window.clearInterval(autoplay);
  autoplay = 0;
}
hero.addEventListener("pointerenter", () => {
  if (autoplay) window.clearInterval(autoplay);
});
hero.addEventListener("pointerleave", () => {
  if (autoplay) autoplay = window.setInterval(() => show(current + 1), 6000);
});

// fruit drifts with the pointer, by depth
hero.addEventListener("pointermove", (e) => {
  if (reducedMotion) return;
  const rect = hero.getBoundingClientRect();
  hero.style.setProperty("--px", ((e.clientX - rect.left) / rect.width - 0.5).toFixed(3));
  hero.style.setProperty("--py", ((e.clientY - rect.top) / rect.height - 0.5).toFixed(3));
});

show(0, false);

// ---------- shop: packs of cans in the current flavour ----------
const PACKS = [
  { size: 6, price: "€14.99" },
  { size: 12, price: "€29.99" },
  { size: 24, price: "€59.99" },
];
const packsEl = $("packs");
for (const p of PACKS) {
  const pack = document.createElement("article");
  pack.className = "pack";
  const cans = document.createElement("div");
  cans.className = "pack-cans";
  cans.style.setProperty("--rows", String(p.size / 6));
  for (let i = 0; i < p.size; i++) {
    const c = document.createElement("span");
    c.className = "mini-can";
    c.style.setProperty("--i", String(i % 6));
    cans.appendChild(c);
  }
  pack.append(cans);
  pack.insertAdjacentHTML("beforeend", `<p class="pack-meta"><span>${p.size} pack</span><span>${p.price}</span></p>`);
  packsEl.appendChild(pack);
}
const setPackLabel = (f: Flavour) =>
  document.documentElement.style.setProperty("--label", `url(${(assets as Record<string, FlavourAssets>)[f.id].label})`);
setPackLabel(FLAVOURS[0]);
document.addEventListener("flavour", (e) => setPackLabel((e as CustomEvent<Flavour>).detail));

const toast = $("toast");
const say = (el: HTMLElement, text: string) => {
  el.textContent = text;
  el.classList.add("show");
  window.setTimeout(() => el.classList.remove("show"), 3200);
};
$("buy").addEventListener("click", () => say(toast, "This is a demo: there's no checkout, but thank you for wanting some."));
$("reseller").addEventListener("click", () => say(toast, "This is a demo page; the reseller programme is imaginary."));

// ---------- testimonials: step through, one card at a time ----------
const quotes = $("quotes");
let quoteIndex = 0;
$("quotes-next").addEventListener("click", () => {
  const cards = quotes.children.length;
  const visible = window.innerWidth > 900 ? 3 : 1;
  quoteIndex = (quoteIndex + 1) % (cards - visible + 1);
  quotes.style.setProperty("--shift", String(quoteIndex));
});

// ---------- contact form (no backend: just a friendly confirmation) ----------
const form = $<HTMLFormElement>("form");
form.addEventListener("submit", (e) => {
  e.preventDefault();
  say($("form-note"), "Thanks! This demo doesn't send messages, but your form worked.");
  form.reset();
});

// ---------- sections rise in as they scroll into view ----------
if (!reducedMotion) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          io.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -15% 0px" },
  );
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
} else {
  document.querySelectorAll(".reveal").forEach((el) => el.classList.add("visible"));
}

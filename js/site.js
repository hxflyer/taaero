/* TA-aero shared script: header, footer, logo, photo slots, scroll "track" progress.
   ─────────────────────────────────────────────────────────────────────────────
   EDIT ME: fill in the team's real contact details here. Only the ones you fill in
   are shown on the Contact page. */
const CONFIG = {
  email: "",       // e.g. "taaero.team@example.com"
  whatsapp: "",    // e.g. "+60 12 345 6789"
  instagram: ""    // e.g. "taaero" (no @)
};

const NAV = [
  ["index.html", "Home"],
  ["car.html", "The Car"],
  ["game.html", "Race"],
  ["team.html", "The Team"],
  ["journey.html", "Journey"],
  ["sponsors.html", "Sponsors"],
  ["contact.html", "Contact"]
];

/* The team logo (Stoop the falcon). */
const LOGO_SVG = `<img class="logo" src="images/falcon.png" alt="TA-aero falcon logo">`;

function here() {
  const f = location.pathname.split("/").pop();
  return f === "" ? "index.html" : f;
}

function buildHeader() {
  const el = document.getElementById("site-header");
  if (!el) return;
  const links = NAV.map(([href, label]) =>
    `<a href="${href}"${href === here() ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  el.innerHTML = `
    <div class="wrap bar">
      <a class="brand" href="index.html"><span data-logo>${LOGO_SVG}</span><span>TA<em>-aero</em></span></a>
      <button class="menu-btn" aria-expanded="false" aria-controls="nav">Menu</button>
      <nav class="nav" id="nav" aria-label="Main">${links}</nav>
      <span class="track-readout" title="How far down the 20 m track you have scrolled">0.0 m / 20 m</span>
    </div>
    <div class="track-progress" aria-hidden="true"><i></i></div>`;
  const btn = el.querySelector(".menu-btn"), nav = el.querySelector(".nav");
  btn.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    btn.setAttribute("aria-expanded", open);
  });
  const fill = el.querySelector(".track-progress i"), read = el.querySelector(".track-readout");
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    const p = max > 0 ? Math.min(1, scrollY / max) : 0;
    fill.style.width = (p * 100) + "%";
    read.textContent = (p * 20).toFixed(1) + " m / 20 m";
  };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  onScroll();
}

function buildFooter() {
  const el = document.getElementById("site-footer");
  if (!el) return;
  el.innerHTML = `
    <div class="wrap">
      <a class="brand" href="index.html"><span data-logo>${LOGO_SVG}</span><span>TA<em>-aero</em></span></a>
      <nav class="foot-nav" aria-label="Footer">${NAV.map(([h, l]) => `<a href="${h}">${l}</a>`).join("")}</nav>
      <p>Time Attack Aerodynamics is a student team competing in STEM Racing.<br>
      Built by the team. STEM Racing and F1 in Schools are trademarks of their owners.</p>
    </div>`;
}

function fillLogos() {
  document.querySelectorAll("[data-logo]:empty").forEach(n => { n.innerHTML = LOGO_SVG; });
}

/* Photo slots: <figure class="slot" data-src="images/team/adela.jpg" data-label="Adela">
   Shows the photo when the file exists; a slot whose file is missing is hidden. */
function fillSlots() {
  document.querySelectorAll(".slot[data-src]").forEach(slot => {
    const img = new Image();
    img.alt = slot.dataset.alt || slot.dataset.label || "";
    img.onload = () => slot.appendChild(img);
    img.onerror = () => { slot.hidden = true; };
    img.src = slot.dataset.src;
  });
}

/* Sections ease in as they scroll into view. Anything already on screen shows straight away. */
function reveal() {
  if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const items = document.querySelectorAll("main .band .wrap > *, main .band .grid-3 > *, main .band .steps > li, main .band .rows > li");
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }), { rootMargin: "0px 0px -8% 0px" });
  items.forEach((el, i) => {
    if (el.closest(".lab, .game, .sim") || el.getBoundingClientRect().top < innerHeight) return;
    el.classList.add("reveal"); el.style.transitionDelay = (i % 4) * 60 + "ms"; io.observe(el);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  buildHeader(); buildFooter(); fillLogos(); fillSlots(); reveal();
});

/* 3D concept car, built from simple shapes with three.js.
   To show the team's real model later, export it from Fusion as .glb/.stl and load it here instead. */
(function () {
  const box = document.getElementById("viewer");
  if (!box) return;
  if (!window.THREE) { box.querySelector(".note").textContent = "The 3D view needs an internet connection to load."; return; }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 500);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  box.prepend(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x6f8aa0, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(8, 20, 12); scene.add(sun);

  const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.1 });
  const TEAL = mat(0x265b6f), YELLOW = mat(0xf4c430), DARK = mat(0x121c24), BROWN = mat(0x5c3b23), STEEL = mat(0xb9c4cd);
  const car = new THREE.Group(); scene.add(car);
  const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); car.add(o); return o; };

  // Body: side profile extruded across the car's width (nose at −x, cartridge at +x)
  const s = new THREE.Shape();
  s.moveTo(-9.6, 0.5);
  s.bezierCurveTo(-6, 0.7, -3, 1.6, 0, 2.5);
  s.bezierCurveTo(2.5, 3.2, 4.5, 3.6, 6.5, 3.6);
  s.lineTo(10, 3.6); s.lineTo(10, 1.1);
  s.bezierCurveTo(7, 0.5, 3, 0.4, -9.6, 0.5);
  const bodyGeo = new THREE.ExtrudeGeometry(s, { depth: 2.2, bevelEnabled: true, bevelSize: 0.35, bevelThickness: 0.35, bevelSegments: 4, curveSegments: 24 });
  bodyGeo.translate(0, 0, -1.1);
  add(bodyGeo, TEAL, 0, 0, 0);

  // Sidepods
  [-1, 1].forEach(k => { const p = add(new THREE.SphereGeometry(1, 24, 16), TEAL, 2.5, 1.2, k * 1.9); p.scale.set(4.2, 0.75, 0.9); });
  // Falcon-brown nose tip and yellow stripe
  const tip = add(new THREE.SphereGeometry(0.75, 20, 14), BROWN, -9.5, 0.62, 0); tip.scale.set(1.3, 0.5, 1.2);
  add(new THREE.BoxGeometry(5, 0.08, 0.5), YELLOW, 3.5, 3.97, 0);

  // CO2 cartridge and its chamber
  const cyl = (r, len, m, x, y, z) => { const o = add(new THREE.CylinderGeometry(r, r, len, 28), m, x, y, z); o.rotation.z = Math.PI / 2; return o; };
  cyl(0.95, 0.5, DARK, 10.15, 2.4, 0);
  cyl(0.8, 1.6, STEEL, 10.6, 2.4, 0);

  // Wheels and axles
  const wheel = (x, r) => [-1, 1].forEach(k => {
    const w = add(new THREE.CylinderGeometry(r, r, 1.5, 32), DARK, x, r, k * 3.3); w.rotation.x = Math.PI / 2;
    const hub = add(new THREE.CylinderGeometry(r * 0.4, r * 0.4, 1.55, 20), YELLOW, x, r, k * 3.3); hub.rotation.x = Math.PI / 2;
  });
  wheel(-6.2, 1.3); wheel(6.4, 1.45);
  [[-6.2, 1.3], [6.4, 1.45]].forEach(([x, y]) => { const a = add(new THREE.CylinderGeometry(0.15, 0.15, 6.6, 12), STEEL, x, y, 0); a.rotation.x = Math.PI / 2; });

  // Wings
  add(new THREE.BoxGeometry(1.7, 0.16, 7.6), YELLOW, -9.4, 0.75, 0);
  [-1, 1].forEach(k => add(new THREE.BoxGeometry(1.9, 1.0, 0.14), TEAL, -9.4, 1.0, k * 3.8));
  add(new THREE.BoxGeometry(1.9, 0.16, 6.2), YELLOW, 9.6, 5.3, 0);
  [-1, 1].forEach(k => add(new THREE.BoxGeometry(2.2, 2.2, 0.14), TEAL, 9.6, 4.5, k * 3.1));
  [-1, 1].forEach(k => add(new THREE.BoxGeometry(0.5, 1.6, 0.2), TEAL, 9.2, 4.3, k * 0.8));

  // Track strip with tether line
  const track = new THREE.Mesh(new THREE.PlaneGeometry(60, 12), new THREE.MeshStandardMaterial({ color: 0xdfe6eb, roughness: 0.9 }));
  track.rotation.x = -Math.PI / 2; car.add(track);
  const line = new THREE.Mesh(new THREE.BoxGeometry(60, 0.05, 0.08), mat(0xa8322d)); line.position.y = 0.15; car.add(line);

  // Simple orbit: drag to rotate
  let yaw = -0.7, pitch = 0.32, spin = true, drag = null;
  const R = 46, target = new THREE.Vector3(0, 2, 0);
  function place() {
    pitch = Math.max(0.03, Math.min(1.5, pitch));
    camera.position.set(target.x + R * Math.cos(pitch) * Math.sin(yaw), target.y + R * Math.sin(pitch), target.z + R * Math.cos(pitch) * Math.cos(yaw));
    camera.lookAt(target);
  }
  function resize() {
    const w = box.clientWidth, h = box.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const spinBtn = document.querySelector('[data-view="spin"]');
  const setSpin = on => { spin = on; spinBtn.setAttribute("aria-pressed", on); };
  box.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY }; box.setPointerCapture(e.pointerId); setSpin(false); });
  box.addEventListener("pointermove", e => {
    if (!drag) return;
    yaw -= (e.clientX - drag.x) * 0.008; pitch += (e.clientY - drag.y) * 0.006;
    drag = { x: e.clientX, y: e.clientY };
  });
  ["pointerup", "pointercancel"].forEach(t => box.addEventListener(t, () => drag = null));
  const views = { side: [0, 0.05], front: [-Math.PI / 2, 0.12], top: [0, 1.5] };
  document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.view === "spin") return setSpin(!spin);
    [yaw, pitch] = views[b.dataset.view]; setSpin(false);
  }));
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (still) setSpin(false);
  addEventListener("resize", resize); resize();
  (function loop() {
    if (spin) yaw += 0.004;
    place(); renderer.render(scene, camera);
    requestAnimationFrame(loop);
  })();
})();

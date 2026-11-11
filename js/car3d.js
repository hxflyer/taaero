/* 3D lab: studio render, exploded view and illustrative wind tunnel. Uses the shared builder in car-model.js. */
(function () {
  const box = document.getElementById("viewer");
  if (!box) return;
  const note = box.querySelector(".note");
  if (!window.THREE || !window.TAAero) { note.textContent = "An internet connection is needed to load the 3D viewer."; return; }
  const T = THREE, A = TAAero, lin = A.lin, { lerp, clamp, smoothstep: smooth } = T.MathUtils;

  let renderer;
  try { renderer = new T.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }); }
  catch { note.textContent = "WebGL is unavailable in this browser."; return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.domElement.setAttribute("aria-hidden", "true");
  box.prepend(renderer.domElement);

  const BG = lin(0x0b131c);
  const scene = new T.Scene();
  scene.background = BG;
  scene.fog = new T.Fog(BG, 70, 180);
  scene.environment = A.makeEnvironment(renderer, "studio");
  const camera = new T.PerspectiveCamera(30, 16 / 9, 0.5, 300);

  // Studio lights: a soft key that casts the shadow, plus cool rim light from behind
  scene.add(new T.HemisphereLight(0xdfefff, 0x1a2633, 0.35));
  const key = new T.DirectionalLight(0xfff1dc, 1.5);
  key.position.set(-9, 22, 13); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.radius = 5; key.shadow.normalBias = 0.02;
  Object.assign(key.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 70 });
  scene.add(key);
  const rim = new T.DirectionalLight(0x8fd4ff, 1.1); rim.position.set(10, 8, -16); scene.add(rim);

  // Glossy studio floor
  const floor = new T.Mesh(new T.CircleGeometry(220, 64),
    new T.MeshStandardMaterial({ color: lin(0x0f1a26), roughness: 0.62, metalness: 0, envMapIntensity: 0.5 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const grid = new T.GridHelper(120, 60, 0x2d5d7c, 0x1b3345);
  grid.material.transparent = true; grid.material.opacity = 0; grid.position.y = 0.01; scene.add(grid);

  const rig = new T.Group(); scene.add(rig);   // lifted as the car explodes so nothing dips below the floor
  let car = null;

  /* ---------- Camera ---------- */
  const views = { perspective: [-0.62, 0.3], side: [0, 0.07], front: [-Math.PI / 2, 0.1], top: [0, 1.5], rear: [1.05, 0.28] };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let yaw = -0.62, pitch = 0.3, yawT = yaw, pitchT = pitch, zoom = 1, zoomT = 1;
  let dist = 30, tgtY = 2;
  let mode = "studio", spin = !reduced.matches, drag = null;
  let explodeT = 0, explodeNow = 0, selected = null;
  const DIST = { studio: 31, exploded: 58, airflow: 44 };

  /* ---------- Exploded view UI ---------- */
  const pins = document.getElementById("part-pins"), list = document.getElementById("part-list");
  const info = document.getElementById("part-info"), slider = document.getElementById("explode");
  const HILITE = lin(0x2aa8ff);
  function select(p) {
    selected = p === selected ? null : p;
    for (const q of car.parts) {
      const on = q === selected;
      q.mats.forEach(m => { if (m.emissive) { m.emissive.copy(on ? HILITE : new T.Color(0)); m.emissiveIntensity = on ? 0.35 : 1; } });
      q.btn.setAttribute("aria-pressed", on); q.pin.classList.toggle("on", on);
    }
    info.innerHTML = selected
      ? `<h4>${selected.name}</h4><p class="spec">${selected.material}</p><p>${selected.blurb}</p>`
      : `<p>Pick a part from the list, or click it on the model, to see what it does.</p>`;
  }
  function buildPartUI() {
    car.parts.forEach((p, i) => {
      p.btn = document.createElement("button");
      p.btn.type = "button"; p.btn.className = "part-btn"; p.btn.setAttribute("aria-pressed", "false");
      p.btn.innerHTML = `<b>${i + 1}</b><span>${p.name}</span>`;
      p.btn.addEventListener("click", () => select(p));
      list.appendChild(p.btn);
      p.pin = document.createElement("button");
      p.pin.type = "button"; p.pin.className = "pin"; p.pin.textContent = i + 1; p.pin.title = p.name; p.pin.tabIndex = -1;
      p.pin.addEventListener("click", () => select(p));
      pins.appendChild(p.pin);
    });
  }
  const v3 = new T.Vector3(), bb = new T.Box3();
  function placePins() {
    const show = mode === "exploded" && explodeNow > 0.25;
    pins.hidden = !show;
    if (!show) return;
    const w = box.clientWidth, h = box.clientHeight;
    for (const p of car.parts) {
      // anchor on the part's first piece (for pairs, the one nearest the camera side)
      const it = p.items.length > 1 && camera.position.z < 0 && p.items[0].offset.z > 0 ? p.items[1] : p.items[0];
      bb.setFromObject(it.obj).getCenter(v3).project(camera);
      p.pin.style.transform = `translate(${(v3.x + 1) / 2 * w}px, ${(1 - v3.y) / 2 * h}px)`;
      p.pin.hidden = v3.z > 1;
    }
  }

  /* ---------- Wind tunnel ---------- */
  const flow = new T.Group(); flow.visible = false; scene.add(flow);
  const streams = [];
  const minX = -16, maxX = 18, SAMPLES = 140;
  let playing = !reduced.matches, playbackRate = 1, flowTime = 0, pressure = false;
  let sparks, pressureMat;

  // Colour ramp shared by the streamlines, the particles and the pressure map (slow/low → fast/high)
  const RAMP = [0x2b4bff, 0x18b7ff, 0x35e6a0, 0xf5e23a, 0xff5a2b].map(lin);
  function ramp(t, out) {
    t = clamp(t, 0, 1) * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(t));
    return out.copy(RAMP[i]).lerp(RAMP[i + 1], t - i);
  }

  // Kinematic model: streamlines ride over smooth envelopes of the body, wheels and rear wing.
  // Returns position plus a relative speed (1 = free stream).
  function streamPath(x, inletY, inletZ) {
    let y = inletY, z = inletZ, speed = 1;
    const side = Math.sign(z) || 1;
    const [bottom, top, width] = A.bodyAt(clamp(x, -10.1, 9.15));
    const bodyFade = smooth(x, -12.5, -9.3) * (1 - smooth(x, 8.8, 14.5));
    const d = Math.abs(z), half = width * 1.2 + 0.45;
    if (d < half) {
      const cross = Math.sqrt(Math.max(0, 1 - (d / half) ** 2));
      const roof = (bottom + top) / 2 + ((top - bottom) / 2 + 0.36) * cross;
      const lift = Math.max(0, roof - y) * bodyFade;
      y += lift;
      speed += 0.5 * Math.min(1, lift) * smooth(x, -9, -2) * (1 - smooth(x, 6.5, 10));   // faster over the crown
      speed -= 0.75 * Math.exp(-(((x + 10.6) / 1.1) ** 2)) * cross * (inletY < 1.4 ? 1 : 0.4); // stagnation at the nose
      speed -= 0.45 * smooth(x, 9, 11) * (1 - smooth(x, 12, 17)) * cross * (inletY < 3.2 ? 1 : 0.3); // base wake
    }
    for (const wh of A.WHEELS) {
      const dx = x - wh.x, lane = Math.abs(z) - wh.z;
      if (Math.abs(lane) >= 1.6) continue;
      const env = smooth(dx, -3.4, -wh.radius) * (1 - smooth(dx, wh.radius, 4.8));
      const hgt = 1 - smooth(y, wh.radius * 2, wh.radius * 2 + 0.5);
      const shift = Math.max(0, wh.width / 2 + 0.38 - Math.abs(lane));
      z += side * (Math.sign(lane) || 1) * shift * env * hgt;
      speed += 0.35 * env * hgt * (shift > 0 ? 1 : 0);
      speed -= 0.55 * smooth(dx, wh.radius, wh.radius + 0.6) * (1 - smooth(dx, 2.5, 6)) * hgt * (Math.abs(lane) < 0.6 ? 1 : 0);
    }
    const wing = smooth(x, 5.9, 7.5) * (1 - smooth(x, 9, 12.4));
    if (Math.abs(z) < 3.35 && y > 4.9 && y < 6.1) {
      const over = y >= 5.42;
      y += (over ? 6.12 - y : 4.88 - y) * wing;
      speed += (over ? 0.3 : -0.15) * wing;
    }
    return [x, y, z, clamp(speed, 0.12, 1.6)];
  }

  function addStream(start, path, radius) {
    const pts = [], speeds = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES, [x, y, z, s] = path(lerp(start, maxX, t), t);
      pts.push(new T.Vector3(x, y, z)); speeds.push(s);
    }
    const tube = new T.TubeGeometry(new T.CatmullRomCurve3(pts), SAMPLES, radius, 5, false);
    const col = [], c = new T.Color(), per = 6;
    for (let i = 0; i <= SAMPLES; i++) {
      ramp(0.5 + (speeds[i] - 1) * 0.9, c);
      const fade = smooth(i, 0, 10) * (1 - smooth(i, SAMPLES - 14, SAMPLES)) * 0.36;
      for (let k = 0; k < per; k++) col.push(c.r * fade, c.g * fade, c.b * fade);
    }
    tube.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    flow.add(new T.Mesh(tube, streamMat));
    streams.push({ pts, speeds, phase: (streams.length * 0.618034) % 1 });
  }
  const streamMat = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });

  function buildFlow() {
    for (const y of [0.7, 1.4, 2.2, 3.1, 4.1, 5.15, 5.75, 6.8])
      for (const z of [-5.4, -4.2, -3.1, -2.2, -1.2, -0.4, 0.4, 1.2, 2.2, 3.1, 4.2, 5.4])
        addStream(minX, x => streamPath(x, y, z), 0.022);
    const swirl = (start, y, z, spread, phase) => addStream(start, (x, t) => {
      const r = spread * (0.12 + 0.88 * t), a = t * 15 + phase;
      return [x, Math.max(0.15, y + Math.cos(a) * r), z + Math.sin(a) * r, 0.3 + 0.35 * t];
    }, 0.018);
    for (const wh of A.WHEELS) for (const s of [-1, 1]) for (const ph of [0, 2.1, 4.2])
      swirl(wh.x + wh.radius + 0.05, wh.radius, s * wh.z, 0.6, ph);
    for (const s of [-1, 1]) for (const ph of [0, Math.PI]) swirl(9.6, 5.45, s * 3.08, 0.5, ph + s);
    for (const ph of [0, 2.1, 4.2]) swirl(9.5, 2.0, 0, 0.85, ph);

    // Glowing particles that ride each streamline at its local speed
    const PER = 5, TRAIL = 7, count = streams.length * PER * TRAIL;
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(new Float32Array(count * 3), 3).setUsage(T.DynamicDrawUsage));
    geo.setAttribute("color", new T.BufferAttribute(new Float32Array(count * 3), 3).setUsage(T.DynamicDrawUsage));
    const dot = A.canvas(64, 64), g = dot.getContext("2d"), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "#fff"); grad.addColorStop(0.25, "rgba(255,255,255,.75)"); grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    sparks = new T.Points(geo, new T.PointsMaterial({
      size: 0.34, map: new T.CanvasTexture(dot), vertexColors: true, transparent: true,
      blending: T.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, sizeAttenuation: true
    }));
    sparks.frustumCulled = false; sparks.userData = { PER, TRAIL };
    flow.add(sparks);
    // each particle remembers how far along its line it is
    for (const s of streams) s.at = Array.from({ length: PER }, (_, k) => ((s.phase + k / PER) % 1) * SAMPLES);
  }
  const pc = new T.Color();
  function moveSparks(dt) {
    const { PER, TRAIL } = sparks.userData, pos = sparks.geometry.attributes.position, col = sparks.geometry.attributes.color;
    let n = 0;
    for (const s of streams) for (let k = 0; k < PER; k++) {
      const i0 = Math.min(SAMPLES - 1, Math.floor(s.at[k]));
      s.at[k] += dt * 34 * s.speeds[i0];
      if (s.at[k] >= SAMPLES) s.at[k] -= SAMPLES;
      for (let j = 0; j < TRAIL; j++, n++) {
        const p = Math.max(0, s.at[k] - j * 0.55 * (0.4 + s.speeds[i0])), i = Math.min(SAMPLES - 1, Math.floor(p)), f = p - i;
        const a = s.pts[i], b = s.pts[i + 1];
        pos.setXYZ(n, lerp(a.x, b.x, f), lerp(a.y, b.y, f), lerp(a.z, b.z, f));
        const fade = (1 - j / TRAIL) ** 1.6 * smooth(p, 0, 8) * (1 - smooth(p, SAMPLES - 12, SAMPLES));
        ramp(0.5 + (s.speeds[i] - 1) * 0.9, pc);
        col.setXYZ(n, pc.r * fade, pc.g * fade, pc.b * fade);
      }
    }
    pos.needsUpdate = col.needsUpdate = true;
  }

  // Surface pressure estimate from how squarely each patch of skin faces the oncoming air
  function buildPressure() {
    const geo = car.bodyMesh.geometry, nrm = geo.attributes.normal, col = [], c = new T.Color();
    for (let i = 0; i < nrm.count; i++) {
      const nx = nrm.getX(i), v = 0.42 - nx * 1.5;   // windward slopes high, leeward slopes low
      ramp(v, c); col.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    pressureMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, envMapIntensity: 0.25 });
  }

  /* ---------- Modes ---------- */
  const modeBtns = [...document.querySelectorAll("[data-mode]")], panels = [...document.querySelectorAll("[data-panel]")];
  const legend = document.getElementById("flow-legend"), spinBtn = document.querySelector('[data-view="spin"]');
  function setSpin(on) { spin = on; spinBtn.setAttribute("aria-pressed", on); }
  function setPressure(on) {
    pressure = on;
    document.getElementById("pressure-toggle").setAttribute("aria-pressed", on);
    car.bodyMesh.material = on && mode === "airflow" ? pressureMat : car.paint;
    legend.querySelector("[data-lo]").textContent = on ? "low pressure / slow" : "slow";
    legend.querySelector("[data-hi]").textContent = on ? "high pressure / fast" : "fast";
  }
  function setMode(m) {
    mode = m;
    modeBtns.forEach(b => b.setAttribute("aria-selected", b.dataset.mode === m));
    panels.forEach(p => { p.hidden = p.dataset.panel !== m; });
    flow.visible = m === "airflow"; legend.hidden = m !== "airflow";
    explodeT = m === "exploded" ? slider.value / 100 : 0;
    if (m !== "exploded" && selected) select(selected);
    setPressure(pressure);
    if (m === "airflow") { [yawT, pitchT] = [-0.3, 0.36]; setSpin(false); }
    if (m === "exploded") { [yawT, pitchT] = [-0.72, 0.42]; setSpin(false); }
    if (m === "studio") { [yawT, pitchT] = views.perspective; }
    zoomT = 1;
    note.textContent = m === "exploded" ? "Drag to rotate · scroll to zoom · click a part" : "Drag to rotate · scroll to zoom";
  }

  /* ---------- Loop ---------- */
  let last, onScreen = true, raf = 0;
  function frame(now) {
    raf = 0;
    const dt = last === undefined ? 0 : Math.min(0.05, (now - last) / 1000); last = now;
    const k = 1 - Math.exp(-dt * 7);
    if (spin && !drag) yawT += dt * 0.25;
    yaw += (yawT - yaw) * k; pitch += (pitchT - pitch) * k; zoom += (zoomT - zoom) * k;
    explodeNow += (explodeT - explodeNow) * (1 - Math.exp(-dt * 5));
    if (car) {
      car.explode(explodeNow);
      rig.position.y = explodeNow * 2.4;
      if (mode === "airflow" && playing) {
        flowTime += dt * playbackRate; moveSparks(dt * playbackRate);
        for (const w of car.wheels) w.spin.rotation.z += dt * playbackRate * 9;
      }
    }
    grid.material.opacity += ((mode === "airflow" ? 0.55 : 0) - grid.material.opacity) * k;
    if (mode === "airflow" && playing) grid.position.x = (flowTime * 6) % 2;

    dist += (DIST[mode] * Math.max(1, 1.55 / camera.aspect) * zoom - dist) * k;
    tgtY += ((mode === "exploded" ? 2 + explodeNow * 4.6 : mode === "airflow" ? 2.6 : 2.0) - tgtY) * k;
    const tx = mode === "exploded" ? explodeNow * 2.6 : mode === "airflow" ? 0.8 : 0;
    camera.position.set(tx + dist * Math.cos(pitch) * Math.sin(yaw), tgtY + dist * Math.sin(pitch), dist * Math.cos(pitch) * Math.cos(yaw));
    camera.lookAt(tx, tgtY, 0);
    renderer.render(scene, camera);
    if (car) placePins();
    schedule();
  }
  function schedule() {
    const active = onScreen && !document.hidden;
    if (active && !raf) raf = requestAnimationFrame(frame);
    if (!active) { cancelAnimationFrame(raf); raf = 0; last = undefined; }
  }
  function resize() {
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    if (car) renderer.render(scene, camera);
  }
  new ResizeObserver(resize).observe(box);
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; schedule(); }).observe(box);
  document.addEventListener("visibilitychange", schedule);

  /* ---------- Input ---------- */
  const ray = new T.Raycaster(), mouse = new T.Vector2();
  function partAt(ev) {
    const r = box.getBoundingClientRect();
    mouse.set((ev.clientX - r.left) / r.width * 2 - 1, -(ev.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObject(car.group, true)[0];
    return hit ? hit.object.userData.part : null;
  }
  box.addEventListener("pointerdown", ev => {
    if (drag || ev.button !== 0 || ev.target.closest("button")) return;
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: 0 };
    box.setPointerCapture(ev.pointerId); setSpin(false);
  });
  box.addEventListener("pointermove", ev => {
    if (!drag || drag.id !== ev.pointerId) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    yawT -= dx * 0.008; pitchT = clamp(pitchT + dy * 0.006, 0.03, 1.52);
    drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = ev.clientX; drag.y = ev.clientY;
  });
  box.addEventListener("pointerup", ev => {
    if (drag && drag.moved < 5 && mode === "exploded" && car) { const p = partAt(ev); if (p) select(p); }
  });
  box.addEventListener("lostpointercapture", () => { drag = null; });
  box.addEventListener("wheel", ev => { ev.preventDefault(); zoomT = clamp(zoomT * (1 + Math.sign(ev.deltaY) * 0.1), 0.5, 1.6); }, { passive: false });

  document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.view === "spin") return setSpin(!spin);
    [yawT, pitchT] = views[b.dataset.view];
    yawT += Math.round((yaw - yawT) / (Math.PI * 2)) * Math.PI * 2;   // take the short way round
    setSpin(false);
  }));
  modeBtns.forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
  slider.addEventListener("input", () => { explodeT = slider.value / 100; document.getElementById("explode-out").value = slider.value + "%"; });
  const pause = document.getElementById("flow-pause"), speed = document.getElementById("flow-speed");
  pause.addEventListener("click", () => { playing = !playing; pause.textContent = playing ? "Pause flow" : "Play flow"; });
  speed.addEventListener("input", () => { playbackRate = +speed.value; document.getElementById("flow-rate").value = playbackRate + "×"; });
  document.getElementById("pressure-toggle").addEventListener("click", () => setPressure(!pressure));
  reduced.addEventListener("change", e => { if (e.matches) { setSpin(false); playing = false; pause.textContent = "Play flow"; } });

  /* ---------- Go ---------- */
  A.loadFalcon(falcon => {
    car = A.buildCar({ falcon, detail: "high" });
    car.paint = car.bodyMesh.material;
    rig.add(car.group);
    buildPartUI(); buildFlow(); buildPressure();
    moveSparks(0);
    pause.textContent = playing ? "Pause flow" : "Play flow";
    select(null); selected = null;
    setSpin(spin); setMode("studio");
    document.getElementById("lab-controls").hidden = false;
    resize(); frame(performance.now());
  });
  resize();
})();

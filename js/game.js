/* Stoop Grand Prix: an arcade circuit race using the TA-aero car model.
   Real STEM Racing cars run in a straight line on a tether. This is the "what if it had a steering wheel" version.
   World units are metres. Forward for a heading angle a is (cos a, 0, sin a). */
(function () {
  const stage = document.getElementById("game");
  if (!stage) return;
  const $ = id => document.getElementById(id);
  if (!window.THREE || !window.TAAero) { $("g-menu-msg").textContent = "The game needs an internet connection to load its 3D engine."; return; }
  const T = THREE, A = TAAero, lin = A.lin, { lerp, clamp } = T.MathUtils;

  let renderer;
  try { renderer = new T.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }); }
  catch { $("g-menu-msg").textContent = "WebGL is unavailable in this browser."; return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  stage.prepend(renderer.domElement);

  const scene = new T.Scene();
  const HAZE = lin(0xcfe0ee);
  scene.fog = new T.Fog(HAZE, 180, 1250);
  scene.environment = A.makeEnvironment(renderer, "sky");
  const sky = A.gradientDome(1800, A.SKY); scene.add(sky);
  const camera = new T.PerspectiveCamera(62, 16 / 9, 0.3, 2600);

  scene.add(new T.HemisphereLight(0xcfe6ff, 0x5d6b47, 0.75));
  const sun = new T.DirectionalLight(0xfff0d6, 1.9);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05;
  Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 10, far: 320 });
  scene.add(sun, sun.target);
  const SUN_DIR = new T.Vector3(70, 110, 45);

  /* ---------- Textures ---------- */
  const rnd = (a, b) => a + Math.random() * (b - a);
  function noiseTex(size, base, specks, repeat) {
    const c = A.canvas(size, size), g = c.getContext("2d");
    g.fillStyle = base; g.fillRect(0, 0, size, size);
    for (const [color, n, r] of specks) { g.fillStyle = color; for (let i = 0; i < n; i++) g.fillRect(Math.random() * size, Math.random() * size, rnd(1, r), rnd(1, r)); }
    return [c, g, repeat];
  }
  function bake([c, , repeat]) { const t = A.tex(c, repeat || [1, 1]); t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; }

  const asphalt = noiseTex(512, "#34373c", [["rgba(255,255,255,0.05)", 5000, 3], ["rgba(0,0,0,0.16)", 5000, 3]]);
  { const g = asphalt[1];
    g.fillStyle = "rgba(18,18,20,0.35)"; g.fillRect(150, 0, 60, 512); g.fillRect(300, 0, 60, 512);          // rubbered-in racing lines
    g.fillStyle = "#e9ecee"; g.fillRect(14, 0, 12, 512); g.fillRect(486, 0, 12, 512);                      // edge lines
    g.fillRect(252, 0, 8, 250); }                                                                          // centre dashes
  const kerb = noiseTex(64, "#d8322a", []); kerb[1].fillStyle = "#f2f2f2"; kerb[1].fillRect(0, 0, 64, 32);
  const grass = noiseTex(256, "#4d7a35", [["rgba(110,160,70,0.5)", 2600, 4], ["rgba(40,80,30,0.5)", 2600, 4]], [500, 500]);
  const verge = noiseTex(256, "#5b8a3d", [["rgba(140,180,90,0.4)", 2400, 4], ["rgba(50,90,35,0.4)", 2000, 4]]);
  const wall = noiseTex(128, "#c9ced3", [["rgba(0,0,0,0.06)", 500, 6]]);
  { const g = wall[1]; g.fillStyle = "#0a566b"; g.fillRect(0, 70, 128, 34); g.fillStyle = "#ffb000"; g.fillRect(0, 104, 128, 8); g.fillStyle = "#8d949b"; g.fillRect(0, 0, 128, 6); }

  /* ---------- Track ---------- */
  const HALF = 7.5, KERB = 1.3, WALL = 15.5;
  const ctrl = [[0, 0], [100, 0], [185, -22], [225, -95], [185, -165], [100, -150], [40, -195], [-50, -245], [-150, -205], [-185, -120], [-120, -85], [-150, -25], [-90, 0]];
  const curve = new T.CatmullRomCurve3(ctrl.map(([x, z]) => new T.Vector3(x, 0, z)), true, "centripetal");
  const N = 1500;
  const P = curve.getSpacedPoints(N).slice(0, N);
  const LENGTH = curve.getLength(), DS = LENGTH / N;
  const TAN = P.map((_, i) => P[(i + 1) % N].clone().sub(P[(i - 1 + N) % N]).normalize());
  const LEFT = TAN.map(t => new T.Vector3(t.z, 0, -t.x));       // left-hand normal
  let CURV = TAN.map((t, i) => Math.asin(clamp(TAN[(i + 3) % N].clone().cross(TAN[(i - 3 + N) % N]).y, -1, 1)) / (6 * DS));
  CURV = CURV.map((_, i) => { let s = 0; for (let k = -6; k <= 6; k++) s += CURV[(i + k + N) % N]; return s / 13; });
  const wrap = i => ((i % N) + N) % N;

  // A ribbon that follows the track between two sideways offsets (positive = left)
  function ribbon(offA, offB, yA, yB, material, vScale, keep) {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const j = i % N, p = P[j], l = LEFT[j];
      pos.push(p.x + l.x * offA, yA, p.z + l.z * offA, p.x + l.x * offB, yB, p.z + l.z * offB);
      uv.push(0, i * DS / vScale, 1, i * DS / vScale);
      if (i < N && (!keep || keep(j))) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new T.Mesh(geo, material); m.receiveShadow = true; scene.add(m); return m;
  }
  const mat = (t, rough, extra) => new T.MeshStandardMaterial(Object.assign({ map: t, roughness: rough, metalness: 0, side: T.DoubleSide, envMapIntensity: 0.35 }, extra));
  const asphaltT = bake(asphalt); asphaltT.wrapT = T.RepeatWrapping;
  ribbon(HALF, -HALF, 0.03, 0.03, mat(asphaltT, 0.82), 12);
  const kerbT = bake(kerb); kerbT.wrapT = T.RepeatWrapping;
  const corner = j => Math.abs(CURV[j]) > 0.0045;
  ribbon(HALF + KERB, HALF, 0.07, 0.035, mat(kerbT, 0.7), 4, corner);
  ribbon(-HALF, -HALF - KERB, 0.035, 0.07, mat(kerbT, 0.7), 4, corner);
  const vergeT = bake(verge); vergeT.wrapS = vergeT.wrapT = T.RepeatWrapping; vergeT.repeat.set(1.5, 1);
  ribbon(WALL, HALF, 0.02, 0.02, mat(vergeT, 1), 8);
  ribbon(-HALF, -WALL, 0.02, 0.02, mat(vergeT, 1), 8);
  const wallT = bake(wall); wallT.wrapS = wallT.wrapT = T.RepeatWrapping;
  for (const s of [1, -1]) { const w = ribbon(s * WALL, s * WALL, 0, 1.15, mat(wallT, 0.6), 1.15); w.material.map = wallT; w.castShadow = true; }
  { // wall uv: run the pattern along the wall
    scene.traverse(o => { if (o.isMesh && o.material.map === wallT) { const uv = o.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 0.5, uv.getX(i)); } });
  }

  const ground = new T.Mesh(new T.PlaneGeometry(5000, 5000), mat(bake(grass), 1));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  /* ---------- Scenery ---------- */
  const flat = (color, rough = 0.8, metal = 0) => new T.MeshStandardMaterial({ color: lin(color), roughness: rough, metalness: metal, envMapIntensity: 0.4 });
  const put = (geo, m, x, y, z, ry = 0) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = o.receiveShadow = true; scene.add(o); return o; };
  function sign(text, w, h, bg, fg, size) {
    const c = A.canvas(512, Math.round(512 * h / w)), g = c.getContext("2d");
    g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = fg; g.font = `italic 800 ${size}px 'Saira Condensed','Arial Narrow',sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, 256, c.height / 2 + 4);
    return new T.MeshStandardMaterial({ map: A.tex(c), roughness: 0.6, side: T.DoubleSide });
  }
  // Start gantry with five lights
  const start = P[0], sTan = TAN[0], sYaw = Math.atan2(-sTan.z, sTan.x);
  const steel = flat(0x2b3138, 0.5, 0.6);
  for (const s of [1, -1]) put(new T.BoxGeometry(0.6, 8, 0.6), steel, start.x + LEFT[0].x * s * (HALF + 2.2), 4, start.z + LEFT[0].z * s * (HALF + 2.2));
  put(new T.BoxGeometry(0.9, 1.6, 2 * HALF + 5.4), steel, start.x, 7.6, start.z, sYaw);
  put(new T.PlaneGeometry(2 * HALF + 4, 1.4), sign("STOOP GRAND PRIX · TA-AERO", 20, 1.4, "#0f1e29", "#f4c430", 30), start.x - sTan.x * 0.47, 7.6, start.z - sTan.z * 0.47, sYaw - Math.PI / 2).castShadow = false;
  const lamps = [];
  for (let i = 0; i < 5; i++) {
    const m = new T.MeshStandardMaterial({ color: 0x220606, emissive: 0xff1a10, emissiveIntensity: 0, roughness: 0.4 });
    const o = put(new T.SphereGeometry(0.42, 16, 12), m, start.x - sTan.x * 0.6 + LEFT[0].x * (i - 2) * 1.5, 6.3, start.z - sTan.z * 0.6 + LEFT[0].z * (i - 2) * 1.5);
    o.castShadow = false; lamps.push(m);
  }
  { // chequered start line
    const c = A.canvas(256, 32), g = c.getContext("2d");
    for (let y = 0; y < 2; y++) for (let x = 0; x < 16; x++) { g.fillStyle = (x + y) % 2 ? "#111" : "#f4f4f4"; g.fillRect(x * 16, y * 16, 16, 16); }
    const line = new T.Mesh(new T.PlaneGeometry(2 * HALF, 1.6), new T.MeshStandardMaterial({ map: A.tex(c), roughness: 0.8 }));
    line.rotation.x = -Math.PI / 2; line.rotation.z = sYaw + Math.PI / 2; line.position.set(start.x, 0.045, start.z); line.receiveShadow = true; scene.add(line);
  }
  // Grandstand with a crowd, on the outside of the start straight
  { const c = A.canvas(256, 64), g = c.getContext("2d"); g.fillStyle = "#39424c"; g.fillRect(0, 0, 256, 64);
    const hues = ["#f4c430", "#0a566b", "#e9ecee", "#d8322a", "#f08a4b", "#2f5fa8", "#222"];
    for (let i = 0; i < 1400; i++) { g.fillStyle = hues[i % hues.length]; g.fillRect(Math.random() * 256, Math.random() * 64, 3, 4); }
    const crowd = new T.MeshStandardMaterial({ map: A.tex(c, [4, 1]), roughness: 0.9 });
    for (let r = 0; r < 7; r++) put(new T.BoxGeometry(150, 1.1, 2.4), r % 1 === 0 ? crowd : steel, 20, 1.2 + r * 1.1, 22 + r * 2.4);
    put(new T.BoxGeometry(152, 0.5, 20), flat(0xe9ecee, 0.5), 20, 13.5, 30);
    for (const x of [-54, -17, 20, 57, 94]) put(new T.BoxGeometry(0.7, 13, 0.7), steel, x, 6.5, 38.5);
  }
  // Pit building and trackside boards on the inside
  put(new T.BoxGeometry(110, 7, 12), flat(0xdfe5ea, 0.7), 30, 3.5, -30);
  put(new T.BoxGeometry(112, 0.6, 14), flat(0x0a566b, 0.5), 30, 7.3, -30);
  put(new T.PlaneGeometry(60, 3), sign("TIME ATTACK AERODYNAMICS", 60, 3, "#0a566b", "#ffffff", 24), 30, 5, -23.9).castShadow = false;
  const boards = [sign("TA-AERO", 14, 3, "#f4c430", "#0f1e29", 96), sign("STEM RACING", 14, 3, "#0f1e29", "#ffffff", 76), sign("STOOP", 14, 3, "#a8322d", "#ffffff", 96)];
  for (let k = 0, i = 120; i < N; i += 97, k++) {
    if (i < 160 || i > N - 160) continue;
    const s = CURV[i] > 0 ? -1 : 1, d = WALL + 2.5, p = P[i], l = LEFT[i];
    const b = put(new T.PlaneGeometry(14, 3), boards[k % 3], p.x + l.x * s * d, 2.6, p.z + l.z * s * d, Math.atan2(-TAN[i].z, TAN[i].x) + (s > 0 ? 0 : Math.PI));
    b.castShadow = false;
    for (const e of [-6, 6]) put(new T.BoxGeometry(0.25, 2.6, 0.25), steel, b.position.x + TAN[i].x * e, 1.3, b.position.z + TAN[i].z * e);
  }
  // Trees (instanced) kept clear of the circuit
  { const spots = [];
    for (let tries = 0; spots.length < 420 && tries < 6000; tries++) {
      const x = rnd(-420, 460), z = rnd(-470, 240);
      if (x > -60 && x < 100 && z > -40 && z < 46) continue;
      let ok = true;
      for (let i = 0; i < N; i += 10) { const dx = P[i].x - x, dz = P[i].z - z; if (dx * dx + dz * dz < 26 * 26) { ok = false; break; } }
      if (ok) spots.push([x, z, rnd(0.7, 1.5)]);
    }
    const trunk = new T.InstancedMesh(new T.CylinderGeometry(0.35, 0.5, 3, 6), flat(0x5c3b23, 1), spots.length);
    const crownA = new T.InstancedMesh(new T.ConeGeometry(3, 7, 8), flat(0x2f6b33, 1), spots.length);
    const crownB = new T.InstancedMesh(new T.ConeGeometry(2.2, 5.5, 8), flat(0x3a7d3c, 1), spots.length);
    const m4 = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3();
    spots.forEach(([x, z, s], i) => {
      q.setFromAxisAngle(new T.Vector3(0, 1, 0), Math.random() * 6);
      trunk.setMatrixAt(i, m4.compose(new T.Vector3(x, 1.5 * s, z), q, sc.set(s, s, s)));
      crownA.setMatrixAt(i, m4.compose(new T.Vector3(x, 5.5 * s, z), q, sc.set(s, s, s)));
      crownB.setMatrixAt(i, m4.compose(new T.Vector3(x, 8.6 * s, z), q, sc.set(s, s, s)));
    });
    for (const im of [trunk, crownA, crownB]) { im.castShadow = true; scene.add(im); }
  }
  // Distant hills
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2 + rnd(-0.1, 0.1), r = rnd(900, 1250), h = rnd(90, 210);
    const hill = new T.Mesh(new T.ConeGeometry(rnd(260, 420), h, 7), flat(i % 2 ? 0x5f7f6a : 0x6b8a78, 1));
    hill.position.set(Math.cos(a) * r, h / 2 - 8, Math.sin(a) * r - 100); scene.add(hill);
  }

  /* ---------- Cars ---------- */
  const SCALE = 0.24, LAPS = 3;
  const RIVALS = [
    { name: "Crimson Kite", base: "#a8221f", accent: "#ffffff", panel: "#f0d9b8", number: "7", skill: 0.99 },
    { name: "Volt Viper", base: "#1c1f26", accent: "#b6f22b", panel: "#3b424c", number: "22", skill: 0.965 },
    { name: "Orange Osprey", base: "#e8641b", accent: "#12222e", panel: "#ffe2c4", number: "41", skill: 0.94 },
    { name: "Royal Swift", base: "#2845b8", accent: "#f4c430", panel: "#dfe6f5", number: "9", skill: 0.915 },
    { name: "White Heron", base: "#e9edf0", accent: "#d8322a", panel: "#aeb9c2", number: "63", skill: 0.89 }
  ];
  const cars = [];
  let player;
  function makeCar(opts, isPlayer) {
    const model = A.buildCar(Object.assign({ detail: "low" }, opts));
    model.group.scale.setScalar(SCALE);
    const holder = new T.Group(); holder.add(model.group); scene.add(holder);
    const car = { model, holder, isPlayer, name: opts.name || "You", color: opts.base || "#0a566b", pos: new T.Vector3(), a: 0, speed: 0, idx: 0, lap: -1, lat: 0, steer: 0, done: 0, skill: opts.skill || 1 };
    cars.push(car); return car;
  }
  function pose(car, dt) {
    car.holder.position.copy(car.pos);
    car.holder.rotation.y = Math.atan2(Math.sin(car.a), -Math.cos(car.a));
    car.model.group.rotation.x = lerp(car.model.group.rotation.x, clamp(-car.steer * car.speed * 0.0012, -0.06, 0.06), 0.2);   // body roll
    for (const w of car.model.wheels) {
      w.spin.rotation.z += car.speed * dt / (w.radius * SCALE);
      if (w.front) w.steer.rotation.y = car.steer * 0.32;
    }
  }
  // Where is a point relative to the track? Searches near the last known sample.
  function locate(car, span = 50) {
    let best = car.idx, bd = Infinity;
    for (let k = -span; k <= span; k++) {
      const j = wrap(car.idx + k), dx = car.pos.x - P[j].x, dz = car.pos.z - P[j].z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = j; }
    }
    const moved = best - car.idx;
    if (moved < -N / 2) car.lap++; else if (moved > N / 2) car.lap--;
    car.idx = best;
    car.lat = (car.pos.x - P[best].x) * LEFT[best].x + (car.pos.z - P[best].z) * LEFT[best].z;
  }
  const progress = c => c.lap * N + (c.isPlayer ? c.idx : c.s);

  function grid() {
    const order = [...cars.filter(c => !c.isPlayer), player];
    order.forEach((c, k) => {
      const s = N - (9 + k * 8) / DS, j = wrap(Math.round(s)), off = k % 2 ? -3.2 : 3.2;
      c.s = s; c.idx = j; c.lap = -1; c.speed = 0; c.done = 0; c.steer = 0; c.off = c.lane = off; c.lat = off;
      c.pos.copy(P[j]).addScaledVector(LEFT[j], off);
      c.a = Math.atan2(TAN[j].z, TAN[j].x); c.vx = c.vz = 0;
      pose(c, 0);
    });
    boost = 1;
  }

  /* ---------- Input ---------- */
  const keys = {}, touch = {};
  const down = (...names) => names.some(n => keys[n] || touch[n]);
  addEventListener("keydown", e => {
    if (state === "menu" || state === "paused" && e.code !== "KeyP" && e.code !== "Escape") return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    if (e.code === "KeyC" && !e.repeat) camMode = (camMode + 1) % 3;
    if (e.code === "KeyR" && !e.repeat && state === "race") rescue();
    if ((e.code === "KeyP" || e.code === "Escape") && !e.repeat) togglePause();
  });
  addEventListener("keyup", e => { keys[e.code] = false; });
  addEventListener("blur", () => { for (const k in keys) keys[k] = false; if (state === "race" || state === "countdown") togglePause(); });
  document.querySelectorAll("[data-key]").forEach(b => {
    const set = v => e => { e.preventDefault(); touch[b.dataset.key] = v; b.classList.toggle("held", v); };
    b.addEventListener("pointerdown", set(true)); b.addEventListener("pointerup", set(false));
    b.addEventListener("pointerleave", set(false)); b.addEventListener("pointercancel", set(false));
    b.addEventListener("contextmenu", e => e.preventDefault());
  });

  /* ---------- Player physics ---------- */
  let boost = 1, boosting = false;
  function drivePlayer(dt) {
    const c = player, live = state === "race" && !c.done;
    const thr = live && down("ArrowUp", "KeyW") ? 1 : 0, brk = live && down("ArrowDown", "KeyS", "Space") ? 1 : 0;
    const want = live ? (down("ArrowLeft", "KeyA") ? 1 : 0) - (down("ArrowRight", "KeyD") ? 1 : 0) : 0;
    c.steer += clamp(want - c.steer, -dt * 4.5, dt * 4.5);
    boosting = live && down("ShiftLeft", "ShiftRight", "KeyB") && boost > 0.02 && thr > 0;
    boost = clamp(boost + (boosting ? -dt / 3.5 : dt / 14), 0, 1);

    const fx = Math.cos(c.a), fz = Math.sin(c.a);
    let fwd = c.vx * fx + c.vz * fz, side = c.vx * fz - c.vz * fx;     // side > 0 means sliding left
    const offroad = Math.abs(c.lat) > HALF + KERB;
    const top = (offroad ? 30 : 80) + (boosting ? 14 : 0);
    if (thr) fwd += (boosting ? 34 : 21) * Math.max(0, 1 - fwd / top) * dt;
    if (brk) fwd = fwd > 0.5 ? Math.max(0, fwd - 42 * dt) : Math.max(-9, fwd - 9 * dt);
    fwd -= fwd * (offroad ? 0.9 : 0.06) * dt + Math.sign(fwd) * 0.8 * dt;
    if (!thr && !brk && Math.abs(fwd) < 0.4) fwd = 0;
    if (c.done) fwd -= fwd * 1.2 * dt;
    side *= Math.exp(-(offroad ? 3.5 : 7.5) * dt);

    const v = Math.abs(fwd), grip = offroad ? 16 : 31;
    const yaw = c.steer * Math.min(v / 7, grip / Math.max(v, 1)) * Math.sign(fwd || 1);
    side -= yaw * v * dt * 0.35;                                          // a touch of slide when turning hard
    c.a -= yaw * dt;
    const nx = Math.cos(c.a), nz = Math.sin(c.a);
    c.vx = nx * fwd + nz * side; c.vz = nz * fwd - nx * side;
    c.pos.x += c.vx * dt; c.pos.z += c.vz * dt;
    c.speed = fwd;
    locate(c);
    if (Math.abs(c.lat) > WALL - 1.1) {                                   // barrier
      const s = Math.sign(c.lat), l = LEFT[c.idx];
      c.pos.addScaledVector(l, -(Math.abs(c.lat) - (WALL - 1.1)) * s);
      const into = c.vx * l.x * s + c.vz * l.z * s;
      if (into > 0) { c.vx -= l.x * s * into * 1.4; c.vz -= l.z * s * into * 1.4; c.vx *= 0.92; c.vz *= 0.92; shake = Math.min(1, into / 12); }
      c.lat = s * (WALL - 1.1);
    }
  }
  function rescue() {
    const c = player; c.pos.copy(P[c.idx]); c.a = Math.atan2(TAN[c.idx].z, TAN[c.idx].x); c.vx = c.vz = c.speed = 0; c.lat = 0;
  }

  /* ---------- Rivals ---------- */
  function driveRival(c, dt) {
    const j = wrap(Math.round(c.s));
    let k = 0; for (let n = 0; n < 70; n += 5) k = Math.max(k, Math.abs(CURV[wrap(j + n)]) * (1 - n / 110));
    let target = Math.min(71 * c.skill, Math.sqrt(25 * c.skill / Math.max(k, 1e-4)));
    const gap = (progress(c) - progress(player)) * DS;
    target *= gap > 90 ? 0.94 : gap < -90 ? 1.05 : 1;                     // gentle rubber band
    if (state !== "race") target = 0;
    if (c.done) target = Math.min(target, 30);
    // traffic: ease off and change lane for anything just ahead
    let lane = c.lane + Math.sin(c.s * 0.004 + c.skill * 40) * 1.2 - clamp(CURV[wrap(j + 25)] * 260, -2.6, 2.6) * -1;
    for (const o of cars) {
      if (o === c) continue;
      let d = (progress(o) - progress(c)); d -= Math.round(d / N) * N; d *= DS;
      const dl = (o.isPlayer ? o.lat : o.off) - c.off;
      if (d > 0 && d < 16 && Math.abs(dl) < 2.6) { lane = c.off - Math.sign(dl || 1) * 3.4; if (d < 7.5) target = Math.min(target, Math.max(o.speed - 1, 8)); }
    }
    c.off += clamp(clamp(lane, -5.6, 5.6) - c.off, -dt * 3, dt * 3);
    c.speed += clamp(target - c.speed, -34 * dt, (17 + 4 * c.skill) * (1 - c.speed / 95) * dt);
    c.s += c.speed * dt / DS;
    if (c.s >= N) { c.s -= N; c.lap++; }
    const i0 = Math.floor(c.s), f = c.s - i0, a = wrap(i0), b = wrap(i0 + 1);
    const px = c.pos.x, pz = c.pos.z;
    c.pos.set(lerp(P[a].x, P[b].x, f) + lerp(LEFT[a].x, LEFT[b].x, f) * c.off, 0, lerp(P[a].z, P[b].z, f) + lerp(LEFT[a].z, LEFT[b].z, f) * c.off);
    if (c.speed > 1) { const want = Math.atan2(c.pos.z - pz, c.pos.x - px); let d = want - c.a; d = Math.atan2(Math.sin(d), Math.cos(d)); c.steer = clamp(-d * 9, -1, 1); c.a += d * Math.min(1, dt * 12); }
    c.idx = a;
  }
  function bump() {
    for (const o of cars) {
      if (o.isPlayer) continue;
      const dx = player.pos.x - o.pos.x, dz = player.pos.z - o.pos.z, d = Math.hypot(dx, dz);
      if (d < 2.5 && d > 0.001) {
        const push = (2.5 - d), ux = dx / d, uz = dz / d;
        player.pos.x += ux * push; player.pos.z += uz * push;
        const rel = (player.vx - Math.cos(o.a) * o.speed) * ux + (player.vz - Math.sin(o.a) * o.speed) * uz;
        if (rel < 0) { player.vx -= ux * rel * 0.8; player.vz -= uz * rel * 0.8; o.speed = Math.max(0, o.speed + rel * -0.15); shake = Math.min(1, -rel / 14); }
      }
    }
  }

  /* ---------- CO2 exhaust puff ---------- */
  const PUFFS = 70, puffGeo = new T.BufferGeometry();
  puffGeo.setAttribute("position", new T.BufferAttribute(new Float32Array(PUFFS * 3), 3));
  puffGeo.setAttribute("color", new T.BufferAttribute(new Float32Array(PUFFS * 3), 3));
  const puffDot = A.canvas(64, 64); { const g = puffDot.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }
  const puffs = new T.Points(puffGeo, new T.PointsMaterial({ size: 1.5, map: new T.CanvasTexture(puffDot), vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
  puffs.frustumCulled = false; scene.add(puffs);
  const puffState = Array.from({ length: PUFFS }, () => ({ life: 0, p: new T.Vector3(), v: new T.Vector3() }));
  let puffNext = 0;
  function updatePuffs(dt) {
    if (boosting) for (let n = 0; n < 3; n++) {
      const q = puffState[puffNext = (puffNext + 1) % PUFFS], fx = Math.cos(player.a), fz = Math.sin(player.a);
      q.life = 1; q.p.set(player.pos.x - fx * 2.4, 0.5, player.pos.z - fz * 2.4);
      q.v.set(-fx * 9 + rnd(-2, 2) + player.vx * 0.6, rnd(0.3, 2), -fz * 9 + rnd(-2, 2) + player.vz * 0.6);
    }
    const pos = puffGeo.attributes.position, col = puffGeo.attributes.color;
    puffState.forEach((q, i) => {
      q.life = Math.max(0, q.life - dt * 2.2); q.p.addScaledVector(q.v, dt);
      pos.setXYZ(i, q.p.x, q.p.y, q.p.z); const b = q.life * 0.55; col.setXYZ(i, b * 0.8, b * 0.95, b);
    });
    pos.needsUpdate = col.needsUpdate = true;
  }

  /* ---------- Race flow and HUD ---------- */
  let state = "menu", clock = 0, raceTime = 0, lapStart = 0, best = null, lastLap = null, camMode = 0, shake = 0, menuSpin = 0, resumeTo = "race";
  const fmt = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ":" + (s < 10 ? "0" : "") + s.toFixed(2); };
  const ord = n => n + (["th", "st", "nd", "rd"][n % 10 > 3 || (n % 100 > 10 && n % 100 < 14) ? 0 : n % 10]);
  function show(id, on) { $(id).hidden = !on; }
  function setLamps(n) { lamps.forEach((m, i) => { m.emissiveIntensity = i < n ? 2.2 : 0; }); document.querySelectorAll("#g-lights i").forEach((l, i) => l.classList.toggle("on", i < n)); }

  function startRace() {
    grid(); state = "countdown"; clock = 0; raceTime = 0; lapStart = 0; lastLap = null;
    show("g-menu", false); show("g-result", false); show("g-hud", true); show("g-lights", true); show("g-touch", true);
    $("g-msg").textContent = ""; stage.focus();
  }
  function togglePause() {
    if (state === "race" || state === "countdown") { resumeTo = state; state = "paused"; show("g-pause", true); }
    else if (state === "paused") { state = resumeTo; show("g-pause", false); last = undefined; }
  }
  function finish() {
    state = "finished";
    const order = standings();
    $("g-result-title").textContent = order[0] === player ? "You win!" : "You finished " + ord(order.indexOf(player) + 1);
    $("g-result-rows").innerHTML = order.map((c, i) =>
      `<li class="${c.isPlayer ? "me" : ""}"><b>${i + 1}</b><i style="background:${c.color}"></i><span>${c.name}</span><em>${c.done ? fmt(c.done) : "+" + Math.max(1, Math.round((progress(order[0]) - progress(c)) * DS)) + " m"}</em></li>`).join("");
    $("g-result-best").textContent = best ? "Best lap " + fmt(best) : "";
    show("g-result", true); show("g-touch", false);
  }
  function standings() {
    return [...cars].sort((a, b) => (a.done && b.done) ? a.done - b.done : a.done ? -1 : b.done ? 1 : progress(b) - progress(a));
  }
  const mini = $("g-map"), mg = mini.getContext("2d");
  const bounds = P.reduce((b, p) => [Math.min(b[0], p.x), Math.max(b[1], p.x), Math.min(b[2], p.z), Math.max(b[3], p.z)], [1e9, -1e9, 1e9, -1e9]);
  function drawMap() {
    const w = mini.width, h = mini.height, pad = 14, sc = Math.min((w - 2 * pad) / (bounds[1] - bounds[0]), (h - 2 * pad) / (bounds[3] - bounds[2]));
    const mx = x => pad + (x - bounds[0]) * sc, mz = z => pad + (z - bounds[2]) * sc;
    mg.clearRect(0, 0, w, h);
    mg.lineJoin = "round"; mg.beginPath();
    for (let i = 0; i <= N; i += 6) { const p = P[i % N]; i ? mg.lineTo(mx(p.x), mz(p.z)) : mg.moveTo(mx(p.x), mz(p.z)); }
    mg.closePath(); mg.strokeStyle = "rgba(15,30,41,0.75)"; mg.lineWidth = 9; mg.stroke(); mg.strokeStyle = "#e9ecee"; mg.lineWidth = 3; mg.stroke();
    mg.fillStyle = "#fff"; mg.fillRect(mx(P[0].x) - 1.5, mz(P[0].z) - 7, 3, 14);
    for (const c of [...cars].reverse()) {
      mg.beginPath(); mg.arc(mx(c.pos.x), mz(c.pos.z), c.isPlayer ? 6 : 4.5, 0, 7); mg.fillStyle = c.isPlayer ? "#f4c430" : c.color; mg.fill();
      mg.lineWidth = 1.5; mg.strokeStyle = c.isPlayer ? "#0f1e29" : "#fff"; mg.stroke();
    }
  }
  function hud() {
    const order = standings();
    $("g-pos").textContent = ord(order.indexOf(player) + 1);
    $("g-lap").textContent = clamp(player.lap + 1, 1, LAPS) + "/" + LAPS;
    $("g-time").textContent = fmt(raceTime);
    $("g-best").textContent = best ? fmt(best) : "–:––.––";
    $("g-speed").textContent = Math.round(Math.abs(player.speed) * 3.6);
    $("g-boost").style.width = boost * 100 + "%";
    $("g-boost").parentNode.classList.toggle("live", boosting);
    drawMap();
  }

  /* ---------- Camera ---------- */
  const camPos = new T.Vector3(), camAim = new T.Vector3(), tmp = new T.Vector3();
  let camReady = false;
  function chase(dt) {
    const c = player, fx = Math.cos(c.a), fz = Math.sin(c.a), v = Math.abs(c.speed);
    if (state === "menu") {
      menuSpin += dt * 0.12;
      camera.position.set(start.x - 22 + Math.cos(menuSpin) * 26, 9 + Math.sin(menuSpin * 0.7) * 2, start.z + Math.sin(menuSpin) * 26);
      camera.lookAt(start.x - 26, 1, start.z); camera.fov = 50; camera.updateProjectionMatrix(); return;
    }
    if (camMode === 1) { tmp.set(c.pos.x + fx * 0.2, 1.25, c.pos.z + fz * 0.2); camAim.set(c.pos.x + fx * 30, 1, c.pos.z + fz * 30); }
    else if (camMode === 2) { tmp.set(c.pos.x - fx * 4, 46, c.pos.z - fz * 4); camAim.set(c.pos.x + fx * 6, 0, c.pos.z + fz * 6); }
    else { tmp.set(c.pos.x - fx * (8.2 + v * 0.03), 3.3 + v * 0.008, c.pos.z - fz * (8.2 + v * 0.03)); camAim.set(c.pos.x + fx * 7, 1.1, c.pos.z + fz * 7); }
    const k = camReady && camMode !== 1 ? 1 - Math.exp(-dt * 6.5) : 1; camReady = true;
    camPos.lerp(tmp, k);
    camera.position.copy(camPos);
    if (shake > 0.01) { camera.position.x += rnd(-1, 1) * shake * 0.35; camera.position.y += rnd(-1, 1) * shake * 0.25; shake *= Math.exp(-dt * 7); }
    camera.lookAt(camAim);
    const fov = (camMode === 1 ? 72 : 60) + v * 0.2 + (boosting ? 6 : 0);
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix();
  }

  /* ---------- Main loop ---------- */
  let last, raf = 0, onScreen = true;
  function tick(now) {
    raf = 0;
    const dt = last === undefined ? 0 : Math.min(0.04, (now - last) / 1000); last = now;
    if (state !== "paused") {
      if (state === "countdown") {
        clock += dt;
        const lit = Math.min(5, Math.floor(clock / 0.8));
        setLamps(lit);
        if (clock > 5 * 0.8 + 1.1) { state = "race"; setLamps(0); show("g-lights", false); $("g-msg").textContent = "GO!"; setTimeout(() => { if ($("g-msg").textContent === "GO!") $("g-msg").textContent = ""; }, 1200); }
      }
      if (state === "race") raceTime += dt;
      if (state !== "menu") {
        const lapBefore = player.lap;
        drivePlayer(dt);
        for (const c of cars) if (!c.isPlayer) { const lb = c.lap; driveRival(c, dt); if (c.lap > lb && c.lap >= LAPS && !c.done) c.done = raceTime; }
        bump();
        if (player.lap > lapBefore && lapBefore >= 0 && state === "race") {
          lastLap = raceTime - lapStart; lapStart = raceTime;
          if (!best || lastLap < best) best = lastLap;
          if (player.lap >= LAPS) { player.done = raceTime; finish(); }
          else { $("g-msg").textContent = player.lap === LAPS - 1 ? "Final lap!" : "Lap " + fmt(lastLap); setTimeout(() => { $("g-msg").textContent = ""; }, 1800); }
        } else if (player.lap > lapBefore && lapBefore < 0) lapStart = raceTime;
        const wrong = state === "race" && player.speed > 4 && Math.cos(player.a) * TAN[player.idx].x + Math.sin(player.a) * TAN[player.idx].z < -0.3;
        show("g-wrong", wrong);
        updatePuffs(dt);
        hud();
      }
      for (const c of cars) pose(c, dt);
      chase(dt);
      sun.target.position.copy(player.pos); sun.position.copy(player.pos).add(SUN_DIR);
      sky.position.set(camera.position.x, 0, camera.position.z);
    }
    renderer.render(scene, camera);
    schedule();
  }
  function schedule() {
    const active = onScreen && !document.hidden;
    if (active && !raf) raf = requestAnimationFrame(tick);
    if (!active) { cancelAnimationFrame(raf); raf = 0; last = undefined; }
  }
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; if (!onScreen && (state === "race" || state === "countdown")) togglePause(); schedule(); }).observe(stage);
  document.addEventListener("visibilitychange", schedule);

  $("g-start").addEventListener("click", startRace);
  $("g-again").addEventListener("click", startRace);
  $("g-resume").addEventListener("click", togglePause);
  $("g-restart").addEventListener("click", () => { show("g-pause", false); startRace(); });
  $("g-cam").addEventListener("click", () => { camMode = (camMode + 1) % 3; });
  $("g-full").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
  });

  // Read-only snapshot, handy for testing from the console
  window.TAAeroRace = () => ({
    state, lap: player.lap, idx: player.idx, lat: +player.lat.toFixed(2), speed: +player.speed.toFixed(1),
    headingError: +Math.atan2(Math.cos(player.a) * TAN[player.idx].z - Math.sin(player.a) * TAN[player.idx].x, Math.cos(player.a) * TAN[player.idx].x + Math.sin(player.a) * TAN[player.idx].z).toFixed(3),
    curvature: +CURV[wrap(player.idx + 30)].toFixed(4), rivals: cars.filter(c => !c.isPlayer).map(c => [c.lap, Math.round(c.s), Math.round(c.speed)])
  });

  A.loadFalcon(falcon => {
    for (const r of RIVALS) makeCar(r, false);
    player = makeCar({ falcon, name: "You (TA-aero)" }, true);
    grid();
    $("g-menu-msg").textContent = "Three laps, five rivals. You start last.";
    $("g-start").disabled = false;
    resize(); tick(performance.now());
  });
})();

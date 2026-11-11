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
  const HAZE = lin(0xc4d3de);
  scene.fog = new T.Fog(HAZE, 260, 3400);
  const camera = new T.PerspectiveCamera(62, 16 / 9, 0.3, 14000);

  // Late-afternoon sun, low and ahead of the start straight
  const SUN = new T.Vector3().setFromSphericalCoords(1, T.MathUtils.degToRad(90 - 21), T.MathUtils.degToRad(112));
  function makeSky() {
    if (!T.Sky) return A.gradientDome(5000, A.SKY);
    const sk = new T.Sky(); sk.scale.setScalar(10000);
    const u = sk.material.uniforms;
    u.turbidity.value = 4.5; u.rayleigh.value = 1.35; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.84; u.sunPosition.value.copy(SUN);
    return sk;
  }
  const sky = makeSky(); scene.add(sky);
  { // reflections and ambient light come from the same sky
    const es = new T.Scene(); es.add(makeSky());
    const land = new T.Mesh(new T.CircleGeometry(4000, 24), new T.MeshBasicMaterial({ color: lin(0x4c5a37) }));
    land.rotation.x = -Math.PI / 2; land.position.y = -6; es.add(land);
    const pm = new T.PMREMGenerator(renderer); scene.environment = pm.fromScene(es, 0, 1, 12000).texture; pm.dispose();
  }
  renderer.toneMappingExposure = T.Sky ? 0.55 : 0.95;

  scene.add(new T.HemisphereLight(0xb9d6ff, 0x57603c, 0.55));
  const sun = new T.DirectionalLight(0xffdfb0, 3.6);
  const SHADOW = Math.min(4096, renderer.capabilities.maxTextureSize);
  sun.castShadow = true; sun.shadow.mapSize.set(SHADOW, SHADOW); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04; sun.shadow.radius = 2.5;
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 20, far: 700 });
  scene.add(sun, sun.target);
  const SUN_DIR = SUN.clone().multiplyScalar(330);

  /* ---------- Post-processing: bloom, speed blur, colour grade ---------- */
  let composer = null, finalPass = null, quality = "high";
  const FINAL = {
    uniforms: { tDiffuse: { value: null }, uBlur: { value: 0 }, uTime: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uBlur, uTime; varying vec2 vUv;
      vec3 tap(vec2 uv, vec2 d, float ca) {
        return vec3(texture2D(tDiffuse, uv + d * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d * ca).b);
      }
      void main() {
        vec2 d = vUv - vec2(0.5, 0.46); float r = length(d);
        float edge = smoothstep(0.12, 0.8, r);
        vec3 c = vec3(0.0);
        for (int i = 0; i < 10; i++) c += tap(vUv - d * (float(i) / 10.0) * uBlur * edge, d, 0.006 * r);   // radial speed blur + slight lens fringe
        c /= 10.0;
        c = pow(max(c, 0.0), vec3(1.0 / 2.2));
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, 1.16);                                  // saturation
        c = (c - 0.5) * 1.08 + 0.5;                                 // contrast
        c = mix(c * vec3(0.96, 1.0, 1.06), c * vec3(1.05, 1.0, 0.94), smoothstep(0.25, 0.8, l));   // cool shadows, warm highlights
        c *= 1.0 - smoothstep(0.42, 1.0, r) * 0.5;                  // vignette
        c += (fract(sin(dot(vUv * vec2(1733.0, 977.0) + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.016;   // fine grain
        gl_FragColor = vec4(c, 1.0);
      }`
  };
  function buildComposer() {
    if (!T.EffectComposer || !T.UnrealBloomPass || !T.ShaderPass) return;
    try {
      const size = renderer.getDrawingBufferSize(new T.Vector2());
      const gl2 = renderer.capabilities.isWebGL2;
      if (gl2) renderer.extensions.get("EXT_color_buffer_float");
      const RT = gl2 && T.WebGLMultisampleRenderTarget ? T.WebGLMultisampleRenderTarget : T.WebGLRenderTarget;
      const target = new RT(size.x, size.y, { type: gl2 ? T.HalfFloatType : T.UnsignedByteType, format: T.RGBAFormat, minFilter: T.LinearFilter, magFilter: T.LinearFilter });
      if (RT !== T.WebGLRenderTarget) target.samples = 4;
      composer = new T.EffectComposer(renderer, target);
      composer.addPass(new T.RenderPass(scene, camera));
      composer.addPass(new T.UnrealBloomPass(new T.Vector2(size.x / 2, size.y / 2), 0.3, 0.7, 0.86));
      finalPass = new T.ShaderPass(FINAL); composer.addPass(finalPass);
    } catch (e) { composer = null; }
  }
  buildComposer();

  /* ---------- Textures ---------- */
  const rnd = (a, b) => a + Math.random() * (b - a);
  const MAXA = renderer.capabilities.getMaxAnisotropy();
  function noiseTex(size, base, specks, repeat) {
    const c = A.canvas(size, size), g = c.getContext("2d");
    g.fillStyle = base; g.fillRect(0, 0, size, size);
    for (const [color, n, r] of specks) { g.fillStyle = color; for (let i = 0; i < n; i++) g.fillRect(Math.random() * size, Math.random() * size, rnd(1, r), rnd(1, r)); }
    return [c, g, repeat];
  }
  function bake([c, , repeat]) { const t = A.tex(c, repeat || [1, 1]); t.anisotropy = MAXA; return t; }
  // Turn a greyscale bump canvas into a tangent-space normal map
  function normalMap(size, draw, strength, repeat) {
    const c = A.canvas(size, size), g = c.getContext("2d"); draw(g, size);
    const src = g.getImageData(0, 0, size, size), out = g.createImageData(size, size), h = (x, y) => src.data[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength, l = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
      out.data[i] = (-dx / l * 0.5 + 0.5) * 255; out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
    }
    g.putImageData(out, 0, 0);
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = MAXA; return t;
  }
  const grit = (g, n) => { g.fillStyle = "#808080"; g.fillRect(0, 0, n, n); for (let i = 0; i < n * n * 0.6; i++) { const v = Math.random() * 255 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * n, Math.random() * n, rnd(1, 2.4), rnd(1, 2.4)); } };

  const asphalt = noiseTex(1024, "#3a3d42", [["rgba(255,255,255,0.045)", 26000, 3], ["rgba(0,0,0,0.14)", 26000, 3]]);
  { const g = asphalt[1];
    for (const [x, w, a] of [[300, 150, 0.2], [585, 150, 0.2], [345, 60, 0.16], [630, 60, 0.16]]) {      // rubbered-in racing lines, soft edged
      const gr = g.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, "rgba(12,12,14,0)"); gr.addColorStop(0.5, `rgba(12,12,14,${a})`); gr.addColorStop(1, "rgba(12,12,14,0)");
      g.fillStyle = gr; g.fillRect(x, 0, w, 1024);
    }
    g.strokeStyle = "rgba(10,10,12,0.22)"; g.lineWidth = 2;                                              // repair seams and cracks
    for (let i = 0; i < 7; i++) { g.beginPath(); let x = rnd(60, 960), y = rnd(0, 1024); g.moveTo(x, y); for (let k = 0; k < 9; k++) g.lineTo(x += rnd(-22, 22), y += rnd(20, 60)); g.stroke(); }
    g.fillStyle = "#eceff1"; g.fillRect(26, 0, 22, 1024); g.fillRect(976, 0, 22, 1024);                 // edge lines
    g.fillRect(505, 0, 14, 480);                                                                         // centre dashes
    g.fillStyle = "rgba(58,61,66,0.35)"; for (let i = 0; i < 500; i++) g.fillRect(rnd(20, 1004), rnd(0, 1024), 3, 3);   // worn paint
  }
  const kerb = noiseTex(64, "#d8322a", [["rgba(0,0,0,0.12)", 90, 4]]); kerb[1].fillStyle = "#f2f2f2"; kerb[1].fillRect(0, 0, 64, 32); kerb[1].fillStyle = "rgba(0,0,0,0.08)"; for (let i = 0; i < 60; i++) kerb[1].fillRect(Math.random() * 64, Math.random() * 64, 3, 2);
  const grass = noiseTex(512, "#b9c2a8", [["rgba(235,245,215,0.5)", 16000, 3], ["rgba(120,135,95,0.55)", 16000, 3], ["rgba(150,140,100,0.25)", 500, 9]], [900, 900]);
  const verge = noiseTex(512, "#4f7d36", [["rgba(150,190,95,0.4)", 12000, 3], ["rgba(45,85,32,0.4)", 12000, 3]]);
  { const g = verge[1]; for (let y = 0; y < 512; y += 128) { g.fillStyle = "rgba(255,255,220,0.07)"; g.fillRect(0, y, 512, 64); } }   // mowing stripes
  const wall = noiseTex(256, "#cfd4d8", [["rgba(0,0,0,0.07)", 1800, 5], ["rgba(60,40,20,0.08)", 60, 30]]);
  { const g = wall[1]; g.fillStyle = "#0a566b"; g.fillRect(0, 140, 256, 70); g.fillStyle = "#ffb000"; g.fillRect(0, 210, 256, 14); g.fillStyle = "#7d858c"; g.fillRect(0, 0, 256, 12); g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(0, 0, 3, 256); g.fillRect(126, 0, 3, 256); }
  const fence = A.canvas(64, 64); { const g = fence.getContext("2d"); g.strokeStyle = "#aab3bb"; g.lineWidth = 1.5; for (let i = -64; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke(); } }
  const roadNormal = normalMap(256, grit, 1.2, [22, 24]);

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
  function ribbon(offA, offB, yA, yB, material, vScale, keep, alongU) {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const j = i % N, p = P[j], l = LEFT[j], v = i * DS / vScale;
      pos.push(p.x + l.x * offA, yA, p.z + l.z * offA, p.x + l.x * offB, yB, p.z + l.z * offB);
      if (alongU) uv.push(v, 0, v, 1); else uv.push(0, v, 1, v);
      if (i < N && (!keep || keep(j))) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new T.Mesh(geo, material); m.receiveShadow = true; scene.add(m); return m;
  }
  const mat = (t, rough, extra) => new T.MeshStandardMaterial(Object.assign({ map: t, roughness: rough, metalness: 0, side: T.DoubleSide, envMapIntensity: 0.4 }, extra));
  const rep = t => { t.wrapS = t.wrapT = T.RepeatWrapping; return t; };
  ribbon(HALF, -HALF, 0.03, 0.03, mat(rep(bake(asphalt)), 0.72, { normalMap: roadNormal, normalScale: new T.Vector2(0.28, 0.28), envMapIntensity: 0.45 }), 16);
  const kerbM = mat(rep(bake(kerb)), 0.55);
  const corner = j => Math.abs(CURV[j]) > 0.0045;
  ribbon(HALF + KERB, HALF, 0.09, 0.035, kerbM, 4, corner);
  ribbon(-HALF, -HALF - KERB, 0.035, 0.09, kerbM, 4, corner);
  const vergeT = rep(bake(verge)); vergeT.repeat.set(2, 1);
  ribbon(WALL, HALF, 0.02, 0.02, mat(vergeT, 0.95), 10);
  ribbon(-HALF, -WALL, 0.02, 0.02, mat(vergeT, 0.95), 10);
  const wallM = mat(rep(bake(wall)), 0.6), fenceT = rep(new T.CanvasTexture(fence)); fenceT.anisotropy = MAXA;
  const fenceM = new T.MeshStandardMaterial({ map: fenceT, alphaTest: 0.35, side: T.DoubleSide, roughness: 0.5, metalness: 0.6 });
  for (const sd of [1, -1]) {
    ribbon(sd * WALL, sd * WALL, 0, 1.15, wallM, 2.3, null, true).castShadow = true;
    ribbon(sd * (WALL + 0.25), sd * (WALL - 0.25), 1.15, 1.15, wallM, 2.3, null, true);                 // wall cap
    const f = ribbon(sd * (WALL + 0.3), sd * (WALL + 0.3), 1.15, 4.4, fenceM, 1.3, null, true);
    f.geometry.attributes.uv.array.forEach((v, i, a) => { if (i % 2) a[i] = v * 2.5; });
  }
  { // fence posts
    const count = Math.floor(N / 7) * 2, posts = new T.InstancedMesh(new T.CylinderGeometry(0.07, 0.07, 3.4, 6), new T.MeshStandardMaterial({ color: lin(0x8b949c), roughness: 0.5, metalness: 0.7 }), count), m4 = new T.Matrix4();
    let n = 0; for (let i = 0; i + 7 <= N && n < count; i += 7) for (const sd of [1, -1]) posts.setMatrixAt(n++, m4.makeTranslation(P[i].x + LEFT[i].x * sd * (WALL + 0.3), 2.8, P[i].z + LEFT[i].z * sd * (WALL + 0.3)));
    posts.castShadow = true; scene.add(posts);
  }

  /* ---------- Terrain: flat around the circuit, rolling hills beyond, mountains on the horizon ---------- */
  const sstep = T.MathUtils.smoothstep;
  const hash = (x, z) => { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); };
  function vnoise(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    return lerp(lerp(hash(xi, zi), hash(xi + 1, zi), u), lerp(hash(xi, zi + 1), hash(xi + 1, zi + 1), u), v);
  }
  const fbm = (x, z) => vnoise(x, z) * 0.5 + vnoise(x * 2.03, z * 2.03) * 0.25 + vnoise(x * 4.1, z * 4.1) * 0.125 + vnoise(x * 8.2, z * 8.2) * 0.0625;
  function trackDist(x, z) { let b = 1e9; for (let i = 0; i < N; i += 6) { const dx = P[i].x - x, dz = P[i].z - z, d = dx * dx + dz * dz; if (d < b) b = d; } return Math.sqrt(b); }
  function height(x, z, d = trackDist(x, z)) {
    const near = sstep(d, 48, 210), far = sstep(Math.hypot(x - 20, z + 115), 620, 2300);
    const ridge = 1 - Math.abs(fbm(x * 0.0011 + 9, z * 0.0011 + 4) * 2 - 0.94);
    return near * ((fbm(x * 0.0045, z * 0.0045) - 0.42) * 46 + fbm(x * 0.021, z * 0.021) * 5) + far * far * (60 + 760 * ridge * ridge);
  }
  { const SIZE = 7200, SEG = 300, geo = new T.PlaneGeometry(SIZE, SIZE, SEG, SEG); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, col = [], c = new T.Color(), meadow = lin(0x6f9a46), dry = lin(0x9aa45a), wood = lin(0x4d7a3a), rock = lin(0x8d8c86), snow = lin(0xf2f5f8);
    for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + 20), pos.setZ(i, pos.getZ(i) - 115);
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); pos.setY(i, height(x, z)); }
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), t = fbm(x * 0.006 + 3, z * 0.006 + 7);
      c.copy(meadow).lerp(dry, sstep(t, 0.45, 0.7)).lerp(wood, sstep(t, 0.5, 0.3) * 0.7);
      c.lerp(rock, Math.max(sstep(y, 150, 330), sstep(1 - nrm.getY(i), 0.25, 0.5))).lerp(snow, sstep(y + t * 120, 520, 640));
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    const ground = new T.Mesh(geo, new T.MeshStandardMaterial({ map: bake(grass), vertexColors: true, roughness: 1, envMapIntensity: 0.3 }));
    ground.receiveShadow = true; scene.add(ground);
  }
  { // a thin, slowly drifting cloud deck
    const n = 512, c = A.canvas(n, n), g = c.getContext("2d"), img = g.createImageData(n, n);
    const tile = (x, z) => { const u = x / n, v = z / n, f = (a, b) => fbm(a * 5 + 31, b * 5 + 17); return lerp(lerp(f(u, v), f(u - 1, v), u), lerp(f(u, v - 1), f(u - 1, v - 1), u), v); };
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const a = sstep(tile(x, y), 0.4, 0.66), i = (y * n + x) * 4; img.data[i] = 255; img.data[i + 1] = 246; img.data[i + 2] = 232; img.data[i + 3] = a * 215; }
    g.putImageData(img, 0, 0);
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(3, 3); t.encoding = T.sRGBEncoding;
    var clouds = new T.Mesh(new T.PlaneGeometry(26000, 26000), new T.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: false, opacity: 0.9 }));
    clouds.rotation.x = Math.PI / 2; clouds.position.y = 1500; scene.add(clouds);
  }

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
  // Forest: two instanced tree shapes with per-tree size and tint, planted on the terrain
  function merged(pieces) {
    const pos = [], nor = [], col = [], c = new T.Color();
    for (const [geo, lo, hi] of pieces) {
      const g = geo.toNonIndexed(); g.computeVertexNormals(); g.computeBoundingBox();
      const p = g.attributes.position, n = g.attributes.normal, y0 = g.boundingBox.min.y, y1 = g.boundingBox.max.y;
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i));
        c.copy(lin(lo)).lerp(lin(hi), (p.getY(i) - y0) / (y1 - y0 || 1)); col.push(c.r, c.g, c.b);
      }
    }
    const out = new T.BufferGeometry();
    out.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); out.setAttribute("normal", new T.Float32BufferAttribute(nor, 3)); out.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    return out;
  }
  const at = (geo, x, y, z, sx = 1, sy = 1, sz = 1) => { geo.scale(sx, sy, sz); geo.translate(x, y, z); return geo; };
  const pine = merged([
    [at(new T.CylinderGeometry(0.28, 0.45, 3.2, 7), 0, 1.6, 0), 0x3d2a1a, 0x5a3d26],
    [at(new T.ConeGeometry(3.3, 4.6, 9), 0, 4.6, 0), 0x16361f, 0x2f6a35], [at(new T.ConeGeometry(2.7, 4.2, 9), 0, 6.9, 0), 0x1a3f24, 0x377a3c],
    [at(new T.ConeGeometry(2.0, 3.8, 9), 0, 9.1, 0), 0x1e4728, 0x40873f], [at(new T.ConeGeometry(1.2, 3.2, 8), 0, 11.2, 0), 0x245230, 0x55a04a]
  ]);
  const oak = merged([
    [at(new T.CylinderGeometry(0.35, 0.6, 4.2, 7), 0, 2.1, 0), 0x3a2a1c, 0x5c4630],
    [at(new T.IcosahedronGeometry(3.2, 1), 0, 6.4, 0, 1, 0.85, 1), 0x2a5a26, 0x6fae4a], [at(new T.IcosahedronGeometry(2.3, 1), 1.9, 5.6, 0.8, 1, 0.8, 1), 0x275424, 0x62a044],
    [at(new T.IcosahedronGeometry(2.4, 1), -1.7, 5.9, -1.1, 1, 0.8, 1), 0x2c5e28, 0x74b44e], [at(new T.IcosahedronGeometry(1.9, 1), 0.3, 8.2, -0.6, 1, 0.85, 1), 0x356b2c, 0x86c257]
  ]);
  { const spots = [[], []];
    for (let tries = 0; spots[0].length + spots[1].length < 1500 && tries < 16000; tries++) {
      const x = rnd(-950, 1000), z = rnd(-1050, 820);
      if (x > -70 && x < 110 && z > -44 && z < 50) continue;
      const d = trackDist(x, z); if (d < 25) continue;
      const grove = fbm(x * 0.008 + 5, z * 0.008 + 2); if (d > 70 && grove < 0.44) continue;           // clearings between the woods
      const y = height(x, z, d); if (y > 190) continue;
      spots[grove > 0.56 || Math.random() < 0.25 ? 0 : 1].push([x, y, z, rnd(0.75, 1.7)]);
    }
    const treeMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, envMapIntensity: 0.25 }), m4 = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), up = new T.Vector3(0, 1, 0), tint = new T.Color();
    [pine, oak].forEach((geo, k) => {
      const im = new T.InstancedMesh(geo, treeMat, spots[k].length);
      spots[k].forEach(([x, y, z, sz], i) => {
        q.setFromAxisAngle(up, Math.random() * 6.3);
        im.setMatrixAt(i, m4.compose(new T.Vector3(x, y - 0.3, z), q, sc.set(sz * rnd(0.85, 1.15), sz, sz * rnd(0.85, 1.15))));
        const v = rnd(0.72, 1.12); im.setColorAt(i, tint.setRGB(v * rnd(0.92, 1.08), v, v * rnd(0.8, 1)));
      });
      im.castShadow = true; im.receiveShadow = true; scene.add(im);
    });
  }
  // Floodlight masts and flags around the start
  { const mast = new T.MeshStandardMaterial({ color: lin(0x6f7780), roughness: 0.45, metalness: 0.7 }), lampM = new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 1.6 });
    for (const [x, z] of [[-70, 44], [20, 46], [110, 44], [-40, -40], [100, -40]]) {
      put(new T.CylinderGeometry(0.25, 0.4, 26, 8), mast, x, 13, z);
      put(new T.BoxGeometry(5, 1.6, 0.6), lampM, x, 26.5, z, z > 0 ? 0 : Math.PI).castShadow = false;
    }
    const flagC = [0xf4c430, 0x0a566b, 0xa8322d, 0xffffff];
    for (let i = 0; i < 12; i++) {
      const x = -52 + i * 13;
      put(new T.CylinderGeometry(0.06, 0.06, 7, 6), mast, x, 17.3, 39.5);
      const f = put(new T.PlaneGeometry(2.4, 1.4), new T.MeshStandardMaterial({ color: lin(flagC[i % 4]), side: T.DoubleSide, roughness: 0.8 }), x + 1.2, 20, 39.5); f.castShadow = false;
    }
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
  const blobTex = A.canvas(128, 64); { const g = blobTex.getContext("2d"), gr = g.createRadialGradient(64, 32, 4, 64, 32, 62); gr.addColorStop(0, "rgba(0,0,0,0.62)"); gr.addColorStop(0.55, "rgba(0,0,0,0.36)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.setTransform(1, 0, 0, 0.5, 0, 16); g.fillStyle = gr; g.fillRect(0, -32, 128, 128); }
  const blobMat = new T.MeshBasicMaterial({ map: new T.CanvasTexture(blobTex), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  let player;
  function makeCar(opts, isPlayer) {
    const model = A.buildCar(Object.assign({ detail: isPlayer ? "high" : "low" }, opts));
    model.group.scale.setScalar(SCALE);
    model.group.traverse(o => { if (o.isMesh && o.material.envMapIntensity !== undefined) o.material.envMapIntensity = 0.75; });
    const holder = new T.Group(); holder.add(model.group); scene.add(holder);
    const blob = new T.Mesh(new T.PlaneGeometry(6.4, 3.4), blobMat); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.05; blob.renderOrder = 1; holder.add(blob);
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
  // Touch: an analog steering pad plus pedal buttons. Shown on touch screens.
  let padSteer = null;
  const pad = $("g-pad"), knob = pad.querySelector("i");
  function padMove(e) {
    const r = pad.getBoundingClientRect(), x = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2 - 26), -1, 1);
    padSteer = -Math.sign(x) * Math.abs(x) ** 0.8; knob.style.transform = `translateX(${x * (r.width / 2 - 34)}px)`;
  }
  pad.addEventListener("pointerdown", e => { e.preventDefault(); try { pad.setPointerCapture(e.pointerId); } catch (err) {} pad.classList.add("held"); padMove(e); });
  pad.addEventListener("pointermove", e => { if (padSteer !== null) padMove(e); });
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) pad.addEventListener(t, () => { padSteer = null; knob.style.transform = ""; pad.classList.remove("held"); });
  const isTouch = () => stage.classList.add("is-touch");
  if (matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0 && !matchMedia("(hover: hover)").matches) isTouch();
  addEventListener("touchstart", isTouch, { once: true, passive: true });

  document.querySelectorAll("[data-key]").forEach(b => {
    const set = v => e => { e.preventDefault(); if (v) try { b.setPointerCapture(e.pointerId); } catch (err) {} touch[b.dataset.key] = v; b.classList.toggle("held", v); };
    b.addEventListener("pointerdown", set(true)); b.addEventListener("pointerup", set(false));
    b.addEventListener("lostpointercapture", set(false)); b.addEventListener("pointercancel", set(false));
    b.addEventListener("contextmenu", e => e.preventDefault());
  });

  /* ---------- Player physics ---------- */
  let boost = 1, boosting = false;
  function drivePlayer(dt) {
    const c = player, live = state === "race" && !c.done;
    const thr = live && down("ArrowUp", "KeyW") ? 1 : 0, brk = live && down("ArrowDown", "KeyS", "Space") ? 1 : 0;
    const want = !live ? 0 : padSteer !== null ? padSteer : (down("ArrowLeft", "KeyA") ? 1 : 0) - (down("ArrowRight", "KeyD") ? 1 : 0);
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
  const DUST = 90, dustGeo = new T.BufferGeometry();
  dustGeo.setAttribute("position", new T.BufferAttribute(new Float32Array(DUST * 3).fill(-50), 3));
  const dust = new T.Points(dustGeo, new T.PointsMaterial({ size: 2.6, map: new T.CanvasTexture(puffDot), color: lin(0x9a8a62), transparent: true, opacity: 0.34, depthWrite: false }));
  dust.frustumCulled = false; scene.add(dust);
  const dustState = Array.from({ length: DUST }, () => ({ life: 0, p: new T.Vector3(0, -50, 0), v: new T.Vector3() }));
  let dustNext = 0;
  function updatePuffs(dt) {
    if (boosting) for (let n = 0; n < 3; n++) {
      const q = puffState[puffNext = (puffNext + 1) % PUFFS], fx = Math.cos(player.a), fz = Math.sin(player.a);
      q.life = 1; q.p.set(player.pos.x - fx * 2.4, 0.5, player.pos.z - fz * 2.4);
      q.v.set(-fx * 9 + rnd(-2, 2) + player.vx * 0.6, rnd(0.3, 2), -fz * 9 + rnd(-2, 2) + player.vz * 0.6);
    }
    if (state === "race" && Math.abs(player.lat) > HALF + KERB && Math.abs(player.speed) > 9) for (let n = 0; n < 2; n++) {
      const d = dustState[dustNext = (dustNext + 1) % DUST];
      d.life = 1; d.p.set(player.pos.x - Math.cos(player.a) * 1.6 + rnd(-0.9, 0.9), 0.3, player.pos.z - Math.sin(player.a) * 1.6 + rnd(-0.9, 0.9));
      d.v.set(rnd(-1.5, 1.5), rnd(1, 2.6), rnd(-1.5, 1.5));
    }
    const dp = dustGeo.attributes.position;
    dustState.forEach((d, i) => { d.life = Math.max(0, d.life - dt * 0.9); d.p.addScaledVector(d.v, dt); dp.setXYZ(i, d.p.x, d.life > 0 ? d.p.y : -50, d.p.z); });
    dp.needsUpdate = true;
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
    $("g-msg").textContent = ""; stage.focus(); stage.classList.add("playing");
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
    show("g-result", true); show("g-touch", false); stage.classList.remove("playing");
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
      sky.position.copy(camera.position);
      clouds.position.set(camera.position.x, 1500, camera.position.z); clouds.material.map.offset.x += dt * 0.0012;
    }
    if (composer && quality === "high") {
      const v = state === "menu" ? 0 : Math.abs(player.speed);
      finalPass.uniforms.uBlur.value += (clamp((v - 38) / 60, 0, 1) * 0.085 + (boosting ? 0.05 : 0) - finalPass.uniforms.uBlur.value) * Math.min(1, dt * 5);
      finalPass.uniforms.uTime.value = (now / 1000) % 60;
      composer.render(dt);
    } else renderer.render(scene, camera);
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
    if (composer) composer.setSize(w, h);
  }
  new ResizeObserver(resize).observe(stage);
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; if (!onScreen && (state === "race" || state === "countdown")) togglePause(); schedule(); }).observe(stage);
  document.addEventListener("visibilitychange", schedule);

  $("g-start").addEventListener("click", startRace);
  $("g-again").addEventListener("click", startRace);
  $("g-resume").addEventListener("click", togglePause);
  $("g-restart").addEventListener("click", () => { show("g-pause", false); startRace(); });
  $("g-cam").addEventListener("click", () => { camMode = (camMode + 1) % 3; });
  $("g-pause-btn").addEventListener("click", togglePause);
  $("g-quality").addEventListener("click", () => {
    quality = quality === "high" ? "low" : "high";
    $("g-quality").textContent = "Graphics: " + (quality === "high" ? "High" : "Low");
    renderer.setPixelRatio(quality === "high" ? Math.min(devicePixelRatio, 1.75) : 1);
    sun.shadow.mapSize.setScalar(quality === "high" ? SHADOW : 1024); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    resize();
  });
  if (!composer) $("g-quality").hidden = true;
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

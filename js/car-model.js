/* Shared TA-aero car builder, used by the 3D lab (car.html) and the racing game (game.html).
   The nose points along −x. One unit is roughly one centimetre.
   Every physical component is its own "part" so the lab can explode, label and highlight it. */
window.TAAero = (function () {
  const T = THREE;
  const lerp = T.MathUtils.lerp, clamp = T.MathUtils.clamp;
  const lin = c => new T.Color(c).convertSRGBToLinear();
  const X0 = -10.1, X1 = 9.24, WIDEN = 1.2;   // WIDEN: body is a little broader than the raw stations

  // Each station gives x, the underside and crown heights, and the half-width.
  const stations = [
    [-10.1, 0.57, 0.63, 0.035], [-9.8, 0.49, 0.93, 0.43],
    [-8.7, 0.46, 1.36, 0.82], [-6.4, 0.48, 1.86, 1.18],
    [-3.9, 0.58, 2.42, 1.57], [-1.1, 0.66, 2.78, 1.86],
    [2.0, 0.70, 3.18, 1.98], [4.6, 0.68, 3.86, 1.93],
    [6.6, 0.60, 4.02, 1.69], [8.3, 0.78, 3.55, 1.38],
    [9.2, 1.01, 3.05, 1.12], [9.23, 1.05, 3.0, 1.07],
    [9.24, 1.97, 2.03, 0.02]
  ];

  function bodyAt(x) {
    const next = stations.findIndex(row => row[0] >= x);
    const index = next < 0 ? stations.length - 2 : Math.max(0, next - 1);
    const a = stations[index], b = stations[index + 1];
    const p = stations[Math.max(0, index - 1)], q = stations[Math.min(stations.length - 1, index + 2)];
    const dx = b[0] - a[0];
    const t = clamp((x - a[0]) / dx, 0, 1);
    const blend = t * t * (3 - 2 * t);
    return [1, 2, 3].map(col => {
      const inSlope = (b[col] - p[col]) / (b[0] - p[0]);
      const outSlope = (q[col] - a[col]) / (q[0] - a[0]);
      return lerp(a[col], b[col], blend) + dx * t * (1 - t) * ((1 - t) * inSlope - t * outSlope);
    });
  }
  // Cross-sections are superellipses: flatter flanks and a rounder crown than a plain ellipse.
  const SQ = 2 / 2.7;
  const pw = v => Math.sign(v) * Math.abs(v) ** SQ;
  function skin(x, theta, offset = 0) {
    const [bottom, top, width] = bodyAt(x);
    return [
      x,
      (bottom + top) / 2 + (Math.max(0.01, (top - bottom) / 2) + offset) * pw(Math.cos(theta)),
      (Math.max(0.01, width * WIDEN) + offset) * pw(Math.sin(theta))
    ];
  }

  /* ---------- Textures ---------- */
  function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function tex(c, repeat) {
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding; t.anisotropy = 8;
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }

  // The whole paint job lives on one texture: x runs nose → tail, y wraps around the body.
  function paintLivery(o) {
    const W = 2048, H = 1024, c = canvas(W, H), g = c.getContext("2d");
    const X = x => (x - X0) / (X1 - X0) * W, Y = th => H * (0.5 - th / (2 * Math.PI));
    g.fillStyle = o.base; g.fillRect(0, 0, W, H);

    for (const s of [1, -1]) {
      const P = (x, th) => [X(x), Y(s * th)];
      // Silver side panel that widens toward the rear wheel
      g.fillStyle = o.panel; g.beginPath();
      g.moveTo(...P(-5.6, 2.2));
      g.bezierCurveTo(...P(-1.5, 1.5), ...P(2.6, 0.92), ...P(9.0, 0.8));
      g.lineTo(...P(9.24, 2.72)); g.lineTo(...P(-4.4, 2.72)); g.closePath(); g.fill();
      // thin pinstripe above the panel
      g.strokeStyle = o.accent; g.lineWidth = 5; g.beginPath();
      g.moveTo(...P(-6.4, 2.22)); g.bezierCurveTo(...P(-1.6, 1.42), ...P(2.6, 0.84), ...P(9.0, 0.72)); g.stroke();

      g.save();
      g.translate(X(1.3), Y(s * 1.5));
      if (o.falcon) {            // head toward the nose, upright on both flanks
        g.scale(-1, (s > 0 ? -1 : 1) * 0.6);   // 0.6: the flank has fewer pixels per centimetre vertically
        g.rotate(-0.5);
        g.drawImage(o.falcon, -300, -222, 600, 444);
      } else if (o.number) {
        g.scale(s > 0 ? 1 : -1, s > 0 ? -1 : 1);
        g.fillStyle = o.base; g.beginPath(); g.ellipse(0, 0, 170, 80, 0, 0, 7); g.fill();
        g.fillStyle = "#fff"; g.scale(1, 0.6); g.font = "italic 800 190px 'Saira Condensed','Arial Narrow',sans-serif";
        g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(o.number, -6, 8);
      }
      g.restore();
    }

    // Centre stripe: constant real width, so it gets wider on the canvas where the body is slim
    g.fillStyle = o.accent; g.beginPath();
    const n = 140, edge = [];
    for (let i = 0; i <= n; i++) {
      const x = lerp(-9.98, 6.4, i / n), w = 0.085 * Math.min(1, 0.35 + (x + 10) / 3) * (1 - Math.max(0, (x - 4.6) / 1.8) ** 2);
      edge.push([X(x), Math.asin(Math.min(0.5, Math.max(0.004, w) / bodyAt(x)[2]))]);
    }
    edge.forEach(([px, a], i) => i ? g.lineTo(px, Y(a)) : g.moveTo(px, Y(a)));
    edge.reverse().forEach(([px, a]) => g.lineTo(px, Y(-a)));
    g.closePath(); g.fill();
    // Swept feathers over the cartridge housing
    for (const s of [1, -1]) for (let k = 0; k < 3; k++) {
      const a = [], b = [];
      for (let i = 0; i <= 40; i++) {
        const u = i / 40, x = lerp(1.6 + k * 0.9, 8.4 - k * 0.7, u);
        const mid = 0.05 + (0.5 + 0.22 * k) * u ** 1.5, half = 0.062 * Math.sin(Math.PI * Math.min(1, u * 1.15 + 0.03)) ** 0.8 * (1 - u * 0.75);
        a.push([X(x), Y(s * (mid - half))]); b.push([X(x), Y(s * (mid + half))]);
      }
      g.beginPath(); a.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); b.reverse().forEach(p => g.lineTo(...p)); g.closePath(); g.fill();
    }
    // Nose chevrons
    for (const s of [1, -1]) { g.beginPath(); g.moveTo(X(-9.9), Y(s * 0.5)); g.lineTo(X(-8.6), Y(s * 0.62)); g.lineTo(X(-9.5), Y(s * 1.0)); g.closePath(); g.fill(); }
    return tex(c);
  }

  function carbonTexture() {
    const c = canvas(64, 64), g = c.getContext("2d");
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const over = (x + y) % 4 < 2, grad = over ? g.createLinearGradient(x * 8, 0, x * 8 + 8, 0) : g.createLinearGradient(0, y * 8, 0, y * 8 + 8);
      grad.addColorStop(0, "#14181d"); grad.addColorStop(0.5, over ? "#3a424b" : "#2b323a"); grad.addColorStop(1, "#14181d");
      g.fillStyle = grad; g.fillRect(x * 8, y * 8, 8, 8);
    }
    return tex(c, [6, 6]);
  }
  function brushedTexture() {
    const c = canvas(256, 256), g = c.getContext("2d");
    g.translate(128, 128);
    for (let i = 0; i < 900; i++) {
      const v = 150 + Math.random() * 95 | 0;
      g.strokeStyle = `rgba(${v},${v + 4},${v + 8},0.55)`; g.lineWidth = 0.6 + Math.random() * 1.4;
      g.rotate(Math.PI * 2 / 900 + Math.random() * 0.01);
      g.beginPath(); g.moveTo(4, 0); g.lineTo(130, 0); g.stroke();
    }
    return tex(c);
  }
  let shared;
  function sharedTextures() { return shared || (shared = { carbon: carbonTexture(), brushed: brushedTexture() }); }

  /* ---------- Materials ---------- */
  function materials(o, livery) {
    const S = sharedTextures();
    const std = (color, roughness, metalness = 0, extra) => new T.MeshStandardMaterial(Object.assign({ color: lin(color), roughness, metalness }, extra));
    return {
      paint: () => new T.MeshPhysicalMaterial({ map: livery, roughness: 0.4, metalness: 0.3, clearcoat: 0.55, clearcoatRoughness: 0.28 }),
      teal: () => new T.MeshPhysicalMaterial({ color: lin(o.base), roughness: 0.4, metalness: 0.3, clearcoat: 0.55, clearcoatRoughness: 0.28 }),
      gold: () => new T.MeshPhysicalMaterial({ color: lin(o.accent), roughness: 0.42, metalness: 0.1, clearcoat: 0.4, clearcoatRoughness: 0.3 }),
      carbon: () => std(0xffffff, 0.45, 0.2, { map: S.carbon }),
      rubber: () => std(0x0d0f12, 0.86),
      steel: () => std(0xc4ccd4, 0.22, 1),
      dark: () => std(0x0b0e12, 0.6, 0.3),
      alu: () => std(0xffffff, 0.42, 0.55, { map: S.brushed })
    };
  }

  /* ---------- Geometry helpers ---------- */
  function surface(rows, columns, sample, uvOf) {
    const positions = [], indices = [], uv = [];
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= columns; j++) {
      positions.push(...sample(i / rows, j / columns));
      uv.push(...(uvOf ? uvOf(i / rows, j / columns) : [i / rows, 1 - j / columns]));
      if (i === rows || j === columns) continue;
      const a = i * (columns + 1) + j, b = a + columns + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    geo.setIndex(indices); geo.computeVertexNormals();
    return geo;
  }
  function extruded(points, depth, bevel = 0.05) {
    const shape = new T.Shape();
    points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
    shape.closePath();
    const geo = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel * 0.8, bevelSegments: 3 });
    geo.translate(0, 0, -depth / 2);
    return geo;
  }
  function airfoil(span, chord) {
    const s = new T.Shape();
    s.moveTo(-chord * 0.5, 0);
    s.bezierCurveTo(-chord * 0.48, 0.22, chord * 0.12, 0.12, chord * 0.5, 0.015);
    s.bezierCurveTo(chord * 0.09, -0.08, -chord * 0.48, -0.1, -chord * 0.5, 0);
    const geo = new T.ExtrudeGeometry(s, { depth: span, bevelEnabled: true, bevelSize: 0.022, bevelThickness: 0.028, bevelSegments: 2, curveSegments: 20 });
    geo.translate(0, 0, -span / 2);
    return geo;
  }
  const lathe = (pts, seg = 48) => new T.LatheGeometry(pts.map(([r, y]) => new T.Vector2(r, y)), seg);

  /* ---------- The car ---------- */
  const WHEELS = [
    { x: -6.25, radius: 1.28, z: 3.03, width: 0.98, front: true },
    { x: 6.48, radius: 1.44, z: 3.18, width: 1.08, front: false }
  ];

  function buildCar(opts = {}) {
    const o = Object.assign({ base: "#0a566b", accent: "#ffb000", panel: "#d3dbe0", falcon: null, number: null, detail: "high" }, opts);
    const hi = o.detail === "high";
    const livery = paintLivery(o), M = materials(o, livery);
    const group = new T.Group(), parts = [];

    function part(id, name, material, blurb) {
      const p = { id, name, material, blurb, items: [], mats: new Set() };
      p.add = (geo, mat, pos = [0, 0, 0], offset = [0, 0, 0], parent = group) => {
        const mesh = geo.isObject3D ? geo : new T.Mesh(geo, mat);
        if (!geo.isObject3D) mesh.position.set(...pos);
        mesh.traverse(m => { if (m.isMesh) { m.castShadow = true; m.userData.part = p; p.mats.add(m.material); } });
        parent.add(mesh);
        p.items.push({ obj: mesh, home: mesh.position.clone(), offset: new T.Vector3(...offset) });
        return mesh;
      };
      parts.push(p);
      return p;
    }

    // Body shell
    const step = hi ? 8 : 4, cols = hi ? 96 : 40;
    const xs = stations.flatMap((row, i) => i === stations.length - 1 ? [row[0]]
      : Array.from({ length: step }, (_, k) => lerp(row[0], stations[i + 1][0], k / step)));
    const bodyGeo = surface(xs.length - 1, cols,
      (u, v) => skin(xs[Math.round(u * (xs.length - 1))], (v - 0.5) * Math.PI * 2),
      (u, v) => [(xs[Math.round(u * (xs.length - 1))] - X0) / (X1 - X0), v]);
    const body = part("body", "Body shell", "Polyurethane model block, primer and paint",
      "CNC-machined from the single official model block. Its teardrop shape and tall cartridge housing set most of the car's drag.");
    const bodyMesh = body.add(bodyGeo, M.paint(), [0, 0, 0], [0, 3.4, 0]);

    // Cartridge chamber and CO2 cartridge (the "engine")
    const chamber = part("chamber", "Cartridge chamber", "Bored into the body, lined sleeve",
      "The round pocket at the back of the body that holds the cartridge. Its position and depth are fixed by the rules so every car fits the launcher.");
    const ring = lathe([[0.74, 0], [0.9, 0], [0.9, 0.24], [0.74, 0.24], [0.74, 0]], 40); ring.rotateZ(-Math.PI / 2);
    chamber.add(ring, M.dark(), [9.08, 1.98, 0], [hi ? 1.2 : 0, 3.4, 0]);
    if (hi) {
      const sleeve = lathe([[0.78, 0], [0.86, 0], [0.86, 5.6], [0.78, 5.6], [0.78, 0]], 40); sleeve.rotateZ(-Math.PI / 2);
      chamber.add(sleeve, M.dark(), [3.4, 1.98, 0], [4.4, 3.4, 0]);
    }
    const power = part("cartridge", "CO₂ cartridge (power unit)", "Steel, 8 g of pressurised CO₂",
      "There is no motor. This is the engine: the launcher pierces the seal and the escaping gas pushes the car down the track for about 0.4 s.");
    const cart = lathe(hi ? [[0, 0], [0.42, 0.04], [0.66, 0.24], [0.74, 0.6], [0.74, 4.5], [0.68, 4.95], [0.42, 5.45], [0.33, 5.6], [0.33, 6.05], [0.27, 6.12], [0, 6.12]]
      : [[0, 5.5], [0.74, 5.5], [0.74, 5.75], [0.42, 5.95], [0.33, 6.05], [0, 6.12]], 40);
    cart.rotateZ(-Math.PI / 2);
    power.add(cart, M.steel(), [3.25, 1.98, 0], [hi ? 12.5 : 0, 3.4, 0]);

    // Floor
    const floor = part("floor", "Floor plate", "Carbon-fibre look undertray",
      "A thin swept plate under the body. It keeps the underside smooth and gives the wings and guides a rigid place to mount.");
    const floorGeo = extruded([[-8.6, -0.7], [-5.9, -1.5], [5.6, -2.15], [8.9, -1.25], [9.2, 1.25], [5.6, 2.15], [-5.9, 1.5], [-8.6, 0.7]], 0.13);
    floorGeo.rotateX(Math.PI / 2);
    floor.add(floorGeo, M.carbon(), [0, 0.39, 0], [0, 0, 0]);

    // Wings
    const fw = part("front-wing", "Front wing", "3D-printed, two endplates",
      "A thin aerofoil across the nose with a small endplate on each tip. On a car this light it steers air around the front wheels more than it makes downforce.");
    const fwMat = M.gold();
    fw.add(airfoil(7.6, 1.37), fwMat, [-9.39, 0.46, 0], [-4.2, 0, 0]);
    for (const s of [-1, 1]) fw.add(extruded([[-10.04, 0.44], [-9.89, 0.78], [-8.65, 0.96], [-8.92, 0.42]], 0.095), fwMat, [0, 0, s * 3.79], [-4.2, 0, s * 0.9]);

    const rw = part("rear-wing", "Rear wing", "3D-printed plane, endplates and two pylons",
      "Sits in clean air above the cartridge housing. The swept endplates stop air spilling round the tips and help the wake close up behind the car.");
    const rwGold = M.gold(), rwTeal = M.teal();
    rw.add(airfoil(6.2, 1.55), rwGold, [8.27, 5.42, 0], [1.6, 7.2, 0]);
    for (const s of [-1, 1]) {
      rw.add(extruded([[7.40, 5.0], [7.54, 5.6], [9.47, 5.96], [9.06, 5.13], [8.64, 4.96]], 0.12), rwTeal, [0, 0, s * 3.08], [1.6, 7.2, s * 1.1]);
      rw.add(extruded([[7.2, 3.0], [7.76, 5.43], [8.24, 5.43], [7.95, 3.0]], 0.14), rwTeal, [0, 0, s * 1.02], [1.6, 5.4, 0]);
    }

    // Axles
    const axles = part("axles", "Axles", "Steel rod, 3 mm",
      "Two straight steel rods through the body. If they are not perfectly parallel the car scrubs speed against the tether line.");
    const axMat = M.steel();
    for (const w of WHEELS) {
      const g = new T.CylinderGeometry(0.15, 0.15, w.z * 2 + 0.3, 20); g.rotateX(Math.PI / 2);
      axles.add(g, axMat, [w.x, w.radius, 0], [0, 0, 0]);
    }

    // Wheels: tyre, hub, bearing
    const tyres = part("tyres", "Tyres", "Low-friction polymer",
      "Four narrow tyres, all of which must touch the track. Smaller, lighter wheels spin up faster, so less of the gas goes into turning them.");
    const hubs = part("hubs", "Wheel hubs", "Machined aluminium discs",
      "Solid disc faces instead of spokes. A flat face stops the wheel acting like a fan and churning the air beside the car.");
    const bearings = part("bearings", "Ball bearings", "Steel races, 7 balls each",
      "One miniature bearing in each wheel lets it turn on the axle with almost no friction. Cleaning out the grease is a classic speed trick.");
    const tyreMat = M.rubber(), hubMat = M.alu(), capMat = M.steel(), innerMat = M.dark(), brMat = M.steel();
    const wheels = [];
    for (const w of WHEELS) for (const s of [-1, 1]) {
      const steer = new T.Group(); steer.position.set(w.x, w.radius, s * w.z); group.add(steer);
      const spin = new T.Group(); steer.add(spin);
      wheels.push({ steer, spin, radius: w.radius, front: w.front, side: s });

      const tg = lathe([[0.69, -0.46], [0.9, -0.46], [0.97, -0.38], [1, -0.24], [1, 0.24], [0.97, 0.38], [0.9, 0.46], [0.69, 0.46], [0.69, -0.46]]
        .map(([r, a]) => [r * w.radius, a * w.width]), hi ? 72 : 32);
      tg.rotateX(Math.PI / 2);
      tyres.add(tg, tyreMat, [0, 0, 0], [0, 0, s * 4.6], spin);

      const hub = new T.Group();
      const disc = (r, d, m, z) => { const g = new T.CylinderGeometry(r, r, d, hi ? 56 : 28); g.rotateX(Math.PI / 2); const me = new T.Mesh(g, m); me.position.z = z; hub.add(me); };
      const face = s * w.width * 0.44;
      disc(w.radius * 0.71, w.width * 0.84, innerMat, 0);
      const plate = new T.Mesh(new T.CircleGeometry(w.radius * 0.72, hi ? 56 : 28), hubMat);
      plate.position.z = face + s * 0.012; if (s < 0) plate.rotation.y = Math.PI; hub.add(plate);
      disc(w.radius * 0.17, 0.1, capMat, face + s * 0.03);
      disc(w.radius * 0.09, 0.16, innerMat, face + s * 0.03);
      hubs.add(hub, null, [0, 0, 0], [0, 0, s * 3.0], spin);

      if (hi) {
        const b = new T.Group();
        const outer = lathe([[0.36, -0.14], [0.5, -0.14], [0.5, 0.14], [0.36, 0.14], [0.36, -0.14]], 32); outer.rotateX(Math.PI / 2);
        const inner = lathe([[0.16, -0.14], [0.26, -0.14], [0.26, 0.14], [0.16, 0.14], [0.16, -0.14]], 32); inner.rotateX(Math.PI / 2);
        b.add(new T.Mesh(outer, brMat), new T.Mesh(inner, brMat));
        for (let i = 0; i < 7; i++) { const ball = new T.Mesh(new T.SphereGeometry(0.075, 12, 10), brMat); ball.position.set(Math.cos(i * 0.898) * 0.31, Math.sin(i * 0.898) * 0.31, 0); b.add(ball); }
        b.position.z = -s * w.width * 0.2;
        bearings.add(b, null, [0, 0, 0], [0, 0, s * 1.5 + s * w.width * 0.2], spin);
        bearings.items[bearings.items.length - 1].home.set(0, 0, -s * w.width * 0.2);
      }
    }
    if (!hi) parts.splice(parts.indexOf(bearings), 1);

    // Tether line guides
    if (hi) {
      const guides = part("guides", "Tether line guides", "Steel screw eyes",
        "Two eyelets under the floor. A fishing line stretched down the track runs through them and keeps the car straight for all 20 metres.");
      const gMat = M.steel();
      for (const x of [-4.4, 5.2]) {
        const eye = new T.Group();
        const loop = new T.Mesh(new T.TorusGeometry(0.17, 0.035, 10, 28), gMat); loop.rotation.y = Math.PI / 2; loop.position.y = -0.2;
        const stem = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 0.22, 8), gMat); stem.position.y = 0.06;
        eye.add(loop, stem); eye.position.set(x, 0.34, 0);
        guides.add(eye, null, [0, 0, 0], [0, -1.9, 0]);
        guides.items[guides.items.length - 1].home.set(x, 0.34, 0);
      }
    }

    function explode(t) {
      for (const p of parts) for (const it of p.items) it.obj.position.copy(it.home).addScaledVector(it.offset, t);
    }
    return { group, parts, wheels, bodyMesh, explode, livery };
  }

  /* ---------- Image-based lighting, generated in code so nothing extra has to download ---------- */
  function gradientDome(radius, stops) {
    const geo = new T.SphereGeometry(radius, 32, 20), col = [], pos = geo.attributes.position, c = new T.Color();
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i) / radius; let k = 0;
      while (k < stops.length - 2 && h > stops[k + 1][0]) k++;
      const [h0, c0] = stops[k], [h1, c1] = stops[k + 1];
      c.copy(lin(c0)).lerp(lin(c1), clamp((h - h0) / (h1 - h0), 0, 1)); col.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    return new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false, depthWrite: false }));
  }
  const SKY = [[-1, 0x4a5a3a], [-0.02, 0x6f8052], [0.0, 0xdce9f2], [0.12, 0xa9cdee], [0.5, 0x4f8fd8], [1, 0x2a62b8]];
  function makeEnvironment(renderer, kind) {
    const s = new T.Scene();
    const panel = (w, h, color, power, pos) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: lin(color).multiplyScalar(power), side: T.DoubleSide }));
      m.position.set(...pos); m.lookAt(0, 0, 0); s.add(m);
    };
    if (kind === "sky") {
      s.add(gradientDome(100, SKY));
      panel(14, 14, 0xfff2d8, 30, [40, 60, 25]);
    } else {
      s.add(gradientDome(100, [[-1, 0x05080c], [0, 0x0d1620], [1, 0x1b2a3a]]));
      panel(34, 16, 0xffffff, 2.2, [0, 26, 6]);
      panel(8, 26, 0xbfe4ff, 1.8, [-30, 9, -12]);
      panel(8, 26, 0xffe6c4, 1.5, [30, 11, 14]);
      panel(46, 3, 0xffffff, 1.2, [0, 5, -34]);
      panel(46, 2, 0x9fd0ff, 0.8, [0, 3, 34]);
    }
    const pm = new T.PMREMGenerator(renderer), env = pm.fromScene(s, 0.04).texture;
    pm.dispose();
    return env;
  }

  function loadFalcon(done) {
    if (!window.FALCON_DECAL && typeof FALCON_DECAL === "undefined") return done(null);
    const img = new Image();
    img.onload = () => done(img); img.onerror = () => done(null);
    img.src = FALCON_DECAL;
  }

  return { buildCar, bodyAt, skin, WHEELS, makeEnvironment, gradientDome, SKY, loadFalcon, lin, tex, canvas };
})();

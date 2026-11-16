/* Shared TA-aero car builder, used by the 3D lab (car.html) and the racing game (game.html).
   The nose points along −x. One unit is roughly one centimetre.
   Every physical component is its own "part" so the lab can explode, label and highlight it. */
window.TAAero = (function () {
  const T = THREE;
  const lerp = T.MathUtils.lerp, clamp = T.MathUtils.clamp;
  const lin = c => new T.Color(c).convertSRGBToLinear();
  // Approximate the supplied front, side and top CAD views in centimetres.
  const BODY_COLOR = "#245568";
  const REAR_WING = { x: 8.05, y: 4.45, span: 6.7, chord: 2.5 };

  // Each station gives x, underside height, crown height and half-width.
  const stations = [
    [-10.1, 0.91, 1.01, 0.055], [-9.5, 0.76, 1.27, 0.34],
    [-8.3, 0.48, 1.72, 0.91], [-6.6, 0.34, 2.32, 1.6],
    [-4.2, 0.34, 3.23, 1.65], [-1.4, 0.34, 4.22, 1.65],
    [1.35, 0.34, 4.93, 1.65], [3.0, 0.34, 5.17, 1.65],
    [6.0, 0.34, 5.17, 1.65], [9.05, 0.34, 5.16, 1.65],
    [9.25, 0.40, 5.09, 1.58]
  ];
  const [X0] = stations[0], [X1] = stations[stations.length - 1];

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
  // Rounded crown over upright flanks and a nearly flat base.
  function skin(x, theta) {
    const [bottom, top, width] = bodyAt(x);
    const angle = Math.abs(theta);
    const shoulder = lerp(bottom, top, 0.62);
    const upper = angle <= Math.PI / 2;
    const cos = Math.cos(theta), sin = Math.sin(theta);
    return [
      x,
      upper ? shoulder + (top - shoulder) * cos : shoulder + (shoulder - bottom) * -(Math.abs(cos) ** 0.23),
      width * Math.sign(sin) * Math.abs(sin) ** (upper ? 0.82 : 0.23)
    ];
  }

  function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function tex(c, repeat) {
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding; t.anisotropy = 8;
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }

  function materials() {
    const std = (color, roughness, metalness = 0) =>
      new T.MeshStandardMaterial({ color: lin(color), roughness, metalness });
    return {
      paint: new T.MeshPhysicalMaterial({
        color: new T.Color(BODY_COLOR).convertSRGBToLinear(),
        roughness: 0.39, metalness: 0.12, clearcoat: 0.45, clearcoatRoughness: 0.3
      }),
      rubber: std(0x212224, 0.86),
      steel: std(0xc4ccd4, 0.22, 1),
      dark: std(0x27282a, 0.58, 0.15)
    };
  }

  function sideLabel(number) {
    const c = canvas(384, 128), g = c.getContext("2d");
    g.fillStyle = "#171a1d"; g.fillRect(0, 0, 384, 128);
    g.fillStyle = "#f7f3e8"; g.fillRect(10, 10, 364, 108);
    g.fillStyle = "#171a1d";
    g.font = "italic bold 35px sans-serif"; g.fillText("STEM", 24, 60); g.fillText("RACING", 24, 96);
    g.font = "italic bold 76px sans-serif"; g.textAlign = "right"; g.fillText(number, 343, 91);
    return new T.MeshStandardMaterial({ map: tex(c), roughness: 0.65 });
  }

  /* ---------- Geometry helpers ---------- */
  function surface(rows, columns, sample) {
    const positions = [], indices = [];
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= columns; j++) {
      positions.push(...sample(i / rows, j / columns));
      if (i === rows || j === columns) continue;
      const a = i * (columns + 1) + j, b = a + columns + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
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
    { x: -4.75, radius: 1.72, z: 2.97, width: 1.94, front: true },
    { x: 4.82, radius: 1.72, z: 2.97, width: 1.94, front: false }
  ];

  function buildCar(opts = {}) {
    const { detail = "high", number = "A" } = opts;
    const hi = detail === "high";
    const M = materials();
    const group = new T.Group(), parts = [];

    function part(id, name, material, blurb) {
      const p = { id, name, material, blurb, items: [], mats: new Set() };
      const partMaterials = new Map();
      p.add = (geo, mat, pos = [0, 0, 0], offset = [0, 0, 0], parent = group) => {
        const mesh = geo.isObject3D ? geo : new T.Mesh(geo, mat);
        if (!geo.isObject3D) mesh.position.set(...pos);
        mesh.traverse(m => {
          if (!m.isMesh) return;
          const source = m.material;
          if (hi && !partMaterials.has(source)) partMaterials.set(source, source.clone());
          if (hi) m.material = partMaterials.get(source);
          m.castShadow = true;
          m.userData.part = p;
          p.mats.add(m.material);
        });
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
      (u, v) => skin(xs[Math.round(u * (xs.length - 1))], (v - 0.5) * Math.PI * 2));
    const body = part("body", "Body shell", "Polyurethane model block, primer and paint",
      "CNC-machined from the single official model block. Its teardrop shape and tall cartridge housing set most of the car's drag.");
    const bodyMesh = body.add(bodyGeo, M.paint, [0, 0, 0], [0, 3.4, 0]);
    const cap = new T.Shape();
    for (let i = 0; i < cols; i++) {
      const [, y, z] = skin(X1, i / cols * 2 * Math.PI - Math.PI);
      if (i === 0) cap.moveTo(-z, y);
      else cap.lineTo(-z, y);
    }
    const hole = new T.Path();
    hole.absarc(0, 2.86, 0.74, 0, Math.PI * 2, true);
    cap.holes.push(hole);
    const rearFace = new T.ShapeGeometry(cap);
    rearFace.rotateY(Math.PI / 2);
    body.add(rearFace, M.paint, [X1, 0, 0], [0, 3.4, 0]);

    // Cartridge chamber and CO2 cartridge (the "engine")
    const chamber = part("chamber", "Cartridge chamber", "Bored into the body, lined sleeve",
      "The round pocket at the back of the body that holds the cartridge. Its position and depth are fixed by the rules so every car fits the launcher.");
    const ring = lathe([[0.74, 0], [0.9, 0], [0.9, 0.24], [0.74, 0.24], [0.74, 0]], 40); ring.rotateZ(-Math.PI / 2);
    chamber.add(ring, M.dark, [9.1, 2.86, 0], [hi ? 1.2 : 0, 3.4, 0]);
    if (hi) {
      const sleeve = lathe([[0.78, 0], [0.86, 0], [0.86, 5.6], [0.78, 5.6], [0.78, 0]], 40); sleeve.rotateZ(-Math.PI / 2);
      chamber.add(sleeve, M.dark, [3.4, 2.86, 0], [4.4, 3.4, 0]);
    }
    const power = part("cartridge", "CO₂ cartridge (power unit)", "Steel, 8 g of pressurised CO₂",
      "There is no motor. This is the engine: the launcher pierces the seal and the escaping gas pushes the car down the track for about 0.4 s.");
    const cart = lathe(hi ? [[0, 0], [0.42, 0.04], [0.66, 0.24], [0.74, 0.6], [0.74, 4.5], [0.68, 4.95], [0.42, 5.45], [0.33, 5.6], [0.33, 6.05], [0.27, 6.12], [0, 6.12]]
      : [[0, 5.5], [0.74, 5.5], [0.74, 5.75], [0.42, 5.95], [0.33, 6.05], [0, 6.12]], 40);
    cart.rotateZ(-Math.PI / 2);
    power.add(cart, M.steel, [3.25, 2.86, 0], [hi ? 12.5 : 0, 3.4, 0]);

    const floor = part("floor", "Underbody and sidepods", "Shaped and painted model material",
      "Low sidepods fill the gap between the axles and carry the race identification panels.");
    floor.add(new T.BoxGeometry(15.5, 0.16, 2.75), M.paint, [0.6, 0.4, 0]);
    const label = sideLabel(number);
    for (const side of [-1, 1]) {
      floor.add(extruded([[-2.94, 0.41], [-2.74, 2.02], [2.91, 2.02], [3.12, 1.79], [3.12, 0.41]],
        1.72, 0.12), M.paint, [0, 0, side * 2.46], [0, -1.25, side * 2.4]);
      const badge = floor.add(new T.PlaneGeometry(3.42, 1.13), label,
        [0.35, 1.16, side * 3.45], [0, -1.25, side * 2.4]);
      if (side < 0) badge.rotation.y = Math.PI;
      floor.add(extruded([[7, 0.38], [7, 1.82], [8.26, 2.02], [9.34, 1.44], [9.66, 0.93], [8.82, 0.43]],
        0.91, 0.16), M.paint, [0, 0, side * 1.84], [0.9, -0.7, side * 1.6]);
    }

    const fw = part("front-wing", "Front wing", "Two sloping panels",
      "The split front wing sweeps down ahead of the front wheels, with the nose between the two panels.");
    for (const side of [-1, 1]) {
      fw.add(extruded([[-9.26, 0.20], [-6.75, 1.48], [-6.49, 1.39], [-6.58, 0.19]],
        3.06, 0.055), M.paint, [0, 0, side * 2.44], [-4.2, 0, side * 1.25]);
    }

    const rw = part("rear-wing", "Rear wing", "Low mounted aerofoil",
      "The low rear wing extends directly from the sides of the cartridge housing.");
    rw.add(airfoil(REAR_WING.span, REAR_WING.chord), M.paint,
      [REAR_WING.x, REAR_WING.y, 0], [1.6, 4.4, 0]);

    // Axles
    const axles = part("axles", "Axles", "Steel rod, 3 mm",
      "Two straight steel rods through the body. If they are not perfectly parallel the car scrubs speed against the tether line.");
    const axMat = M.steel;
    for (const w of WHEELS) {
      const g = new T.CylinderGeometry(0.15, 0.15, w.z * 2 + 0.3, 20); g.rotateX(Math.PI / 2);
      axles.add(g, axMat, [w.x, w.radius, 0], [0, 0, 0]);
    }

    // Wheels: tyre, hub, bearing
    const tyres = part("tyres", "Tyres", "Low-friction polymer",
      "Four slick tyres, all of which must touch the track. Smaller, lighter wheels spin up faster, so less of the gas goes into turning them.");
    const hubs = part("hubs", "Wheel hubs", "Dark recessed discs",
      "Solid disc faces instead of spokes. A flat face stops the wheel acting like a fan and churning the air beside the car.");
    const bearings = part("bearings", "Ball bearings", "Steel races, 7 balls each",
      "One miniature bearing in each wheel lets it turn on the axle with almost no friction. Cleaning out the grease is a classic speed trick.");
    const tyreMat = M.rubber, hubMat = M.dark, innerMat = M.dark, brMat = M.steel;
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
      const gMat = M.steel;
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
    return { group, parts, wheels, bodyMesh, explode };
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

  return { buildCar, bodyAt, X0, X1, BODY_COLOR, REAR_WING, WHEELS, makeEnvironment, gradientDome, SKY, lin, tex, canvas };
})();

/* Shared TA-aero car builder, used by the 3D lab (car.html) and the racing game (game.html).
   The nose points along −x. One unit is roughly one centimetre.
   Every physical component is its own "part" so the lab can explode, label and highlight it. */
window.TAAero = (function () {
  const T = THREE;
  const lerp = T.MathUtils.lerp, clamp = T.MathUtils.clamp;
  const lin = c => new T.Color(c).convertSRGBToLinear();
  // Approximate the supplied front, side and top CAD views in centimetres.
  const BODY_COLOR = "#245568";
  const REAR_WING = { x: 7.65, y: 4.23, span: 5.7, chord: 1.75 };

  // Approximate envelopes used only to draw the illustrative airflow paths.
  const stations = [
    [-8.55, 0.35, 0.92, 0.12], [-7.3, 0.14, 1.36, 1.0],
    [-5.6, 0.08, 2.06, 1.52], [-3.7, 0.05, 2.85, 1.56],
    [-1.6, 0.05, 3.55, 2.8], [0.5, 0.05, 4.23, 2.8],
    [2.7, 0.05, 4.65, 1.65], [5.0, 0.05, 4.69, 1.65],
    [8.55, 0.05, 4.49, 1.6]
  ];
  const [X0] = stations[0], [X1] = stations[stations.length - 1];

  function bodyAt(x) {
    const next = stations.findIndex(row => row[0] >= x);
    const index = next < 0 ? stations.length - 2 : Math.max(0, next - 1);
    const a = stations[index], b = stations[index + 1];
    const t = clamp((x - a[0]) / (b[0] - a[0]), 0, 1);
    return [1, 2, 3].map(column => lerp(a[column], b[column], t));
  }

  function canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }
  function tex(c, repeat) {
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding; t.anisotropy = 8;
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }

  function decode(data, ArrayType) {
    return new ArrayType(Uint8Array.from(atob(data), character => character.charCodeAt(0)).buffer);
  }

  function cadGeometry(name) {
    const data = window.TAAeroCAD[name];
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(decode(data.positions, Float32Array), 3));
    geometry.setAttribute("normal", new T.BufferAttribute(decode(data.normals, Float32Array), 3));
    geometry.setIndex(new T.BufferAttribute(decode(data.indices, Uint16Array), 1));
    geometry.computeBoundingBox();
    return geometry;
  }

  const wheelGroups = ["Body1 (2)", "Body1 (3)", "Body1 (5)", "Body1 (6)"];
  const WHEELS = [
    { x: -3.70, radius: 1.5, z: 2.545, width: 2 },
    { x: 4.65, radius: 1.5, z: 2.545, width: 2 }
  ];

  function buildCar() {
    const group = new T.Group(), parts = [], wheels = [];
    const teal = () => new T.MeshPhysicalMaterial({
      color: new T.Color(BODY_COLOR).convertSRGBToLinear(),
      roughness: 0.39, metalness: 0.12, clearcoat: 0.45, clearcoatRoughness: 0.3
    });

    function part(name, material, blurb, finish) {
      const p = { name, material, blurb, mats: new Set([finish]), items: [] };
      parts.push(p);
      return (geometry, parent, offset) => {
        const obj = new T.Mesh(geometry, finish);
        obj.castShadow = true;
        obj.userData.part = p;
        parent.add(obj);
        p.items.push({ obj, offset: new T.Vector3(...offset) });
        return obj;
      };
    }

    const body = part("Main body", "Model block and teal paint",
      "The central shell and the features exported with it are one component in the supplied CAD mesh.", teal());
    const bodyMesh = body(cadGeometry("Body1"), group, [0, 3.4, 0]);

    const wings = part("Rear wing pieces", "Teal painted components",
      "The two pieces sit on opposite sides of the rear of the car.", teal());
    wings(cadGeometry("Body43"), group, [1.8, 2, -2.3]);
    wings(cadGeometry("Body44"), group, [1.8, 2, 2.3]);

    const plates = part("Front wing end pieces", "Teal painted components",
      "These pieces sit ahead of the front wheels, at the outer edges of the front wing.", teal());
    plates(cadGeometry("Body45"), group, [-2.3, 0, -2.6]);
    plates(cadGeometry("Body46"), group, [-2.3, 0, 2.6]);

    const tyres = part("Wheels", "Dark finish", "The four wheel meshes are imported from the CAD export.",
      new T.MeshStandardMaterial({ color: lin(0x242426), roughness: 0.8 }));
    for (const name of wheelGroups) {
      const geometry = cadGeometry(name);
      const center = geometry.boundingBox.getCenter(new T.Vector3());
      const radius = geometry.boundingBox.getSize(new T.Vector3()).y / 2;
      const steer = new T.Group(), spin = new T.Group();
      steer.position.copy(center);
      group.add(steer);
      steer.add(spin);
      geometry.translate(-center.x, -center.y, -center.z);
      tyres(geometry, spin, [0, 0, Math.sign(center.z) * 3.3]);
      wheels.push({ steer, spin, radius, front: center.x < 0 });
    }

    function explode(amount) {
      for (const p of parts) for (const { obj, offset } of p.items) {
        obj.position.copy(offset).multiplyScalar(amount);
      }
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

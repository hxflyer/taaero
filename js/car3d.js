/* Studio model and illustrative wind tunnel. The nose points along −x. */
(function () {
  const box = document.getElementById("viewer");
  if (!box) return;
  const note = box.querySelector(".note");
  if (!window.THREE) {
    note.textContent = "An internet connection is needed to load the 3D viewer.";
    return;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    note.textContent = "WebGL is unavailable in this browser.";
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.domElement.setAttribute("aria-hidden", "true");
  box.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 150);
  const car = new THREE.Group();
  scene.add(car, new THREE.HemisphereLight(0xe6f8ff, 0x53677d, 1.05));
  function light(color, intensity, x, y, z) {
    const lamp = new THREE.DirectionalLight(color, intensity);
    lamp.position.set(x, y, z);
    scene.add(lamp);
  }
  light(0xffeed6, 1.6, -6, 12, 8);
  light(0x8bdcff, 1.8, 4, 5, -8);

  const finish = (color, roughness, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color).convertSRGBToLinear(), roughness, metalness });
  const teal = finish(0x09556a, 0.43, 0.18);
  const gold = finish(0xffa900, 0.46, 0.14);
  const carbon = finish(0x131c24, 0.67);
  const rubber = finish(0x111419, 0.72);
  const steel = finish(0xa0adb8, 0.28, 0.55);

  function mesh(geometry, material, x = 0, y = 0, z = 0) {
    const part = new THREE.Mesh(geometry, material);
    part.position.set(x, y, z);
    car.add(part);
    return part;
  }

  // Each station gives x, the underside and crown heights, and the half-width.
  const stations = [
    [-10.1, 0.57, 0.63, 0.035], [-9.8, 0.49, 0.91, 0.43],
    [-8.7, 0.46, 1.28, 0.82], [-6.4, 0.48, 1.67, 1.18],
    [-3.9, 0.60, 2.14, 1.57], [-1.1, 0.71, 2.45, 1.86],
    [2.0, 0.79, 2.80, 1.98], [4.6, 0.75, 3.50, 1.93],
    [6.6, 0.61, 3.69, 1.69], [8.3, 0.78, 3.32, 1.38],
    [9.2, 1.01, 2.96, 1.12], [9.23, 1.05, 2.91, 1.07],
    [9.24, 1.97, 1.99, 0.02]
  ];

  // Shape interpolation shares the same surface with the paint and airflow.
  function bodyAt(x) {
    const nextStation = stations.findIndex(row => row[0] >= x);
    const index = nextStation < 0 ? stations.length - 2 : Math.max(0, nextStation - 1);
    const a = stations[index];
    const b = stations[index + 1];
    const p = stations[Math.max(0, index - 1)];
    const q = stations[Math.min(stations.length - 1, index + 2)];
    const dx = b[0] - a[0];
    const t = THREE.MathUtils.clamp((x - a[0]) / dx, 0, 1);
    const blend = t * t * (3 - 2 * t);
    return [1, 2, 3].map(column => {
      const inSlope = (b[column] - p[column]) / (b[0] - p[0]);
      const outSlope = (q[column] - a[column]) / (q[0] - a[0]);
      return THREE.MathUtils.lerp(a[column], b[column], blend)
        + dx * t * (1 - t) * ((1 - t) * inSlope - t * outSlope);
    });
  }

  function skin(x, theta, offset = 0) {
    const [bottom, top, width] = bodyAt(x);
    return [
      x,
      (bottom + top) / 2 + (Math.max(0.01, (top - bottom) / 2) + offset) * Math.cos(theta),
      (Math.max(0.01, width) + offset) * Math.sin(theta)
    ];
  }

  function surface(rows, columns, sample) {
    const positions = [], indices = [], uv = [];
    for (let i = 0; i <= rows; i++) {
      for (let j = 0; j <= columns; j++) {
        positions.push(...sample(i / rows, j / columns));
        uv.push(i / rows, 1 - j / columns);
        if (i === rows || j === columns) continue;
        const a = i * (columns + 1) + j;
        const b = a + columns + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  const bodyXs = stations.flatMap((row, i) => i === stations.length - 1 ? [row[0]]
    : Array.from({ length: 8 }, (_, step) => THREE.MathUtils.lerp(row[0], stations[i + 1][0], step / 8)));
  mesh(surface(bodyXs.length - 1, 80, (u, v) =>
    skin(bodyXs[Math.round(u * (bodyXs.length - 1))], (v - 0.5) * Math.PI * 2)), teal);

  // A single stripe branches into two swept feathers over the cartridge housing.
  mesh(surface(80, 8, (u, v) => {
    const x = THREE.MathUtils.lerp(-9.92, 6.5, u);
    const width = bodyAt(x)[2];
    const halfAngle = Math.asin(Math.min(0.3, 0.08 / width));
    return skin(x, (2 * v - 1) * halfAngle, 0.022);
  }), gold);
  for (const side of [-1, 1]) {
    mesh(surface(40, 8, (u, v) => {
      const sweep = 0.62 * u ** 1.3;
      return skin(THREE.MathUtils.lerp(2.7, 7.7, u),
        side * sweep + (2 * v - 1) * 0.065 * (1 - u), 0.026);
    }), gold);
  }

  function outlinedPart(points, depth, material, z) {
    const shape = new THREE.Shape();
    points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.04, bevelSegments: 3
    });
    return mesh(geometry, material, 0, 0, z - depth / 2);
  }

  // Swept floor, thin airfoil sections, and feather-shaped endplates.
  outlinedPart([[-8.6, -0.7], [-5.9, -1.5], [5.6, -2.15], [8.9, -1.25],
    [9.2, 1.25], [5.6, 2.15], [-5.9, 1.5], [-8.6, 0.7]], 0.13, carbon, 0)
    .rotateX(Math.PI / 2).position.y = 0.39;
  function wing(x, y, span, chord) {
    const wingShape = new THREE.Shape();
    wingShape.moveTo(-chord * 0.5, 0);
    wingShape.bezierCurveTo(-chord * 0.48, 0.22, chord * 0.12, 0.12, chord * 0.5, 0.015);
    wingShape.bezierCurveTo(chord * 0.09, -0.08, -chord * 0.48, -0.1, -chord * 0.5, 0);
    const geo = new THREE.ExtrudeGeometry(wingShape, {
      depth: span, bevelEnabled: true, bevelSize: 0.022, bevelThickness: 0.028, bevelSegments: 2
    });
    mesh(geo, gold, x, y, -span / 2);
  }
  wing(-9.39, 0.46, 7.6, 1.37);
  wing(8.27, 4.72, 6.2, 1.55);
  for (const side of [-1, 1]) {
    outlinedPart([[-10.04, 0.44], [-9.89, 0.78], [-8.65, 0.96], [-8.92, 0.42]],
      0.095, gold, side * 3.79);
    outlinedPart([[7.40, 4.30], [7.54, 4.90], [9.47, 5.26], [9.06, 4.43], [8.64, 4.26]],
      0.12, teal, side * 3.08);
    outlinedPart([[7.24, 3.0], [7.76, 4.73], [8.24, 4.73], [7.89, 3.0]],
      0.14, teal, side * 1.02);
  }

  // Use the exact team mark as a painted decal that follows the body curvature.
  const falcon = new Image();
  falcon.onload = () => {
    for (const side of [-1, 1]) {
      const decal = document.createElement("canvas");
      decal.width = 1024;
      decal.height = 512;
      const context = decal.getContext("2d");
      context.fillStyle = "#d2dce0";
      context.beginPath();
      context.moveTo(18, 333);
      context.bezierCurveTo(144, 110, 624, 39, 1008, 65);
      context.bezierCurveTo(905, 292, 665, 409, 325, 465);
      context.quadraticCurveTo(80, 498, 18, 333);
      context.fill();
      context.translate(side === 1 ? decal.width : 0, 0);
      context.scale(side === 1 ? -1 : 1, 1);
      context.translate(510, side === 1 ? 242 : 249);
      context.rotate(side === 1 ? -0.37 : -0.68);
      context.drawImage(falcon, -377, -250, 754, 540);
      const texture = new THREE.CanvasTexture(decal);
      texture.encoding = THREE.sRGBEncoding;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      const patch = (u, v, offset) => {
        const x = THREE.MathUtils.lerp(-3.9, 3.95, u);
        return skin(x, side * (0.53 + v * 1.78 - u * 0.13), offset);
      };
      mesh(surface(60, 16, (u, v) => patch(u, v, 0.04)),
        new THREE.MeshStandardMaterial({
          map: texture, transparent: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.55
        }));
      render();
    }
  };
  falcon.src = FALCON_DECAL;

  function cylinder(r, depth, material, x, y, z, axis) {
    const part = mesh(new THREE.CylinderGeometry(r, r, depth, 48), material, x, y, z);
    if (axis === "x") part.rotation.z = Math.PI / 2;
    if (axis === "z") part.rotation.x = Math.PI / 2;
  }
  cylinder(0.88, 0.22, carbon, 9.16, 1.98, 0, "x");
  cylinder(0.73, 0.22, steel, 9.28, 1.98, 0, "x");
  cylinder(0.27, 0.09, carbon, 9.42, 1.98, 0, "x");

  const wheels = [
    { x: -6.25, radius: 1.28, z: 3.03, width: 0.98 },
    { x: 6.48, radius: 1.44, z: 3.18, width: 1.08 }
  ];
  for (const { x, radius, z, width } of wheels) {
    cylinder(0.15, z * 2, steel, x, radius, 0, "z");
    const tire = new THREE.LatheGeometry([
      [0.69, -0.46], [0.92, -0.46], [0.98, -0.35], [1, -0.22],
      [1, 0.22], [0.98, 0.35], [0.92, 0.46], [0.69, 0.46]
    ].map(([r, axial]) => new THREE.Vector2(r * radius, axial * width)), 64);
    tire.rotateX(Math.PI / 2);
    for (const side of [-1, 1]) {
      mesh(tire, rubber, x, radius, side * z);
      cylinder(radius * 0.71, 0.08, carbon, x, radius, side * (z - width * 0.46), "z");
      const face = side * (z + width * 0.46);
      cylinder(radius * 0.72, 0.09, steel, x, radius, face, "z");
      cylinder(radius * 0.20, 0.11, carbon, x, radius, face, "z");
      cylinder(radius * 0.13, 0.13, steel, x, radius, face, "z");
    }
  }

  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = shadowCanvas.height = 128;
  const ctx = shadowCanvas.getContext("2d");
  const shade = ctx.createRadialGradient(64, 64, 3, 64, 64, 64);
  shade.addColorStop(0, "#05090cf0");
  shade.addColorStop(0.55, "#05090c99");
  shade.addColorStop(1, "#05090c00");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 128, 128);
  mesh(new THREE.PlaneGeometry(28, 11), new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false
  }), 0, 0.012, 0).rotation.x = -Math.PI / 2;

  const flow = new THREE.Group();
  scene.add(flow);
  flow.visible = false;
  const streams = [];
  const throughColor = new THREE.Color(0x57d9ff).convertSRGBToLinear();
  const wakeColor = new THREE.Color(0xffab47).convertSRGBToLinear();
  const minX = -15, maxX = 16, samples = 128, trailLength = 9;
  const smooth = THREE.MathUtils.smoothstep;
  const streamMaterial = new THREE.LineBasicMaterial({
    color: throughColor, opacity: 0.32, transparent: true, depthWrite: false, toneMapped: false
  });
  const wakeMaterial = streamMaterial.clone();
  wakeMaterial.color.copy(wakeColor);

  // A kinematic model uses smooth obstacle envelopes and expanding wake traces.
  function streamPath(x, inletY, inletZ) {
    let y = inletY, z = inletZ;
    const side = Math.sign(z) || 1;
    const [bottom, top, width] = bodyAt(THREE.MathUtils.clamp(x, -10.1, 9.15));
    const bodyFade = smooth(x, -12, -9.5) * (1 - smooth(x, 8.8, 13.8));
    const distance = Math.abs(z);
    if (distance < width + 0.35) {
      const crossSection = Math.sqrt(Math.max(0, 1 - (distance / (width + 0.35)) ** 2));
      const roof = (bottom + top) / 2 + ((top - bottom) / 2 + 0.38) * crossSection;
      y += Math.max(0, roof - y) * bodyFade;
    }
    for (const wheel of wheels) {
      const dx = x - wheel.x;
      const wheelEnvelope = smooth(dx, -3.35, -wheel.radius)
        * (1 - smooth(dx, wheel.radius, 4.5));
      const wheelHeight = 1 - smooth(y, wheel.radius * 2, wheel.radius * 2 + 0.5);
      const lane = Math.abs(z) - wheel.z;
      if (Math.abs(lane) >= 1.55) continue;
      const clearance = wheel.width / 2 + 0.36;
      const shift = Math.max(0, clearance - Math.abs(lane));
      z += side * (Math.sign(lane) || 1) * shift * wheelEnvelope * wheelHeight;
    }
    const rearWing = smooth(x, 5.9, 7.5) * (1 - smooth(x, 9, 12.2));
    if (Math.abs(z) < 3.35 && y > 4.25 && y < 5.35) {
      y += (y < 4.72 ? 4.22 - y : 5.36 - y) * rearWing;
    }
    return [x, y, z];
  }

  function addStream(start, wake, path) {
    const positions = new Float32Array((samples + 1) * 3);
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      positions.set(path(THREE.MathUtils.lerp(start, maxX, t), t), i * 3);
    }
    const track = new THREE.BufferGeometry();
    track.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    flow.add(new THREE.Line(track, wake ? wakeMaterial : streamMaterial));

    const trail = new THREE.BufferGeometry();
    const moving = new THREE.BufferAttribute(new Float32Array(trailLength * 3), 3);
    moving.setUsage(THREE.DynamicDrawUsage);
    trail.setAttribute("position", moving);
    const pulse = new THREE.Line(trail, new THREE.LineBasicMaterial({
      color: wake ? wakeColor : throughColor, transparent: true, depthWrite: false, opacity: 0.9, toneMapped: false
    }));
    pulse.frustumCulled = false;
    flow.add(pulse);
    streams.push({ positions, moving, wake, phase: (streams.length * 0.618034) % 1 });
  }

  for (const y of [0.88, 1.65, 2.75, 4.4, 5.45]) {
    for (const z of [-5.2, -3.65, -2.62, -1.28, 0, 1.28, 2.62, 3.65, 5.2]) {
      addStream(minX, false, x => streamPath(x, y, z));
    }
  }
  function wakePair(start, y, z, spread, phase) {
    addStream(start, true, (x, t) => {
      const radius = spread * (0.15 + 0.85 * t);
      const angle = t * 13 + phase;
      return [x, y + Math.cos(angle) * radius, z + Math.sin(angle) * radius];
    });
  }
  for (const wheel of wheels) {
    for (const side of [-1, 1]) {
      for (const phase of [0, Math.PI]) {
        wakePair(wheel.x + wheel.radius + 0.05, wheel.radius, side * wheel.z, 0.55, phase);
      }
    }
  }
  for (const side of [-1, 1]) {
    wakePair(9.5, 4.63, side * 3.08, 0.48, side * Math.PI / 2);
  }

  function moveTracers(time) {
    for (const { positions, moving, phase, wake } of streams) {
      const tip = ((time * (wake ? 0.44 : 0.34) + phase) % 1) * samples;
      for (let i = 0; i < trailLength; i++) {
        const point = Math.max(0, tip - trailLength + 1 + i);
        const floor = Math.floor(point);
        const a = floor * 3;
        const b = Math.min(samples, floor + 1) * 3;
        moving.setXYZ(i,
          THREE.MathUtils.lerp(positions[a], positions[b], point - floor),
          THREE.MathUtils.lerp(positions[a + 1], positions[b + 1], point - floor),
          THREE.MathUtils.lerp(positions[a + 2], positions[b + 2], point - floor));
      }
      moving.needsUpdate = true;
    }
  }

  const views = {
    perspective: [-0.56, 0.3], side: [0, 0.08],
    front: [-Math.PI / 2, 0.11], top: [0, 1.56]
  };
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let [yaw, pitch] = views.perspective;
  let spin = false, drag = null, playing = !reducedMotion.matches;
  let playbackRate = 1, flowTime = 0, frame = 0, previousFrame;
  let onScreen = true;

  function render() {
    pitch = THREE.MathUtils.clamp(pitch, 0.03, 1.56);
    const distance = (flow.visible ? 41 : 30) * Math.max(1, 1.62 / camera.aspect);
    const target = new THREE.Vector3(flow.visible ? 0.6 : 0, flow.visible ? 2.45 : 2.06, 0);
    camera.position.set(
      target.x + distance * Math.cos(pitch) * Math.sin(yaw),
      target.y + distance * Math.sin(pitch),
      distance * Math.cos(pitch) * Math.cos(yaw));
    camera.lookAt(target);
    renderer.render(scene, camera);
  }
  function animate(timestamp) {
    frame = 0;
    const step = previousFrame === undefined ? 0 : Math.min(0.05, (timestamp - previousFrame) / 1000);
    previousFrame = timestamp;
    if (spin) yaw += step * 0.32;
    if (flow.visible && playing) {
      flowTime += step * playbackRate;
      moveTracers(flowTime);
    }
    render();
    schedule();
  }
  function schedule() {
    const active = onScreen && !document.hidden && (spin || (flow.visible && playing));
    if (active && !frame) frame = requestAnimationFrame(animate);
    if (!active) {
      cancelAnimationFrame(frame);
      frame = 0;
      previousFrame = undefined;
    }
  }
  function resize() {
    const { clientWidth: width, clientHeight: height } = box;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  }
  new ResizeObserver(resize).observe(box);
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    schedule();
  }).observe(box);
  document.addEventListener("visibilitychange", schedule);

  const spinButton = document.querySelector('[data-view="spin"]');
  function setSpin(enabled) {
    spin = enabled;
    spinButton.setAttribute("aria-pressed", enabled);
    schedule();
  }
  box.addEventListener("pointerdown", event => {
    if (drag || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    box.setPointerCapture(event.pointerId);
    setSpin(false);
  });
  box.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    yaw -= (event.clientX - drag.x) * 0.008;
    pitch += (event.clientY - drag.y) * 0.006;
    drag.x = event.clientX;
    drag.y = event.clientY;
    render();
  });
  box.addEventListener("lostpointercapture", () => { drag = null; });
  document.querySelectorAll("[data-view]").forEach(button => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      if (view === "spin") {
        setSpin(!spin);
        return;
      }
      [yaw, pitch] = views[view];
      setSpin(false);
      render();
    });
  });

  const toggle = document.getElementById("airflow-toggle");
  const options = document.getElementById("airflow-options");
  const pause = document.getElementById("flow-pause");
  const speed = document.getElementById("flow-speed");
  const rate = document.getElementById("flow-rate");
  function setPlaying(enabled) {
    playing = enabled;
    pause.textContent = enabled ? "Pause flow" : "Play flow";
    schedule();
  }
  toggle.addEventListener("click", () => {
    flow.visible = !flow.visible;
    toggle.setAttribute("aria-pressed", flow.visible);
    options.hidden = !flow.visible;
    if (flow.visible) {
      [yaw, pitch] = [-0.28, 0.43];
      setSpin(false);
    }
    render();
    schedule();
  });
  pause.addEventListener("click", () => setPlaying(!playing));
  speed.addEventListener("input", () => {
    playbackRate = Number(speed.value);
    rate.value = playbackRate + "×";
  });
  reducedMotion.addEventListener("change", event => {
    if (event.matches) {
      setSpin(false);
      setPlaying(false);
    }
  });

  moveTracers(flowTime);
  setPlaying(playing);
  resize();
  document.getElementById("car-views").hidden = false;
  note.textContent = "Drag to rotate";
})();

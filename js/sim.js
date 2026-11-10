/* Time attack simulator.
   A simplified model of a CO2 dragster on a 20 m track:
     thrust  = F0 · e^(−t/τ)            (assumed curve for an 8 g cartridge)
     drag    = ½ · ρ · v² · Cd · A
     rolling = μ · m · g
   Integrated in small time steps until the car has travelled 20 m. */
(function () {
  const F0 = 9.0, TAU = 0.17, RHO = 1.2, G = 9.81, TRACK = 20, DT = 0.0005;
  const $ = id => document.getElementById(id);
  const inputs = { mass: $("s-mass"), cd: $("s-cd"), area: $("s-area"), fric: $("s-fric") };
  if (!inputs.mass) return;

  function simulate() {
    const m = inputs.mass.value / 1000, cd = +inputs.cd.value, A = inputs.area.value / 1e4, mu = +inputs.fric.value;
    let t = 0, x = 0, v = 0, vmax = 0;
    const trace = [0]; // position sampled every 5 ms, for the animation
    while (x < TRACK && t < 6) {
      const force = F0 * Math.exp(-t / TAU) - 0.5 * RHO * v * v * cd * A - (v > 0 || t < 0.05 ? mu * m * G : 0);
      v = Math.max(0, v + (force / m) * DT);
      x += v * DT; t += DT;
      if (v > vmax) vmax = v;
      if (Math.round(t / DT) % 10 === 0) trace.push(Math.min(x, TRACK));
      if (v === 0 && t > 0.5) return { time: Infinity, vmax, trace };
    }
    return { time: t, vmax, trace };
  }

  const car = $("sim-car"), strip = $("strip"), lights = [...$("lights").children];
  const btn = $("sim-btn"), btnLabel = btn.querySelector("span"), msg = $("sim-msg");
  let state = "idle", goAt = 0, timers = [], best = null;
  try { best = JSON.parse(localStorage.getItem("taaero-best")); } catch (e) {}

  const fmt = s => s.toFixed(3);
  function showSetup() {
    $("o-mass").textContent = (+inputs.mass.value).toFixed(1) + " g";
    $("o-cd").textContent = (+inputs.cd.value).toFixed(2);
    $("o-area").textContent = (+inputs.area.value).toFixed(1) + " cm²";
    $("o-fric").textContent = (+inputs.fric.value).toFixed(3);
    if (state === "idle") {
      const r = simulate();
      msg.innerHTML = "Predicted track time for this setup: <b>" + (isFinite(r.time) ? fmt(r.time) + " s" : "did not finish") + "</b>" +
        (best ? " · Your best total: <b>" + fmt(best) + " s</b>" : "");
    }
  }
  Object.values(inputs).forEach(i => i.addEventListener("input", showSetup));

  function setLights(n) { lights.forEach((l, i) => l.classList.toggle("on", i < n)); }
  function placeCar(x) {
    const span = strip.clientWidth - car.clientWidth - 10;
    car.style.transform = "translateX(" + (x / TRACK) * span + "px)";
  }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function idle(text) {
    state = "idle"; clearTimers(); setLights(0); btnLabel.textContent = "Arm";
    Object.values(inputs).forEach(i => i.disabled = false);
    if (text) msg.innerHTML = text; else showSetup();
  }

  function arm() {
    state = "armed"; placeCar(0); btnLabel.textContent = "Launch";
    Object.values(inputs).forEach(i => i.disabled = true);
    msg.textContent = "Wait for the lights to go out…";
    ["r-react", "r-track", "r-total"].forEach(id => $(id).textContent = "0.000");
    for (let i = 1; i <= 5; i++) timers.push(setTimeout(() => setLights(i), i * 650));
    timers.push(setTimeout(() => { setLights(0); state = "go"; goAt = performance.now(); },
      5 * 650 + 800 + Math.random() * 1700));
  }

  function launch() {
    const reaction = (performance.now() - goAt) / 1000;
    const r = simulate();
    state = "running"; btn.disabled = true;
    $("r-react").textContent = fmt(reaction);
    $("r-speed").textContent = Math.round(r.vmax * 3.6) + " km/h";
    const start = performance.now();
    (function frame(now) {
      const t = (now - start) / 1000, i = Math.min(r.trace.length - 1, Math.floor(t / 0.005));
      placeCar(r.trace[i]);
      $("r-track").textContent = fmt(Math.min(t, isFinite(r.time) ? r.time : t));
      if (i < r.trace.length - 1) return requestAnimationFrame(frame);
      btn.disabled = false;
      if (!isFinite(r.time)) return idle("The car stopped before the finish. Try less friction or less drag.");
      const total = reaction + r.time;
      $("r-track").textContent = fmt(r.time); $("r-total").textContent = fmt(total);
      const isBest = !best || total < best;
      if (isBest) { best = total; try { localStorage.setItem("taaero-best", JSON.stringify(best)); } catch (e) {} }
      idle((isBest ? "New personal best: " : "Finished in ") + "<b>" + fmt(total) + " s</b>" +
        (isBest ? "" : " · Best: <b>" + fmt(best) + " s</b>") + ". Change the setup or go again.");
    })(start);
  }

  function press() {
    if (state === "idle") arm();
    else if (state === "armed") idle("Jump start! You launched before the lights went out. Arm and try again.");
    else if (state === "go") launch();
  }
  btn.addEventListener("click", press);
  addEventListener("keydown", e => {
    if (e.code !== "Space" || state === "idle" || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type !== "range") return;
    e.preventDefault(); press();
  });
  $("sim-reset").addEventListener("click", () => {
    best = null; try { localStorage.removeItem("taaero-best"); } catch (e) {}
    if (state === "idle") showSetup();
  });
  addEventListener("resize", () => { if (state === "idle") placeCar(0); });
  showSetup();
})();

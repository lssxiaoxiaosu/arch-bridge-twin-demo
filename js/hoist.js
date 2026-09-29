/* ==========================================================================
   hoist.js —— 斜拉扣挂缆索吊装工艺推演（程序化三维场景）
   对应《详细设计和建设方案》4.6 吊装工况与吊装顺序：
     两岸对称、先拱脚后拱顶；塔顶位移、扣索索力、节段标高随工序变化；
     拱顶设可拆卸合龙段。桥体 BIM 为成桥状态，故本视图用程序化场景表达施工过程。
   ========================================================================== */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HOIST_SEQ } from './data.js';

const SPAN = 6.2, RISE = 1.62, DECK_Y = 0.66, TOWER_H = 3.15, RIB_Z = 0.62;

const C_FUTURE = 0x2a4560, C_DONE = 0x22d3ee, C_CUR = 0xf5a524, C_TOWER = 0x6f8bab, C_CABLE = 0x8b5cf6, C_ANCHOR = 0x4c8dff;
const archY = (t) => RISE * (1 - (2 * t - 1) ** 2);
const archT = (t) => new THREE.Vector3(-SPAN / 2 + SPAN * t, archY(t), 0);

export function createHoist(container, onUpdate) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x04070f, 14, 30);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 120);
  camera.position.set(6.4, 4.1, 8.6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.5, 0); controls.enableDamping = true; controls.dampingFactor = 0.09;
  controls.minDistance = 2; controls.maxDistance = 30;

  scene.add(new THREE.HemisphereLight(0x9fd8ff, 0x0a1424, 0.7));
  const d1 = new THREE.DirectionalLight(0xffffff, 1.9); d1.position.set(6, 10, 6); scene.add(d1);
  const d2 = new THREE.DirectionalLight(0x22d3ee, 1.0); d2.position.set(-6, 3, -6); scene.add(d2);

  const grid = new THREE.GridHelper(SPAN * 3, 30, 0x22d3ee, 0x143352);
  grid.material.transparent = true; grid.material.opacity = 0.25; scene.add(grid);

  const M = {
    future: new THREE.MeshStandardMaterial({ color: C_FUTURE, metalness: 0.5, roughness: 0.55, transparent: true, opacity: 0.34 }),
    done: new THREE.MeshStandardMaterial({ color: C_DONE, metalness: 0.72, roughness: 0.28, emissive: new THREE.Color(C_DONE), emissiveIntensity: 0.22 }),
    cur: new THREE.MeshStandardMaterial({ color: C_CUR, metalness: 0.7, roughness: 0.3, emissive: new THREE.Color(C_CUR), emissiveIntensity: 0.6 }),
    tower: new THREE.MeshStandardMaterial({ color: C_TOWER, metalness: 0.6, roughness: 0.4 }),
    deck: new THREE.MeshStandardMaterial({ color: 0x3d6ea8, metalness: 0.55, roughness: 0.45 }),
    hanger: new THREE.MeshStandardMaterial({ color: 0xf5a524, metalness: 0.6, roughness: 0.35 }),
    hook: new THREE.MeshStandardMaterial({ color: 0xf43f5e, metalness: 0.6, roughness: 0.3, emissive: new THREE.Color(0xf43f5e), emissiveIntensity: 0.35 }),
  };
  const LM = {
    cable: new THREE.LineBasicMaterial({ color: C_CABLE }),
    anchor: new THREE.LineBasicMaterial({ color: C_ANCHOR }),
    main: new THREE.LineBasicMaterial({ color: 0x22d3ee }),
  };

  /* ---------------- 塔架 + 锚索 ---------------- */
  const towerTop = { L: new THREE.Vector3(), R: new THREE.Vector3() };
  [['L', -1], ['R', 1]].forEach(([side, sx]) => {
    const x = sx * (SPAN / 2 - 0.12);
    const grp = new THREE.Group();
    [-1, 1].forEach((sz) => {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.07, TOWER_H, 0.07), M.tower);
      col.position.set(x, TOWER_H / 2, sz * RIB_Z); grp.add(col);
    });
    const rungs = Math.round(TOWER_H / 0.15);
    for (let i = 1; i <= rungs; i++) {
      const y = (TOWER_H / rungs) * i;
      const rg = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, RIB_Z * 2), i % 2 ? M.tower : M.tower);
      rg.position.set(x, y, 0); grp.add(rg);
      if (i % 2 === 0) {
        const len = Math.hypot(TOWER_H / rungs, RIB_Z * 2);
        const dg = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, len), M.tower);
        dg.position.set(x, y - TOWER_H / rungs / 2, 0);
        dg.rotation.x = Math.atan2(RIB_Z * 2, TOWER_H / rungs) * (i % 4 === 0 ? 1 : -1) * 1.0;
        dg.rotation.y = Math.PI / 2;
        grp.add(dg);
      }
    }
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, RIB_Z * 2 + 0.16), M.tower);
    cap.position.set(x, TOWER_H + 0.04, 0); grp.add(cap);
    scene.add(grp);
    const top = new THREE.Vector3(x, TOWER_H + 0.08, 0);
    towerTop[side] = top;
    for (let k = 0; k < 4; k++) {
      const az = (k - 1.5) * 0.55;
      const anchor = new THREE.Vector3(x + sx * 1.75, 0.02, Math.sin(az) * 1.5);
      const g = new THREE.BufferGeometry().setFromPoints([top, anchor]);
      scene.add(new THREE.Line(g, LM.anchor));
      const blk = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.16), M.tower);
      blk.position.copy(anchor); scene.add(blk);
    }
  });

  /* ---------------- 拱肋节段 ---------------- */
  const segMeshes = new Map();   // key: rib+seg
  ['A', 'B'].forEach((rib) => {
    const z = rib === 'A' ? -RIB_Z : RIB_Z;
    for (let i = 1; i <= 22; i++) {
      const t0 = (i - 1) / 22, t1 = i / 22, tm = (t0 + t1) / 2;
      const p0 = archT(t0), p1 = archT(t1), pm = archT(tm);
      const len = p0.distanceTo(p1) * 0.9;
      const geo = new THREE.BoxGeometry(len, 0.085, 0.085);
      const mesh = new THREE.Mesh(geo, M.future);
      mesh.position.set(pm.x, pm.y, z);
      mesh.rotation.z = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      mesh.userData = { rib, seg: i, t: tm };
      scene.add(mesh);
      segMeshes.set(`${rib}${i}`, mesh);
    }
  });

  /* ---------------- 桥面系与吊杆 ---------------- */
  const deck = new THREE.Mesh(new THREE.BoxGeometry(SPAN * 0.94, 0.055, 1.15), M.deck);
  deck.position.set(0, DECK_Y, 0); deck.visible = false; scene.add(deck);
  const hangers = [];
  for (let i = 1; i <= 32; i++) {
    const t = i / 33;
    const x = -SPAN / 2 + SPAN * t;
    const top = archY(t), bot = DECK_Y;
    if (top <= bot + 0.04) continue;
    [-1, 1].forEach((sz) => {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, top - bot, 6), M.hanger);
      h.position.set(x, (top + bot) / 2, sz * RIB_Z);
      h.visible = false; scene.add(h); hangers.push(h);
    });
  }

  /* ---------------- 吊钩与扣索（动态） ---------------- */
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.16), M.hook);
  scene.add(hook);
  const hookLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), LM.main);
  scene.add(hookLine);
  const trolley = new THREE.Line(new THREE.BufferGeometry().setFromPoints([towerTop.L, towerTop.R]), LM.cable);
  scene.add(trolley);
  const stayLines = [new THREE.Line(new THREE.BufferGeometry(), LM.cable), new THREE.Line(new THREE.BufferGeometry(), LM.cable)];
  stayLines.forEach((l) => scene.add(l));

  /* ---------------- 状态推进 ---------------- */
  const st = { step: 0, playing: false, speed: 1, acc: 0, hookTarget: new THREE.Vector3(0, RISE + 0.4, 0), pulse: 0, paused: false };

  function applyStep(step) {
    st.step = Math.max(0, Math.min(HOIST_SEQ.length, step));
    const done = HOIST_SEQ.slice(0, st.step);
    const doneKeys = new Set(done.map((s) => `${s.rib}${s.seg}`));
    segMeshes.forEach((m, key) => {
      m.scale.setScalar(1);
      m.material = doneKeys.has(key) ? M.done : M.future;
    });
    const cur = HOIST_SEQ[st.step - 1];
    if (cur) {
      const m = segMeshes.get(`${cur.rib}${cur.seg}`);
      if (m) { m.material = M.cur; m.scale.setScalar(1.0); }
      st.hookTarget = archT(cur.t).setZ(cur.rib === 'A' ? -RIB_Z : RIB_Z).add(new THREE.Vector3(0, 0.42, 0));
      /* 扣索：塔顶 → 已安装节段（取两岸已装最外端各一根） */
      const sides = ['L', 'R'];
      const byRib = { L: null, R: null };
      done.forEach((s) => {
        const isLeft = s.t < 0.5;
        const key = isLeft ? 'L' : 'R';
        if (s.rib !== (cur?.rib || 'A')) return;
        if (!byRib[key] || (isLeft ? s.t < byRib[key].t : s.t > byRib[key].t)) byRib[key] = s;
      });
      stayLines.forEach((line, i) => {
        const side = sides[i];
        const anchor = byRib[side] ? archT(byRib[side].t) : new THREE.Vector3(side === 'L' ? -SPAN / 2 : SPAN / 2, archY(0.02), 0);
        anchor.z = cur ? (cur.rib === 'A' ? -RIB_Z : RIB_Z) : 0;
        line.geometry.dispose();
        line.geometry = new THREE.BufferGeometry().setFromPoints([towerTop[side], anchor]);
        line.visible = st.step > 0;
      });
      const closed = st.step >= HOIST_SEQ.length;
      deck.visible = closed;
      hangers.forEach((h) => { h.visible = closed; });
    } else {
      stayLines.forEach((l) => { l.visible = false; });
      deck.visible = false; hangers.forEach((h) => { h.visible = false; });
    }
    onUpdate?.({
      step: st.step, total: HOIST_SEQ.length, playing: st.playing,
      cur: cur || null, speed: st.speed,
      tip: cur ? cur.tip : 0, cable: cur ? cur.cable : 0, elev: cur ? cur.elev : 0,
      stage: cur ? cur.stage : 0,
    });
  }

  /* ---------------- 循环 ---------------- */
  let last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.08, (now - last) / 1000); last = now;
    if (st.playing) {
      st.acc += dt * st.speed;
      if (st.acc > 0.85) { st.acc = 0; if (st.step < HOIST_SEQ.length) applyStep(st.step + 1); else st.playing = false; }
    }
    st.pulse += dt;
    const cur = segMeshes.get(HOIST_SEQ[st.step - 1] ? `${HOIST_SEQ[st.step - 1].rib}${HOIST_SEQ[st.step - 1].seg}` : '');
    if (cur) {
      const k = 1 + 0.06 * Math.sin(st.pulse * 4);
      cur.scale.set(k, k, k);
      M.cur.emissiveIntensity = 0.45 + 0.35 * Math.abs(Math.sin(st.pulse * 3));
    }
    hook.position.lerp(st.hookTarget, 1 - Math.pow(0.0015, dt));
    hookLine.geometry.dispose();
    hookLine.geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, TOWER_H + 0.08, 0), hook.position]);
    controls.update();
    if (!st.paused) renderer.render(scene, camera);
  }
  requestAnimationFrame(loop);

  function resize() {
    const w = container.clientWidth || 800, h = container.clientHeight || 480;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(container);
  window.addEventListener('resize', resize);

  applyStep(0);

  return {
    applyStep,
    next() { applyStep(st.step + 1); },
    reset() { applyStep(0); st.playing = false; },
    play() { if (st.step >= HOIST_SEQ.length) applyStep(0); st.playing = true; applyStep(st.step); },
    pause() { st.playing = false; applyStep(st.step); },
    toggle() { st.playing ? this.pause() : this.play(); },
    setSpeed(v) { st.speed = +v; },
    isPlaying() { return st.playing; },
    setPaused(v) { st.paused = !!v; if (v) renderer.render(scene, camera); },
    total: HOIST_SEQ.length,
    resize,
    setView(kind) {
      const V = {
        all: [[6.4, 4.1, 8.6], [0, 1.5, 0]],
        side: [[0, 2.2, 11.5], [0, 1.5, 0]],
        tower: [[-5.2, 3.4, 5.6], [-SPAN / 2, 1.6, 0]],
      }[kind] || [[6.4, 4.1, 8.6], [0, 1.5, 0]];
      camera.position.set(...V[0]); controls.target.set(...V[1]); controls.update();
    },
  };
}

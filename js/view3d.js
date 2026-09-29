/* ==========================================================================
   view3d.js —— 三维数字孪生场景
   对应《详细设计和建设方案》6.2 / 6.4 / 6.5：
     · 加载平南三桥 BIM（GLB + Draco），按试验模型 1:100（跨径 6 m）归一化
     · 构件自动分类 → 图层显隐；构件级拾取 → 属性面板
     · 测点按几何反求挂接到拱肋 / 吊杆 / 桥面表面（等效方案 6.5 的测点—构件绑定）
     · 四档阈值状态着色；剖切、测量、预设视角、第一人称漫游（轨道）
   ========================================================================== */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { STATUS, TYPES, VISUAL_SENSORS, MODEL_CATS } from './data.js';

const SPAN = 6.0;          // 归一化跨径（方案：试验模型跨径约 5.2～6.0 m）
/* 显示精度：按面片预算保留贡献最大的构件（对应需求 4-5「面片数 ≤200 万时帧率 ≥30 fps」的可调策略） */
const PRECISION = { high: Infinity, standard: 12000000, smooth: 2000000 };
const PRECISION_LABEL = { high: '精细（全部构件）', standard: '标准（约 1200 万面片）', smooth: '流畅（约 200 万面片）' };
const tmpBox = new THREE.Box3();
const tmpV = new THREE.Vector3();

function glowTexture(color = '#ffffff') {
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.28, color);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function envTexture(renderer) {
  const w = 1024, h = 512, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0.00, '#050b18');
  grd.addColorStop(0.34, '#0d2b4a');
  grd.addColorStop(0.50, '#2b7fa8');
  grd.addColorStop(0.58, '#0b1e33');
  grd.addColorStop(1.00, '#04070f');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  [[0.18, 0.40, '#7dd3fc'], [0.55, 0.34, '#a78bfa'], [0.82, 0.44, '#22d3ee']].forEach(([x, y, col]) => {
    const rg = g.createRadialGradient(x * w, y * h, 0, x * w, y * h, 150);
    rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, w, h);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose(); tex.dispose();
  return env;
}

export function createTwin(container, engine, hooks = {}) {
  const state = {
    ready: false, colorMode: 'normal', wireframe: false, grid: true, perf: false,
    layers: Object.fromEntries(MODEL_CATS.map((c) => [c.key, true])),
    sensorTypes: Object.fromEntries(Object.keys(TYPES).map((k) => [k, true])),
    measure: false, measurePts: [], tween: null, selected: null,
    clipOn: false, clipVal: 100, prec: 'standard', paused: false,
  };

  /* ------------------------------------------------------------ 渲染器 */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.environment = envTexture(renderer);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
  camera.position.set(6.6, 3.6, 7.4);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 0.6; controls.maxDistance = 40;
  controls.target.set(0, 1.1, 0);

  /* 灯光：主光 + 补光 + 轮廓光，营造科技感层次 */
  scene.add(new THREE.HemisphereLight(0x9fd8ff, 0x0a1424, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(6, 9, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0x6aa8ff, 0.75); fill.position.set(-7, 4, -6); scene.add(fill);
  const rim = new THREE.DirectionalLight(0x22d3ee, 1.15); rim.position.set(-3, 2.4, 7); scene.add(rim);

  /* 网格基准 */
  const grid = new THREE.GridHelper(SPAN * 3.4, 34, 0x22d3ee, 0x143352);
  grid.material.transparent = true; grid.material.opacity = 0.28;
  scene.add(grid);

  /* 剖切面 */
  const clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), SPAN / 2);
  const clipHelpers = new THREE.Group(); clipHelpers.visible = false; scene.add(clipHelpers);

  /* 测量 */
  const measureGroup = new THREE.Group(); scene.add(measureGroup);
  const measureLabel = document.createElement('div');
  measureLabel.className = 'stage-chip mono';
  measureLabel.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:none';
  container.appendChild(measureLabel);

  const doRay = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  const meshList = [];
  const markers = [];
  const pickables = [];
  const ganttMats = new Set();
  const matVariants = new Map();     // 原材质 uuid → [4 档变体]
  const statusColor = STATUS.map((s) => new THREE.Color(s.color));
  const spriteTex = glowTexture('#ffffff');

  let root = null, gbox = new THREE.Box3(), deckY = 0.4, crownY = 1.6, ribZ = { A: -0.5, B: 0.5 };
  let ribs = { A: { xmin: -3, xmax: 3, ymin: 0, ymax: 1.5 }, B: { xmin: -3, xmax: 3, ymin: 0, ymax: 1.5 } };
  let ranked = null;

  /* ------------------------------------------------------------ 模型加载 */
  const draco = new DRACOLoader().setDecoderPath('./libs/draco/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const t0 = performance.now();

  loader.load('./model/pingnan_bridge.glb', (gltf) => {
    root = gltf.scene;
    const g = new THREE.Group();
    g.add(root);
    scene.add(g);

    /* 1) 长轴对齐 X 轴（跨径方向），并按跨径归一化 */
    root.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(root);
    let size = box.getSize(new THREE.Vector3());
    if (size.z > size.x) { g.rotation.y = Math.PI / 2; }
    g.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(g); size = box.getSize(new THREE.Vector3());
    const s = SPAN / size.x;
    g.scale.setScalar(s);
    g.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(g);
    const c = box.getCenter(new THREE.Vector3());
    g.position.set(-c.x, -box.min.y, -c.z);
    g.updateMatrixWorld(true);

    gbox = new THREE.Box3().setFromObject(g);
    const gs = gbox.getSize(new THREE.Vector3());
    const H = gs.y, D = gs.z;

    /* 2) 构件分类：以竖向中心高度直方图确定桥面标高，再按几何形态分区 */
    const all = [];
    root.traverse((o) => {
      if (o.isMesh && o.geometry) {
        const bb = new THREE.Box3().setFromObject(o);
        const sz = bb.getSize(new THREE.Vector3());
        const ct = bb.getCenter(new THREE.Vector3());
        const tris = o.geometry.index ? o.geometry.index.count / 3 : (o.geometry.attributes.position?.count || 0) / 3;
        all.push({ o, bb, sz, ct, tris });
      }
    });
    const hist = new Array(24).fill(0);
    all.forEach((m) => {
      const k = Math.max(0, Math.min(23, Math.floor((m.ct.y - gbox.min.y) / H * 24)));
      hist[k] += m.tris;
    });
    let deckBin = 0, best = -1;
    hist.forEach((v, i) => { if (i < 16 && v > best) { best = v; deckBin = i; } });
    deckY = gbox.min.y + (deckBin + 0.5) / 24 * H;

    all.forEach((m) => {
      const maxDim = Math.max(m.sz.x, m.sz.y, m.sz.z);
      const above = m.ct.y > deckY + H * 0.04;
      const vertical = m.sz.y > 1.8 * Math.max(m.sz.x, m.sz.z);
      if (maxDim < SPAN * 0.006) m.cat = 'other';
      else if (Math.abs(m.ct.y - deckY) <= H * 0.07 && m.sz.x > SPAN * 0.01) m.cat = 'deck';
      else if (above && vertical) m.cat = 'hanger';
      else if (above && (m.sz.x > SPAN * 0.05 || m.ct.y > deckY + H * 0.42)) m.cat = 'arch';
      else if (above) m.cat = 'brace';
      else m.cat = 'other';
      m.o.userData.meta = m;
    });

    /* 3) 两片拱肋的横向位置与包络（用于测点反求） */
    const archMeshes = all.filter((m) => m.cat === 'arch');
    const zs = archMeshes.map((m) => m.ct.z);
    const zMid = zs.length ? (Math.min(...zs) + Math.max(...zs)) / 2 : 0;
    ['A', 'B'].forEach((k) => {
      const sel = archMeshes.filter((m) => (k === 'A' ? m.ct.z <= zMid : m.ct.z > zMid));
      const use = sel.length ? sel : archMeshes;
      const xmin = Math.min(...use.map((m) => m.bb.min.x));
      const xmax = Math.max(...use.map((m) => m.bb.max.x));
      const ymin = Math.min(...use.map((m) => m.bb.min.y));
      const ymax = Math.max(...use.map((m) => m.bb.max.y));
      ribs[k] = { xmin, xmax, ymin, ymax };
      ribZ[k] = use.reduce((a, m) => a + m.ct.z, 0) / use.length;
    });
    crownY = Math.max(ribs.A.ymax, ribs.B.ymax);

    /* 4) 材质规整 + 生成四档状态变体 + 面片统计 */
    let tris = 0;
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (!m) return;
        if (m.metalness !== undefined && m.metalness > 0.85) m.metalness = 0.55;
        if (m.color && m.color.r + m.color.g + m.color.b < 0.12) m.color.setHex(0x93a3b8);
        m.envMapIntensity = 1.15;
        m.clippingPlanes = [clipPlane];
        m.clipShadows = true;
        ganttMats.add(m);
        if (!matVariants.has(m.uuid)) {
          const base = m.color ? m.color.clone() : new THREE.Color(0x93a3b8);
          matVariants.set(m.uuid, STATUS.map((st, i) => {
            if (i === 0) return m;
            const v = m.clone();
            v.clippingPlanes = [clipPlane];
            v.color = base.clone().lerp(statusColor[i], 0.42);
            v.emissive = statusColor[i].clone();
            v.emissiveIntensity = [0, 0.28, 0.5, 0.85][i];
            if (v.metalness !== undefined) v.metalness = Math.min(v.metalness ?? 0.4, 0.45);
            return v;
          }));
        }
      });
      o.userData.baseMat = o.material;
      o.userData.cat = o.userData.meta?.cat || 'other';
      o.geometry.computeBoundingSphere?.();
      meshList.push(o); pickables.push(o);
      tris += o.userData.meta?.tris || 0;
    });
    state.tris = Math.round(tris);

    /* 5) 测点挂接（几何反求） */
    buildMarkers();
    applyLayers();

    state.ready = true;
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
    camera.updateProjectionMatrix();
    hooks.onReady?.({
      meshes: meshList.length, tris: state.tris,
      cats: MODEL_CATS.map((c) => ({ ...c, count: all.filter((m) => m.cat === c.key).length, tris: all.filter((m) => m.cat === c.key).reduce((a, m) => a + m.tris, 0) })),
      span: SPAN, height: gs.y, width: gs.z, loadMs: Math.round(performance.now() - t0),
      deckY, crownY,
    });
  }, (ev) => {
    hooks.onProgress?.({ loaded: ev.loaded, total: ev.total || 15613516 });
  }, (err) => {
    console.error(err);
    hooks.onError?.(String(err && err.message || err));
  });

  /* ------------------------------------------------------------ 测点挂接 */
  function rayY(x, z, fromY) {
    const org = new THREE.Vector3(x, fromY, z);
    doRay.set(org, new THREE.Vector3(0, -1, 0));
    doRay.far = SPAN * 2;
    const hits = doRay.intersectObjects(meshList, false);
    return hits.length ? hits[0].point : null;
  }

  function buildMarkers() {
    VISUAL_SENSORS.forEach((s) => {
      let p = null;
      const pl = s.place;
      if (pl.kind === 'arch') {
        const r = ribs[pl.rib];
        const x = r.xmin + (r.xmax - r.xmin) * pl.t;
        const yn = rayY(x, ribZ[pl.rib], crownY + 0.6);
        const y = yn ? yn.y : r.ymin + (r.ymax - r.ymin) * (1 - (2 * pl.t - 1) ** 2);
        const off = 0.055 + (pl.offset || 0);
        const dz = [-0.005, 0.005, -0.045, 0.045][pl.face] || 0;
        p = new THREE.Vector3(x, y + (pl.face === 0 ? off : pl.face === 1 ? -off * 0.8 : 0), ribZ[pl.rib] + dz);
      } else if (pl.kind === 'deck') {
        const x = ribs.A.xmin + (ribs.A.xmax - ribs.A.xmin) * pl.x;
        const z = ribZ[pl.side === 'L' ? 'A' : 'B'];
        const hit = rayY(x, z, crownY + 1.2);
        p = new THREE.Vector3(x, (hit ? hit.y : deckY) + (pl.face === 0 ? 0.05 : -0.05), z);
      } else if (pl.kind === 'hanger') {
        const denom = 33;
        const x = ribs.A.xmin + (ribs.A.xmax - ribs.A.xmin) * (pl.idx / denom);
        const yn = rayY(x, ribZ[pl.rib], crownY + 0.6);
        const yTop = yn ? yn.y : crownY;
        p = new THREE.Vector3(x, (yTop + deckY) / 2, ribZ[pl.rib] + (pl.rib === 'A' ? -0.03 : 0.03));
      } else if (pl.kind === 'env') {
        p = new THREE.Vector3(pl.x * SPAN * 0.5, pl.hi ? crownY + 0.9 : 0.12, SPAN * 0.32);
      }
      if (!p) return;
      const mat = new THREE.SpriteMaterial({ map: spriteTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const sp = new THREE.Sprite(mat);
      sp.position.copy(p);
      sp.scale.setScalar(0.075);
      sp.userData.sensor = s;
      sp.userData.isMarker = true;
      scene.add(sp);
      markers.push(sp);
      pickables.push(sp);
      s._pos = p;
    });
  }

  /* ------------------------------------------------------------ 状态刷新 */
  function statusOfMesh(m) {
    const cat = m.userData.cat;
    let worst = 0;
    if (cat === 'arch' || cat === 'hanger') {
      const z = m.userData.meta?.ct.x ?? 0;
      const zn = (z - ribs.A.xmin) / Math.max(0.001, ribs.A.xmax - ribs.A.xmin);
      VISUAL_SENSORS.forEach((s) => {
        if (s.type !== 'SG' || s.rib === '-') return;
        if (s.place?.kind === 'arch' && Math.abs(s.place.t - zn) < 0.09 && s.status > worst) worst = s.status;
        if (s.place?.kind === 'hanger' && cat === 'hanger' && Math.abs(s.place.idx / 33 - zn) < 0.05 && s.status > worst) worst = s.status;
      });
    } else if (cat === 'deck') {
      VISUAL_SENSORS.forEach((s) => { if (s.place?.kind === 'deck' && s.status > worst) worst = s.status; });
    }
    return worst;
  }

  function applyColors() {
    meshList.forEach((m) => {
      const mats = Array.isArray(m.userData.baseMat) ? m.userData.baseMat : [m.userData.baseMat];
      if (state.colorMode === 'normal' || !state.layers[m.userData.cat]) {
        if (m.material !== m.userData.baseMat) m.material = m.userData.baseMat;
        return;
      }
      const lv = statusOfMesh(m);
      const next = Array.isArray(m.userData.baseMat)
        ? m.userData.baseMat.map((mm) => (matVariants.get(mm.uuid) || [mm])[lv])
        : (matVariants.get(m.userData.baseMat.uuid) || [m.userData.baseMat])[lv];
      m.material = next;
      void mats;
    });
  }

  function applyMarkers() {
    markers.forEach((sp) => {
      const s = sp.userData.sensor;
      const on = state.sensorTypes[s.type] && state.layers[(s.place?.kind === 'deck') ? 'deck' : (s.place?.kind === 'hanger' ? 'hanger' : 'arch')] !== false;
      sp.visible = on;
      const c = STATUS[s.status || 0].color;
      sp.material.color.set(c);
      const pulse = s.status >= 2 ? 0.085 + 0.03 * (1 + Math.sin(performance.now() / 160)) : 0.072;
      sp.scale.setScalar(pulse);
    });
  }

  function applyLayers() {
    const budget = PRECISION[state.prec] ?? 12000000;
    let keep = null;
    if (budget !== Infinity) {
      if (!ranked || ranked.length !== meshList.length) {
        ranked = meshList.slice().sort((a, b) => (b.userData.meta?.tris || 0) - (a.userData.meta?.tris || 0));
      }
      keep = new Set();
      let acc = 0;
      for (const m of ranked) {
        if (acc >= budget) break;
        keep.add(m); acc += m.userData.meta?.tris || 0;
      }
    }
    let tris = 0, draws = 0;
    meshList.forEach((m) => {
      const t = m.userData.meta?.tris || 0;
      const vis = state.layers[m.userData.cat] !== false && (!keep || keep.has(m));
      m.visible = vis;
      if (vis) { tris += t; draws++; }
    });
    applyColors();
    applyMarkers();
    state.visibleTris = Math.round(tris);
    state.visibleDraws = draws;
  }

  /* ------------------------------------------------------------ 交互 */
  function pointer(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  function pickAt(e) {
    pointer(e);
    doRay.setFromCamera(ptr, camera);
    doRay.far = 200;
    const hits = doRay.intersectObjects(pickables.filter((o) => o.visible), false);
    return hits[0] || null;
  }

  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!state.ready) return;
    const hit = pickAt(e);
    if (hit?.object.userData.isMarker) {
      const s = hit.object.userData.sensor;
      hooks.onHover?.({ x: e.clientX, y: e.clientY, html: `<b>${s.code}</b><br>${s.pos}<br>${TYPES[s.type].name} ${fmt(s)}` });
      renderer.domElement.style.cursor = 'pointer';
    } else if (hit) {
      const m = hit.object.userData.meta;
      hooks.onHover?.({
        x: e.clientX, y: e.clientY,
        html: `<b>${MODEL_CATS.find((c) => c.key === m.cat)?.name || '构件'}</b><br>包络 ${m.sz.x.toFixed(2)}×${m.sz.y.toFixed(2)}×${m.sz.z.toFixed(2)} m<br>面片 ${Math.round(m.tris).toLocaleString()}`,
      });
      renderer.domElement.style.cursor = 'crosshair';
    } else {
      hooks.onHover?.(null);
      renderer.domElement.style.cursor = state.measure ? 'crosshair' : 'grab';
    }
  });

  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (!state.ready) return;
    const hit = pickAt(e);
    if (state.measure) {
      if (!hit) return;
      state.measurePts.push(hit.point.clone());
      if (state.measurePts.length === 2) {
        const [a, b] = state.measurePts;
        const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x22d3ee }));
        measureGroup.add(line);
        [[a, 0x22d3ee], [b, 0xf43f5e]].forEach(([p, col]) => {
          const d = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), new THREE.MeshBasicMaterial({ color: col }));
          d.position.copy(p); measureGroup.add(d);
        });
        const dist = a.distanceTo(b);
        hooks.toast?.(`测量结果：${dist.toFixed(3)} m（模型归一化尺寸，对应原型 ${(dist * 100).toFixed(2)} m）`);
        state.measurePts = [];
      }
      return;
    }
    if (!hit) { hooks.onSelect?.(null); return; }
    if (hit.object.userData.isMarker) {
      const s = hit.object.userData.sensor;
      state.selected = s;
      hooks.onSelect?.({ kind: 'sensor', sensor: s });
      focus(s._pos, 1.6);
    } else {
      const m = hit.object.userData.meta;
      state.selected = m;
      hooks.onSelect?.({
        kind: 'mesh', cat: m.cat, size: m.sz, center: m.ct, tris: m.tris,
        mat: (Array.isArray(hit.object.material) ? hit.object.material[0] : hit.object.material)?.name || '默认材质',
        nearest: nearestSensor(m.ct),
      });
    }
  });

  function nearestSensor(p) {
    let best = null, bd = 1e9;
    VISUAL_SENSORS.forEach((s) => { if (!s._pos) return; const d = s._pos.distanceTo(p); if (d < bd) { bd = d; best = s; } });
    return best ? { sensor: best, dist: bd } : null;
  }

  function fmt(s) {
    const t = TYPES[s.type];
    return `${(s.value ?? 0).toFixed(t.decimals)} ${t.unit}`;
  }

  /* ------------------------------------------------------------ 相机 */
  const VIEWS = () => ({
    all:   [[SPAN * 1.15, SPAN * 0.62, SPAN * 1.28], [0, crownY * 0.5, 0]],
    side:  [[0, crownY * 0.62, SPAN * 1.95], [0, crownY * 0.5, 0]],
    top:   [[0.001, SPAN * 2.1, 0.001], [0, 0, 0]],
    crown: [[0, crownY + 0.9, SPAN * 0.72], [0, crownY * 0.85, 0]],
    deck:  [[0, deckY + 0.75, SPAN * 0.55], [0, deckY + 0.1, 0]],
    foot:  [[-SPAN * 0.62, 1.35, SPAN * 0.55], [-SPAN * 0.42, 0.55, 0]],
  });

  function setCamera(kind, instant) {
    const v = VIEWS()[kind]; if (!v) return;
    const [pos, tgt] = v;
    if (instant) {
      camera.position.set(...pos); controls.target.set(...tgt); controls.update(); return;
    }
    state.tween = { t: 0, p0: camera.position.clone(), p1: new THREE.Vector3(...pos), t0: controls.target.clone(), t1: new THREE.Vector3(...tgt) };
  }

  function focus(p, dist = 1.8) {
    if (!p) return;
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    state.tween = { t: 0, p0: camera.position.clone(), p1: p.clone().addScaledVector(dir, dist), t0: controls.target.clone(), t1: p.clone() };
  }

  /* ------------------------------------------------------------ 主循环 */
  let last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 0;
  function loop(now) {
    if (state.stopped) return;
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;

    if (state.tween) {
      state.tween.t = Math.min(1, state.tween.t + dt / 0.7);
      const k = 1 - Math.pow(1 - state.tween.t, 3);
      camera.position.lerpVectors(state.tween.p0, state.tween.p1, k);
      controls.target.lerpVectors(state.tween.t0, state.tween.t1, k);
      if (state.tween.t >= 1) state.tween = null;
    }
    controls.autoRotate = state.autoRotate === true;
    controls.autoRotateSpeed = 0.6;
    controls.update();

    if (state.ready && !state.paused) {
      applyMarkers();
      if (state.colorMode === 'status') applyColors();
      renderer.render(scene, camera);
      fpsAcc += dt; fpsN++;
      if (fpsAcc > 0.5) {
        fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0;
        hooks.onStats?.({ fps, tris: state.visibleTris ?? state.tris, total: state.tris, draws: state.visibleDraws ?? 0 });
      }
    }
  }
  requestAnimationFrame(loop);

  /* ------------------------------------------------------------ 尺寸 */
  function resize() {
    const w = container.clientWidth || 800, h = container.clientHeight || 480;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(container);
  window.addEventListener('resize', resize);

  /* ------------------------------------------------------------ API */
  return {
    state, scene, camera, renderer,
    setLayer(k, v) { state.layers[k] = v; applyLayers(); },
    setSensorType(k, v) { state.sensorTypes[k] = v; applyMarkers(); },
    setColorMode(m) { state.colorMode = m; applyColors(); },
    setPrecision(k) { state.prec = k; applyLayers(); return { tris: state.visibleTris, draws: state.visibleDraws, label: PRECISION_LABEL[k] }; },
    setWireframe(v) { state.wireframe = v; ganttMats.forEach((m) => { m.wireframe = v; }); matVariants.forEach((arr) => arr.forEach((m) => { m.wireframe = v; })); },
    setAutoRotate(v) { state.autoRotate = v; },
    setGrid(v) { grid.visible = v; },
    setPerf(v) { state.prec = v ? 'standard' : 'high'; applyLayers(); },
    setClip(pct) {
      state.clipVal = pct;
      state.clipOn = pct < 100;
      const x0 = ribs.A.xmin - 0.2, x1 = ribs.A.xmax + 0.2;
      clipPlane.constant = x0 + (x1 - x0) * (pct / 100);
      clipHelpers.visible = false;
    },
    setMeasure(v) {
      state.measure = v; state.measurePts = [];
      if (!v) { measureGroup.clear(); }
    },
    clearMeasure() { state.measurePts = []; measureGroup.clear(); },
    setCamera, focus,
    /* 暂停/恢复渲染：用于截图、投影演示或降低无意义功耗 */
    setPaused(v) { state.paused = !!v; if (!v) { last = performance.now(); } else { renderer.render(scene, camera); } },
    stop() { state.paused = true; renderer.render(scene, camera); state.stopped = true; },
    start() { if (state.stopped) { state.stopped = false; state.paused = false; last = performance.now(); requestAnimationFrame(loop); } },
    renderOnce() { renderer.render(scene, camera); },
    resetCamera() { setCamera('all'); },
    stats() { return { fps, tris: state.visibleTris ?? state.tris, total: state.tris, draws: state.visibleDraws ?? 0 }; },
  };
}

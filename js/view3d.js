/* ==========================================================================
   view3d.js —— 三维数字孪生场景（v2 · 修复版）
   对应《详细设计和建设方案》6.2 / 6.4 / 6.5
   v2 修复记录：
     ① 归一化改用"剔除退化图元后的稳健包围盒"——原模型含 12 个 CAD 线段实体
        （尺寸 2072×0×0、面片数 1），会把包围盒从 7 219 撑到 339 363（47 倍），
        导致桥体被压小、偏移、对不上焦。
     ② 测点挂接不再对全模型做 130 次射线求交（5115 个构件 × 5073 万面片会让主线程
        冻结数十秒到数分钟，表现为"加载卡死/页面崩溃"），改为按实测包络解析求点。
     ③ 拾取不再用三角形级射线求交（鼠标每移动一次就卡住），改为包围盒拾取 + 节流。
     ④ 状态着色不再对每个构件遍历全部测点（5115×130 ≈ 67 万次/帧），改为分区预计算。
     ⑤ 显示精度改为"按尺寸剔除微小零件"，并新增帧率看门狗自动降级。
     ⑥ 新增 WebGL 上下文丢失/恢复处理。
   ========================================================================== */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { STATUS, TYPES, VISUAL_SENSORS, MODEL_CATS } from './data.js';

const SPAN = 6.0;                 // 归一化跨径（试验模型约 5.2～6.0 m）
const MIN_TRIS = 4;               // 面片数低于此值视为退化图元（CAD 线段/标注），永久隐藏
/* 显示精度：按"构件最大尺寸 / 跨度"剔除零件。阈值由本模型实测取舍曲线确定（页面内可复核）：
   全部 5115 件 / 5073 万面片 →  1% 跨度 1071 件 / 791 万 →  4% 跨度 153 件 / 144 万 */
const PRECISION = { high: 0, standard: 0.01, smooth: 0.04 };
const PRECISION_LABEL = {
  high: '精细（全部 5115 个构件 / 5073 万面片，建议独显）',
  standard: '标准（约 1071 个构件 / 791 万面片）',
  smooth: '流畅（约 153 个构件 / 144 万面片，≤200 万，对齐需求 4-5）',
};
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
  grd.addColorStop(0.00, '#050b18'); grd.addColorStop(0.34, '#0d2b4a');
  grd.addColorStop(0.50, '#2b7fa8'); grd.addColorStop(0.58, '#0b1e33');
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
    ready: false, colorMode: 'normal', wireframe: false, grid: true,
    layers: Object.fromEntries(MODEL_CATS.map((c) => [c.key, true])),
    sensorTypes: Object.fromEntries(Object.keys(TYPES).map((k) => [k, true])),
    measure: false, measurePts: [], tween: null, selected: null,
    clipOn: false, clipVal: 100, prec: 'standard', paused: false, stopped: false,
    visibleTris: 0, visibleDraws: 0, degenerate: 0, totalTris: 0,
  };

  /* ------------------------------------------------------------ 渲染器 */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);

  /* ⑥ WebGL 上下文丢失 / 恢复：低端 GPU 渲染大模型时可能触发，
        不做处理会表现为"模型突然消失 + 页面卡死" */
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    state.contextLost = true;
    hooks.onContextLost?.();
  }, false);
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    state.contextLost = false;
    applyLayers();
    hooks.onContextRestored?.();
  }, false);

  const scene = new THREE.Scene();
  scene.environment = envTexture(renderer);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 400);
  camera.position.set(4.3, 2.4, 4.8);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 0.6; controls.maxDistance = 60;
  controls.target.set(0, 1.1, 0);

  scene.add(new THREE.HemisphereLight(0xbfe4ff, 0x0a1424, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(6, 9, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0x7ab6ff, 0.9); fill.position.set(-7, 4, -6); scene.add(fill);
  const rim = new THREE.DirectionalLight(0x22d3ee, 1.3); rim.position.set(-3, 2.4, 7); scene.add(rim);

  const grid = new THREE.GridHelper(SPAN * 1.35, 18, 0x22d3ee, 0x143352);
  grid.material.transparent = true; grid.material.opacity = 0.18;
  scene.add(grid);

  const clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), SPAN / 2);
  const measureGroup = new THREE.Group(); scene.add(measureGroup);

  const doRay = new THREE.Raycaster();
  const ray = new THREE.Ray();
  const ptr = new THREE.Vector2();
  const markers = [];
  const meshList = [];             // 有效构件（tris >= MIN_TRIS）
  const markerList = [];           // 精灵测点
  const matVariants = new Map();
  const allMats = new Set();
  const statusColor = STATUS.map((s) => new THREE.Color(s.color));
  const spriteTex = glowTexture('#ffffff');

  let root = null, gbox = new THREE.Box3(), deckY = 0.4, crownY = 1.6;
  const ribZ = { A: -0.5, B: 0.5 };
  const ribs = { A: { xmin: -3, xmax: 3, ymin: 0, ymax: 1.5 }, B: { xmin: -3, xmax: 3, ymin: 0, ymax: 1.5 } };
  let envelope = [];               // [{x, yTop, yBot}]
  let spanX = [-3, 3], heightH = 1.5;
  const zoneStatus = new Array(12).fill(0);

  /* ------------------------------------------------------------ 工具 */
  function unionBox(list) {
    const b = new THREE.Box3();
    b.makeEmpty();
    for (const m of list) { tmpBox.setFromObject(m); b.union(tmpBox); }
    return b;
  }

  /* ------------------------------------------------------------ 模型加载 */
  const draco = new DRACOLoader().setDecoderPath('./libs/draco/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const t0 = performance.now();

  loader.load('./model/pingnan_bridge.glb', (gltf) => {
    try {
      build(gltf);
    } catch (e) {
      console.error(e);
      hooks.onError?.(String(e && e.stack || e));
    }
  }, (ev) => {
    hooks.onProgress?.({ loaded: ev.loaded, total: ev.total || 15613516 });
  }, (err) => {
    console.error(err);
    hooks.onError?.(String(err && err.message || err));
  });

  function build(gltf) {
    root = gltf.scene;
    const g = new THREE.Group();
    g.add(root);
    scene.add(g);

    /* 1) 收集构件，剔除退化图元（CAD 线段/标注：面片数极少且形状退化） */
    const items = [];
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const tris = o.geometry.index ? o.geometry.index.count / 3 : (o.geometry.attributes.position?.count || 0) / 3;
      const degenerate = tris < MIN_TRIS;
      items.push({ o, tris, degenerate });
    });
    const valid = items.filter((it) => !it.degenerate);
    state.degenerate = items.length - valid.length;

    /* 2) 稳健归一化：只用有效构件算包围盒 */
    root.updateMatrixWorld(true);
    let box = unionBox(valid.map((it) => it.o));
    let size = box.getSize(new THREE.Vector3());
    if (size.z > size.x) g.rotation.y = Math.PI / 2;          // 长轴（跨径）对齐 X
    g.updateMatrixWorld(true);
    box = unionBox(valid.map((it) => it.o));
    size = box.getSize(new THREE.Vector3());
    g.scale.setScalar(SPAN / Math.max(1e-6, size.x));
    g.updateMatrixWorld(true);
    box = unionBox(valid.map((it) => it.o));
    const c = box.getCenter(new THREE.Vector3());
    g.position.set(g.position.x - c.x, g.position.y - box.min.y, g.position.z - c.z);
    g.updateMatrixWorld(true);

    gbox = unionBox(valid.map((it) => it.o));
    const gs = gbox.getSize(new THREE.Vector3());
    const H = gs.y;
    heightH = H;
    spanX = [gbox.min.x, gbox.max.x];
    if (H <= 0 || gs.x <= 0) throw new Error('模型包围盒异常，无法归一化');

    /* 3) 每个构件的世界包围盒 + 面片数 + 分区 */
    const all = [];
    valid.forEach((it) => {
      const bb = new THREE.Box3().setFromObject(it.o);
      const sz = bb.getSize(new THREE.Vector3());
      const ct = bb.getCenter(new THREE.Vector3());
      const maxDim = Math.max(sz.x, sz.y, sz.z);
      const xn = (ct.x - gbox.min.x) / Math.max(1e-6, gs.x);
      all.push({ o: it.o, bb, sz, ct, tris: it.tris, maxDim, zone: Math.max(0, Math.min(11, Math.floor(xn * 12))) });
      it.o.userData.meta = all[all.length - 1];
    });
    items.filter((it) => it.degenerate).forEach((it) => {
      it.o.visible = false;
      it.o.userData.degenerate = true;
    });

    /* 4) 桥面标高：用"构件数量"直方图（下半部）而不是面片，避免被局部细节带偏 */
    const BINS = 24;
    const cnt = new Array(BINS).fill(0);
    all.forEach((m) => { cnt[Math.max(0, Math.min(BINS - 1, Math.floor((m.ct.y - gbox.min.y) / H * BINS)))] += 1; });
    let deckBin = -1, best = -1;
    for (let i = 0; i < Math.floor(BINS * 0.78); i++) if (cnt[i] > best) { best = cnt[i]; deckBin = i; }
    deckY = gbox.min.y + ((deckBin < 0 ? 11 : deckBin) + 0.5) / BINS * H;

    /* 5) 实测上/下包络（32 箱）：用于构件分类、测点解析挂接与拱顶标高 */
    const NX = 32;
    const env = Array.from({ length: NX }, () => ({ top: -Infinity, bot: Infinity }));
    all.forEach((m) => {
      const i0 = Math.max(0, Math.min(NX - 1, Math.floor((m.bb.min.x - gbox.min.x) / gs.x * NX)));
      const i1 = Math.max(0, Math.min(NX - 1, Math.floor((m.bb.max.x - gbox.min.x) / gs.x * NX)));
      for (let i = i0; i <= i1; i++) {
        env[i].top = Math.max(env[i].top, m.bb.max.y);
        env[i].bot = Math.min(env[i].bot, m.bb.min.y);
      }
    });
    envelope = env.map((e, i) => ({
      x: gbox.min.x + (i + 0.5) / NX * gs.x,
      yTop: isFinite(e.top) ? e.top : gbox.max.y,
      yBot: isFinite(e.bot) ? e.bot : gbox.min.y,
    }));
    crownY = Math.max(...envelope.map((e) => e.yTop));

    /* 6) 构件分类：拱肋按"实测上包络带"识别（中承式拱桥的下半拱在桥面以下，
          只按"高于桥面"判断会把下半个拱肋误分到其他构件） */
    const envTopOf = (x) => {
      const t = (x - gbox.min.x) / Math.max(1e-6, gs.x);
      const i = Math.max(0, Math.min(NX - 1, Math.floor(t * NX)));
      const e = env[i];
      return isFinite(e.top) ? e.top : gbox.max.y;
    };
    all.forEach((m) => {
      const vertical = m.sz.y > 1.8 * Math.max(m.sz.x, m.sz.z);
      const nearDeck = Math.abs(m.ct.y - deckY) <= H * 0.06;
      const nearArchBand = Math.abs(envTopOf(m.ct.x) - m.ct.y) < H * 0.26;
      if (m.maxDim < SPAN * 0.006) m.cat = 'other';
      else if (nearDeck && !vertical) m.cat = 'deck';
      else if (vertical && m.ct.y > deckY && m.sz.y > H * 0.05) m.cat = 'hanger';
      else if (nearArchBand) m.cat = m.maxDim < SPAN * 0.010 ? 'brace' : 'arch';
      else if (m.ct.y > deckY - H * 0.03) m.cat = 'brace';
      else m.cat = 'other';
    });

    /* 7) 两片拱肋的横向位置：取上半部构件的 z 中心，按中位数分两簇 */
    const upper = all.filter((m) => m.ct.y > deckY + H * 0.25);
    if (upper.length) {
      const zs = upper.map((m) => m.ct.z).sort((a, b) => a - b);
      const mid = zs[Math.floor(zs.length / 2)];
      const lo = upper.filter((m) => m.ct.z <= mid), hi = upper.filter((m) => m.ct.z > mid);
      if (lo.length) ribZ.A = lo.reduce((a, m) => a + m.ct.z, 0) / lo.length;
      if (hi.length) ribZ.B = hi.reduce((a, m) => a + m.ct.z, 0) / hi.length;
    }

    /* 8) 材质规整 + 四档状态变体 */
    let tris = 0;
    all.forEach((m) => {
      const o = m.o;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((mm2) => {
        if (!mm2) return;
        if (mm2.metalness !== undefined && mm2.metalness > 0.85) mm2.metalness = 0.55;
        if (mm2.color && mm2.color.r + mm2.color.g + mm2.color.b < 0.12) mm2.color.setHex(0x93a3b8);
        mm2.envMapIntensity = 1.25;
        mm2.clippingPlanes = [clipPlane];
        allMats.add(mm2);
        if (!matVariants.has(mm2.uuid)) {
          const base = mm2.color ? mm2.color.clone() : new THREE.Color(0x93a3b8);
          matVariants.set(mm2.uuid, STATUS.map((st, i) => {
            if (i === 0) return mm2;
            const v = mm2.clone();
            v.clippingPlanes = [clipPlane];
            v.color = base.clone().lerp(statusColor[i], 0.45);
            v.emissive = statusColor[i].clone();
            v.emissiveIntensity = [0, 0.3, 0.55, 0.9][i];
            if (v.metalness !== undefined) v.metalness = Math.min(v.metalness ?? 0.4, 0.45);
            return v;
          }));
        }
      });
      o.userData.baseMat = o.material;
      o.userData.cat = m.cat;
      meshList.push(o);
      tris += m.tris;
    });
    state.totalTris = Math.round(tris);

    /* 9) 测点解析挂接（无射线求交） */
    buildMarkers();

    state.ready = true;
    applyLayers();
    resize();

    const cats = MODEL_CATS.map((k) => {
      const sel = all.filter((m) => m.cat === k.key);
      return { ...k, count: sel.length, tris: sel.reduce((a, m) => a + m.tris, 0) };
    });
    hooks.onReady?.({
      meshes: meshList.length, degenerate: state.degenerate, tris: state.totalTris,
      cats, span: SPAN, height: gs.y, width: gs.z,
      deckY, crownY, loadMs: Math.round(performance.now() - t0),
      envelope, zones: 12,
      dbg: (() => {
        const dims = all.map((m) => m.maxDim).sort((a, b) => a - b);
        const q = (p) => dims[Math.min(dims.length - 1, Math.floor(dims.length * p))];
        const count = (thr) => all.filter((m) => m.maxDim >= thr * SPAN).length;
        return `跨度${gs.x.toFixed(2)} 高${gs.y.toFixed(2)} 宽${gs.z.toFixed(2)} | maxDim 中位${q(0.5).toFixed(4)} p90 ${q(0.9).toFixed(4)} 最大${dims[dims.length - 1].toFixed(4)} | 通过件数 标准${count(PRECISION.standard)} 流畅${count(PRECISION.smooth)}`;
      })(),
    });
  }

  /* ------------------------------------------------------------ 测点挂接（解析法） */
  function envTopAt(x) {
    if (!envelope.length) return crownY;
    const t = (x - spanX[0]) / Math.max(1e-6, spanX[1] - spanX[0]);
    const i = Math.max(0, Math.min(envelope.length - 1, Math.floor(t * envelope.length)));
    return envelope[i].yTop;
  }

  function buildMarkers() {
    const H = heightH;
    const off = Math.max(H * 0.05, SPAN * 0.008);        // 表面偏移
    const thick = Math.max(H * 0.10, SPAN * 0.012);      // 拱肋等效厚度
    const zoff = Math.max(Math.abs(ribZ.B - ribZ.A) * 0.10, SPAN * 0.008);
    VISUAL_SENSORS.forEach((s) => {
      const pl = s.place;
      let p = null;
      if (pl.kind === 'arch') {
        const z = ribZ[pl.rib] ?? 0;
        const x = spanX[0] + (spanX[1] - spanX[0]) * pl.t;
        const yTop = envTopAt(x);
        const face = pl.face;
        const y = face === 0 ? yTop - off * 0.4
          : face === 1 ? yTop - thick
            : yTop - thick * 0.5;
        const dz = face === 2 ? -zoff : face === 3 ? zoff : 0;
        p = new THREE.Vector3(x, y + (pl.offset || 0) * 0.1, z + dz);
      } else if (pl.kind === 'deck') {
        const x = spanX[0] + (spanX[1] - spanX[0]) * pl.x;
        const z = ribZ[pl.side === 'L' ? 'A' : 'B'] ?? 0;
        p = new THREE.Vector3(x, deckY + (pl.face === 0 ? off * 0.5 : -off * 0.5), z);
      } else if (pl.kind === 'hanger') {
        const x = spanX[0] + (spanX[1] - spanX[0]) * (pl.idx / 33);
        const yTop = envTopAt(x);
        const y = yTop - (yTop - deckY) * 0.45;
        p = new THREE.Vector3(x, y, (ribZ[pl.rib] ?? 0) + (pl.rib === 'A' ? -zoff * 0.4 : zoff * 0.4));
      } else if (pl.kind === 'env') {
        p = new THREE.Vector3(pl.x * SPAN * 0.5, pl.hi ? crownY + H * 0.25 : heightH * 0.06, SPAN * 0.30);
      }
      if (!p) return;
      const mat = new THREE.SpriteMaterial({
        map: spriteTex, color: 0xffffff, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, sizeAttenuation: true,
      });
      const sp = new THREE.Sprite(mat);
      sp.position.copy(p);
      sp.scale.setScalar(0.075);
      sp.userData.sensor = s;
      sp.userData.isMarker = true;
      scene.add(sp);
      markers.push(sp);
      markerList.push(sp);
      s._pos = p;
    });
  }

  /* ------------------------------------------------------------ 可见性与着色 */
  function applyLayers() {
    const thr = (PRECISION[state.prec] ?? 0) * SPAN;
    let tris = 0, draws = 0;
    meshList.forEach((m) => {
      const mt = m.userData.meta;
      const vis = state.layers[m.userData.cat] !== false && mt.maxDim >= thr;
      m.visible = vis;
      if (vis) { tris += mt.tris; draws++; }
    });
    applyColors();
    applyMarkers();
    state.visibleTris = Math.round(tris);
    state.visibleDraws = draws;
  }

  /* ④ 状态着色：分区预计算后 O(1) 查表 */
  function refreshZoneStatus() {
    const zones = zoneStatus.length;
    for (let i = 0; i < zones; i++) zoneStatus[i] = 0;
    VISUAL_SENSORS.forEach((s) => {
      if (s.type !== 'SG' || !s.place) return;
      let z = 0;
      if (s.place.kind === 'arch' || s.place.kind === 'deck') z = Math.max(0, Math.min(zones - 1, Math.floor(s.place.t * zones)));
      else if (s.place.kind === 'hanger') z = Math.max(0, Math.min(zones - 1, Math.floor(s.place.idx / 33 * zones)));
      else return;
      if ((s.status || 0) > zoneStatus[z]) zoneStatus[z] = s.status || 0;
    });
  }

  function applyColors() {
    if (state.colorMode !== 'status') {
      meshList.forEach((m) => { if (m.material !== m.userData.baseMat) m.material = m.userData.baseMat; });
      return;
    }
    meshList.forEach((m) => {
      const mt = m.userData.meta;
      if (!mt) return;
      const lv = zoneStatus[Math.max(0, Math.min(zoneStatus.length - 1, mt.zone))] | 0;
      const base = m.userData.baseMat;
      m.material = Array.isArray(base)
        ? base.map((b) => (matVariants.get(b.uuid) || [b])[lv])
        : (matVariants.get(base.uuid) || [base])[lv];
    });
  }

  function applyMarkers() {
    const now = performance.now();
    for (let i = 0; i < markers.length; i++) {
      const sp = markers[i];
      const s = sp.userData.sensor;
      const kind = s.place?.kind;
      const layerOk = kind === 'deck' ? state.layers.deck !== false
        : kind === 'hanger' ? state.layers.hanger !== false
          : kind === 'arch' ? state.layers.arch !== false : true;
      sp.visible = state.sensorTypes[s.type] !== false && layerOk;
      if (!sp.visible) continue;
      const st = s.status || 0;
      sp.material.color.set(STATUS[st].color);
      sp.scale.setScalar(st >= 2 ? 0.085 + 0.03 * (1 + Math.sin(now / 160)) : 0.072);
    }
  }

  /* ------------------------------------------------------------ 拾取（包围盒法） */
  function setPointer(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  function pickMesh() {
    ray.setFromCamera(ptr, camera);
    let hitM = null, hitD = Infinity, hitPoint = null;
    for (let i = 0; i < meshList.length; i++) {
      const m = meshList[i];
      if (!m.visible) continue;
      const bb = m.userData.meta.bb;
      const p = ray.intersectBox(bb, tmpV);
      if (p) {
        const d = p.distanceTo(ray.origin);
        if (d < hitD) { hitD = d; hitM = m; hitPoint = p.clone(); }
      }
    }
    return hitM ? { mesh: hitM, point: hitPoint } : null;
  }

  function pickMarker() {
    doRay.setFromCamera(ptr, camera);
    doRay.far = 400;
    const hits = doRay.intersectObjects(markers.filter((s) => s.visible), false);
    return hits.length ? hits[0] : null;
  }

  let lastHover = 0;
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!state.ready || state.contextLost) return;
    const now = performance.now();
    if (now - lastHover < 90) return;                 // ③ 节流，避免鼠标移动就卡顿
    lastHover = now;
    setPointer(e);
    const mk = pickMarker();
    if (mk) {
      const s = mk.object.userData.sensor;
      hooks.onHover?.({ x: e.clientX, y: e.clientY, html: `<b>${s.code}</b><br>${s.pos}<br>${TYPES[s.type].name} ${fmt(s)}` });
      renderer.domElement.style.cursor = 'pointer';
      return;
    }
    const hit = pickMesh();
    if (hit) {
      const mt = hit.mesh.userData.meta;
      hooks.onHover?.({
        x: e.clientX, y: e.clientY,
        html: `<b>${MODEL_CATS.find((cc) => cc.key === mt.cat)?.name || '构件'}</b><br>包络 ${mt.sz.x.toFixed(2)}×${mt.sz.y.toFixed(2)}×${mt.sz.z.toFixed(2)} m<br>面片 ${Math.round(mt.tris).toLocaleString()}`,
      });
      renderer.domElement.style.cursor = 'crosshair';
      return;
    }
    hooks.onHover?.(null);
    renderer.domElement.style.cursor = state.measure ? 'crosshair' : 'grab';
  });

  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (!state.ready || state.contextLost) return;
    setPointer(e);
    if (state.measure) {
      const hit = pickMesh();
      if (!hit) return;
      state.measurePts.push(hit.point.clone());
      if (state.measurePts.length === 2) {
        const [a, b] = state.measurePts;
        measureGroup.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([a, b]),
          new THREE.LineBasicMaterial({ color: 0x22d3ee })));
        [[a, 0x22d3ee], [b, 0xf43f5e]].forEach(([p, col]) => {
          const d = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), new THREE.MeshBasicMaterial({ color: col }));
          d.position.copy(p); measureGroup.add(d);
        });
        const dist = a.distanceTo(b);
        hooks.toast?.(`测量结果：${dist.toFixed(3)} m（模型归一化尺寸，按 1:100 对应原型 ${(dist * 100).toFixed(2)} m）`);
        state.measurePts = [];
      }
      return;
    }
    const mk = pickMarker();
    if (mk) {
      const s = mk.object.userData.sensor;
      state.selected = s;
      hooks.onSelect?.({ kind: 'sensor', sensor: s });
      focus(s._pos, 1.6);
      return;
    }
    const hit = pickMesh();
    if (!hit) { hooks.onSelect?.(null); return; }
    const mt = hit.mesh.userData.meta;
    const mat = Array.isArray(hit.mesh.material) ? hit.mesh.material[0] : hit.mesh.material;
    hooks.onSelect?.({
      kind: 'mesh', cat: mt.cat, size: mt.sz, center: mt.ct, tris: mt.tris,
      mat: mat?.name || '默认材质', nearest: nearestSensor(mt.ct),
    });
  });

  function nearestSensor(p) {
    let best = null, bd = Infinity;
    for (const s of VISUAL_SENSORS) {
      if (!s._pos) continue;
      const d = s._pos.distanceTo(p);
      if (d < bd) { bd = d; best = s; }
    }
    return best ? { sensor: best, dist: bd } : null;
  }

  function fmt(s) {
    const t = TYPES[s.type];
    return `${(s.value ?? 0).toFixed(t.decimals)} ${t.unit}`;
  }

  /* ------------------------------------------------------------ 相机 */
  const VIEWS = () => ({
    all: [[SPAN * 0.72, SPAN * 0.40, SPAN * 0.80], [0, crownY * 0.5, 0]],
    side: [[0, crownY * 0.55, SPAN * 1.28], [0, crownY * 0.45, 0]],
    top: [[0.001, SPAN * 1.45, 0.001], [0, 0, 0]],
    crown: [[0, crownY + 0.55, SPAN * 0.46], [0, crownY * 0.85, 0]],
    deck: [[0, deckY + 0.42, SPAN * 0.34], [0, deckY + 0.06, 0]],
    foot: [[-SPAN * 0.40, 0.85, SPAN * 0.34], [-SPAN * 0.30, 0.35, 0]],
  });

  function setCamera(kind, instant) {
    const v = VIEWS()[kind];
    if (!v) return;
    const [pos, tgt] = v;
    if (instant) { camera.position.set(...pos); controls.target.set(...tgt); controls.update(); return; }
    state.tween = { t: 0, p0: camera.position.clone(), p1: new THREE.Vector3(...pos), t0: controls.target.clone(), t1: new THREE.Vector3(...tgt) };
  }

  function focus(p, dist = 1.8) {
    if (!p) return;
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    state.tween = { t: 0, p0: camera.position.clone(), p1: p.clone().addScaledVector(dir, dist), t0: controls.target.clone(), t1: p.clone() };
  }

  /* ------------------------------------------------------------ 主循环 */
  let last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 60, lowFpsFrames = 0;
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

    if (state.ready && !state.paused && !state.contextLost) {
      if (state.colorMode === 'status') { refreshZoneStatus(); applyColors(); }
      applyMarkers();
      renderer.render(scene, camera);

      fpsAcc += dt; fpsN++;
      if (fpsAcc > 0.5) {
        fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0;
        hooks.onStats?.({ fps, tris: state.visibleTris, total: state.totalTris, draws: state.visibleDraws, degenerate: state.degenerate, prec: state.prec });
        /* ⑤ 帧率看门狗：持续低帧自动降级，避免用户机器被拖死 */
        if (fps > 0 && fps < 22) {
          lowFpsFrames++;
          if (lowFpsFrames >= 6 && state.prec !== 'smooth') {
            lowFpsFrames = 0;
            state.prec = state.prec === 'high' ? 'standard' : 'smooth';
            applyLayers();
            hooks.onDowngrade?.(state.prec, { fps, tris: state.visibleTris, draws: state.visibleDraws });
          }
        } else lowFpsFrames = 0;
      }
    }
  }
  requestAnimationFrame(loop);

  function resize() {
    const w = container.clientWidth || 800, h = container.clientHeight || 480;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(container);
  window.addEventListener('resize', resize);

  /* ------------------------------------------------------------ API */
  return {
    state, scene, camera, renderer,
    setLayer(k, v) { state.layers[k] = v; applyLayers(); },
    setSensorType(k, v) { state.sensorTypes[k] = v; applyMarkers(); },
    setColorMode(m) { state.colorMode = m; if (m === 'status') refreshZoneStatus(); applyColors(); return { zones: zoneStatus.slice() }; },
    setPrecision(k) { state.prec = k; applyLayers(); return { tris: state.visibleTris, draws: state.visibleDraws, label: PRECISION_LABEL[k] }; },
    setWireframe(v) {
      allMats.forEach((m) => { m.wireframe = v; });
      matVariants.forEach((arr) => arr.forEach((m) => { m.wireframe = v; }));
    },
    setAutoRotate(v) { state.autoRotate = v; },
    setGrid(v) { grid.visible = v; },
    setClip(pct) {
      state.clipVal = pct;
      state.clipOn = pct < 100;
      const x0 = spanX[0] - 0.2, x1 = spanX[1] + 0.2;
      clipPlane.constant = x0 + (x1 - x0) * (pct / 100);
    },
    setMeasure(v) { state.measure = v; state.measurePts = []; if (!v) measureGroup.clear(); },
    clearMeasure() { state.measurePts = []; measureGroup.clear(); },
    setCamera, focus,
    setPaused(v) { state.paused = !!v; if (!v) last = performance.now(); else if (state.ready) renderer.render(scene, camera); },
    stop() { if (state.ready) renderer.render(scene, camera); state.paused = true; state.stopped = true; },
    start() { if (state.stopped) { state.stopped = false; state.paused = false; last = performance.now(); requestAnimationFrame(loop); } },
    renderOnce() { if (state.ready) renderer.render(scene, camera); },
    resetCamera() { setCamera('all'); },
    stats() { return { fps, tris: state.visibleTris, total: state.totalTris, draws: state.visibleDraws, degenerate: state.degenerate, prec: state.prec }; },
  };
}

/* ==========================================================================
   app.js —— 应用主控：数据引擎、三维孪生、看板、预警、吊装、台账、系统
   ========================================================================== */
import * as D from './data.js';
import { createCharts } from './charts.js';
import { createTwin } from './view3d.js';
import { createHoist } from './hoist.js';
import * as UI from './ui.js';

const engine = D.createEngine();
const charts = createCharts();
const buf = new Map();                 // code → 滚动值
const tb = [];                         // 时间标签
let twin = null, hoist = null, currentView = 'twin';
let replay = { on: false, playing: false, min: 0 };
let histSeries = null, histCode = null;

const LIVE_CODES = [
  'SG-PN3-AR-A-03-TU-01', 'SG-PN3-AR-B-04-TD-01', 'SG-PN3-DK-LG-02-L-TU',
  'LD-PN3-AR-A-MX-01', 'IN-PN3-AR-A-F01-01', 'AC-PN3-AR-A-A01-01',
  'CF-PN3-HG-19-01', 'TH-PN3-EN-T1-01', 'WS-PN3-EN-W1-01',
];
const STRAIN_SERIES = ['SG-PN3-AR-A-03-TU-01', 'SG-PN3-AR-B-04-TD-01', 'SG-PN3-AR-A-S08-TU-01'];
const N = 90;                          // 滚动窗口点数

/* ------------------------------------------------------------ 工具 */
const pad = (n, w = 2) => String(n).padStart(w, '0');
const hhmmss = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const humOf = (t) => 62 + 16 * Math.sin((t / 3600000 - 9) / 24 * Math.PI * 2);
const byCode = (c) => D.SENSOR_BY_CODE.get(c);

function pushBuf(code, v) {
  if (!buf.has(code)) buf.set(code, []);
  const a = buf.get(code); a.push(v);
  if (a.length > N) a.shift();
}

function snapshotAt(t) {
  D.SENSORS.forEach((s) => { s.value = engine.valueOf(s.code, t); s.status = D.statusOf(s.type, s.value, s.ref); });
}

function stats(pairs) {          // [[实测, 理论]]
  const n = pairs.length;
  if (!n) return { mae: 0, mre: 0, r: 0, n: 0, over: 0 };
  const mae = pairs.reduce((a, p) => a + Math.abs(p[0] - p[1]), 0) / n;
  const mre = pairs.reduce((a, p) => a + (Math.abs(p[1]) > 1e-6 ? Math.abs(p[0] - p[1]) / Math.abs(p[1]) : 0), 0) / n;
  const mx = pairs.reduce((a, p) => a + p[0], 0) / n, my = pairs.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  pairs.forEach(([x, y]) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; });
  return { mae, mre, r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0, n, over: pairs.filter((p) => Math.abs(p[0]) > D.TYPES.LD.th[1]).length };
}

/* ------------------------------------------------------------ 三维孪生 */
function initTwin() {
  if (twin) return;
  try {
    twin = createTwin(UI.$('twinCanvas'), engine, {
      onProgress: ({ loaded, total }) => {
        const p = Math.min(99, loaded / total * 100);
        UI.$('loadBar').style.width = p.toFixed(0) + '%';
        UI.$('loadTxt').textContent = `已解析 ${(loaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`;
      },
      onReady: (info) => {
        UI.$('loadBar').style.width = '100%';
        UI.$('loadTxt').textContent = `完成 · 有效构件 ${info.meshes} 个 · ${(info.tris / 10000).toFixed(1)} 万面片 · ${info.loadMs} ms`;
        UI.$('loadOverlay').classList.add('hide');
        setTimeout(() => UI.$('loadOverlay').classList.add('gone'), 220);
        UI.$('modelInfo').innerHTML = `
          <div class="row" style="display:flex;justify-content:space-between"><span class="dim">有效构件</span><b class="mono">${info.meshes}</b></div>
          <div class="row" style="display:flex;justify-content:space-between"><span class="dim">退化图元（已隐藏）</span><b class="mono">${info.degenerate}</b></div>
          <div class="row" style="display:flex;justify-content:space-between"><span class="dim">总面片</span><b class="mono">${(info.tris / 10000).toFixed(1)} 万</b></div>
          <div class="row" style="display:flex;justify-content:space-between"><span class="dim">归一化跨径</span><b class="mono">${info.span.toFixed(1)} m</b></div>
          <div class="row" style="display:flex;justify-content:space-between"><span class="dim">模型高度</span><b class="mono">${info.height.toFixed(2)} m</b></div>
          <div class="row" style="display:flex;justify-content:space-between"><span class="dim">桥面标高</span><b class="mono">${info.deckY.toFixed(2)} m</b></div>
          <div class="row" style="display:flex;justify-content:space-between"><span class="dim">拱顶标高</span><b class="mono">${info.crownY.toFixed(2)} m</b></div>
          <div class="row" style="display:flex;justify-content:space-between"><span class="dim">解析耗时</span><b class="mono">${info.loadMs} ms</b></div>
          <div class="row" style="display:flex;justify-content:space-between"><span class="dim">测点挂接</span><b class="mono">${D.VISUAL_SENSORS.length} 个</b></div>
          <div class="dim small" style="margin-top:4px">${info.dbg || ''}</div>`;
        const toggleLayer = (k) => {
          twin.setLayer(k, !twin.state.layers[k]);
          UI.renderLayerList(info.cats, twin.state.layers, toggleLayer);
        };
        UI.renderLayerList(info.cats, twin.state.layers, toggleLayer);
        UI.toast(`三维场景就绪：有效构件 ${info.meshes} 个（另隐藏 ${info.degenerate} 个 CAD 退化图元）、${(info.tris / 10000).toFixed(1)} 万面片，测点已挂接 ${D.VISUAL_SENSORS.length} 个。`);
      },
      onError: (msg) => UI.fatal('三维模型加载失败：' + msg),
      onContextLost: () => {
        UI.toast('⚠ 显卡渲染上下文丢失（模型过大或显存不足）。已自动切换到「流畅」精度，正在恢复…', 'bad');
        twin?.setPrecision('smooth');
        document.querySelectorAll('#precMode .seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.prec === 'smooth'));
      },
      onContextRestored: () => UI.toast('渲染上下文已恢复。如仍卡顿，请保持「流畅」精度。'),
      onDowngrade: (prec, st) => {
        document.querySelectorAll('#precMode .seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.prec === prec));
        UI.toast(`检测到帧率偏低（${st.fps} fps），已自动降级为「${prec === 'smooth' ? '流畅' : '标准'}」精度：${(st.tris / 10000).toFixed(0)} 万面片 / ${st.draws} 个构件。可手动切回更高精度。`, 'warn');
      },
      onStats: (s) => UI.renderStatusBar(s, engine.latency().reduce((a, r) => a + r[1], 0)),
      onHover: (o) => {
        const tip = UI.$('tip3d');
        if (!o) { tip.hidden = true; return; }
        const host = UI.$('twinCanvas').getBoundingClientRect();
        tip.hidden = false;
        tip.style.left = (o.x - host.left + 14) + 'px';
        tip.style.top = (o.y - host.top + 14) + 'px';
        tip.innerHTML = o.html;
      },
      onSelect: (sel) => UI.renderSelection(sel),
      toast: (m) => UI.toast(m),
    });
  } catch (e) {
    UI.fatal(e && e.stack || String(e));
  }
}

/* ------------------------------------------------------------ 视图切换 */
function showView(v) {
  currentView = v;
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === 'view-' + v));
  document.querySelectorAll('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  /* 仅当前视图渲染，其余场景暂停，避免无意义占用 GPU（对应方案 4-5 帧率与资源优化） */
  twin?.setPaused(v !== 'twin');
  hoist?.setPaused(v !== 'hoist');
  if (v === 'twin') { initTwin(); setTimeout(() => { twin?.renderer.setSize(UI.$('twinCanvas').clientWidth, UI.$('twinCanvas').clientHeight, false); }, 60); }
  if (v === 'dash') { setTimeout(() => { charts.resize(); refreshDash(true); }, 60); }
  if (v === 'history') { setTimeout(() => { charts.resize(); if (histSeries) drawHistory(); }, 60); }
  if (v === 'hoist') { initHoist(); setTimeout(() => hoist?.resize(), 60); }
  if (v === 'alarm') UI.renderAlarmTable(engine.alarms, alarmFilter, locate, refreshAlarms);
  if (v === 'devices') { UI.renderDevStats(); UI.renderTables(engine); }
  if (v === 'system') { UI.renderTables(engine); UI.renderLogs(engine.logs); }
}

/* ------------------------------------------------------------ 吊装视图 */
function initHoist() {
  if (hoist) return;
  hoist = createHoist(UI.$('hoistCanvas'), (s) => {
    UI.renderHoistSteps(s.step, s.total);
    UI.renderHoistReadout(s);
    UI.$('hoistPlay').textContent = s.playing ? '⏸ 暂停' : '▶ 播放';
  });
  hoist.setView('all');
  UI.renderHoistSteps(0, hoist.total);
  UI.$('hoistPlay').onclick = () => hoist.toggle();
  UI.$('hoistNext').onclick = () => { hoist.pause(); hoist.next(); };
  UI.$('hoistReset').onclick = () => hoist.reset();
  UI.$('hoistSpeed').onchange = (e) => hoist.setSpeed(e.target.value);
  UI.renderHoistReadout({ step: 0, total: hoist.total, cur: null, tip: 0, cable: 0, elev: 0 });
}

/* ------------------------------------------------------------ 看板刷新 */
function refreshDash(full) {
  const strainSeries = STRAIN_SERIES.map((c, i) => ({
    name: c.replace('SG-PN3-', ''), color: ['#22d3ee', '#a78bfa', '#10d9a0'][i],
    t: tb, v: buf.get(c) || [], main: i === 0,
  }));
  charts.strain(strainSeries, D.TYPES.SG.th);

  const cfs = D.SENSORS.filter((s) => s.type === 'CF');
  charts.cable(cfs.map((s) => ({ n: s.code.replace('CF-PN3-', ''), v: s.value || 0, ref: s.ref, s: s.status || 0 })));

  const ld = byCode('LD-PN3-AR-A-MX-01');
  const m = buf.get(ld.code) || [];
  charts.disp(tb.slice(-m.length), m, m.map((_, i) => ld.base * (1 + 0.03 * Math.sin(i / 9))));

  const th = byCode('TH-PN3-EN-T1-01'), ws = byCode('WS-PN3-EN-W1-01');
  charts.env(tb, buf.get(th.code) || [], tb.map((_, i) => humOf(Date.now() - (N - i) * 1000)), buf.get(ws.code) || []);

  if (full) UI.renderDashKpis(engine);
  UI.renderDashAlarms(engine.alarms, locate);
  const pairs = m.map((v, i) => [v, ld.base * (1 + 0.03 * Math.sin(i / 9))]);
  UI.renderErrGrid(stats(pairs));
}

/* ------------------------------------------------------------ 预警 */
const alarmFilter = { level: '', status: '' };
function refreshAlarms() {
  UI.renderAlarmStats(engine.alarms);
  UI.renderAlarmTable(engine.alarms, alarmFilter, locate, refreshAlarms);
}
function locate(code) {
  showView('twin');
  const s = byCode(code);
  if (!s) return;
  if (s._pos && twin) { twin.focus(s._pos, 1.5); }
  UI.renderSelection({ kind: 'sensor', sensor: s });
  UI.toast(`已定位测点 <b>${code}</b>（${s.pos}）`);
}

/* ------------------------------------------------------------ 历史与回放 */
function preprocess(rows) {
  let v = rows.map((r) => r[1]);
  const th = rows.map((r) => r[2]);
  if (UI.$('ppOutlier').checked) {
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) || 1;
    v = v.map((x) => (Math.abs(x - mean) > 3.2 * sd ? NaN : x));
  }
  if (UI.$('ppAvg').checked) {
    v = v.map((_, i) => {
      const seg = v.slice(Math.max(0, i - 2), i + 3).filter((x) => !isNaN(x));
      return seg.length ? seg.reduce((a, b) => a + b, 0) / seg.length : NaN;
    });
  }
  if (UI.$('ppLpf').checked) {
    let prev = v.find((x) => !isNaN(x)) ?? 0;
    v = v.map((x) => { prev = isNaN(x) ? prev : prev + 0.32 * (x - prev); return prev; });
  }
  if (UI.$('ppFill').checked) {
    const out = v.slice();
    for (let i = 0; i < out.length; i++) {
      if (isNaN(out[i])) {
        let j = i; while (j < out.length && isNaN(out[j])) j++;
        const a = out[i - 1], b = out[j];
        for (let k = i; k < j; k++) out[k] = (a !== undefined && b !== undefined) ? a + (b - a) * (k - i + 1) / (j - i + 1) : (a ?? b ?? 0);
      }
    }
    v = out;
  }
  return v.map((x, i) => ({ t: hhmmss(rows[i][0]), v: x, th: th[i] }));
}

function drawHistory() {
  if (!histSeries || !histCode) return;
  const s = byCode(histCode);
  const th = s.type === 'CF'
    ? [s.ref * 1.1, s.ref * 1.15, s.ref * 1.2]
    : D.TYPES[s.type].th;
  charts.history(histCode, histSeries, D.TYPES[s.type].unit, th);
  UI.$('hsTitle').textContent = `${histCode} · ${s.pos}`;
  const mae = histSeries.reduce((a, p) => a + Math.abs(p.v - p.th), 0) / histSeries.length;
  UI.$('hsStat').textContent = `样本 ${histSeries.length} · 平均绝对误差 ${mae.toFixed(3)} ${D.TYPES[s.type].unit}`;
}

function doQuery() {
  const code = UI.$('hsSensor').value;
  const hours = +UI.$('hsRange').value;
  if (!code) { UI.toast('请选择测点', 'warn'); return; }
  histCode = code;
  const rows = engine.history(code, Date.now(), hours * 60, hours > 48 ? 30 : 1);
  histSeries = preprocess(rows);
  drawHistory();
  UI.toast(`已查询 <b>${code}</b> 近 ${hours} 小时数据，共 ${histSeries.length} 条（含预处理）`);
}

/* ------------------------------------------------------------ 主循环 */
let lastTick = 0, latencyCache = engine.latency(), frozen = false;
function loop(now) {
  if (frozen) return;
  requestAnimationFrame(loop);
  if (now - lastTick < 1000) return;
  lastTick = now;
  const t = Date.now();

  if (replay.on) {
    snapshotAt(t - replay.min * 60000);
    if (replay.playing) {
      replay.min -= 5;
      if (replay.min < 0) { replay.min = 0; replay.playing = false; UI.$('btnPbPlay').textContent = '▶ 回放'; }
      UI.$('pbSlider').value = String(1440 - replay.min);
      UI.$('pbVal').textContent = `T-${replay.min} min`;
    }
  } else {
    engine.tick(t);
  }

  STRAIN_SERIES.forEach((c) => pushBuf(c, byCode(c)?.value ?? 0));
  LIVE_CODES.forEach((c) => pushBuf(c, byCode(c)?.value ?? 0));
  tb.push(hhmmss(t)); if (tb.length > N) tb.shift();
  latencyCache = engine.latency();

  /* 右侧实时测点（自动挑选数值最大者 + 固定代表测点） */
  const live = LIVE_CODES.map(byCode).filter(Boolean).slice(0, 8);
  UI.renderLiveList(live, buf, (code) => locate(code));
  UI.renderLatency(latencyCache, latencyCache.reduce((a, r) => a + r[1], 0));
  UI.renderTopKpis(engine);
  UI.renderStatusBar(twin ? twin.stats() : { fps: 0, tris: 0 }, latencyCache.reduce((a, r) => a + r[1], 0));

  const active = engine.alarms.filter((a) => a.status !== '已恢复').length;
  const badge = UI.$('alarmBadge');
  badge.hidden = active === 0;
  badge.textContent = active;

  if (currentView === 'dash') refreshDash(false);
  if (currentView === 'alarm') UI.renderAlarmStats(engine.alarms);
  if (currentView === 'devices') UI.renderDevStats();
  if (currentView === 'history' && histSeries && !replay.on) {
    UI.$('pbVal').textContent = '最新';
  }
}

/* ------------------------------------------------------------ 事件绑定 */
function bind() {
  document.querySelectorAll('.rail-btn').forEach((b) => { b.onclick = () => showView(b.dataset.view); });

  UI.$('btnLoadEvent').onclick = () => {
    const k = engine.fireLoadEvent();
    UI.toast(`已注入加载工况（强度 ${(k * 100).toFixed(0)}%）：应变、竖向位移、索力将同步响应，观察分级预警与三维着色联动。`, 'warn');
  };

  /* 三维视图控件 */
  document.querySelectorAll('[data-cam]').forEach((b) => { b.onclick = () => { initTwin(); twin?.setCamera(b.dataset.cam); }; });
  UI.$('colorMode').onclick = (e) => {
    const b = e.target.closest('.seg-btn'); if (!b) return;
    document.querySelectorAll('#colorMode .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    twin?.setColorMode(b.dataset.mode);
    UI.toast(b.dataset.mode === 'status' ? '状态着色：构件按所属分区的最不利测点状态着色（四档阈值）。' : '恢复真实材质显示。');
  };
  UI.$('swWire').onchange = (e) => twin?.setWireframe(e.target.checked);
  UI.$('swRotate').onchange = (e) => twin?.setAutoRotate(e.target.checked);
  UI.$('swGrid').onchange = (e) => twin?.setGrid(e.target.checked);
  UI.$('precMode').onclick = (e) => {
    const b = e.target.closest('.seg-btn'); if (!b) return;
    document.querySelectorAll('#precMode .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    const r = twin?.setPrecision(b.dataset.prec);
    const map = {
      high: '精细：显示全部构件（含微小零件），仅建议在独显机器上用于局部查看与出图',
      standard: '标准：隐藏小于跨度 0.2% 的微小零件（本模型约相当于 1 m 以下的螺栓级细节），兼顾观感与帧率',
      smooth: '流畅：隐藏小于跨度 0.5% 的零件，用于投影、集显或低配设备',
    };
    UI.toast(`${map[b.dataset.prec]}　当前渲染 ${((r?.tris || 0) / 10000).toFixed(0)} 万面片、${r?.draws ?? 0} 个构件。`);
  };
  UI.$('clipSlider').oninput = (e) => {
    const v = +e.target.value;
    UI.$('clipVal').textContent = v >= 100 ? '关' : v + '%';
    twin?.setClip(v);
  };
  UI.$('btnMeasure').onclick = (e) => {
    const on = !e.target.classList.contains('on');
    e.target.classList.toggle('on', on);
    twin?.setMeasure(on);
    UI.$('measureHint').hidden = !on;
    UI.toast(on ? '测量模式已开启：在模型上依次点击两点。' : '测量模式已关闭。');
  };
  UI.$('btnMeasureClear').onclick = () => { twin?.clearMeasure(); UI.toast('已清除测量标记。'); };

  /* 看板 */
  UI.$('btnStrainAdd').onclick = () => {
    const png = charts.exportPng('chStrain');
    if (png) UI.downloadDataURL('拱肋应变曲线.png', png);
    UI.toast('已导出图表 PNG（对应需求 4-15 图表导出）。');
  };

  /* 历史查询 */
  const sel = UI.$('hsType');
  sel.innerHTML = Object.values(D.TYPES).map((t) => `<option value="${t.key}">${t.name}</option>`).join('');
  function fillSensors() {
    const list = D.SENSORS.filter((s) => s.type === sel.value && s.visual).slice(0, 40);
    UI.$('hsSensor').innerHTML = list.map((s) => `<option value="${s.code}">${s.code}　${s.pos}</option>`).join('');
  }
  sel.onchange = fillSensors; fillSensors();
  UI.$('btnHsQuery').onclick = doQuery;
  UI.$('btnHsCsv').onclick = () => {
    if (!histSeries) { UI.toast('请先执行查询', 'warn'); return; }
    UI.downloadCSV(`${histCode}_history.csv`, [['时间', '实测值', '理论值'], ...histSeries.map((d) => [d.t, d.v.toFixed(4), d.th.toFixed(4)])]);
    engine.pushLog('操作', 'admin', `导出 ${histCode} 历史数据 CSV`, '成功');
    UI.toast('已导出 CSV（对应需求 4-15 数据导出）。');
  };
  ['ppAvg', 'ppLpf', 'ppOutlier', 'ppFill'].forEach((id) => { UI.$(id).onchange = () => { if (histSeries) { const rows = engine.history(histCode, Date.now(), +UI.$('hsRange').value * 60, +UI.$('hsRange').value > 48 ? 30 : 1); histSeries = preprocess(rows); drawHistory(); } }; });

  /* 回放 */
  UI.$('pbSlider').oninput = (e) => {
    const v = +e.target.value;
    replay.on = v < 1440;
    replay.min = 1440 - v;
    UI.$('pbVal').textContent = replay.on ? `T-${replay.min} min` : '最新';
    if (replay.on) snapshotAt(Date.now() - replay.min * 60000);
  };
  UI.$('btnPbPlay').onclick = (e) => {
    replay.on = true; replay.playing = !replay.playing;
    if (replay.min <= 0) replay.min = 60;
    e.target.textContent = replay.playing ? '⏸ 暂停' : '▶ 回放';
    UI.$('pbSlider').value = String(1440 - replay.min);
    UI.toast(replay.playing ? '历史回放中：三维场景按时间轴同步着色。' : '回放已暂停。');
  };
  UI.$('btnPbSnap').onclick = () => {
    replay.on = true; replay.playing = false;
    snapshotAt(Date.now() - replay.min * 60000);
    showView('twin');
    UI.toast(`已在三维孪生中定位到 T-${replay.min} min 的状态快照。`);
  };

  /* 预警筛选 */
  UI.$('almLevel').onchange = (e) => { alarmFilter.level = e.target.value; refreshAlarms(); };
  UI.$('almStatus').onchange = (e) => { alarmFilter.status = e.target.value; refreshAlarms(); };
}

/* ------------------------------------------------------------ 启动 */
function boot() {
  const q = new URLSearchParams(location.search);
  UI.renderStatusLegend();
  const types = D.CATEGORY_STATS.map((c) => ({ key: c.type, name: D.TYPES[c.type].name, icon: D.TYPES[c.type].icon, color: D.TYPES[c.type].color, design: c.design, visual: c.visual, on: true }));
  const toggleSensor = (k) => {
    const t = types.find((x) => x.key === k);
    t.on = t.on === false;
    twin?.setSensorType(k, t.on);
    UI.renderSensorToggles(types, toggleSensor);
  };
  UI.renderSensorToggles(types, toggleSensor);
  UI.renderSelection(null);
  engine.tick(Date.now());
  bind();
  initTwin();
  UI.renderLogs(engine.logs);
  refreshAlarms();
  requestAnimationFrame(loop);

  const clock = UI.$('clock');
  setInterval(() => { clock.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false }); }, 1000);
  clock.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });

  window.addEventListener('error', (e) => console.error('[demo]', e.message));
  /* 调试/自动化钩子（供演示脚本与自检使用） */
  window.__demo = {
    engine, charts, showView,
    twin: () => twin, hoist: () => hoist,
  };
  /* 深链：?view=dash 直接进入指定视图；?auto=1 加载完成后暂停渲染（用于截图/投影） */
  const wantView = q.get('view');
  if (wantView && ['twin', 'dash', 'history', 'alarm', 'hoist', 'devices', 'system'].includes(wantView)) showView(wantView);
  if (q.get('auto')) {
    const t = setInterval(() => {
      if (twin && twin.state.ready) {
        clearInterval(t);
        UI.$('loadOverlay').classList.add('hide');
        setTimeout(() => {
          twin.setPaused(true); hoist?.setPaused(true);
          if (q.get('freeze')) { twin.stop(); frozen = true; }
        }, 1600);
      }
    }, 400);
  }
  if (q.get('prec') && twin) {
    twin.setPrecision(q.get('prec'));
    document.querySelectorAll('#precMode .seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.prec === q.get('prec')));
  }
  setTimeout(() => {
    if (!twin || !twin.state.ready) {
      UI.$('loadTxt').textContent = '仍在解析模型（约 15 MB Draco 压缩数据）…';
    }
  }, 12000);
}

boot();

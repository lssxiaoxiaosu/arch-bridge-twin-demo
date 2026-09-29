/* ==========================================================================
   ui.js —— 面板 / 列表 / 表格渲染层
   ========================================================================== */
import { TYPES, STATUS, DEVICES, ZONE_STATS, CATEGORY_STATS, CODE_RULES, ROLES, ORG_TREE, USERS, HOIST_STEPS, SENSORS } from './data.js';
import { spark } from './charts.js';

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

let toastTimer = null;
export function toast(msg, type = '') {
  const t = $('toast');
  t.innerHTML = msg;
  t.className = 'show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3200);
}

export function fatal(msg) {
  const f = $('fatal');
  f.hidden = false;
  f.textContent = '【演示启动失败】\n\n' + msg + '\n\n请确认：\n1) 通过 HTTP 访问（运行 启动演示.bat，不要直接双击 index.html）\n2) libs/ 与 model/ 目录完整\n3) 浏览器已启用 WebGL';
}

const fmt = (s) => `${(s.value ?? 0).toFixed(TYPES[s.type].decimals)}`;

/* ------------------------------------------------------------ 三维视图面板 */
export function renderLayerList(cats, layers, onToggle) {
  $('layerList').innerHTML = cats.map((c) => `
    <div class="layer-row ${layers[c.key] === false ? 'off' : ''}" data-layer="${c.key}">
      <span class="swatch" style="background:${c.color};color:${c.color}"></span>
      <span class="n">${c.name}</span>
      <span class="c">${c.count} 件 · ${(c.tris / 10000).toFixed(1)}万面</span>
    </div>`).join('');
  $('layerList').querySelectorAll('[data-layer]').forEach((el) => {
    el.onclick = () => onToggle(el.dataset.layer);
  });
}

export function renderSensorToggles(types, onToggle) {
  $('sensorToggles').innerHTML = types.map((t) => `
    <div class="layer-row ${t.on === false ? 'off' : ''}" data-type="${t.key}">
      <span class="swatch" style="background:${t.color};color:${t.color}"></span>
      <span class="n">${t.icon} ${t.name}</span>
      <span class="c">${t.visual}/${t.design}</span>
    </div>`).join('');
  $('sensorToggles').querySelectorAll('[data-type]').forEach((el) => { el.onclick = () => onToggle(el.dataset.type); });
}

export function renderStatusLegend() {
  $('statusLegend').innerHTML = STATUS.map((s) => `<div class="leg-row"><i style="background:${s.color};color:${s.color}"></i>${s.name}${s.k ? ' 档' : ''}</div>`).join('');
}

export function renderSelection(sel) {
  const box = $('selInfo');
  if (!sel) { box.innerHTML = '<div class="dim">点击模型中的构件或测点查看属性</div>'; return; }
  if (sel.kind === 'sensor') {
    const s = sel.sensor, t = TYPES[s.type];
    box.innerHTML = `
      <div class="hd"><span class="dot" style="background:${STATUS[s.status || 0].color};color:${STATUS[s.status || 0].color}"></span><b>${s.code}</b></div>
      <div class="row"><span>指标类型</span><b>${t.name}</b></div>
      <div class="row"><span>安装位置</span><b>${s.pos}</b></div>
      <div class="row"><span>当前值</span><b style="color:${STATUS[s.status || 0].color}">${fmt(s)} ${t.unit}</b></div>
      <div class="row"><span>状态</span><b>${STATUS[s.status || 0].name}</b></div>
      <div class="row"><span>阈值(预警/报警/紧急)</span><b>${t.type === 'CF' ? '±10/15/20%' : t.th.join(' / ')}</b></div>
      <div class="row"><span>采集装置</span><b>${DEVICES[(hashIdx(s.code, 8))].id}</b></div>
      <div class="row"><span>编码规则</span><b>附录 D 四码合一</b></div>`;
  } else {
    const name = { arch: '主拱肋', hanger: '吊杆', deck: '桥面系', brace: '横联/腹杆', other: '其他构件' }[sel.cat] || '构件';
    box.innerHTML = `
      <div class="hd"><span class="dot" style="background:#22d3ee;color:#22d3ee"></span><b>${name}</b></div>
      <div class="row"><span>包络尺寸</span><b>${sel.size.x.toFixed(2)}×${sel.size.y.toFixed(2)}×${sel.size.z.toFixed(2)} m</b></div>
      <div class="row"><span>中心坐标</span><b>${sel.center.x.toFixed(2)}, ${sel.center.y.toFixed(2)}, ${sel.center.z.toFixed(2)}</b></div>
      <div class="row"><span>面片数</span><b>${Math.round(sel.tris).toLocaleString()}</b></div>
      <div class="row"><span>材质</span><b>${esc(sel.mat)}</b></div>
      ${sel.nearest ? `<div class="row"><span>最近测点</span><b>${sel.nearest.sensor.code}</b></div>
      <div class="row"><span>测点距离</span><b>${sel.nearest.dist.toFixed(3)} m</b></div>
      <div class="row"><span>测点实时值</span><b style="color:${STATUS[sel.nearest.sensor.status || 0].color}">${fmt(sel.nearest.sensor)} ${TYPES[sel.nearest.sensor.type].unit}</b></div>` : ''}
      <div class="dim small" style="margin-top:6px">说明：桥体为成桥状态 BIM，构件 ID 沿用模型原始编号；正式版按方案附录 D 的编码规则与实体铭牌四码合一。</div>`;
  }
}

export function renderLiveList(list, buf, onPick) {
  const box = $('liveList');
  box.innerHTML = list.map((s) => {
    const t = TYPES[s.type], st = STATUS[s.status || 0];
    return `<div class="live-row lv${s.status || 0}" data-code="${s.code}">
      <span class="c">${s.code}</span>
      <span class="v" style="color:${st.color}">${fmt(s)}<small>${t.unit}</small></span>
      <canvas class="pv" data-spark="${s.code}"></canvas>
    </div>`;
  }).join('');
  box.querySelectorAll('.live-row').forEach((el) => { el.onclick = () => onPick?.(el.dataset.code); });
  box.querySelectorAll('canvas[data-spark]').forEach((c) => {
    const arr = buf.get(c.dataset.spark) || [];
    spark(c, arr, STATUS[(SENSORS.find((s) => s.code === c.dataset.spark)?.status) || 0].color);
  });
}

export function renderLatency(rows, total) {
  $('latencyBox').innerHTML = rows.map(([n, v]) => `
    <div class="lat-row"><span class="lb">${n}</span>
      <span class="tr"><i style="width:${Math.min(100, v / 0.6 * 100)}%"></i></span>
      <span class="vv">${(v * 1000).toFixed(0)} ms</span></div>`).join('')
    + `<div class="lat-total"><span>合计（要求 ≤2000 ms）</span><b>${(total * 1000).toFixed(0)} ms</b></div>`;
}

/* ------------------------------------------------------------ 顶栏 / 状态栏 / KPI */
export function renderTopKpis(engine) {
  const active = engine.alarms.filter((a) => a.status !== '已恢复');
  const sg = SENSORS.filter((s) => s.type === 'SG' && s.visual);
  const mx = sg.reduce((a, s) => (Math.abs(s.value || 0) > Math.abs(a.value || 0) ? s : a), sg[0] || { value: 0 });
  const cfg = SENSORS.find((s) => s.type === 'CF');
  const ws = SENSORS.find((s) => s.type === 'WS');
  const items = [
    ['最大应变', `${fmt(mx)}<small>με</small>`, mx.status >= 2 ? 'rose' : mx.status === 1 ? 'warn' : '', '#22d3ee'],
    ['最大索力', `${(cfg?.value || 0).toFixed(1)}<small>kN</small>`, '', '#f5a524'],
    ['瞬时风速', `${(ws?.value || 0).toFixed(1)}<small>m/s</small>`, '', '#8ee6ff'],
    ['活动预警', `${active.length}<small>条</small>`, active.length ? 'rose' : '', '#f43f5e'],
  ];
  $('topKpis').innerHTML = items.map(([k, v, cls, c]) => `<div class="tk ${cls}" style="--c:${c}"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
}

export function renderStatusBar(stats, latency) {
  $('sbFps').textContent = stats.fps ?? '--';
  $('sbTris').textContent = ((stats.tris || 0) / 10000).toFixed(1) + ' 万';
  $('sbDraw').textContent = stats.draws ?? '--';
  $('sbLatency').textContent = ((latency * 1000).toFixed(0)) + ' ms';
  $('sbPoints').textContent = SENSORS.filter((s) => s.visual).length + ' / ' + SENSORS.length;
  $('renderTag').textContent = `${stats.fps ?? '--'} fps · ${((stats.tris || 0) / 10000).toFixed(1)} 万面片 · ${stats.draws ?? '--'} 构件`;
  $('precInfo').textContent = `当前渲染 ${((stats.tris || 0) / 10000).toFixed(0)} 万面片 / ${stats.draws ?? 0} 个构件`;
}

export function renderDashKpis(engine) {
  const online = SENSORS.filter((s) => s.visual).length;
  const active = engine.alarms.filter((a) => a.status !== '已恢复');
  const lv3 = active.filter((a) => a.level === 3).length;
  const sg = SENSORS.filter((s) => s.type === 'SG' && s.visual);
  const mx = sg.reduce((a, s) => (Math.abs(s.value || 0) > Math.abs(a.value || 0) ? s : a), { value: 0 });
  const ld = SENSORS.filter((s) => s.type === 'LD');
  const mxd = ld.reduce((a, s) => (Math.abs(s.value || 0) > Math.abs(a.value || 0) ? s : a), { value: 0 });
  const items = [
    ['在线测点', `${online}`, `共 ${SENSORS.length} 个（含塔架 10 个待接入）`, '#22d3ee'],
    ['采集装置', '8 / 8', 'AI 12 · DI 8 · DO 20 · 串口 11', '#4c8dff'],
    ['最大应变', `${fmt(mx)}`, 'με · ' + (mx.code || ''), '#10d9a0'],
    ['最大竖向位移', `${fmt(mxd)}`, 'mm · ' + (mxd.code || ''), '#a78bfa'],
    ['活动预警', `${active.length}`, `其中紧急 ${lv3} 条`, active.length ? '#f43f5e' : '#10d9a0'],
    ['端到端延迟', `${((engine.latency().reduce((a, r) => a + r[1], 0)) * 1000).toFixed(0)}`, 'ms · 要求 ≤2000 ms', '#f5a524'],
  ];
  $('kpiRow').innerHTML = items.map(([k, v, s, c]) => `
    <div class="kpi" style="--c:${c}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('');
}

export function renderErrGrid(e) {
  const cell = (k, v, cls, unit) => `<div class="err-cell"><div class="k">${k}</div><div class="v ${cls}">${v}<small style="font-size:11px;color:#7c93b4"> ${unit || ''}</small></div></div>`;
  $('errGrid').innerHTML =
    cell('绝对误差（均值）', e.mae.toFixed(4), e.mae < 0.05 ? 'good' : e.mae < 0.12 ? 'mid' : '', 'mm') +
    cell('相对误差（均值）', (e.mre * 100).toFixed(2), e.mre < 0.05 ? 'good' : 'mid', '%') +
    cell('相关系数 R', e.r.toFixed(4), e.r > 0.98 ? 'good' : 'mid', '') +
    cell('样本数 / 超限次数', `${e.n} / ${e.over}`, e.over ? 'mid' : 'good', '');
}

export function renderDashAlarms(alarms, onLocate) {
  const list = alarms.filter((a) => a.status !== '已恢复').slice(0, 12);
  const box = $('dashAlarms');
  if (!list.length) { box.innerHTML = '<div class="empty">暂无预警，系统运行正常</div>'; return; }
  box.innerHTML = list.map((a) => `
    <div class="alm-item lv${a.level}" data-code="${a.code}">
      <div class="t1"><b>${a.code}</b><span style="color:${STATUS[a.level].color}">${STATUS[a.level].name}</span></div>
      <div class="t2">${a.pos} · ${(a.value ?? 0).toFixed(2)} / 阈值 ${(a.th ?? 0).toFixed(2)}</div>
    </div>`).join('');
  box.querySelectorAll('[data-code]').forEach((el) => { el.onclick = () => onLocate?.(el.dataset.code); });
}

/* ------------------------------------------------------------ 预警视图 */
export function renderAlarmStats(alarms) {
  const active = alarms.filter((a) => a.status !== '已恢复');
  const c = (k) => active.filter((a) => a.level === k).length;
  const items = [
    ['活动预警总数', active.length, '#f43f5e'],
    ['紧急（三级）', c(3), '#f43f5e'],
    ['报警（二级）', c(2), '#f5a524'],
    ['预警（一级）', c(1), '#ffd166'],
    ['已恢复', alarms.filter((a) => a.status === '已恢复').length, '#10d9a0'],
    ['平均触发延迟', '1.8 s', '#22d3ee'],
  ];
  $('alarmStats').innerHTML = items.map(([k, v, col]) => `
    <div class="kpi" style="--c:${col}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">要求：三级阈值 · 触发 ≤3 s</div></div>`).join('');
}

export function renderAlarmTable(alarms, filter, onLocate, onAck) {
  let list = alarms.slice();
  if (filter.level) list = list.filter((a) => String(a.level) === filter.level);
  if (filter.status) list = list.filter((a) => a.status === filter.status);
  const tb = $('alarmTable').querySelector('tbody');
  tb.innerHTML = list.slice(0, 120).map((a) => `
    <tr>
      <td class="mono">${new Date(a.t).toLocaleTimeString('zh-CN', { hour12: false })}</td>
      <td class="mono">${a.code}</td>
      <td>${a.pos}</td>
      <td>${TYPES[a.type].name}</td>
      <td class="mono" style="color:${STATUS[a.level].color}">${(a.value ?? 0).toFixed(3)} ${TYPES[a.type].unit}</td>
      <td class="mono">${(a.th ?? 0).toFixed(3)}</td>
      <td><span class="pill ${a.level === 3 ? 'bad' : a.level === 2 ? 'mid' : 'warn'}">${STATUS[a.level].name}</span></td>
      <td><span class="pill ${a.status === '已恢复' ? 'ok' : a.status === '已确认' ? 'info' : 'vio'}">${a.status}</span></td>
      <td><button class="btn xs" data-loc="${a.id}">三维定位</button> <button class="btn xs" data-ack="${a.id}">确认</button></td>
    </tr>`).join('');
  $('alarmEmpty').hidden = list.length > 0;
  tb.querySelectorAll('[data-loc]').forEach((b) => {
    b.onclick = () => { const a = alarms.find((x) => x.id === +b.dataset.loc); onLocate?.(a?.code); };
  });
  tb.querySelectorAll('[data-ack]').forEach((b) => {
    b.onclick = () => { const a = alarms.find((x) => x.id === +b.dataset.ack); if (a) { a.status = '已确认'; onAck?.(); } };
  });
}

/* ------------------------------------------------------------ 台账视图 */
export function renderDevStats() {
  const items = [
    ['采集装置在线', '8 / 8', 'AI≥4 · DI≥4 · DO≥8 · RS485/RS232 · RJ45 · 内置无线', '#22d3ee'],
    ['静态应变采集仪', '2 台', '60 通道/台，共 120 通道（方案 5.4.1 通道核算）', '#4c8dff'],
    ['传感器总数', `${CATEGORY_STATS.reduce((a, c) => a + c.design, 0)}`, `模型可视化挂接 ${CATEGORY_STATS.reduce((a, c) => a + c.visual, 0)} 个`, '#a78bfa'],
    ['环境设备', '4 台风机', '950～1500 W · 9000～16000 m³/h · DO 联动', '#10d9a0'],
  ];
  $('devStats').innerHTML = items.map(([k, v, s, c]) => `
    <div class="kpi" style="--c:${c}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('');
}

export function renderTables(engine) {
  $('devTable').querySelector('tbody').innerHTML = DEVICES.map((d) => `
    <tr><td class="mono">${d.id}</td><td>${d.pos}</td><td class="mono">${d.ai}</td><td class="mono">${d.di}</td>
    <td class="mono">${d.do}</td><td class="mono">${d.serial}</td><td class="mono">${d.points}</td>
    <td><span class="pill ok">在线</span></td></tr>`).join('');

  $('zoneTable').querySelector('tbody').innerHTML = ZONE_STATS.map(([z, p, d, v]) => `
    <tr><td>${z}</td><td>${p}</td><td class="mono">${d}</td>
    <td class="mono">${v || '<span class="dim">待塔架模型接入</span>'}</td></tr>`).join('');

  $('sensTable').querySelector('tbody').innerHTML = CATEGORY_STATS.map((c) => `
    <tr><td><span class="pill info">${c.name}</span></td><td>${TYPES[c.type].name}</td>
    <td class="mono">${c.design}</td><td class="mono">${c.visual}</td>
    <td class="mono">${(c.visual / c.design * 100).toFixed(0)}%</td></tr>`).join('');

  $('codeTable').querySelector('tbody').innerHTML = CODE_RULES.map(([k, n, e, s]) => `
    <tr><td><span class="pill info">${k}</span></td><td>${n}</td><td class="mono">${e}</td><td>${s}</td></tr>`).join('');

  $('roleTable').querySelector('tbody').innerHTML = ROLES.map(([r, d, m, o, u]) => `
    <tr><td><b>${r}</b></td><td>${d}</td><td>${m}</td><td>${o}</td><td class="mono">${u}</td></tr>`).join('');

  $('orgTree').innerHTML = ORG_TREE.map(([n, lv]) => `<div class="n${lv}">${lv === 1 ? '◆ ' : lv === 2 ? '▸ ' : ''}${n}</div>`).join('');

  $('userTable').querySelector('tbody').innerHTML = USERS.map(([a, n, r, o, s, p]) => `
    <tr><td class="mono">${a}</td><td>${n}</td><td>${r}</td><td>${o}</td>
    <td><span class="pill ok">${s}</span></td><td class="mono">${p}</td></tr>`).join('');
}

export function renderLogs(logs) {
  const seed = [
    [new Date().toLocaleTimeString('zh-CN', { hour12: false }), '登录', 'zhou_xh', 'Web 端登录', '成功'],
    [new Date(Date.now() - 6e4).toLocaleTimeString('zh-CN', { hour12: false }), '操作', 'admin', '修改 DAQ-03 上报周期 1s→5s', '成功'],
    [new Date(Date.now() - 12e4).toLocaleTimeString('zh-CN', { hour12: false }), '告警', 'system', 'SG-PN3-AR-A-02-TU-01 触发报警', '已推送'],
    [new Date(Date.now() - 18e4).toLocaleTimeString('zh-CN', { hour12: false }), '操作', 'lab_01', '导出 24h 历史数据 CSV', '成功'],
    [new Date(Date.now() - 26e4).toLocaleTimeString('zh-CN', { hour12: false }), '登录', 'stu_g01', 'Web 端登录', '成功'],
    [new Date(Date.now() - 33e4).toLocaleTimeString('zh-CN', { hour12: false }), '操作', 'admin', '新增角色「研究生」数据范围', '成功'],
  ];
  const all = logs.concat(seed).slice(0, 40);
  $('logTable').querySelector('tbody').innerHTML = all.map(([t, ty, u, o, r]) => `
    <tr><td class="mono">${t}</td><td><span class="pill ${ty === '告警' ? 'bad' : ty === '登录' ? 'info' : 'vio'}">${ty}</span></td>
    <td class="mono">${u}</td><td>${o}</td><td>${r}</td></tr>`).join('');
}

/* ------------------------------------------------------------ 吊装视图 */
export function renderHoistSteps(step, total) {
  const round = step <= 44 ? Math.ceil(step / 4) : 11;
  const stage = round <= 4 ? 0 : round <= 8 ? 1 : 2;
  const cur = step >= total ? 4 : stage === 0 ? 0 : stage === 1 ? 1 : 2;
  $('hoistSteps').innerHTML = HOIST_STEPS.map((s, i) => `
    <li class="${i === cur ? 'on' : i < cur ? 'done' : ''}">${s}</li>`).join('');
}

export function renderHoistReadout(s) {
  const pct = (s.step / s.total * 100).toFixed(0);
  $('hoistProg').textContent = `节段 ${s.step} / ${s.total}　${s.cur ? s.cur.label : '未开始'}`;
  $('hoistReadout').innerHTML = `
    <div class="r"><span>塔顶位移</span><b>${s.tip.toFixed(2)} cm</b></div>
    <div class="r"><span>扣索索力</span><b>${s.cable.toFixed(1)} kN</b></div>
    <div class="r"><span>节段标高</span><b>${s.elev.toFixed(3)} m</b></div>
    <div class="r"><span>已装比例</span><b>${pct}%</b></div>
    <div class="r"><span>控制要求</span><b>≤5.00 cm</b></div>`;
}

/* ------------------------------------------------------------ 工具 */
function hashIdx(str, n) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h % n; }

export function downloadCSV(name, rows) {
  const csv = '\ufeff' + rows.map((r) => r.join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function downloadDataURL(name, url) {
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
}

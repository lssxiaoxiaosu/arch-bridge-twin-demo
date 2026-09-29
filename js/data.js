/* ==========================================================================
   data.js —— 仿真数据引擎
   说明：本 Demo 无后端。全部"实时/历史"数据由本文件的可复现仿真引擎生成，
        用于验证《详细设计和建设方案》第 4 项平台的功能链路与交互设计，
        不代表真实采集数据。测点编码、分区与阈值口径均与方案第 5 章、附录 D 一致。
   ========================================================================== */

/* ------------------------------------------------------------------ 指标定义 */
export const TYPES = {
  SG: { key: 'SG', name: '应变',       unit: 'με',  color: '#22d3ee', icon: '◉', decimals: 1, th: [400, 600, 800],  dir: 'high' },
  LD: { key: 'LD', name: '激光位移',   unit: 'mm',  color: '#4c8dff', icon: '⇕', decimals: 3, th: [1.0, 1.5, 2.0],  dir: 'high' },
  IN: { key: 'IN', name: '倾角',       unit: '°',   color: '#a78bfa', icon: '∠', decimals: 4, th: [0.05, 0.10, 0.15], dir: 'high' },
  AC: { key: 'AC', name: '振动加速度', unit: 'g',   color: '#f472b6', icon: '∿', decimals: 4, th: [0.05, 0.10, 0.20], dir: 'high' },
  CF: { key: 'CF', name: '索力',       unit: 'kN',  color: '#f5a524', icon: '⋈', decimals: 2, th: [0.10, 0.15, 0.20], dir: 'rel' },
  TH: { key: 'TH', name: '温湿度',     unit: '℃',  color: '#10d9a0', icon: '☀', decimals: 1, th: [32, 35, 38],    dir: 'high' },
  WS: { key: 'WS', name: '风速风向',   unit: 'm/s', color: '#8ee6ff', icon: '≋', decimals: 2, th: [8, 10, 12],      dir: 'high' },
};

export const STATUS = [
  { k: 0, name: '正常', color: '#10d9a0' },
  { k: 1, name: '预警', color: '#ffd166' },
  { k: 2, name: '报警', color: '#f5a524' },
  { k: 3, name: '紧急', color: '#f43f5e' },
];

/* ------------------------------------------------------------------ 随机与噪声 */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rnd(seed) {           // mulberry32
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6d2b79f5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const gauss = (r) => (r() + r() + r() + r() - 2) * 0.8;

/* ------------------------------------------------------------------ 阈值判定 */
export function statusOf(type, value, ref) {
  const t = TYPES[type];
  if (type === 'CF') {
    const dev = ref ? Math.abs(value - ref) / ref : 0;
    if (dev >= t.th[2]) return 3;
    if (dev >= t.th[1]) return 2;
    if (dev >= t.th[0]) return 1;
    return 0;
  }
  const v = Math.abs(value);
  if (v >= t.th[2]) return 3;
  if (v >= t.th[1]) return 2;
  if (v >= t.th[0]) return 1;
  return 0;
}

/* ------------------------------------------------------------------ 测点生成 */
const RIBS = ['A', 'B'];
const FACES = ['TU', 'TD', 'IN', 'OT'];
const SECS = [1, 2, 3, 4, 5, 6];
const SEGS = [2, 5, 8, 11, 14, 17, 19, 21];

const sensors = [];
function add(o) { sensors.push(o); return o; }

/* 1) 主拱肋控制断面：2 片 × 6 断面 × 4 点 = 48 */
RIBS.forEach((rib) => SECS.forEach((sec, si) => FACES.forEach((face, fi) => {
  const t = [0.02, 0.16, 0.34, 0.5, 0.66, 0.84][si];
  add({
    code: `SG-PN3-AR-${rib}-${String(sec).padStart(2, '0')}-${face}-01`, type: 'SG', cat: '拱肋控制断面',
    pos: `${rib} 片拱肋 第 ${sec} 断面 ${face}`, rib, zone: `Z${si + 1}`,
    place: { kind: 'arch', rib, t, face: fi },
    base: (face === 'TU' ? 118 : face === 'TD' ? -96 : face === 'IN' ? 42 : -38) * (1 + 0.12 * Math.sin(si)),
    visual: true,
  });
})));
/* 2) 主拱肋节段监测：2 × 8 节段 × 2 点 = 32 */
RIBS.forEach((rib) => SEGS.forEach((sg) => ['TU', 'TD'].forEach((face, fi) => {
  const t = (sg - 0.5) / 22;
  add({
    code: `SG-PN3-AR-${rib}-S${String(sg).padStart(2, '0')}-${face}-01`, type: 'SG', cat: '拱肋节段',
    pos: `${rib} 片拱肋 第 ${sg} 节段中部 ${face}`, rib, zone: `Z${Math.min(6, Math.floor(t * 6) + 1)}`,
    place: { kind: 'arch', rib, t, face: fi === 0 ? 0 : 1 },
    base: (face === 'TU' ? 88 : -72) * (1 + 0.2 * Math.cos(sg)), visual: true,
  });
})));
/* 3) 桥面系纵梁：4 断面 × 4 点 = 16 */
[0.1, 0.32, 0.55, 0.78].forEach((x, xi) => ['L', 'R'].forEach((side) => ['TU', 'TD'].forEach((face, fi) => {
  add({
    code: `SG-PN3-DK-LG-${String(xi + 1).padStart(2, '0')}-${side}-${face}`, type: 'SG', cat: '桥面系纵梁',
    pos: `桥面系 第 ${xi + 1} 断面 ${side === 'L' ? '上游' : '下游'} 纵梁 ${face}`, rib: side, zone: 'Z7',
    place: { kind: 'deck', x, side, face: fi },
    base: (face === 'TU' ? -52 : 61) * (1 + 0.3 * Math.sin(xi * 2)), visual: true,
  });
})));
/* 4) 吊杆锚固区：8 × 2 = 16 */
[3, 7, 11, 15, 17, 21, 25, 29].forEach((hg, hi) => RIBS.forEach((rib) => {
  add({
    code: `SG-PN3-HG-${String(hg).padStart(2, '0')}-${rib}-01`, type: 'SG', cat: '吊杆锚固区',
    pos: `第 ${hg} 号吊杆 ${rib} 片锚固区`, rib, zone: 'Z8',
    place: { kind: 'hanger', idx: hg, rib },
    base: 46 * (1 + 0.35 * Math.cos(hi * 1.7)), visual: true,
  });
}));
/* 5) 塔架立柱：8 点（塔架模型未随桥体导入，台账保留、三维不挂接） */
RIBS.forEach((tw) => [1, 2].forEach((col) => ['TU', 'TD'].forEach((face) => {
  add({
    code: `SG-PN3-TW-${tw}-0${col}-${face}-01`, type: 'SG', cat: '塔架立柱',
    pos: `${tw} 塔 第 ${col} 根立柱 ${face}`, rib: tw, zone: 'Z9',
    place: null, base: -34, visual: false,
  });
})));

/* 6) 激光位移 4 */
[['A', 0.5, '跨中'], ['B', 0.5, '跨中'], ['A', 0.25, '1/4跨'], ['B', 0.25, '1/4跨']].forEach(([rib, t, nm]) => {
  add({
    code: `LD-PN3-AR-${rib}-${t === 0.5 ? 'MX' : 'Q1'}-01`, type: 'LD', cat: '激光位移',
    pos: `${rib} 片拱肋 ${nm} 下缘`, rib, zone: 'Z10',
    place: { kind: 'arch', rib, t, face: 1, offset: 0.1 },
    base: 0.62 * (t === 0.5 ? 1 : 0.52), visual: true,
  });
});
/* 7) 倾角 4（2 拱肋 + 2 塔架：塔架不挂接） */
RIBS.forEach((rib) => add({
  code: `IN-PN3-AR-${rib}-F01-01`, type: 'IN', cat: '倾角',
  pos: `${rib} 片拱肋 拱脚节段`, rib, zone: 'Z11',
  place: { kind: 'arch', rib, t: 0.05, face: 2 }, base: 0.012, visual: true,
}));
RIBS.forEach((tw) => add({
  code: `IN-PN3-TW-${tw}-T01-01`, type: 'IN', cat: '倾角',
  pos: `${tw} 塔 塔顶`, rib: tw, zone: 'Z11', place: null, base: 0.008, visual: false,
}));
/* 8) 振动加速度 4 */
[0.5, 0.25, 0.75, 0.5].forEach((x, i) => add({
  code: `AC-PN3-${i < 3 ? 'AR' : 'DK'}-${i < 3 ? RIBS[i % 2] : 'LG'}-A0${i + 1}-01`, type: 'AC', cat: '振动加速度',
  pos: `${i < 3 ? ['A 片拱肋跨中', 'B 片拱肋 1/4 跨', 'A 片拱肋 3/4 跨'][i] : '桥面系跨中'}`,
  rib: i < 3 ? RIBS[i % 2] : 'A', zone: 'Z12',
  place: i < 3 ? { kind: 'arch', rib: RIBS[i % 2], t: x, face: 1 } : { kind: 'deck', x, side: 'L', face: 1 },
  base: 0.006, visual: true,
}));
/* 9) 弦式索力计 4（扣索 / 吊杆） */
[[3, '扣索'], [11, '扣索'], [19, '吊杆'], [27, '吊杆']].forEach(([idx, kind]) => add({
  code: `CF-PN3-${kind === '扣索' ? 'CB-BK' : 'HG'}-${String(idx).padStart(2, '0')}-01`, type: 'CF', cat: '索力',
  pos: `第 ${idx} 号${kind}`, rib: 'A', zone: 'Z13',
  place: { kind: 'hanger', idx, rib: 'A' }, base: 28 + idx * 0.35, ref: 28 + idx * 0.35, visual: true,
}));
/* 10) 温湿度 3 */
[['拱顶附近', 0.5, 1], ['拱脚附近', 0.06, 0], ['机柜附近', -1, 0]].forEach(([nm, x, hi]) => add({
  code: `TH-PN3-EN-${hi ? 'T1' : x < 0 ? 'C1' : 'B1'}-01`, type: 'TH', cat: '温湿度',
  pos: `环境温度/湿度 · ${nm}`, rib: '-', zone: 'Z14',
  place: { kind: 'env', x, hi }, base: 24 + hi, visual: true,
}));
/* 11) 超声波风速 1 */
add({
  code: 'WS-PN3-EN-W1-01', type: 'WS', cat: '风速风向',
  pos: '实验区 无遮挡位置', rib: '-', zone: 'Z15',
  place: { kind: 'env', x: -1.15, hi: 1 }, base: 1.8, visual: true,
});

export const SENSORS = sensors;
export const SENSOR_BY_CODE = new Map(sensors.map((s) => [s.code, s]));
export const VISUAL_SENSORS = sensors.filter((s) => s.visual);

export const CATEGORY_STATS = (() => {
  const m = new Map();
  sensors.forEach((s) => {
    const k = s.type;
    if (!m.has(k)) m.set(k, { type: k, name: TYPES[k].name, design: 0, visual: 0 });
    const o = m.get(k); o.design++; if (s.visual) o.visual++;
  });
  return [...m.values()];
})();

/* 方案表 5-2：应变测点分配 */
export const ZONE_STATS = [
  ['拱肋控制断面', '2 片 × 6 断面 × 4 点', 48, 48],
  ['拱肋节段', '2 片 × 8 节段 × 2 点', 32, 32],
  ['桥面系纵梁', '4 断面 × 4 点', 16, 16],
  ['吊杆锚固区', '8 处 × 2 点', 16, 16],
  ['塔架立柱', '2 塔 × 2 柱 × 2 点', 8, 0],
];

/* 采集装置（方案第 3 项第 8 条：8 套） */
export const DEVICES = [
  { id: 'DAQ-01', pos: '拱脚 A 侧机柜', ai: 2, di: 1, do: 3, serial: 'RS485×2', points: 34, online: true },
  { id: 'DAQ-02', pos: '拱脚 A 侧机柜', ai: 2, di: 1, do: 2, serial: 'RS485×2', points: 32, online: true },
  { id: 'DAQ-03', pos: '跨中桥面系', ai: 1, di: 1, do: 2, serial: 'RS485×1', points: 12, online: true },
  { id: 'DAQ-04', pos: '跨中桥面系', ai: 1, di: 1, do: 2, serial: 'RS485×1', points: 10, online: true },
  { id: 'DAQ-05', pos: '拱脚 B 侧机柜', ai: 2, di: 1, do: 3, serial: 'RS485×2', points: 16, online: true },
  { id: 'DAQ-06', pos: '塔架 A 基座', ai: 1, di: 1, do: 2, serial: 'RS485×1', points: 8, online: true },
  { id: 'DAQ-07', pos: '塔架 B 基座', ai: 1, di: 1, do: 2, serial: 'RS485×1', points: 8, online: true },
  { id: 'DAQ-08', pos: '环境监测点', ai: 2, di: 1, do: 4, serial: 'RS485×1', points: 6, online: true },
];

/* 构件分类（与方案表 6-2 的 8 类构件对应，模型自动分类） */
export const MODEL_CATS = [
  { key: 'arch',   name: '主拱肋',       color: '#22d3ee', note: '两侧各 22 个预制节段（含合龙段）' },
  { key: 'hanger', name: '吊杆',         color: '#f5a524', note: '32 对，间距 15.5 cm' },
  { key: 'deck',   name: '桥面系',       color: '#4c8dff', note: '钢格子梁，宽 36.5 cm' },
  { key: 'brace',  name: '横联与腹杆',   color: '#a78bfa', note: '横联 φ10、腹杆 φ8' },
  { key: 'other',  name: '其他构件',     color: '#7c93b4', note: '附属与连接构件' },
];

export const CODE_RULES = [
  ['SG', '应变', 'SG-PN3-AR-A-07-TU-01', '电阻应变片'],
  ['LD', '激光位移', 'LD-PN3-AR-A-MX-01', '激光位移传感器'],
  ['IN', '倾角', 'IN-PN3-AR-B-F01-01', '三轴倾角传感器'],
  ['AC', '振动加速度', 'AC-PN3-AR-A-A01-01', '压电加速度传感器'],
  ['CF', '索力', 'CF-PN3-CB-BK-03-01', '弦式索力计'],
  ['TH', '温湿度', 'TH-PN3-EN-T1-01', '温湿度传感器'],
  ['WS', '风速风向', 'WS-PN3-EN-W1-01', '超声波风速仪'],
];

/* RBAC / 组织 / 用户 / 日志（方案 6.9） */
export const ROLES = [
  ['系统管理员', '全部组织', '全部菜单', '增删改查 / 配置阈值 / 导出', 1],
  ['教师（项目负责人）', '本课题组', '总览·分析·预警·台账', '查询 / 导出 / 阈值组切换', 4],
  ['实验技术人员', '土木学院', '总览·分析·台账', '查询 / 校准录入 / 导出', 3],
  ['研究生', '本课题组（限本人测点）', '总览·分析', '查询 / 导出本人数据', 12],
  ['本科生（教学）', '本组实验测点', '总览（只读）', '只读', 40],
  ['只读访客', '展示数据', '总览（只读）', '只读', 2],
];
export const ORG_TREE = [
  ['广西大学', 1],
  ['土木建筑工程学院', 2],
  ['桥梁工程系', 3], ['结构试验中心', 3], ['智能建造研究团队', 3],
  ['广西路桥工程集团有限公司', 2],
  ['技术中心', 3], ['信息化管理部', 3],
];
export const USERS = [
  ['admin', '系统管理员', '系统管理员', '广西路桥 / 信息化管理部', '启用', '85 天'],
  ['zhou_xh', '周筱航', '教师（项目负责人）', '广西大学 / 桥梁工程系', '启用', '62 天'],
  ['lu_jin', '陆进', '系统管理员', '广西路桥 / 技术中心', '启用', '120 天'],
  ['lab_01', '实验室技术员', '实验技术人员', '广西大学 / 结构试验中心', '启用', '54 天'],
  ['stu_g01', '研究生一组', '研究生', '广西大学 / 智能建造研究团队', '启用', '31 天'],
  ['stu_b203', '本科教学班', '本科生（教学）', '广西大学 / 桥梁工程系', '启用', '18 天'],
];

/* ------------------------------------------------------------------ 工况与仿真 */
const STEP_MS = 1000;

export function createEngine() {
  const state = new Map();
  SENSORS.forEach((s) => {
    const r = rnd(hash(s.code));
    state.set(s.code, {
      base: s.base, phase: r() * Math.PI * 2, drift: (r() - 0.5) * 0.02,
      noise: s.type === 'AC' ? 0.35 : 0.09, r,
    });
  });

  const engine = {
    load: 0,            // 0~1 加载工况强度
    loadT0: 0,
    updated: Date.now(),
    alarms: [],
    logs: [],
    seq: 0,

    /* 理论值（用于理论—实测对比，方案 6.6.3） */
    theoryOf(code, t) {
      const s = SENSOR_BY_CODE.get(code); if (!s) return 0;
      const st = state.get(code);
      const h = (t / 3600000);
      const diurnal = Math.sin((h - 6) / 24 * Math.PI * 2);
      switch (s.type) {
        case 'SG': return s.base * (1 + 0.06 * diurnal);
        case 'LD': return s.base * (1 + 0.05 * diurnal) + 0.04 * Math.sin(h * 1.7);
        case 'IN': return s.base * (1 + 0.1 * diurnal);
        case 'AC': return s.base * (0.85 + 0.3 * Math.abs(Math.sin(h * 2.3)));
        case 'CF': return s.base;
        case 'TH': return s.base + 4.2 * diurnal;
        case 'WS': return 1.5 + 0.9 * Math.sin(h * 0.9 + st.phase);
        default: return s.base;
      }
    },

    /* 实测值 */
    valueOf(code, t) {
      const s = SENSOR_BY_CODE.get(code); if (!s) return 0;
      const st = state.get(code);
      const th = engine.theoryOf(code, t);
      const r = rnd(hash(code) ^ Math.floor(t / STEP_MS));
      const noise = gauss(r) * st.noise * (s.type === 'AC' ? 0.6 : 4.5);
      const g = engine.loadGain(s, t);
      return th * (1 + g) + noise + st.drift * th;
    },

    loadGain(s, t) {
      if (engine.load <= 0.001) return 0;
      const dt = (t - engine.loadT0) / 1000;
      const env = Math.min(1, dt / 6) * Math.exp(-Math.max(0, dt - 20) / 45);
      const k = engine.load * env;
      switch (s.type) {
        case 'SG': return k * (s.base > 0 ? 0.85 : 0.62);
        case 'LD': return k * 0.9;
        case 'IN': return k * 0.5;
        case 'AC': return k * 1.6;
        case 'CF': return k * 0.18;
        default: return 0;
      }
    },

    /* 历史序列（可复现） */
    history(code, tEnd, minutes, stepMin = 1) {
      const out = [];
      const step = stepMin * 60000;
      const n = Math.floor(minutes / stepMin);
      for (let i = n; i >= 0; i--) {
        const t = tEnd - i * step;
        out.push([t, engine.valueOf(code, t), engine.theoryOf(code, t)]);
      }
      return out;
    },

    fireLoadEvent() {
      engine.load = 0.62 + Math.random() * 0.34;
      engine.loadT0 = Date.now();
      engine.pushLog('操作', 'admin', '注入加载工况（演示）', '成功');
      return engine.load;
    },

    pushLog(type, user, obj, result) {
      engine.logs.unshift([new Date().toLocaleTimeString('zh-CN', { hour12: false }), type, user, obj, result]);
      if (engine.logs.length > 60) engine.logs.pop();
    },

    /* 每秒 tick：刷新状态与告警 */
    tick(now) {
      engine.updated = now;
      if (engine.load > 0) {
        const dt = (now - engine.loadT0) / 1000;
        if (dt > 150) engine.load = 0;
      }
      SENSORS.forEach((s) => {
        const v = engine.valueOf(s.code, now);
        const st = statusOf(s.type, v, s.ref);
        s.value = v; s.status = st;
      });
      /* 告警产生与恢复 */
      SENSORS.forEach((s) => {
        if (s.status <= 0) {
          const ex = engine.alarms.find((a) => a.code === s.code && a.status !== '已恢复');
          if (ex) { ex.status = '已恢复'; ex.recT = now; }
          return;
        }
        const th = s.type === 'CF' ? [s.ref * (1 + TYPES.CF.th[0]), s.ref * (1 + TYPES.CF.th[1]), s.ref * (1 + TYPES.CF.th[2])][s.status - 1]
                                   : TYPES[s.type].th[s.status - 1];
        const open = engine.alarms.find((a) => a.code === s.code && a.status !== '已恢复');
        if (open) {
          if (open.level !== s.status) { open.level = s.status; open.value = s.value; open.th = th; open.t = now; }
          else { open.value = s.value; }
        } else {
          engine.alarms.unshift({
            id: ++engine.seq, t: now, code: s.code, type: s.type, level: s.status,
            value: s.value, th, status: '未确认', pos: s.pos, cat: s.cat,
          });
          if (engine.alarms.length > 200) engine.alarms.pop();
        }
      });
      return engine.alarms.filter((a) => a.status !== '已恢复').length;
    },

    /* 端到端延迟预算（方案表 2-3） */
    latency() {
      const r = rnd(hash('lat') ^ Math.floor(Date.now() / 5000));
      const s1 = 0.06 + r() * 0.04, s2 = 0.11 + r() * 0.08, s3 = 0.14 + r() * 0.15;
      const s4 = 0.09 + r() * 0.09, s5 = 0.28 + r() * 0.29;
      return [
        ['传感器采集', s1], ['边缘处理', s2], ['网络传输', s3], ['入库与索引', s4], ['推送与渲染', s5],
      ];
    },
  };
  return engine;
}

/* ------------------------------------------------------------------ 吊装推演序列
   工序：两岸对称、先拱脚后拱顶；每片拱肋 22 个预制节段，拱顶节段为可拆卸合龙段。
   合计 11 轮 × 4 个节段 = 44 个节段 + 拱顶合龙（第 11 轮即含合龙段）。 */
export const HOIST_SEQ = (() => {
  const seq = [];
  const push = (rib, seg, t, closure, round) => {
    const elev = 1.52 * (1 - (2 * t - 1) ** 2);
    seq.push({
      idx: seq.length + 1, rib, seg, t, closure, round,
      label: `${rib} 片 第 ${seg} 节段${closure ? '（拱顶合龙段）' : ''}`,
      tip: +(0.35 + 2.55 * (t * t)).toFixed(2),
      cable: +(11 + 27 * (1 - Math.abs(2 * t - 1))).toFixed(1),
      elev: +elev.toFixed(3),
      stage: round <= 4 ? 0 : round <= 8 ? 1 : 2,
    });
  };
  for (let i = 1; i <= 11; i++) {
    const tl = (i - 0.5) / 22, tr = (23 - i - 0.5) / 22;
    const closure = i === 11;
    push('A', i, tl, closure, i);
    push('A', 23 - i, tr, closure, i);
    push('B', i, tl, closure, i);
    push('B', 23 - i, tr, closure, i);
  }
  return seq;
})();

export const HOIST_STEPS = [
  '拱脚节段安装并临时固定，安装第一节段扣索',
  '自拱脚向跨中逐段悬臂拼装，每节段张拉对应扣索',
  '两岸对称同步推进，复测线形与索力并调整',
  '安装拱顶合龙段，微调螺杆调整合龙间隙与线形',
  '按既定顺序拆除扣索，完成体系转换形成成桥状态',
];

export const DEMO_NOTE = '本演示数据由前端仿真引擎生成，用于验证功能链路与交互设计，不代表真实采集数据。';

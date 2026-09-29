/* ==========================================================================
   charts.js —— ECharts 图表层（监测总览 / 数据分析）
   统一深色科技主题；阈值标线、理论—实测同轴对比、导出能力均对应方案 6.6
   ========================================================================== */
import { TYPES, STATUS } from './data.js';

const LINE = 'rgba(56,189,248,.12)';
const TXT = '#a8c0dc';
const TXT_DIM = '#7c93b4';

const axisBase = (name = '') => ({
  name, nameTextStyle: { color: TXT_DIM, fontSize: 10 },
  axisLine: { lineStyle: { color: 'rgba(56,189,248,.35)' } },
  axisLabel: { color: TXT_DIM, fontSize: 10 },
  splitLine: { lineStyle: { color: LINE } },
  axisTick: { show: false },
});

const baseOption = (extra = {}) => Object.assign({
  backgroundColor: 'transparent',
  animation: true,
  animationDuration: 320,
  textStyle: { fontFamily: '"Microsoft YaHei",sans-serif' },
  grid: { left: 46, right: 18, top: 30, bottom: 26 },
  tooltip: {
    trigger: 'axis', backgroundColor: 'rgba(9,21,39,.94)', borderColor: 'rgba(56,189,248,.35)',
    textStyle: { color: '#dcebff', fontSize: 11 }, axisPointer: { type: 'line', lineStyle: { color: 'rgba(34,211,238,.5)' } },
  },
  legend: { textStyle: { color: TXT, fontSize: 10.5 }, itemWidth: 12, itemHeight: 7, top: 2, right: 8 },
}, extra);

export function createCharts() {
  const inst = new Map();

  function ensure(id) {
    if (inst.has(id)) return inst.get(id);
    const dom = document.getElementById(id);
    if (!dom) return null;
    const ch = echarts.init(dom, null, { renderer: 'canvas' });
    inst.set(id, ch);
    return ch;
  }

  function set(id, option, notMerge = true) {
    const ch = ensure(id); if (!ch) return;
    ch.setOption(option, notMerge);
  }

  const api = {
    ensure,

    /* 拱肋应变：多测点滚动曲线 + 阈值标线 */
    strain(series, th) {
      set('chStrain', baseOption({
        grid: { left: 50, right: 20, top: 34, bottom: 26 },
        xAxis: Object.assign(axisBase(''), { type: 'category', data: series[0]?.t || [], boundaryGap: false }),
        yAxis: Object.assign(axisBase('με'), { type: 'value', scale: true }),
        series: series.map((s) => ({
          name: s.name, type: 'line', data: s.v, smooth: true, showSymbol: false,
          lineStyle: { width: 1.6, color: s.color }, itemStyle: { color: s.color },
          areaStyle: { opacity: 0.06, color: s.color },
          markLine: s.main ? {
            silent: true, symbol: 'none',
            data: [
              { yAxis: th[1], lineStyle: { color: STATUS[2].color, type: 'dashed', width: 1 }, label: { formatter: '报警 ' + th[1], color: STATUS[2].color, fontSize: 10 } },
              { yAxis: th[2], lineStyle: { color: STATUS[3].color, type: 'dashed', width: 1 }, label: { formatter: '紧急 ' + th[2], color: STATUS[3].color, fontSize: 10 } },
            ],
          } : undefined,
        })),
      }));
    },

    /* 索力：实测 vs 设计（参考）值，并按 ±10/15/20% 阈值着色 */
    cable(items) {
      set('chCable', baseOption({
        grid: { left: 46, right: 14, top: 30, bottom: 30 },
        legend: { show: true, top: 2, right: 8 },
        xAxis: Object.assign(axisBase(''), { type: 'category', data: items.map((i) => i.n), axisLabel: { color: TXT_DIM, fontSize: 9.5, interval: 0, rotate: 12 } }),
        yAxis: Object.assign(axisBase('kN'), { type: 'value', scale: true }),
        series: [
          {
            name: '实测', type: 'bar', barWidth: '52%', data: items.map((i) => ({
              value: +i.v.toFixed(2),
              itemStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: STATUS[i.s].color }, { offset: 1, color: 'rgba(34,211,238,.12)' }]),
                borderRadius: [3, 3, 0, 0],
              },
            })),
          },
          {
            name: '设计值', type: 'line', symbol: 'circle', symbolSize: 6, smooth: false,
            data: items.map((i) => +i.ref.toFixed(2)),
            lineStyle: { color: '#a78bfa', width: 1.2, type: 'dashed' }, itemStyle: { color: '#a78bfa' },
          },
        ],
      }));
    },

    /* 桥面竖向位移：理论 vs 实测 */
    disp(t, measured, theory) {
      set('chDisp', baseOption({
        grid: { left: 46, right: 16, top: 32, bottom: 24 },
        xAxis: Object.assign(axisBase(''), { type: 'category', data: t, boundaryGap: false }),
        yAxis: Object.assign(axisBase('mm'), { type: 'value', scale: true }),
        series: [
          { name: '实测', type: 'line', data: measured, smooth: true, showSymbol: false, lineStyle: { width: 2, color: '#22d3ee' }, itemStyle: { color: '#22d3ee' }, areaStyle: { opacity: 0.08, color: '#22d3ee' } },
          { name: '理论', type: 'line', data: theory, smooth: true, showSymbol: false, lineStyle: { width: 1.4, color: '#a78bfa', type: 'dashed' }, itemStyle: { color: '#a78bfa' } },
        ],
      }));
    },

    /* 环境量三联 */
    env(t, temp, hum, wind) {
      set('chEnv', baseOption({
        grid: { left: 40, right: 42, top: 32, bottom: 24 },
        xAxis: Object.assign(axisBase(''), { type: 'category', data: t, boundaryGap: false }),
        yAxis: [
          Object.assign(axisBase('℃ / %RH'), { type: 'value', scale: true }),
          Object.assign(axisBase('m/s'), { type: 'value', scale: true, splitLine: { show: false } }),
        ],
        series: [
          { name: '温度', type: 'line', data: temp, smooth: true, showSymbol: false, lineStyle: { width: 1.8, color: '#10d9a0' }, itemStyle: { color: '#10d9a0' } },
          { name: '湿度', type: 'line', data: hum, smooth: true, showSymbol: false, lineStyle: { width: 1.4, color: '#4c8dff' }, itemStyle: { color: '#4c8dff' } },
          { name: '风速', type: 'line', yAxisIndex: 1, data: wind, smooth: true, showSymbol: false, lineStyle: { width: 1.4, color: '#8ee6ff' }, itemStyle: { color: '#8ee6ff' } },
        ],
      }));
    },

    /* 历史查询：单测点 + dataZoom + 阈值 */
    history(title, data, unit, th) {
      set('chHistory', baseOption({
        grid: { left: 56, right: 24, top: 40, bottom: 62 },
        dataZoom: [
          { type: 'inside', start: 40, end: 100 },
          { type: 'slider', height: 18, bottom: 12, borderColor: 'rgba(56,189,248,.25)', textStyle: { color: TXT_DIM, fontSize: 10 }, dataBackground: { lineStyle: { color: '#22d3ee' }, areaStyle: { color: 'rgba(34,211,238,.15)' } } },
        ],
        xAxis: Object.assign(axisBase(''), { type: 'category', data: data.map((d) => d.t), boundaryGap: false }),
        yAxis: Object.assign(axisBase(unit), { type: 'value', scale: true }),
        series: [
          { name: '实测', type: 'line', data: data.map((d) => +d.v.toFixed(4)), smooth: true, showSymbol: false, lineStyle: { width: 2, color: '#22d3ee' }, itemStyle: { color: '#22d3ee' }, areaStyle: { opacity: 0.07, color: '#22d3ee' } },
          { name: '理论', type: 'line', data: data.map((d) => +d.th.toFixed(4)), smooth: true, showSymbol: false, lineStyle: { width: 1.2, color: '#a78bfa', type: 'dashed' }, itemStyle: { color: '#a78bfa' } },
        ],
      }));
      const ch = ensure('chHistory');
      if (ch) ch.setOption({
        series: [{ markLine: { silent: true, symbol: 'none', data: th.map((v, i) => ({ yAxis: v, lineStyle: { color: STATUS[i + 1].color, type: 'dashed', width: 1 } })) } }],
      });
    },

    resize() { inst.forEach((c) => c.resize()); },
    exportPng(id) { const c = ensure(id); return c ? c.getDataURL({ pixelRatio: 2, backgroundColor: '#04070f' }) : null; },
    disposeAll() { inst.forEach((c) => c.dispose()); inst.clear(); },
  };
  return api;
}

/* 迷你走势图（Canvas 直绘，避免大量图表实例） */
export function spark(canvas, values, color) {
  const w = canvas.clientWidth || 120, h = canvas.clientHeight || 16;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!values || values.length < 2) return;
  const min = Math.min(...values), max = Math.max(...values), rng = (max - min) || 1;
  g.beginPath();
  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - 2 - ((v - min) / rng) * (h - 4);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.strokeStyle = color; g.lineWidth = 1.2; g.stroke();
  g.lineTo(w, h); g.lineTo(0, h); g.closePath();
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, color + '55'); grd.addColorStop(1, color + '00');
  g.fillStyle = grd; g.fill();
}

export { TYPES };

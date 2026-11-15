/**
 * 跨服卡池对比的**时差折线** option（纯函数，`CrossServerChart.vue` 与 `verify-render` 共用）。
 *
 * 口径（2026-11-15 用户定）：
 * - **只画跟国服相关的两个差值**：`国际服 − 国服`（`gapEnSc`）、`繁中服 − 国服`（`gapTcSc`）。
 *   三个时差里的 `EN-TC` **不进图**（表格里那一列照旧）。
 * - **横轴 = 国服开始日期**（`scStart`）；没有国服日期的行不画（连 x 都没有）。
 * - 负值 = 该服比国服早（与表格 `.neg` 同一语义），0 轴画一条虚线当参照。
 *
 * ⚠️ 两条 series 用**同一套 x**（缺的那条给 `null`、`connectNulls: false`）——
 *   axis 触发的 tooltip 靠 `dataIndex` 对齐，各画各的 x 会错位。
 */

const BLUE = '#2563b0';
const AMBER = '#c2410c';
const MUTED = '#7b8794';
const AXIS = '#c9dcf3';
const GRID_LINE = '#eef3f9';

/** 有国服开始日的行，按时间升序（折线要按 x 递增连线，不能跟表格的排序走） */
export function crossChartPoints(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.scStart)
    .slice()
    .sort((a, b) => (a.scStart < b.scStart ? -1 : a.scStart > b.scStart ? 1 : 0));
}

/**
 * @param {Array<object>} rows `site.crossRows`（已按右栏筛选过）
 * @returns {object} echarts option
 */
export function crossChartOption(rows = []) {
  const pts = crossChartPoints(rows);
  const dataOf = (key) => pts.map((r) => [r.scStart, r[key] ?? null]);
  const line = (name, key, color) => ({
    name,
    type: 'line',
    data: dataOf(key),
    connectNulls: false,
    showSymbol: false,
    symbolSize: 6,
    lineStyle: { width: 2, color },
    itemStyle: { color },
    emphasis: { focus: 'none' },
  });

  return {
    animation: false,
    grid: { left: 46, right: 18, top: 46, bottom: 30 },
    legend: {
      top: 4, right: 0, itemWidth: 14, itemHeight: 8,
      textStyle: { fontSize: 11, color: MUTED },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: AXIS } },
      formatter(params) {
        const r = pts[params?.[0]?.dataIndex];
        if (!r) return '';
        const row = (label, v) => (v === null || v === undefined
          ? `<span style="color:${MUTED}">${label}：—</span>`
          : `${label}：<b>${v > 0 ? '+' : ''}${v}</b> 天`);
        return [
          `<b>${r.name}</b>`,
          `国服开始：${r.scStart}`,
          row('国际服 − 国服', r.gapEnSc),
          row('繁中服 − 国服', r.gapTcSc),
          `<span style="color:${MUTED}">负数 = 该服比国服早</span>`,
        ].join('<br/>');
      },
    },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: AXIS } },
      axisTick: { lineStyle: { color: AXIS } },
      axisLabel: { fontSize: 10, color: MUTED, hideOverlap: true },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: '天数',
      nameTextStyle: { fontSize: 10, color: MUTED, align: 'right' },
      axisLabel: { fontSize: 10, color: MUTED },
      splitLine: { lineStyle: { color: GRID_LINE } },
    },
    series: [
      {
        ...line('国际服 − 国服', 'gapEnSc', BLUE),
        /* 0 轴 = 「与国服同期」 */
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: AXIS, type: 'dashed' },
          data: [{ yAxis: 0 }],
        },
      },
      line('繁中服 − 国服', 'gapTcSc', AMBER),
    ],
  };
}

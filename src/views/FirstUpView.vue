<script setup>
/**
 * 首次UP间隔。
 *
 * 「首次UP」有两种**统计模式**（右栏顶部切换，用户 2026-10-02 加）：
 * - **首次进店**（默认）：卡池的 `isShop` 标记 → 该干员首次进商店兑换的日期
 * - **首次轮换**：进入「常驻标准寻访 / 联合行动 / 定向甄选 / 前路回响」最早的一次
 *   （名单见 constants.js 的 `ROTATION_TYPES`；不看进店标记）
 * 两种模式下面这套「横轴 / 纵轴」口径都一样，只是「首次日期」换了来源 ——
 * 所以本组件里**只认 `data.mode`，不自己做分支**（文案词统一从 constants 取）。
 *
 * 另外两个可切换的口径（右栏）：
 * - 横轴 `firstUpAxis`：按**首次日期**（默认）/ 按**实装日期**
 * - 纵轴 `firstUpMetric`：距**同星级上一个首次日期**（默认）/ 距**该干员实装日**
 * 六星、五星各自成一条序列，**间隔只在同星级内部比较**
 * （六星与五星的进店名额/节奏不同，跨星级相减没有意义）。
 *
 * 三个容易踩的点：
 * 1. 纵轴刻度固定在左右两侧：绘图区要横向滚动（点数太多，一屏放不下还要标干员名），
 *    而 echarts 画的 y 轴会跟着滚出视野。所以把刻度**抽出来做成两个 sticky 的刻度条**
 *    （.ybar-l / .ybar-r），echarts 那边关掉 axisLabel、只留 splitLine。
 *    两边要对齐 → grid 的 top/height/left/right 全部写死像素，刻度文本位置按同一个公式算。
 * 2. 刻度步长随纵轴口径与**筛选后的数据**变化：`gap` 以 **14 天（两周）为基准**、随跨度放大或缩到 7 天，
 *    且**下界也可能为负**（按实装日期排序时，后实装却更早进店的干员会算出负间隔）；
 *    `sinceRelease` 的**起点取筛选后数据的下界**（不是 0 —— 例如筛到近 2 年时，能在近两年
 *    进店的干员都是等了好几年的老干员，从 0 画起会把折线压成一条直线），
 *    步长用「整齐」步长（1/2.5/5 × 10ⁿ 那套）。
 * 3. 图片模式下点变成**圆形头像**（用 **custom 系列手绘 + zrender 的 `clipPath` 裁圆** ——
 *    `symbol:'image://…'` 不能裁剪，方形素材会直接显示成方块），此时不显示名字标签。
 *
 * ⚠️ 另外，下面 tooltip 的 `formatter` 是 **echarts 在客户端**调用的 → **SSR 出的 HTML 里不含浮窗内容**，
 * 所以 `verify-render` 里验浮窗文案只能 `fs.readFileSync` 读本文件源码（别去 HTML 里找，永远找不到）。
 * 浮窗显示的字段：干员 / 实装日 / 首次日期 / **所在卡池**（`r.firstBanner`）/ 间隔天数 / 累计次数。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useSiteStore } from '../stores/site.js';
import { avatarUrl } from '../lib/avatars.js';
import { modeFirstLabel, modeWord } from '../lib/firstUp.js';
import EChart from '../components/EChart.vue';
import { useDragPan } from '../composables/useDragPan.js';

const site = useSiteStore();
const data = computed(() => site.firstUp);
const isImage = computed(() => site.avatarMode === 'image');

/** 「首次进店」/「首次轮换」——分节标题、tooltip、空态文案都用它 */
const firstLabel = computed(() => modeFirstLabel(data.value.mode));
/** 「进店」/「轮换」——「累计 N 次」「没有 N 记录」这类句子里的词 */
const word = computed(() => modeWord(data.value.mode));

/* ---- 布局常量：grid 与两侧刻度条必须严格对齐，因此全部用固定像素 ---- */
const GRID = { top: 30, height: 300, left: 56, right: 56, bottom: 96 };
const CHART_H = GRID.top + GRID.height + GRID.bottom; // 426
const TICK_STEP = 14;   // 纵轴 = 距上个首次日期时的刻度步长（天）
const POINT_W = 52;     // 每个点占的宽度（要放得下干员名标签 / 头像）
const AVATAR_PT = 30;   // 图片模式下点的直径

const BLUE = '#2563b0';
const BLUE_DARK = '#1b4f9c';
const MUTED = '#7b8794';
const GRID_LINE = '#eef3f9';

/** 刻度序列（含首尾），避免浮点误差累加 */
function tickRange(min, max, step) {
  const out = [];
  for (let v = min; v <= max + 1e-6; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/** 「整齐」步长：1 / 2 / 2.5 / 5 × 10ⁿ（base < 10 时避开 2.5，免得出现 2.5 天这种步长） */
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const base = 10 ** Math.floor(Math.log10(raw));
  for (const m of (base >= 10 ? [1, 2, 2.5, 5] : [1, 2, 5])) {
    if (raw <= m * base) return m * base;
  }
  return 10 * base;
}

/**
 * 「距上个首次日期」的步长：以 14（两周）为基准，随**筛选后**的跨度自适应 ——
 * 目标 6 段左右，跨度很小时允许降到 7（一周）。这样缩小时间范围后
 * 纵轴不会还是「0 / 14 / 28」那几条、也不会因为跨度大而糊成一片。
 */
function pickGapStep(span) {
  const target = Math.max(span, 1) / 6;
  if (target <= 7) return 7;
  return 14 * Math.ceil(target / 14);
}

/**
 * 纵轴范围与刻度：**起点与步长都跟随筛选后的数据**。
 *
 * - `gap`：0 是「紧邻上一次」的基准，所以范围始终含 0（有负间隔时下界更低）
 * - `sinceRelease`：起点直接取数据的下界 —— 例如筛到「近 N 年」时，
 *   能在近两年进店的干员都是等了很多年的老干员，最小值可能就有 600 天，
 *   这时纵轴就该从 600 起，而不是从 0 画起把折线压成一条直线
 *
 * @returns {{yMin:number,yMax:number,step:number,ticks:number[]}}
 */
function axisOf(rows, metric) {
  const vals = rows.map((r) => r.value).filter((v) => typeof v === 'number');
  if (!vals.length) return { yMin: 0, yMax: TICK_STEP, step: TICK_STEP, ticks: [0, TICK_STEP] };

  const rawMax = Math.max(...vals);
  const rawMin = Math.min(...vals);

  if (metric === 'gap') {
    const dataMax = Math.max(rawMax, 0);
    const dataMin = Math.min(rawMin, 0);
    const step = pickGapStep(dataMax - dataMin);
    const yMin = Math.floor(dataMin / step) * step;
    /* 至少留 3 段，避免筛到只剩两三个点时图被压成一条线 */
    const yMax = Math.max(yMin + step * 3, Math.ceil(dataMax / step) * step);
    return { yMin, yMax, step, ticks: tickRange(yMin, yMax, step) };
  }

  const step = niceStep((rawMax - rawMin) / 6);
  const yMin = Math.floor(rawMin / step) * step;
  const yMax = Math.max(yMin + step * 3, Math.ceil(rawMax / step) * step);
  return { yMin, yMax, step, ticks: tickRange(yMin, yMax, step) };
}

const axis6 = computed(() => axisOf(data.value.six, data.value.metric));
const axis5 = computed(() => axisOf(data.value.five, data.value.metric));

/** 刻度文本的纵向位置：与 echarts value 轴 label 一致（刻度线中心对齐） */
const tickTop = (v, ax) => GRID.top + ((ax.yMax - v) / ((ax.yMax - ax.yMin) || 1)) * GRID.height;

const chartW = (rows) => rows.length * POINT_W + 40;
const rowW = (rows) => chartW(rows) + GRID.left + GRID.right;

const avatarOf = (name) => avatarUrl(site.operators[name] || { name }, 'circle');

function buildOption(rows, rarity, ax) {
  const image = isImage.value;
  return {
    animationDuration: 260,
    grid: {
      top: GRID.top,
      height: GRID.height,
      left: GRID.left,
      right: GRID.right,
      containLabel: false,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: '#c9dcf3' } },
      confine: true,
      formatter(params) {
        const r = rows[params[0]?.dataIndex];
        if (!r) return '';
        const lines = [`<b>${r.name}</b>（${rarity}★）`,
          `实装：${r.releaseDate || '—'}`,
          `${firstLabel.value}：${r.firstDate}`,
          /* 那次「首次」发生在哪个卡池 —— 轮换口径下尤其有用（可能是标准 / 联合 / 定向 / 前路之一），
             与上一行的日期同源（都由 firstUp.js 里同一次卡池给出） */
          `所在卡池：${r.firstBanner || '—'}`];

        if (data.value.metric === 'gap') {
          lines.push(
            r.gap === null
              ? '<span style="color:#7b8794">该星级序列首位，没有前序间隔</span>'
              : `距同星级上一个点「${r.prevName}」：<b>${r.gap}</b> 天`
                + (r.gap < 0 ? `<span style="color:#7b8794">（负数：更晚实装却更早${word.value}）</span>` : ''),
          );
        } else {
          lines.push(r.sinceRelease === null
            ? '<span style="color:#7b8794">缺少实装日</span>'
            : `${firstLabel.value}距实装：<b>${r.sinceRelease}</b> 天`);
        }
        lines.push(`累计${word.value} ${r.count} 次`);
        return lines.join('<br/>');
      },
    },
    xAxis: {
      type: 'category',
      data: rows.map((r) => r.xLabel),
      boundaryGap: false,
      axisTick: { alignWithLabel: true, lineStyle: { color: '#c9dcf3' } },
      axisLine: { lineStyle: { color: '#c9dcf3' } },
      axisLabel: { rotate: 60, fontSize: 10, color: MUTED, margin: 10 },
    },
    yAxis: {
      type: 'value',
      min: ax.yMin,
      max: ax.yMax,
      interval: ax.step,
      /* 刻度文本交给两侧的固定刻度条，这里只保留网格线 */
      axisLabel: { show: false },
      axisTick: { show: false },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: GRID_LINE } },
    },
    series: [
      {
        type: 'line',
        name: `${rarity}星`,
        data: rows.map((r) => r.value),
        connectNulls: false,
        /* 图片模式下点交给下面的 custom 系列画（要裁成圆），线本身不画符号 */
        symbol: image ? 'none' : 'circle',
        symbolSize: image ? AVATAR_PT : 7,
        lineStyle: { width: 2, color: BLUE },
        itemStyle: { color: BLUE },
        label: image
          ? { show: false }
          : {
            show: true,
            position: 'top',
            distance: 6,
            fontSize: 12,
            color: BLUE_DARK,
            formatter: (p) => rows[p.dataIndex].name,
          },
        /* 干员名一个都不许藏 —— 挤就挤，方便一眼扫到某位干员 */
        labelLayout: { hideOverlap: false },
      },
      /* 图片模式：用 custom 系列手绘**圆形**头像。
         ⚠️ 不能沿用 `symbol:'image://…'` —— 它只是把图贴上去，**没法裁剪**，
         方形素材会直接显示成方块。zrender 的 group 支持 clipPath，所以这里
         手绘并用圆形裁剪（与 UP 历史页同一套做法）。
         `silent` 交给折线系列处理悬停（axis 触发的 tooltip 不受影响）。 */
      ...(image ? [{
        type: 'custom',
        name: `${rarity}星头像`,
        data: rows.map((r, i) => [i, r.value]),
        silent: true,
        z: 10,
        renderItem(params, api) {
          const row = rows[params.dataIndex];
          if (!row || row.value === null) return null;
          const p = api.coord([api.value(0), api.value(1)]);
          const d = AVATAR_PT;
          return {
            type: 'group',
            clipPath: { type: 'circle', shape: { cx: p[0], cy: p[1], r: d / 2 } },
            children: [
              {
                type: 'image',
                style: {
                  image: avatarOf(row.name),
                  x: p[0] - d / 2,
                  y: p[1] - d / 2,
                  width: d,
                  height: d,
                },
              },
            ],
          };
        },
      }] : []),
    ],
  };
}

const option6 = computed(() => buildOption(data.value.six, 6, axis6.value));
const option5 = computed(() => buildOption(data.value.five, 5, axis5.value));

/* ---- 打开页面 / 调整筛选后，默认停在最右侧（最新的进店） ---- */
const scroll6 = ref(null);
const scroll5 = ref(null);

/* 鼠标按住拖拽平移（只认鼠标 —— 触摸交给浏览器的原生滑动，见 composables/useDragPan.js）。
   ⚠️ 两个容器共用一套处理函数：它们不会同时出现（一次只渲染一个星级），
   而且 useDragPan 内部同时只记一个活动指针，安全。
   这两个容器是 `overflow-y: hidden`，所以纵向那句跟手会被浏览器忽略 → 表现就是纯横向拖。 */
const { dragging, onPointerDown, onPointerMove, onPointerUp } = useDragPan();

function scrollToEnd() {
  for (const el of [scroll6.value, scroll5.value]) {
    if (el) el.scrollLeft = el.scrollWidth;
  }
}

onMounted(() => nextTick(scrollToEnd));
watch(
  () => [data.value.six.length, data.value.five.length],
  () => nextTick(scrollToEnd),
);

const rangeText = computed(() => {
  const { from, to } = site.firstUpRange;
  if (!from && !to) return '全部';
  return `${from || '…'} ~ ${to || '…'}`;
});

/* 口径文案：横轴 / 纵轴的「首次XX」都跟着统计模式变（用户指定：分节标题也跟随） */
const axisText = computed(
  () => (site.firstUpAxis === 'release' ? '按实装日期' : `按${firstLabel.value}日期`),
);
const metricText = computed(
  () => (site.firstUpMetric === 'sinceRelease' ? '距实装日' : `距上个${firstLabel.value}`),
);
</script>

<template>
  <div class="card">
    <div class="hd">
      <span class="count">
        六星 {{ data.six.length }} 位 · 五星 {{ data.five.length }} 位 ·
        横轴{{ axisText }} · 纵轴{{ metricText }} · 筛选范围 {{ rangeText }}
      </span>
    </div>

    <div class="grp-sep" id="g6">六星干员 · {{ firstLabel }}间隔</div>
    <div v-if="!data.six.length" class="empty">当前筛选范围内没有六星干员的{{ word }}记录</div>
    <div
      v-else ref="scroll6" class="chart-scroll" :class="{ dragging }"
      @pointerdown="onPointerDown" @pointermove="onPointerMove"
      @pointerup="onPointerUp" @pointercancel="onPointerUp"
    >
      <div class="chart-row" :style="{ width: `${rowW(data.six)}px` }">
        <div class="ybar ybar-l" :style="{ width: `${GRID.left}px`, flex: `0 0 ${GRID.left}px`, height: `${CHART_H}px` }">
          <span class="unit">天</span>
          <span v-for="t in axis6.ticks" :key="t" class="tk" :style="{ top: `${tickTop(t, axis6)}px` }">{{ t }}</span>
        </div>
        <EChart :option="option6" :width="chartW(data.six)" :height="CHART_H" />
        <div class="ybar ybar-r" :style="{ width: `${GRID.right}px`, flex: `0 0 ${GRID.right}px`, height: `${CHART_H}px` }">
          <span class="unit">天</span>
          <span v-for="t in axis6.ticks" :key="t" class="tk" :style="{ top: `${tickTop(t, axis6)}px` }">{{ t }}</span>
        </div>
      </div>
    </div>

    <div class="grp-sep" id="g5">五星干员 · {{ firstLabel }}间隔</div>
    <div v-if="!data.five.length" class="empty">当前筛选范围内没有五星干员的{{ word }}记录</div>
    <div
      v-else ref="scroll5" class="chart-scroll" :class="{ dragging }"
      @pointerdown="onPointerDown" @pointermove="onPointerMove"
      @pointerup="onPointerUp" @pointercancel="onPointerUp"
    >
      <div class="chart-row" :style="{ width: `${rowW(data.five)}px` }">
        <div class="ybar ybar-l" :style="{ width: `${GRID.left}px`, flex: `0 0 ${GRID.left}px`, height: `${CHART_H}px` }">
          <span class="unit">天</span>
          <span v-for="t in axis5.ticks" :key="t" class="tk" :style="{ top: `${tickTop(t, axis5)}px` }">{{ t }}</span>
        </div>
        <EChart :option="option5" :width="chartW(data.five)" :height="CHART_H" />
        <div class="ybar ybar-r" :style="{ width: `${GRID.right}px`, flex: `0 0 ${GRID.right}px`, height: `${CHART_H}px` }">
          <span class="unit">天</span>
          <span v-for="t in axis5.ticks" :key="t" class="tk" :style="{ top: `${tickTop(t, axis5)}px` }">{{ t }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * ECharts 包装组件。
 *
 * - **动态 import**：echarts 只在浏览器端、且只在组件挂载后才加载。
 *   SSR（scripts/verify-render.mjs）渲染页面时不会碰到 echarts 与 DOM。
 * - 容器尺寸变化时自动 `resize()`（横屏/抽屉开合都会改变宽度）。
 * - `width > 0` 时图表按该像素宽度绘制，配合外层容器的横向滚动
 *   （点数多的时候一屏塞不下，宁可让用户横向拖，也不把标签挤成一团）。
 * - **浮窗补丁**：`setOption` 前把 `option.tooltip` 换成「挂到全屏固定图层 + 手机竖屏放进可用带」
 *   那一套（见 lib/chartTooltip.js）——浮窗因此不会被 `.chart-scroll` 裁掉，手机上也不会
 *   被手指挡住 / 压住横轴 / 盖住折线图。
 *   ⚠️ 补丁必须**每次 `setOption` 都重打**：页面一改筛选就重建 option，而 `position` 回调
 *   取的是**当前** option 里的那个（它闭包着图表容器元素）；另外**断点变化**时也要重打，
 *   因为窄屏的紧凑样式是**打补丁那一刻**算出来的（`extraCssText` 不像 `position` 那样每次重读）。
 * - **浮窗互斥**：同一时刻只允许一张图有浮窗（手机上是「点一下」出浮窗、不会自动消失，
 *   点完六星再点五星会两个都留着）。见 lib/chartTooltip.js 的 `registerChart`。
 *   副作用：浮窗改画在固定图层上 → **任何滚动都先把浮窗收起来**（见 `onAnyScroll`），
 *   免得它停在原地、跟已经滚走的那个点脱节。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  patchTooltip, disposeTooltipLayer, registerChart, unregisterChart,
} from '../lib/chartTooltip.js';
import { useLayout } from '../composables/useLayout.js';

const props = defineProps({
  option: { type: Object, required: true },
  /** 图表宽度（px）；0 = 填满容器 */
  width: { type: Number, default: 0 },
  height: { type: Number, default: 380 },
  /** 浮窗可用带回调 `(host) => ({top?, bottom?, mode?})`（视口坐标）——见 lib/chartTooltip.js */
  tipBand: { type: Function, default: null },
});

const el = ref(null);
let chart = null;
let observer = null;
let unmounted = false;

/* 窄屏或竖屏 → 浮窗贴边（与抽屉「浮层形态」同一个断点） */
const { isNarrow } = useLayout();

/** 打浮窗补丁。`tooltip` 是数组（多浮窗）时不动 —— 本项目没有这种图，别猜它的语义。 */
function patchOption(opt) {
  if (!el.value || !opt?.tooltip || Array.isArray(opt.tooltip)) return opt;
  return {
    ...opt,
    tooltip: patchTooltip(opt.tooltip, el.value, {
      isPin: () => isNarrow.value,
      band: props.tipBand,
    }),
  };
}

/* 浮窗画在**全屏固定**图层上 → 横向滚动时它会停在原地，跟已经滚走的那根条脱节
   （原生「挂在图表里」是跟着一起滚的，没这个问题）。所以任何滚动都先把浮窗收起来。
   `scroll` 不冒泡但**会在捕获阶段经过 document**，所以一个捕获监听就能覆盖图表滚动区
   （`.chart-scroll` / `.tl-scroll`）与整页滚动。 */
function onAnyScroll() {
  chart?.dispatchAction({ type: 'hideTip' });
}

async function setup() {
  /* 动态加载按需引入好的 echarts（见 src/lib/charts.js）——
     SSR 渲染时不会执行到这里，echarts 与 DOM 都不会被碰到。 */
  const { default: echarts } = await import('../lib/charts.js');
  if (unmounted || !el.value) return;

  chart = echarts.init(el.value);
  chart.setOption(patchOption(props.option));
  registerChart(chart);
  observer = new ResizeObserver(() => chart?.resize());
  observer.observe(el.value);
  document.addEventListener('scroll', onAnyScroll, true);
}

onMounted(setup);

watch(
  () => props.option,
  (opt) => chart?.setOption(patchOption(opt), true),
  /* 不用 deep：option 都是 computed 生成的**新对象**，浅比较足够；
     而 UP 历史那种 2500+ 个点的 option 做深比较非常浪费 */
);

watch(
  () => [props.width, props.height],
  () => chart?.resize(),
);

/* 断点一变就重打补丁，让窄屏的紧凑样式（`extraCssText`）跟着转屏立刻生效。
   宽高变化会触发 resize → 位置按新尺寸重算，但 `extraCssText` 不会自己更新。 */
watch(isNarrow, () => chart?.setOption(patchOption(props.option), true));

onBeforeUnmount(() => {
  unmounted = true;
  document.removeEventListener('scroll', onAnyScroll, true);
  observer?.disconnect();
  observer = null;
  if (chart) unregisterChart(chart);
  chart?.dispose();
  chart = null;
  /* 浮窗图层挂在 body 上，得自己摘（浮窗 DOM 是 echarts 塞进去的，跟着图层一起走） */
  if (el.value) disposeTooltipLayer(el.value);
});
</script>

<template>
  <div
    ref="el"
    class="echart"
    :style="{ height: `${height}px`, ...(width ? { width: `${width}px` } : {}) }"
  />
</template>

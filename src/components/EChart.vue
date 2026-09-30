<script setup>
/**
 * ECharts 包装组件。
 *
 * - **动态 import**：echarts 只在浏览器端、且只在组件挂载后才加载。
 *   SSR（scripts/verify-render.mjs）渲染页面时不会碰到 echarts 与 DOM。
 * - 容器尺寸变化时自动 `resize()`（横屏/抽屉开合都会改变宽度）。
 * - `width > 0` 时图表按该像素宽度绘制，配合外层容器的横向滚动
 *   （点数多的时候一屏塞不下，宁可让用户横向拖，也不把标签挤成一团）。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  option: { type: Object, required: true },
  /** 图表宽度（px）；0 = 填满容器 */
  width: { type: Number, default: 0 },
  height: { type: Number, default: 380 },
});

const el = ref(null);
let chart = null;
let observer = null;
let unmounted = false;

async function setup() {
  /* 动态加载按需引入好的 echarts（见 src/lib/charts.js）——
     SSR 渲染时不会执行到这里，echarts 与 DOM 都不会被碰到。 */
  const { default: echarts } = await import('../lib/charts.js');
  if (unmounted || !el.value) return;

  chart = echarts.init(el.value);
  chart.setOption(props.option);
  observer = new ResizeObserver(() => chart?.resize());
  observer.observe(el.value);
}

onMounted(setup);

watch(
  () => props.option,
  (opt) => chart?.setOption(opt, true),
  /* 不用 deep：option 都是 computed 生成的**新对象**，浅比较足够；
     而 UP 历史那种 2500+ 个点的 option 做深比较非常浪费 */
);

watch(
  () => [props.width, props.height],
  () => chart?.resize(),
);

onBeforeUnmount(() => {
  unmounted = true;
  observer?.disconnect();
  observer = null;
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <div
    ref="el"
    class="echart"
    :style="{ height: `${height}px`, ...(width ? { width: `${width}px` } : {}) }"
  />
</template>

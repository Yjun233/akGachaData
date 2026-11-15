<script setup>
/**
 * 跨服卡池对比的**图表版**（2026-11-15 用户加）—— 挂在表格下面，同一路由 `/cross-server`。
 *
 * 与「首次UP间隔」不同：那边图表 / 表格是**两个独立路由**（左栏两个入口）；
 * 这里**同一页、表格在上图表在下**，左栏仍只有一个「跨服对比」。
 *
 * option 的构造抽在 `lib/crossChart.js`（纯函数，`verify-render` 直接吃那一条），
 * 本组件只负责取数（`site.crossRows`，已按右栏筛选）+ 标题。
 */
import { computed } from 'vue';
import EChart from './EChart.vue';
import { crossChartOption, crossChartPoints } from '../lib/crossChart.js';

const props = defineProps({
  rows: { type: Array, default: () => [] },
});

const points = computed(() => crossChartPoints(props.rows));
const option = computed(() => crossChartOption(props.rows));
</script>

<template>
  <section class="cross-chart">
    <div class="cc-head">
      <span class="cc-title">时差走势</span>
      <span class="cc-hint">横轴 = 国服开始日期；只画与国服相关的两个差值（国际服 / 繁中服相对国服）</span>
    </div>
    <p v-if="!points.length" class="cc-hint">当前筛选下没有可对比的卡池。</p>
    <EChart v-else :option="option" :height="300" />
  </section>
</template>

<script setup>
/**
 * 跨服卡池对比的**图表版**（2026-11-15 用户加）—— 独立路由 `/cross-server/chart`。
 *
 * 与表格版（`/cross-server`）是**两条并列路由**，左栏二级菜单里**表格版在上、图表版在下**
 * （用户指定，与「首次UP间隔」的图表在上相反）。两页共用同一套 `crossFilters`。
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
      <span class="cc-hint">横轴 = 国服开始日期；只画与国服相关的两个差值（国际服 / 繁中服相对国服），虚线 = 与国服同期</span>
    </div>
    <p v-if="!points.length" class="cc-hint">当前筛选下没有可对比的卡池。</p>
    <EChart v-else :option="option" :height="420" />
  </section>
</template>

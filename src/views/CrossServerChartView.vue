<script setup>
/**
 * 跨服卡池对比 · **图表版**（`/cross-server/chart`，2026-11-15 用户加）。
 *
 * 与表格版（`CrossServerView.vue`）是**两条并列路由**，共用同一套 `site.crossFilters` /
 * `crossRows`，左栏「跨服卡池对比」的二级菜单里**表格版在上、图表版在下**（用户指定）。
 *
 * 图只画**跟国服相关的两个差值**（国际服 − 国服、繁中服 − 国服），横轴 = 国服开始日期；
 * 口径与 option 构造全在 `lib/crossChart.js` 的文件头，本页只负责取数。
 *
 * ⚠️ 取数用 `crossRowsForChart`（**忽略右栏的「额外显示仅国服存在的卡池」**）—— 那批行只有国服，
 *    两个差值恒为 null，画不出点、只会把横轴拉长。见 store 里那个 getter 的说明。
 */
import { computed } from 'vue';
import { useSiteStore } from '../stores/site.js';
import CrossServerChart from '../components/CrossServerChart.vue';

const site = useSiteStore();

const rows = computed(() => site.crossRowsForChart);
</script>

<template>
  <div class="card">
    <CrossServerChart :rows="rows" />
  </div>
</template>

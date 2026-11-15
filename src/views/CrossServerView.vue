<script setup>
/**
 * 跨服卡池对比（`/cross-server`，2026-11-04 用户加）。
 *
 * **不受左栏服务器选择控制** —— 三服（国服 / 国际服 / 繁中服）的卡池按名称配对后一起列。
 * 筛选与排序都在右栏（`pane-cross`），状态在 `site.crossFilters` / `site.crossSort`，
 * 与卡池列表那套**分开存**，互不影响。
 *
 * ⚠️ **没有卡片头**（2026-11-04 用户删掉）。原来那行「三服按卡池名称配对 · 命中 N / M 期 ·
 * 6★ 名单不一致 K 期」与右栏结果条（`FilterDrawer.vue` 的 `crossResult`）完全重复，而右栏还多给了
 * 三服 / 两服 / 单服的行数拆分 → 只留右栏，别再往回加。
 *
 * ⭐ **图表版在表格下面**（2026-11-15 用户加）：与「首次UP间隔」不同，那边是**两个独立路由**
 * （`/first-up` 与 `/first-up/table`、左栏两个入口）；这里**同一页、表格在上图表在下**，
 * 左栏仍只有一个「跨服对比」入口。图只画 `SC→EN` / `SC→TC` 两个差值，横轴是国服开始日期
 * （三个时差里 `EN-TC` 不进图，表格那列照旧）。
 */
import { computed, ref } from 'vue';
import { useSiteStore } from '../stores/site.js';
import CrossServerTable from '../components/CrossServerTable.vue';
import CrossServerChart from '../components/CrossServerChart.vue';
import CrossServerUpDialog from '../components/CrossServerUpDialog.vue';

const site = useSiteStore();

const rows = computed(() => site.crossRows);

/** 弹窗当前展示的那一行（null = 不显示） */
const openRow = ref(null);
</script>

<template>
  <div class="card">
    <CrossServerTable :rows="rows" @open="openRow = $event" />

    <CrossServerChart :rows="rows" />

    <CrossServerUpDialog v-if="openRow" :row="openRow" @close="openRow = null" />
  </div>
</template>

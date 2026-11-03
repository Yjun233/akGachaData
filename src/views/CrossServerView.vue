<script setup>
/**
 * 跨服卡池对比（`/cross-server`，2026-11-04 用户加）。
 *
 * **不受左栏服务器选择控制** —— 三服（国服 / 国际服 / 繁中服）的卡池按名称配对后一起列。
 * 筛选与排序都在右栏（`pane-cross`），状态在 `site.crossFilters` / `site.crossSort`，
 * 与卡池列表那套**分开存**，互不影响。
 *
 * 卡片头写两件事：
 * - `命中 N / M 期` —— M 是**全部**配对行。差额来自右栏的日期范围（默认上界是
 *   「最后一个至少两服有数据的卡池」，所以国服独有的未来池默认看不到，清空日期框才出来）；
 * - `6★ 名单不一致 K 期` —— 就是表格里「查看」按钮是琥珀色的那些
 *   （联合行动 12 期起 / 定向甄选 / 中坚甄选）。
 */
import { computed, ref } from 'vue';
import { useSiteStore } from '../stores/site.js';
import CrossServerTable from '../components/CrossServerTable.vue';
import CrossServerUpDialog from '../components/CrossServerUpDialog.vue';

const site = useSiteStore();

const rows = computed(() => site.crossRows);
const total = computed(() => site.crossEntries.length);
const diffCount = computed(() => site.crossDiffCount);

/** 弹窗当前展示的那一行（null = 不显示） */
const openRow = ref(null);
</script>

<template>
  <div class="card">
    <div class="hd">
      <span class="count">
        三服按卡池名称配对 · 命中 {{ rows.length }} / {{ total }} 期 ·
        6★ 名单不一致 {{ diffCount }} 期
      </span>
    </div>

    <CrossServerTable :rows="rows" @open="openRow = $event" />

    <CrossServerUpDialog v-if="openRow" :row="openRow" @close="openRow = null" />
  </div>
</template>

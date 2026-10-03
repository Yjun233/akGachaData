<script setup>
/**
 * 固定顶栏：折叠按钮 ☰ + 当前页标题 +（统计页）1.1 / 1.2 / 2.1 / 2.2 定位 + 筛选按钮。
 * 顶栏宽度由 .layout 上的 nav-show / filter-show 类控制（停靠形态下会收进中间区域）。
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { STAT_SECTIONS } from '../lib/constants.js';
import { useLayout } from '../composables/useLayout.js';

const route = useRoute();
const { toggleNav, toggleFilter } = useLayout();

/** 当前页标题（统计页额外显示 1.1 / 1.2 / 2.1 / 2.2 定位按钮） */
const TITLES = {
  banners: '卡池列表',
  stats: '出率提升记录',
  firstUp: '首次UP间隔',
  upHistory: 'UP 历史一览',
};

const title = computed(() => TITLES[route.name] ?? '');
const isStats = computed(() => route.name === 'stats');

/** 跳到统计页某个分节（用 scrollIntoView，避免污染路由 hash） */
function goTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
</script>

<template>
  <header class="topbar">
    <button class="tb-btn" type="button" title="页面导航" @click="toggleNav">
      <span class="glyph">☰</span>
    </button>
    <div class="tb-title">
      <span class="t">{{ title }}</span>
    </div>
    <div v-if="isStats" class="tb-toc">
      <a v-for="s in STAT_SECTIONS" :key="s.id" href="#" @click.prevent="goTo(s.id)">
        {{ s.label }}
      </a>
    </div>
    <div class="tb-spacer"></div>
    <button class="tb-btn" type="button" title="数据筛选" @click="toggleFilter">
      <span class="glyph">≡</span>筛选
    </button>
  </header>
</template>

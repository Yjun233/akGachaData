<script setup>
/**
 * 首页：卡池列表。
 * 展示**全部**卡池（不受参考日期影响），只受右栏筛选影响。
 * 宽屏用**铺满容器**的表格（`width:100%` + `min-width:1225px` 兜底，再窄就横向滚动），
 * `(max-width:640px)` 改用卡片。
 */
import { computed } from 'vue';
import { useSiteStore } from '../stores/site.js';
import { useLayout } from '../composables/useLayout.js';
import BannerTable from '../components/BannerTable.vue';
import BannerCards from '../components/BannerCards.vue';

const site = useSiteStore();
const { isCard } = useLayout();

const rows = computed(() => site.bannerRows);
</script>

<template>
  <div class="card">
    <BannerCards v-if="isCard" :rows="rows" />
    <BannerTable v-else :rows="rows" />
  </div>
</template>

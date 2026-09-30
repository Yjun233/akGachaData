<script setup>
/**
 * 首页：卡池列表。
 * 展示**全部**卡池（不受参考日期影响），只受右栏筛选影响。
 * 宽屏用固定列宽的表格，`(max-width:640px)` 改用卡片。
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

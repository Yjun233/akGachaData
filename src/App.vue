<script setup>
/**
 * 应用骨架：固定顶栏 + 左右抽屉 + 全宽内容区（参考 ark.yituliu.cn 的布局）。
 * 抽屉形态（停靠 / 浮层）与断点集中在 composables/useLayout.js。
 */
import { onMounted } from 'vue';
import { useSiteStore } from './stores/site.js';
import { useLayout, initLayoutWatchers } from './composables/useLayout.js';
import AppTopbar from './components/AppTopbar.vue';
import NavDrawer from './components/NavDrawer.vue';
import FilterDrawer from './components/FilterDrawer.vue';

const site = useSiteStore();
const { isDocked, navShow, filterShow, backdropShow, closeDrawers } = useLayout();

initLayoutWatchers();
onMounted(() => site.load());
</script>

<template>
  <div
    class="layout"
    :class="{ docked: isDocked, 'nav-show': navShow, 'filter-show': filterShow }"
  >
    <AppTopbar />
    <NavDrawer />
    <FilterDrawer />
    <div class="backdrop" :class="{ show: backdropShow }" @click="closeDrawers" />

    <main class="content">
      <div v-if="site.error" class="note">
        <b>数据加载失败</b> — {{ site.error }}
      </div>
      <div v-else-if="!site.ready" class="note">正在加载数据…</div>
      <router-view v-else />
    </main>
  </div>
</template>

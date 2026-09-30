import { createRouter, createWebHistory } from 'vue-router';
import BannerListView from '../views/BannerListView.vue';

/**
 * 页面结构（docs/工作指令.md 5.2）：
 *   /                首页，卡池列表
 *   /operators       出率提升记录（统计页）
 *   /shop-interval   首次进店间隔（折线图）
 *   /up-history      UP 历史一览（横向时间轴）
 * 不设干员列表页与详情页。
 */
export default createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'banners', component: BannerListView },
    { path: '/operators', name: 'stats', component: () => import('../views/StatsView.vue') },
    { path: '/shop-interval', name: 'shopInterval', component: () => import('../views/ShopIntervalView.vue') },
    { path: '/up-history', name: 'upHistory', component: () => import('../views/UpHistoryView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior(to, from, saved) {
    return saved ?? { top: 0 };
  },
});

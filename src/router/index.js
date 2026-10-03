import { createRouter, createWebHistory } from 'vue-router';
import BannerListView from '../views/BannerListView.vue';

/**
 * 页面结构（docs/工作指令.md 5.2）：
 *   /                首页，卡池列表
 *   /operators       出率提升记录（统计页）
 *   /first-up        首次UP间隔（折线图；两种统计模式：首次进店 / 首次轮换）
 *   /first-up/table  首次UP间隔 · 表格版（同一份数据的表格呈现，左栏二级菜单）
 *   /up-history      UP 历史一览（横向时间轴）
 * 不设干员列表页与详情页。
 *
 * ⚠️ `/first-up` 与 `/first-up/table` 是**两条并列路由**，不是父子嵌套：
 * 两页各是一个独立视图（图表 / 表格），谁也不渲染对方的 `<router-view>`。
 * 左栏把它们做成一个「首次UP间隔」+ 二级菜单（见 NavDrawer.vue）。
 */
export default createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'banners', component: BannerListView },
    { path: '/operators', name: 'stats', component: () => import('../views/StatsView.vue') },
    { path: '/first-up', name: 'firstUp', component: () => import('../views/FirstUpView.vue') },
    { path: '/first-up/table', name: 'firstUpTable', component: () => import('../views/FirstUpTableView.vue') },
    { path: '/up-history', name: 'upHistory', component: () => import('../views/UpHistoryView.vue') },
    /*
     * 老路径（页面还叫「首次进店间隔」时的 `/shop-interval`）留一条**前端跳转**，
     * 免得被分享 / 收藏过的旧链接直接落到首页（catch-all 的 redirect 会让人以为"打开就回首页"）。
     * ⚠️ 必须排在下面的 `/:pathMatch(.*)*` **之前**，否则永远轮不到它。
     * ⚠️ 这只是前端 `history.replace`，**不是 HTTP 302** —— 服务器仍是 404.html 兜底（返回 404 状态码）。
     */
    { path: '/shop-interval', redirect: '/first-up' },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior(to, from, saved) {
    return saved ?? { top: 0 };
  },
});

<script setup>
/**
 * 左抽屉：页面导航 + 服务器选择 + 数据元信息。
 * 服务器下拉只渲染 metadata.servers 里 available 的项 —— 未来接入新服务器时前端无需改动。
 *
 * 导航条目与路由一一对应；**「首次UP间隔」带一个二级菜单**（图表版 / 表格版）——
 * 同一份 `firstUp` 数据的两种呈现，路由是两条并列路由（`/first-up` 与 `/first-up/table`，
 * 见 router/index.js）。父项在两个子页面都高亮，子项各自高亮当前那个。
 *
 * 底部还挂一块**自定义卡池**（全局开关 + 添加弹窗入口）—— 口径见
 * `akGachaDocs/site/自定义卡池功能预研.md`。开关是**界面状态**、不持久化（刷新回默认「只显示」）。
 */
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSiteStore } from '../stores/site.js';
import { useLayout } from '../composables/useLayout.js';
import CustomBannerDialog from './CustomBannerDialog.vue';

/**
 * 卡池数据的来源**按服务器不同**：
 *   国服来自 PRTS Wiki；国际服来自 arknights.wiki.gg；
 *   繁中服没有公开数据站，来自用户自建的卡池记录表（金山文档在线表格，人工维护，
 *   没有对外链接，所以 url 为 null）。
 * （干员头像一律来自 ArknightsAssets/ArknightsAssets2，见 akGachaDocs/resource/资源仓库说明.md。）
 */
const BANNER_SOURCES = {
  sc: { label: 'PRTS Wiki', url: 'https://prts.wiki' },
  en: { label: 'Arknights Wiki（wiki.gg）', url: 'https://arknights.wiki.gg' },
  tc: { label: '自建卡池记录表', url: null },
};
const site = useSiteStore();

/** 当前服务器的卡池数据来源（署名用） */
const bannerSource = computed(() => BANNER_SOURCES[site.server] ?? BANNER_SOURCES.sc);
const route = useRoute();
const router = useRouter();
const { navShow, toggleNav, closeDrawers, isDocked } = useLayout();

/** 「首次UP间隔」的两个页面（图表版 / 表格版）—— 父项在**任一**页都要高亮 */
const isFirstUp = computed(() => route.name === 'firstUp' || route.name === 'firstUpTable');

function go(name) {
  router.push({ name });
  // 浮层形态下点导航后收起抽屉；停靠形态下保持展开（操作内容区不该关掉侧栏）
  if (!isDocked.value) closeDrawers();
}

function onServerChange(e) {
  site.setServer(e.target.value);
}

/** 自定义卡池的「添加 / 编辑」弹窗开关 */
const showCustom = ref(false);
</script>

<template>
  <aside class="drawer drawer-left" :class="{ show: navShow }">
    <div class="drawer-hd">
      <span class="h">页面导航</span>
      <button class="drawer-close" type="button" title="收起" @click="toggleNav">✕</button>
    </div>

    <nav class="sidenav">
      <button class="navitem" type="button" :class="{ active: route.name === 'banners' }" @click="go('banners')">
        <span class="ic" />卡池列表
      </button>
      <button class="navitem" type="button" :class="{ active: route.name === 'stats' }" @click="go('stats')">
        <span class="ic" />出率提升记录
      </button>
      <button class="navitem" type="button" :class="{ active: isFirstUp }" @click="go('firstUp')">
        <span class="ic" />首次UP间隔
      </button>
      <!-- 二级菜单：同一份数据的两种呈现。⚠️ 父项点了进「图表版」（原来的默认页），
           子项才是显式切换；父项在任一子页面都保持高亮（见 isFirstUp） -->
      <div class="navsub">
        <button
          class="navsubitem" type="button" :class="{ active: route.name === 'firstUp' }"
          @click="go('firstUp')"
        >图表版</button>
        <button
          class="navsubitem" type="button" :class="{ active: route.name === 'firstUpTable' }"
          @click="go('firstUpTable')"
        >表格版</button>
      </div>
      <button class="navitem" type="button" :class="{ active: route.name === 'upHistory' }" @click="go('upHistory')">
        <span class="ic" />UP 历史一览
      </button>
    </nav>

    <!-- 底部区：干员展示模式 + 服务器（都贴左栏底部，顺序：展示模式在上、服务器在下） -->
    <div class="drawer-bottom">
      <div class="avgroup">
        <label>干员展示</label>
        <div class="seg">
          <button
            type="button" :class="{ on: site.avatarMode === 'text' }"
            title="显示干员名" @click="site.setAvatarMode('text')"
          >简洁模式</button>
          <button
            type="button" :class="{ on: site.avatarMode === 'image' }"
            title="用干员头像代替名称" @click="site.setAvatarMode('image')"
          >图片模式</button>
        </div>
      </div>

      <div class="sgroup">
        <label for="s-server">服务器</label>
        <select id="s-server" :value="site.server" @change="onServerChange">
          <option v-for="s in site.availableServers" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
      </div>

      <div class="avgroup">
        <label>自定义卡池<template v-if="site.customCount">（{{ site.customCount }} 个）</template></label>
        <div class="seg">
          <button
            type="button" :class="{ on: !site.customInStats }" title="自定义卡池只出现在卡池列表里"
            @click="site.customInStats = false"
          >只显示</button>
          <button
            type="button" :class="{ on: site.customInStats }" title="自定义卡池也计入统计与图表"
            @click="site.customInStats = true"
          >计入统计</button>
        </div>
        <div class="btn-row">
          <button class="btn" type="button" @click="showCustom = true">＋ 添加自定义卡池…</button>
        </div>
      </div>
    </div>

    <div class="drawer-note">
      干员 <b>{{ site.operatorCount }}</b> 位 · 卡池 <b>{{ site.allBanners.length }}</b> 个<template
        v-if="site.customCount"
      >（含 <b>{{ site.customCount }}</b> 个自定义）</template><br />
      <!-- 只显示**当前服务器**的更新日（用户 2026-10-06 定）——
           中坚另有来源（官方解包），所以**单起一行**，不跟在括号里 -->
      {{ site.serverMeta.label }}数据更新 <b>{{ site.updateDates[site.server] }}</b><br />
      中坚数据更新 <b>{{ site.claUpdateDates[site.server] }}</b><br />
      卡池信息来源 <a v-if="bannerSource.url" :href="bannerSource.url" target="_blank" rel="noreferrer">{{ bannerSource.label }}</a><span v-else>{{ bannerSource.label }}</span><br /><br />
      网站内使用的游戏图片、文本原文等，仅用于更好地辅助数据查询，其版权属于鹰角网络。本网站与鹰角网络无关。
    </div>
  </aside>

  <CustomBannerDialog v-if="showCustom" @close="showCustom = false" />
</template>

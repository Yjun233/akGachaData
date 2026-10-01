<script setup>
/**
 * 左抽屉：页面导航 + 服务器选择 + 数据元信息。
 * 服务器下拉只渲染 metadata.servers 里 available 的项 —— 未来接入新服务器时前端无需改动。
 */
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSiteStore } from '../stores/site.js';
import { useLayout } from '../composables/useLayout.js';

/**
 * 卡池数据的来源**按服务器不同**：
 *   国服来自 PRTS Wiki；国际服来自 arknights.wiki.gg；
 *   繁中服没有可用的数据站，来自本地人工维护的卡池记录表（没有链接，所以 url 为 null）。
 * （干员头像一律来自 ArknightsGameResource，见 ../akGachaResource/docs/资源仓库说明.md。）
 */
const BANNER_SOURCES = {
  sc: { label: 'PRTS Wiki', url: 'https://prts.wiki' },
  en: { label: 'Arknights Wiki（wiki.gg）', url: 'https://arknights.wiki.gg' },
  tc: { label: '本地卡池记录表', url: null },
};
const site = useSiteStore();

/** 当前服务器的卡池数据来源（署名用） */
const bannerSource = computed(() => BANNER_SOURCES[site.server] ?? BANNER_SOURCES.sc);
const route = useRoute();
const router = useRouter();
const { navShow, toggleNav, closeDrawers, isDocked } = useLayout();

function go(name) {
  router.push({ name });
  // 浮层形态下点导航后收起抽屉；停靠形态下保持展开（操作内容区不该关掉侧栏）
  if (!isDocked.value) closeDrawers();
}

function onServerChange(e) {
  site.setServer(e.target.value);
}
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
      <button class="navitem" type="button" :class="{ active: route.name === 'shopInterval' }" @click="go('shopInterval')">
        <span class="ic" />首次进店间隔
      </button>
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
    </div>

    <div class="drawer-note">
      干员 <b>{{ site.operatorCount }}</b> 位 · 卡池 <b>{{ site.serverMeta.bannerCount ?? 0 }}</b> 个<br />
      国服数据更新 <b>{{ site.updateDates.sc }}</b><br />
      国际服数据更新 <b>{{ site.updateDates.en }}</b><br />
      繁中服数据更新 <b>{{ site.updateDates.tc }}</b><br />
      卡池信息来源 <a v-if="bannerSource.url" :href="bannerSource.url" target="_blank" rel="noreferrer">{{ bannerSource.label }}</a><span v-else>{{ bannerSource.label }}</span><br /><br />
      网站内使用的游戏图片、文本原文等，仅用于更好地辅助数据查询，其版权属于鹰角网络。本网站与鹰角网络无关。
    </div>
  </aside>
</template>

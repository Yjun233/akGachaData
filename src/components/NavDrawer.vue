<script setup>
/**
 * 左抽屉：页面导航 + 服务器选择 + 数据元信息。
 * 服务器下拉只渲染 metadata.servers 里 available 的项 —— 未来接入新服务器时前端无需改动。
 */
import { useRoute, useRouter } from 'vue-router';
import { useSiteStore } from '../stores/site.js';
import { useLayout } from '../composables/useLayout.js';

const site = useSiteStore();
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
      数据更新 <b>{{ site.snapshotDate }}</b><br />
      来源 <a href="https://prts.wiki" target="_blank" rel="noreferrer">PRTS Wiki</a>
    </div>
  </aside>
</template>

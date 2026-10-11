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

/**
 * 左栏最底部的两个外链图标（2026-10-11 用户要求）：
 *   · GitHub 章 → **站点仓库**（源码在这里；数据与头像另有仓库 `akGachaResource`，见 README）
 *   · b 站小电视 → 作者的 bilibili 空间
 * ⚠️ 图标一律**内联 SVG**（不引图标库、也不靠图标字体）—— 与全站「零外部依赖」的口径一致，
 *    颜色走 `currentColor`，所以 hover 换色时不用另做一套。
 */
const REPO_URL = 'https://github.com/Yjun233/akGachaData';
const BILI_URL = 'https://space.bilibili.com/5555217';

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

      <!-- 页脚外链：站点仓库 + b 站空间（图标内联，见 script 里 REPO_URL / BILI_URL 的说明）。
           ⚠️ SVG 的填充规则用 evenodd：电视机身是实心的，两只眼睛与嘴是「挖空」的洞 ——
              这样 hover 时底色变了也不会露出白点。 -->
      <div class="drawer-links">
        <a class="dlk" :href="REPO_URL" target="_blank" rel="noreferrer" title="站点仓库（GitHub）" aria-label="站点仓库（GitHub）">
          <svg viewBox="0 0 24 24" fill="currentColor" focusable="false" aria-hidden="true">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
        </a>
        <a class="dlk" :href="BILI_URL" target="_blank" rel="noreferrer" title="bilibili 空间" aria-label="bilibili 空间">
          <svg viewBox="0 0 24 24" fill="currentColor" focusable="false" aria-hidden="true">
            <path
              fill-rule="evenodd"
              d="M6.1 5.8h11.8a4.1 4.1 0 0 1 4.1 4.1v6.4a4.1 4.1 0 0 1-4.1 4.1H6.1A4.1 4.1 0 0 1 2 16.3V9.9a4.1 4.1 0 0 1 4.1-4.1ZM7.1 11.6a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm7 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm-5.9 4h5.6a2.8 2.8 0 0 1-5.6 0Z"
            />
            <path d="M8.4 5.6 6.1 2.8M15.6 5.6l2.3-2.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </a>
      </div>
    </div>
  </aside>

  <CustomBannerDialog v-if="showCustom" @close="showCustom = false" />
</template>

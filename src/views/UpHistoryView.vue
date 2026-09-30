<script setup>
/**
 * UP 历史一览（横向时间轴图）。
 *
 * 每位干员一条横条：**实装日 → 当前筛选下最后一次 UP 的卡池开始日**，
 * 条上按卡池开始日打标记，标记颜色区分卡池大类。
 *
 * 布局是三段式（原因见 `src/lib/upTimeline.js` 的文件头）：
 * - **顶部**：一条高度固定的刻度条，用 `position:sticky` 钉在滚动区顶部 ——
 *   横轴固定在顶部显示，纵向滚动时不跑掉；刻度落在每个月 1 号，格式 `2026-01`
 * - **左侧**：干员名列（DOM，`sticky left`），横向滚动时名字不会滚走
 * - **主体**：echarts 画布，只有横条与标记
 *
 * 宽度：`minInnerWidth(monthCount)` 给出最小宽度（每月 46px，放得下 `YYYY-MM` 标签，
 * 同时让 99% 的相邻标记不重叠）；窗口不够宽时外层横向滚动。
 *
 * 已排除限定干员；一次只显示一个星级（右栏切换，默认六星）。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useSiteStore } from '../stores/site.js';
import { buildUpTimeline, chartHeight, minInnerWidth, TL } from '../lib/upTimeline.js';
import EChart from '../components/EChart.vue';

const site = useSiteStore();
const data = computed(() => site.upHistory);
const isImage = computed(() => site.avatarMode === 'image');

/** 当前显示的星级（右栏切换，默认六星） */
const rows = computed(() => (site.upRarity === 5 ? data.value.five : data.value.six));

/** 图表 option（顶部刻度条 + 主体） */
const built = computed(() => buildUpTimeline({
  rows: rows.value,
  xRange: site.upRange,
  isImage: isImage.value,
  operatorByName: site.operators,
}));

const bodyH = computed(() => chartHeight(rows.value));
const innerW = computed(() => minInnerWidth(built.value.xMin, built.value.xMax));

/** 星级的汉字写法 —— 界面上要写「六星 / 五星」，不能直接输出 6 / 5 */
const rarityChar = computed(() => (site.upRarity === 5 ? '五' : '六'));

/* ---- 横向滚动条默认停在最右侧 ----
   最新的 UP 都在右端，打开页面先看到最新的一段才合理。
   ⚠️ 要等两拍：① ECharts 是 onMounted 里才 init 的，nextTick 时画布可能还没撑开；
   ② 画布撑开后 scrollWidth 才准。所以 rAF 里再补一次。 */
const scrollEl = ref(null);
async function scrollToRight() {
  await nextTick();
  const el = scrollEl.value;
  if (!el) return;
  el.scrollLeft = el.scrollWidth - el.clientWidth;
  requestAnimationFrame(() => { el.scrollLeft = el.scrollWidth - el.clientWidth; });
}
onMounted(scrollToRight);
/** 切星级会整体换一批干员，重新贴回最右 */
watch(() => site.upRarity, scrollToRight);

const filterText = computed(() => {
  if (site.upShopOnly) return '只看进店';
  if (!site.upTypes.length) return '全部卡池类型';
  return `已选 ${site.upTypes.length} 种类型`;
});
</script>

<template>
  <div class="card">
    <div class="hd">
      <span class="count">
        {{ rarityChar }}星 {{ rows.length }} 位 · {{ filterText }}
      </span>
    </div>

    <div class="grp-sep" :id="site.upRarity === 5 ? 'uh5' : 'uh6'">{{ rarityChar }}星干员</div>
    <div v-if="!rows.length" class="empty">当前筛选下没有{{ rarityChar }}星干员的 UP 记录</div>
    <div v-else ref="scrollEl" class="tl-scroll">
      <div class="tl-inner" :style="{ minWidth: innerW + 'px' }">
        <!-- 顶部：固定的横轴刻度条 -->
        <div class="tl-head">
          <div class="tl-corner" :style="{ width: TL.nameW + 'px' }" />
          <div class="tl-headchart">
            <EChart :option="built.axisOption" :height="TL.stripH" />
          </div>
        </div>

        <!-- 主体：左侧固定名字列 + 图表 -->
        <div class="tl-rows">
          <div class="tl-names" :style="{ width: TL.nameW + 'px', paddingTop: TL.gridTop + 'px' }">
            <div
              v-for="r in rows" :key="r.name" class="tl-name"
              :style="{ height: TL.rowH + 'px', lineHeight: TL.rowH + 'px' }"
            >{{ r.name }}</div>
          </div>
          <div class="tl-body">
            <EChart :option="built.bodyOption" :height="bodyH" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

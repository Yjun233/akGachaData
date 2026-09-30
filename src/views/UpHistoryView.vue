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
import { computed } from 'vue';
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
const otherChar = computed(() => (site.upRarity === 5 ? '六' : '五'));
const otherCount = computed(() => (site.upRarity === 5 ? data.value.six.length : data.value.five.length));

const filterText = computed(() => {
  if (site.upShopOnly) return '只看进店';
  if (!site.upTypes.length) return '全部卡池类型';
  return `已选 ${site.upTypes.length} 种类型`;
});
</script>

<template>
  <div class="card">
    <div class="hd">
      <h2>UP 历史一览</h2>
      <span class="count">
        {{ rarityChar }}星 {{ rows.length }} 位 · {{ filterText }} ·
        {{ otherChar }}星 {{ otherCount }} 位可切换
      </span>
    </div>

    <div class="note" style="margin: 14px 16px 4px">
      每位干员一条横条：从<b>实装日</b>画到当前筛选下<b>最后一次 UP</b> 的卡池开始日；
      条上按卡池开始日打标记（圆的左边缘对齐日期，超出可视范围的两端直接截断）。
      标记统一是「浅底圆 + <b>大类色圆环</b>」——
      <b style="color:#8a6d00">标准寻访</b> / <b style="color:#00628f">中坚寻访</b> /
      <b style="color:#5b21b6">限定寻访</b>，环内是头像（图片模式）或干员名首字（简洁模式），
      <b style="color:#15803d">商店兑换</b>是标记右上角的绿色小圆点；悬停可看该次卡池信息。
      <b>已排除限定干员</b>；横轴斜排在顶部且固定（每月 1 号一条竖线），左侧名字列固定。
      右栏的「时间范围」只改变横轴可视范围，纵轴始终保留全部干员。
    </div>

    <div class="grp-sep" :id="site.upRarity === 5 ? 'uh5' : 'uh6'">{{ rarityChar }}星干员 · UP 历史</div>
    <div v-if="!rows.length" class="empty">当前筛选下没有{{ rarityChar }}星干员的 UP 记录</div>
    <div v-else class="tl-scroll">
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

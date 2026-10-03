<script setup>
/**
 * 首次UP间隔 · **表格版**（左栏「首次UP间隔」下的二级菜单，用户 2026-10-03 加）。
 *
 * 和图表版（FirstUpView.vue）用**同一份数据** —— `site.firstUp`，六星 / 五星各自一条序列、
 * 已按当前口径排好序；只是换成表格：图表上读不出精确值的几列（实装日 / 首次日期 / 所在卡池）
 * 在这里一目了然，也方便整列对着看。
 *
 * 与图表版的对应关系：
 * - **分节**（六星 / 五星）与**行序** = 图表的点序，都听 `site.firstUpAxis`
 *   （按首次日期 / 按实装日期）—— 所以右栏的「横轴」口径在本页改的是**行顺序**
 * - 「距上行」= 图表纵轴的 `gap`；「距实装」= 图表纵轴的 `sinceRelease`。
 *   表格放得下，所以两列都列出来，**当前纵轴口径那一列**加底色 —— 右栏「纵轴」的切换
 *   在本页就体现为高亮列（图表版那边是直接改曲线）。⚠️ 别把这两列删成「只留当前口径」，
 *   那样一来切口径会**整列换位置**，看着像表格在跳。
 * - 组内**第一位**没有前序 → 「距上行」显示 `—`（与图表上不画这一点一致）
 * - `gap` 可能为**负**（按实装日期排序时，后实装却更早进店的干员）→ 标黄 + 悬停说明
 *
 * ⚠️ **刻意不做「点表头排序」**：行序就是「距上行」这一列的计算顺序，
 * 一旦重排，这一列（以及它与上下行的关系）就失去意义。想换顺序请用右栏的「横轴」口径。
 *
 * ⚠️ 列头文案：**只有「首次X日」**跟着统计模式换词（`modeWord`），别写死「进店」；
 * 「距上行」「累计数」是固定短文案（用户 2026-10-03 特意改短），**不**跟模式走 ——
 * 所以 verify-render 里对表头的期望值要按它们写，别照抄右栏那一套长文案。
 *
 * 图片模式的干员列用**长方形蒙版头像** —— 与「出率提升记录」（统计页 StatTable）同款，
 * 共用 main.css 里那一条 `.avt-rect`（宽是高 2 倍 + 四边渐隐）。这边没有冻结列，
 * 定位包含块与列宽要自己补，见 main.css「首次UP间隔 · 表格版」那段。
 *
 * ⚠️ 「干员」列**定宽 = 7 个汉字**（`th` / `td` 都挂 `opcell`，宽度写在 main.css）——
 * 别再让它随内容自适应：图片模式下头像是绝对定位、不撑列宽，列会当场塌掉。
 *
 * ⚠️ **表头一律居中**（用户 2026-10-03）：列头不跟着数据格的对齐走（数字格仍右对齐、
 * 「所在卡池」的数据格仍左对齐）。`th` 上留着 `num` 只是标明列的性质，对齐由 main.css 里
 * `table.grid.fup-tbl thead th{text-align:center}` 统一覆盖 —— 别再给 `th` 挂 `tl`。
 *
 * ⚠️ 六星 / 五星两节放进 `.pair`（与出率提升记录同款）：宽度放得下就**左右并排**，
 * 放不下由 flex-wrap 自动竖排 —— 这是本页与图表版在版式上唯一的差别（那边永远上下两节）。
 */
import { computed } from 'vue';
import { useSiteStore } from '../stores/site.js';
import { avatarUrl } from '../lib/avatars.js';
import { axisLabel, metricShort, modeFirstLabel, modeWord, firstUpRangeLabel } from '../lib/firstUp.js';

const site = useSiteStore();
const data = computed(() => site.firstUp);
const isImage = computed(() => site.avatarMode === 'image');

/** 「首次进店」/「首次轮换」—— 分节标题与空态文案 */
const firstLabel = computed(() => modeFirstLabel(data.value.mode));
/** 「进店」/「轮换」—— 只用在「首次X日」这个列头（「距上行」「累计数」是固定短文案） */
const word = computed(() => modeWord(data.value.mode));

const axisText = computed(() => axisLabel(data.value.mode, site.firstUpAxis));
const metricText = computed(() => metricShort(data.value.mode, site.firstUpMetric));

/** 两个分节：与图表版一一对应（顺序也一样：先六星） */
const sections = computed(() => [
  { key: 'six', label: '六星干员', rows: data.value.six },
  { key: 'five', label: '五星干员', rows: data.value.five },
]);

/* 「筛选范围」文案：日期框默认填的就是完整跨度，所以那种情况仍显示「全部」 */
const rangeText = computed(() => firstUpRangeLabel(site.firstUpRange, site.fullFirstUpRange));

/** 图片模式头像：表格版用**长方形蒙版**（与「出率提升记录」同一套，见 main.css 的 .avt-rect）。
 *  ⚠️ shape 只在素材缺失、回退占位图时才有意义 —— 真素材都是同一张方形 96×96 PNG，
 *  形状（这里的 2:1 长方蒙版）完全交给 CSS。 */
const avatarOf = (name) => avatarUrl(site.operators[name] || { name }, 'square');

/** 当前纵轴口径 → 给哪一列加底色（右栏切换时的唯一反馈） */
const isMetric = (which) => site.firstUpMetric === which;
</script>

<template>
  <div class="card">
    <div class="hd">
      <span class="count">
        六星 {{ data.six.length }} 位 · 五星 {{ data.five.length }} 位 ·
        行序{{ axisText }} · 高亮列{{ metricText }} · 筛选范围 {{ rangeText }}
      </span>
    </div>

    <!-- 六星 / 五星放进 .pair：宽度放得下就左右并排，放不下 flex-wrap 自动竖排
         （与出率提升记录同一套，见 main.css 的「同星级两表自适应并排」那段） -->
    <div class="pair">
      <template v-for="sec in sections" :key="sec.key">
        <div class="pair-col">
          <div class="grp-sep">{{ sec.label }} · {{ firstLabel }}间隔</div>

          <div v-if="!sec.rows.length" class="empty">
            当前筛选范围内没有{{ sec.label }}的{{ word }}记录
          </div>

          <div v-else class="tbl-scroll plain">
            <table class="grid floating fup-tbl" :class="{ 'img-mode': isImage }">
              <thead>
                <tr>
                  <th class="opcell">干员</th>
                  <th class="num">实装日</th>
                  <th class="num">首次{{ word }}日</th>
                  <th>所在卡池</th>
                  <th
                    class="num" :class="{ 'metric-on': isMetric('gap') }"
                    title="距同星级上一个点（同一列上一行）的首次日期之差；组内第一位没有前序"
                  >距上行</th>
                  <th
                    class="num" :class="{ 'metric-on': isMetric('sinceRelease') }"
                    :title="`该干员首次${word}日 − 自有实装日；缺少实装日时为 —`"
                  >距实装</th>
                  <th class="num">累计数</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in sec.rows" :key="r.name">
                  <td class="opcell">
                    <img
                      v-if="isImage" class="avt-rect" :src="avatarOf(r.name)"
                      :alt="r.name" :title="r.name"
                    />
                    <b v-else>{{ r.name }}</b>
                  </td>
                  <td class="num">
                    <span v-if="!r.releaseDate" class="dash">—</span>
                    <template v-else>{{ r.releaseDate }}</template>
                  </td>
                  <td class="num">{{ r.firstDate }}</td>
                  <td class="tl">{{ r.firstBanner || '—' }}</td>
                  <td class="num" :class="{ 'metric-on': isMetric('gap') }">
                    <span
                      v-if="r.gap === null" class="dash"
                      title="组内第一位，没有前序间隔"
                    >—</span>
                    <span
                      v-else-if="r.gap < 0" class="neg"
                      :title="`更晚实装却更早${word}：上一个点是「${r.prevName}」`"
                    >{{ r.gap }}</span>
                    <template v-else>{{ r.gap }}</template>
                  </td>
                  <td class="num" :class="{ 'metric-on': isMetric('sinceRelease') }">
                    <span v-if="r.sinceRelease === null" class="dash">—</span>
                    <template v-else>{{ r.sinceRelease }}</template>
                  </td>
                  <td class="num">{{ r.count }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

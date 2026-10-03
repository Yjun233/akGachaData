<script setup>
/**
 * 右抽屉：只装当前页面用得到的筛选。
 *  - 卡池列表页   → 筛选表单（类型 / 大类 / 开始日期范围 / UP 干员名）
 *  - 统计页       → 参考日期
 *  - 首次UP间隔   → **统计模式切换** + 横轴 / 纵轴口径 + 首次日期范围
 *  - UP 历史一览  → 时间范围（横轴）+ 纵轴排序 + 卡池类型多选 + 只看进店
 *
 * 两条「时间范围」共用同一套「草稿 + 确认」逻辑，见 composables/useRangeDraft.js。
 */
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { FIRST_UP_MODES, FIRST_UP_MODE_LABEL, UP_SORT_ROWS } from '../lib/constants.js';
import { modeWord } from '../lib/firstUp.js';
import { useSiteStore } from '../stores/site.js';
import { useLayout } from '../composables/useLayout.js';
import { useRangeDraft } from '../composables/useRangeDraft.js';
import TypeButtons from './TypeButtons.vue';

const site = useSiteStore();
const route = useRoute();
const { filterShow, toggleFilter } = useLayout();

const isBanners = computed(() => route.name === 'banners');
const isStats = computed(() => route.name === 'stats');
const isFirstUp = computed(() => route.name === 'firstUp');
const isUp = computed(() => route.name === 'upHistory');

/** 当前统计模式的词：`首次进店` / `首次轮换` */
const firstLabel = computed(() => FIRST_UP_MODE_LABEL[site.firstUpMode]);
/** 不带「首次」的词：`进店` / `轮换` */
const firstWord = computed(() => modeWord(site.firstUpMode));

const filterTitle = computed(() => {
  if (isStats.value) return '参考日期';
  if (isFirstUp.value) return `${firstLabel.value}日期范围`;
  if (isUp.value) return '时间范围与筛选';
  return '数据筛选';
});

/** 当前模式下的首次日期边界（首末首次进店日 / 首次轮换日），用作日期输入的上下限 */
const firstUpBounds = computed(() => site.firstUp.bounds);

/** 当前服务器**卡池**的开始 / 结束日边界 —— UP 历史「开始日期」的下限用第一个卡池的开始日 */
const bannerBounds = computed(() => site.bannerBounds);

const bannerResult = computed(
  () => `命中 ${site.bannerRows.length} / ${site.banners.length} 个卡池`,
);

const statResult = computed(() => {
  const { visible, map } = site.statData;
  return `参考日期 ${site.refDate} · 可见卡池 ${visible.length} 个 · 参与统计干员 ${Object.keys(map).length} 位`;
});

const firstUpResult = computed(() => {
  const { six, five, rows, mode } = site.firstUp;
  return `命中 六星 ${six.length} 位 / 五星 ${five.length} 位`
    + `（共 ${rows.length} 位有${modeWord(mode)}记录）`;
});

const upResult = computed(() => {
  const { six, five } = site.upHistory;
  const marks = [...six, ...five].reduce((a, r) => a + r.count, 0);
  return `六星 ${six.length} 位 / 五星 ${five.length} 位 · 共 ${marks} 个 UP 标记`;
});

/* ---------------- 两条「时间范围」共用的草稿+确认逻辑 ---------------- */
const {
  draftFrom: fupFrom, draftTo: fupTo, yearsInput: fupYears, error: fupError,
  fromDirty: fupFromDirty, toDirty: fupToDirty,
  confirmFrom: confirmFupFrom, confirmTo: confirmFupTo,
  confirmYears: confirmFupYears, reset: resetFup,
} = useRangeDraft(
  () => site.firstUpRange,
  (f, t) => site.setFirstUpRange(f, t),
  (n) => site.applyFirstUpYears(n),
);

const {
  draftFrom: upFrom, draftTo: upTo, yearsInput: upYears, error: upError,
  fromDirty: upFromDirty, toDirty: upToDirty,
  confirmFrom: confirmUpFrom, confirmTo: confirmUpTo,
  confirmYears: confirmUpYears, reset: resetUpRange,
} = useRangeDraft(
  () => site.upRange,
  (f, t) => site.setUpRange(f, t),
  (n) => site.applyUpYears(n),
);

/* ---------------- 卡池列表：寻访筛选（多选按钮组，见 TypeButtons.vue） ---------------- */

/** 右栏顶部的一行摘要（按钮组本身已经很直观，这里只给个计数） */
const bannerTypesLabel = computed(() => (!site.filters.types.length
  ? '全部类型'
  : `已选 ${site.filters.types.length} 种`));

/* ---------------- UP 历史：卡池类型（同一个按钮组） ---------------- */

/** 右栏顶部的一行摘要（按钮组本身已经很直观，这里只给个计数） */
const upTypesLabel = computed(() => {
  if (site.upShopOnly) return '只看进店（类型筛选已禁用）';
  if (!site.upTypes.length) return '全部类型';
  return `已选 ${site.upTypes.length} 种`;
});

function resetUp() {
  resetUpRange();
  site.setUpSort('release-asc');
  site.setUpTypes([]);
  site.setUpShopOnly(false);
  site.setUpShowAll(false);
  site.setUpHideMid(false);
  site.setUpShowGaps(false);
}

/* ⚠️ 日期输入框上的 `min` 只约束**原生选择器**，手打更早的日期照样能提交。
   真正的下限夹在 store 的 `setUpRange()` 里（顺带把「近 N 年」那条路径一起盖住），
   所以这里不需要再包一层。 */
</script>

<template>
  <aside class="drawer drawer-right" :class="{ show: filterShow }">
    <div class="drawer-hd">
      <span class="h">{{ filterTitle }}</span>
      <button class="drawer-close" type="button" title="收起" @click="toggleFilter">✕</button>
    </div>

    <!-- 卡池列表的筛选（竖排） -->
    <div v-if="isBanners" class="drawer-bd pane pane-banners">
      <div class="fgroup">
        <!-- ⚠️ 与 UP 历史右栏用**同一个组件**，两处的操作手感必须一致（多选 + 大类全选） -->
        <TypeButtons
          :selected="site.filters.types" :label-text="bannerTypesLabel"
          @toggle="site.toggleBannerType"
          @toggle-category="site.toggleBannerCategory"
          @clear="site.setBannerTypes([])"
        />
      </div>
      <div class="fgroup">
        <label for="f-from">开始日期 ≥</label>
        <input id="f-from" v-model="site.filters.from" type="date" />
      </div>
      <div class="fgroup">
        <label for="f-to">开始日期 ≤</label>
        <input id="f-to" v-model="site.filters.to" type="date" />
      </div>
      <div class="fgroup">
        <label for="f-op">UP 干员名</label>
        <input id="f-op" v-model="site.filters.op" type="text" placeholder="如：银灰" />
      </div>
      <button class="btn" type="button" @click="site.resetFilters()">重置筛选</button>
      <div class="fresult">{{ bannerResult }}</div>
    </div>

    <!-- 出率提升记录：参考日期只作用于本页 -->
    <div v-else-if="isStats" class="drawer-bd pane pane-stats">
      <div class="fgroup">
        <label for="refDate">参考日期</label>
        <input
          id="refDate" type="date" :value="site.refDate"
          @change="site.setRefDate($event.target.value)"
        />
      </div>
      <div class="btn-row">
        <button class="btn" type="button" @click="site.setRefDate(site.today)">今天</button>
      </div>
      <div class="fhint">
        仅统计 <code>卡池开启日期 ≤ 参考日期</code> 的卡池，用于回看任意历史时点的出率提升记录。
        不影响「卡池列表」页。
      </div>
      <div class="fresult">{{ statResult }}</div>
    </div>

    <!-- 首次UP间隔：统计模式 + 横轴 / 纵轴口径 + 按首次日期筛选 -->
    <div v-else-if="isFirstUp" class="drawer-bd pane pane-firstup">
      <div class="fgroup">
        <label>统计模式</label>
        <div class="seg">
          <button
            v-for="m in FIRST_UP_MODES" :key="m.id"
            type="button" :class="{ on: site.firstUpMode === m.id }"
            @click="site.setFirstUpMode(m.id)"
          >{{ m.label }}</button>
        </div>
      </div>
      <div class="fgroup">
        <label>横轴（顺序与轴标签日期）</label>
        <div class="seg">
          <button
            type="button" :class="{ on: site.firstUpAxis === 'first' }"
            @click="site.setFirstUpAxis('first')"
          >按{{ firstLabel }}日期</button>
          <button
            type="button" :class="{ on: site.firstUpAxis === 'release' }"
            @click="site.setFirstUpAxis('release')"
          >按实装日期</button>
        </div>
      </div>
      <div class="fgroup">
        <label>纵轴</label>
        <div class="seg">
          <button
            type="button" :class="{ on: site.firstUpMetric === 'gap' }"
            @click="site.setFirstUpMetric('gap')"
          >距上个{{ firstLabel }}</button>
          <button
            type="button" :class="{ on: site.firstUpMetric === 'sinceRelease' }"
            @click="site.setFirstUpMetric('sinceRelease')"
          >距实装日期</button>
        </div>
      </div>
      <div class="fgroup">
        <label>快速填入日期范围</label>
        <div class="quick-row">
          <span class="q-txt">近</span>
          <input
            id="fup-years" v-model="fupYears" type="number" min="1" step="1"
            inputmode="numeric" title="输入正整数年数" @keyup.enter="confirmFupYears"
          />
          <span class="q-txt">年</span>
          <button class="btn sm" type="button" @click="confirmFupYears">确认</button>
        </div>
      </div>
      <div class="fgroup">
        <label for="fup-from">开始日期</label>
        <div class="date-row">
          <input
            id="fup-from" v-model="fupFrom" type="date" :class="{ dirty: fupFromDirty }"
            :min="firstUpBounds.min" :max="firstUpBounds.max" @keyup.enter="confirmFupFrom"
          />
          <button class="btn sm" type="button" @click="confirmFupFrom">确认</button>
        </div>
      </div>
      <div class="fgroup">
        <label for="fup-to">结束日期</label>
        <div class="date-row">
          <input
            id="fup-to" v-model="fupTo" type="date" :class="{ dirty: fupToDirty }"
            :min="firstUpBounds.min" :max="firstUpBounds.max" @keyup.enter="confirmFupTo"
          />
          <button class="btn sm" type="button" @click="confirmFupTo">确认</button>
        </div>
      </div>

      <p v-if="fupError" class="ferr">{{ fupError }}</p>

      <div class="btn-row">
        <button class="btn" type="button" @click="resetFup">全部</button>
      </div>
      <div class="fhint">
        只保留<b>{{ firstLabel }}日</b>落在区间内的干员（当前模式的可用范围
        <code>{{ firstUpBounds.min }} ~ {{ firstUpBounds.max }}</code>），区间内按<b>同星级</b>重新计算相邻间隔，
        纵轴起点与刻度会跟着数据变。<br />
        切换<b>统计模式</b>时区间<b>保持不变</b>，只是筛的日期从「首次进店日」换成「首次轮换日」
        （两种模式的可用范围略有不同）。<br />
        日期框<b>描红</b>表示改动还没确认；两端冲突时以刚确认的一端为准，自动把另一端挪到相隔 1 天。
        不影响其他页面。
      </div>
      <div class="fresult">{{ firstUpResult }}</div>
    </div>

    <!-- UP 历史一览 -->
    <div v-else class="drawer-bd pane pane-up">
      <div class="fgroup">
        <label>切换星级</label>
        <div class="seg">
          <button
            type="button" :class="{ on: site.upRarity === 6 }"
            @click="site.setUpRarity(6)"
          >六星（{{ site.upHistory.six.length }}）</button>
          <button
            type="button" :class="{ on: site.upRarity === 5 }"
            @click="site.setUpRarity(5)"
          >五星（{{ site.upHistory.five.length }}）</button>
        </div>
      </div>

      <div class="fgroup">
        <label>快速填入日期范围</label>
        <div class="quick-row">
          <span class="q-txt">近</span>
          <input
            id="up-years" v-model="upYears" type="number" min="1" step="1"
            inputmode="numeric" title="输入正整数年数" @keyup.enter="confirmUpYears"
          />
          <span class="q-txt">年</span>
          <button class="btn sm" type="button" @click="confirmUpYears">确认</button>
        </div>
      </div>
      <div class="fgroup">
        <label for="up-from">开始日期<small>不早于本服第一个卡池</small></label>
        <div class="date-row">
          <input
            id="up-from" v-model="upFrom" type="date" :class="{ dirty: upFromDirty }"
            :min="bannerBounds.min" @keyup.enter="confirmUpFrom"
          />
          <button class="btn sm" type="button" @click="confirmUpFrom">确认</button>
        </div>
      </div>
      <div class="fgroup">
        <label for="up-to">结束日期</label>
        <div class="date-row">
          <input
            id="up-to" v-model="upTo" type="date" :class="{ dirty: upToDirty }"
            @keyup.enter="confirmUpTo"
          />
          <button class="btn sm" type="button" @click="confirmUpTo">确认</button>
        </div>
      </div>

      <p v-if="upError" class="ferr">{{ upError }}</p>

      <label class="chk">
        <input
          type="checkbox" :checked="site.upShowAll"
          @change="site.setUpShowAll($event.target.checked)"
        />
        <span>显示范围内未 UP 干员</span>
      </label>

      <div class="fgroup">
        <label>纵轴排序</label>
        <div class="sortrows">
          <div v-for="r in UP_SORT_ROWS" :key="r.label" class="sortrow">
            <span class="sortlabel">{{ r.label }}</span>
            <div class="seg mini">
              <button
                type="button" :class="{ on: site.upSort === r.asc }"
                @click="site.setUpSort(r.asc)"
              >升序</button>
              <button
                type="button" :class="{ on: site.upSort === r.desc }"
                @click="site.setUpSort(r.desc)"
              >降序</button>
            </div>
          </div>
        </div>
      </div>

      <div class="fgroup">
        <!-- 两级按钮组：与卡池列表右栏共用同一个组件 -->
        <TypeButtons
          :selected="site.upTypes" :disabled="site.upShopOnly" :label-text="upTypesLabel"
          @toggle="site.toggleUpType"
          @toggle-category="site.toggleUpCategory"
          @clear="site.setUpTypes([])"
        />
      </div>

      <label class="chk">
        <input
          type="checkbox" :checked="site.upShopOnly"
          @change="site.setUpShopOnly($event.target.checked)"
        />
        <span>只看进店<small>勾选后禁用并清空卡池类型筛选</small></span>
      </label>

      <label class="chk">
        <input
          type="checkbox" :checked="site.upHideMid"
          @change="site.setUpHideMid($event.target.checked)"
        />
        <span>隐藏在结束日期已属中坚的干员<small>按<code>结束日期</code>（未设则按今天）判断该干员是否已移入中坚寻访</small></span>
      </label>

      <label class="chk">
        <input
          type="checkbox" :checked="site.upShowGaps"
          @change="site.setUpShowGaps($event.target.checked)"
        />
        <span>显示两次 UP 的间隔天数<small>两个标记在屏幕上隔得开（≈ 相隔 ≥ 41 天）时，在中间写日期差</small></span>
      </label>

      <div class="btn-row">
        <button class="btn" type="button" @click="resetUp">全部重置</button>
      </div>
      <div class="fresult">{{ upResult }}</div>
    </div>
  </aside>
</template>

<script setup>
/**
 * 右抽屉：只装当前页面用得到的筛选。
 *  - 卡池列表页   → 筛选表单（类型 / 大类 / 开始日期范围 / UP 干员多选）
 *    ⚠️ UP 干员是**多选**：搜索框支持 名字 / 全拼 / 首字母（lib/opSearch.js），
 *    点候选加进来、点 chip 移除；生效的是 store 里的 `filters.ops`（精确名数组）。
 *  - 统计页       → 参考日期
 *  - 首次UP间隔   → **统计模式切换** + 横轴 / 纵轴口径 + 首次日期范围
 *    （**图表版 / 表格版共用** —— 同一份数据、同一套口径，见 NavDrawer 的二级菜单）
 *  - UP 历史一览  → 时间范围（横轴）+ 纵轴排序 + 卡池类型多选 + 只看进店
 *
 * 两条「时间范围」共用同一套「草稿 + 确认」逻辑，见 composables/useRangeDraft.js。
 * ⚠️ **首次UP间隔**与**UP 历史**两处的**结束日期默认值 = 访问网站时的真实今天**
 * （2026-10-04 用户要求），由 store 的 `fullFirstUpRange` / `fullUpRange` 提供，
 * 「全部 / 重置」也回到它 —— 这两个标签因此都带一句「默认今天」。
 * ⚠️ **卡池列表**不在此列：结束日期仍取数据的最晚结束日（列表要照常列出预告池）。
 */
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { FIRST_UP_MODES, FIRST_UP_MODE_LABEL, UP_SORT_ROWS } from '../lib/constants.js';
import { modeWord } from '../lib/firstUp.js';
import { useSiteStore } from '../stores/site.js';
import { useLayout } from '../composables/useLayout.js';
import { useRangeDraft } from '../composables/useRangeDraft.js';
import TypeButtons from './TypeButtons.vue';
import { ensurePinyin, searchOperators } from '../lib/opSearch.js';

const site = useSiteStore();
const route = useRoute();
const { filterShow, toggleFilter } = useLayout();

const isBanners = computed(() => route.name === 'banners');
const isStats = computed(() => route.name === 'stats');
/* 「首次UP间隔」的两个版本（图表版 / 表格版）共用同一套右栏筛选：
   同一份 `site.firstUp`、同一套统计模式与口径，所以判断要覆盖两条路由 */
const isFirstUp = computed(() => route.name === 'firstUp' || route.name === 'firstUpTable');
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

/** 结束日期输入框的上限 = 首次日期上界与「今天」里较晚的那个。
 *  ⚠️ 2026-10-04：结束日期默认值改成了「今天」（store 的 fullFirstUpRange），而首次日期上界
 *  通常比今天还早 —— 上限还压着数据上界的话，原生选择器就够不到自己默认填的那个值。 */
const firstUpToMax = computed(() => Math.max(site.today, firstUpBounds.value.max || site.today));

/** 当前服务器**卡池**的开始 / 结束日边界 —— UP 历史「开始日期」的下限用第一个卡池的开始日 */
const bannerBounds = computed(() => site.bannerBounds);

/**
 * 两枚快捷预设里，**当前区间正好等于哪一枚**（配 `site.setXxxRangePreset`）：
 * `'today'` = `[最早, 今天]`（默认口径）、`'full'` = `[最早, 数据里最晚]`、都不是则 `''`。
 * 用来把已经生效的那枚**置灰** —— 两枚都不高亮的话，用户点「最早 ~ 今天」看到的是「没反应」。
 * ⚠️ 开始日期也参与比较：只改了一半（比如只把结束日期调到最晚）不算命中任何一枚。
 */
function presetOn(range, min, max) {
  if (!min || range.from !== min) return '';
  if (range.to === site.today) return 'today';
  if (max && range.to === max) return 'full';
  return '';
}
const fupPresetOn = computed(() => presetOn(site.firstUpRange, firstUpBounds.value.min, firstUpBounds.value.max));
const upPresetOn = computed(() => presetOn(site.upRange, bannerBounds.value.min, bannerBounds.value.max));

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
  /* 「全部」回到默认范围（空框只显示「年/月/日」；结束日期 = 今天，见 store 的说明） */
  () => site.fullFirstUpRange,
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
  /* 「全部重置」同理：回到默认范围（本服最早卡池开始日 ~ 今天，见 store 的 fullUpRange） */
  () => site.fullUpRange,
);

/* ---------------- 卡池列表：寻访筛选（多选按钮组，见 TypeButtons.vue） ---------------- */

/** 右栏顶部的一行摘要（按钮组本身已经很直观，这里只给个计数） */
const bannerTypesLabel = computed(() => (!site.filters.types.length
  ? '全部类型'
  : `已选 ${site.filters.types.length} 种`));

/* ---------------- 卡池列表：UP 干员多选（名字 / 全拼 / 首字母，见 lib/opSearch.js） ----------------
   搜索框里打的字**不入 store** —— 它只是「挑干员」的过程，不是筛选条件本身；
   真正生效的是 `site.filters.ops`（精确干员名数组，命中任意一个即保留）。
   候选由 searchOperators 算：三种写法都能匹配、已选的自动排除、按命中质量排序。 */

/** 搜索框里正在打的字 */
const opQuery = ref('');

/* 拼音字典（pinyin-pro，320KB）**懒加载**：输入框一获得焦点才开始拉，
   免得每个页面的首屏都背上它（见 lib/opSearch.js）。到位后置真 → 候选重算一次。 */
const pinyinReady = ref(false);
let dictAsked = false;
function askPinyin() {
  if (dictAsked) return;
  dictAsked = true;
  ensurePinyin().then(() => { pinyinReady.value = true; });
}

/** 候选干员名（空关键词 → 空列表，不铺开 200 多个） */
const opCandidates = computed(() => {
  void pinyinReady.value; // 依赖它：字典到位后重算（在那之前只按名字匹配）
  return searchOperators(Object.keys(site.operators), opQuery.value, { exclude: site.filters.ops });
});

/** 点候选 = 加入已选，并清掉搜索框，好接着挑下一个 */
function pickOp(name) {
  site.toggleBannerOp(name);
  opQuery.value = '';
}

/* ---------------- UP 历史：卡池类型（同一个按钮组） ---------------- */

/** 右栏顶部的一行摘要（按钮组本身已经很直观，这里只给个计数）。
 *  「只看进店」与卡池类型是**叠加**的两个条件（2026-10-03 改），所以两个都报出来。 */
const upTypesLabel = computed(() => {
  const picked = site.upTypes.length ? `已选 ${site.upTypes.length} 种` : '全部类型';
  return site.upShopOnly ? `只看进店 · ${picked}` : picked;
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
   所以这里不需要再包一层。
   结束日期**不设上下限**：默认值是「今天」，但允许往后调（要看已预告的卡池），
   也允许往前调（回看某个历史时点）。 */
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
        <label for="f-op">
          UP 干员<span class="fcount">{{ site.filters.ops.length ? `已选 ${site.filters.ops.length} 位` : '可多选' }}</span>
        </label>
        <!-- 打字 → 下面出候选；回车取第一个候选、Esc 清空（都得先选进来才算筛选条件） -->
        <input
          id="f-op" v-model="opQuery" type="text" autocomplete="off"
          placeholder="名字 / 全拼 / 首字母，如 银灰 / yinhui / yh"
          @focus="askPinyin"
          @keyup.enter="opCandidates.length && pickOp(opCandidates[0])"
          @keyup.esc="opQuery = ''"
        />
        <!-- 已选：点一下移除 -->
        <div v-if="site.filters.ops.length" class="opchips">
          <button
            v-for="n in site.filters.ops" :key="n" class="opchip" type="button"
            :title="`移除 ${n}`" @click="site.toggleBannerOp(n)"
          >{{ n }}<i>×</i></button>
        </div>
        <!-- 候选：点一下加入已选 -->
        <div v-if="opQuery.trim()" class="opsug">
          <div v-if="!opCandidates.length" class="opsug-empty">没有匹配的干员</div>
          <button
            v-for="n in opCandidates" :key="n" class="opsug-item" type="button"
            @click="pickOp(n)"
          >
            {{ n }}
          </button>
        </div>
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
        <!-- ⚠️ 两枚快捷预设：「最早 ~ 今天」= 现在的默认口径；「最早 ~ 最晚」= 结束日期
             改成「今天」之前的旧口径（2026-10-04 用户要求）。当前已是该口径的那枚置灰。 -->
        <div class="presets">
          <button
            class="btn sm" type="button" :disabled="fupPresetOn === 'today'"
            @click="site.setFirstUpRangePreset('today')"
          >最早 ~ 今天</button>
          <button
            class="btn sm" type="button" :disabled="fupPresetOn === 'full'"
            @click="site.setFirstUpRangePreset('full')"
          >最早 ~ 最晚</button>
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
        <label for="fup-to">结束日期<small>默认今天</small></label>
        <div class="date-row">
          <input
            id="fup-to" v-model="fupTo" type="date" :class="{ dirty: fupToDirty }"
            :min="firstUpBounds.min" :max="firstUpToMax" @keyup.enter="confirmFupTo"
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
        <!-- 同上：两枚预设（store 的 setUpRangePreset），当前口径的那枚置灰 -->
        <div class="presets">
          <button
            class="btn sm" type="button" :disabled="upPresetOn === 'today'"
            @click="site.setUpRangePreset('today')"
          >最早 ~ 今天</button>
          <button
            class="btn sm" type="button" :disabled="upPresetOn === 'full'"
            @click="site.setUpRangePreset('full')"
          >最早 ~ 最晚</button>
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
        <label for="up-to">结束日期<small>默认今天，时间轴不伸到未来</small></label>
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
        <!-- 两级按钮组：与卡池列表右栏共用同一个组件。
             「只看进店」时把「不可能有进店记录的类型」置灰（其余照常可选，两个条件叠加）。 -->
        <TypeButtons
          :selected="site.upTypes" :disabled-types="site.upShopOnly ? site.noShopTypes : []"
          :label-text="upTypesLabel"
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
        <span>只看进店<small>上面的卡池类型不可能有进店记录的类型会置灰</small></span>
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

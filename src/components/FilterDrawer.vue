<script setup>
/**
 * 右抽屉：只装当前页面用得到的筛选。
 *  - 卡池列表页   → 筛选表单（类型 / 大类 / 开始日期范围 / UP 干员多选）
 *    ⚠️ UP 干员是**多选**：搜索框支持 名字 / 全拼 / 首字母（lib/opSearch.js），
 *    点候选加进来、点 chip 移除；生效的是 store 里的 `filters.ops`（精确名数组）。
 *  - 统计页       → 参考日期 + 「中坚甄选计入出率提升」开关 + 「中坚寻访只看中坚」开关
 *                    + 「中坚寻访不看标准次数」开关 + 「高亮干员」/「置灰干员」多选（两者互斥）
 *                    （2026-10-16 加：中坚表藏掉总/标准次数两列；选中的干员在四张表里那一行加浅黄底）
 *  - 首次UP间隔   → **统计模式切换** + 横轴 / 纵轴口径 + 首次日期范围
 *    （**图表版 / 表格版共用** —— 同一份数据、同一套口径，见 NavDrawer 的二级菜单）
 *  - UP 历史一览  → 时间范围（横轴）+ 纵轴排序 + 卡池类型多选 + 只看进店
 *  - 跨服卡池对比 → 寻访类型（白名单）+ **国服**开始日期范围 + UP 干员多选
 *    ⚠️ 这一页三服并列、**与左栏服务器选择无关**，所以它的筛选状态也单独存
 *    （`crossFilters` / `crossSort`），切服不重置。
 *
 * 两条「时间范围」共用同一套「草稿 + 确认」逻辑，见 composables/useRangeDraft.js。
 * ⚠️ **首次UP间隔**与**UP 历史**两处的**结束日期默认值 = 访问网站时的真实今天**
 * （2026-10-04 用户要求），由 store 的 `fullFirstUpRange` / `fullUpRange` 提供，
 * 「全部 / 重置」也回到它 —— 这两个标签因此都带一句「默认今天」。
 * ⚠️ **卡池列表**不在此列：结束日期仍取数据的最晚结束日（列表要照常列出预告池）。
 */
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { FIRST_UP_MODES, FIRST_UP_POOLS, UP_SORT_ROWS } from '../lib/constants.js';
import { CROSS_ALLOWED_TYPES } from '../lib/crossServer.js';
import { lastStdWord as lastStdWordOf, modeFirstLabel, modeWord } from '../lib/firstUp.js';
import { useSiteStore } from '../stores/site.js';
import { useLayout } from '../composables/useLayout.js';
import { useRangeDraft } from '../composables/useRangeDraft.js';
import TypeButtons from './TypeButtons.vue';
import OpPicker from './OpPicker.vue';

const site = useSiteStore();
const route = useRoute();
const { filterShow, toggleFilter } = useLayout();

const isBanners = computed(() => route.name === 'banners');
const isStats = computed(() => route.name === 'stats');
/* 「首次UP间隔」的两个版本（图表版 / 表格版）共用同一套右栏筛选：
   同一份 `site.firstUp`、同一套统计模式与口径，所以判断要覆盖两条路由 */
const isFirstUp = computed(() => route.name === 'firstUp' || route.name === 'firstUpTable');
const isUp = computed(() => route.name === 'upHistory');
/* 跨服卡池对比（2026-11-04）：三服并列，右栏只管类型 / 国服日期范围 / UP 干员。
   ⚠️ 2026-11-15 起拆成两条路由（表格 `crossServer` / 图表 `crossServerChart`），
      两页共用同一套 `crossFilters`，所以判断要覆盖两条。 */
const isCross = computed(() => route.name === 'crossServer' || route.name === 'crossServerChart');
/* 「额外显示仅国服存在的卡池」这条**只在表格版**出现（2026-11-16 用户加）：
   它是把默认被日期上界切掉的那批「只有国服有」的池**补进来**（追加，不是筛选）；
   图表上这些点两个差值都是 null、只会把横轴拉长，所以不适用。
   store 侧对应 `crossRowsForChart`（忽略这一项），别在图表页用 `crossRows`。 */
const isCrossTable = computed(() => route.name === 'crossServer');

/* 当前统计模式的词：`首次进店` / `首次轮换`；**中坚模式下前面加「中坚」**
   （`首次中坚进店` / `首次中坚轮换`）—— 取词统一走 lib/firstUp.js，别在这儿另拼一份 */
const firstLabel = computed(() => modeFirstLabel(site.firstUpMode, site.firstUpPool));
/** 不带「首次」的词：`进店` / `轮换`（中坚模式：`中坚进店` / `中坚轮换`） */
const firstWord = computed(() => modeWord(site.firstUpMode, site.firstUpPool));
/** 中坚模式「最后标准……日期」里的那个词：`进店` / `UP`（与 lastStdWord 同源） */
const lastStdWord = computed(() => lastStdWordOf(site.firstUpMode));

const filterTitle = computed(() => {
  if (isCross.value) return '筛选与日期范围';
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

/* ---------------- 跨服卡池对比：右栏摘要与结果条 ----------------
   ⚠️ 分母用 `crossEntries`（**全部**配对行，163）而不是当前日期范围内的行 ——
      这样「日期范围把国服独有的未来池切掉了」这件事在抽屉里是可见的。 */
const crossTypesLabel = computed(() => (!site.crossFilters.types.length
  ? '全部类型'
  : `已选 ${site.crossFilters.types.length} 种`));

const crossResult = computed(() => {
  const rows = site.crossRows;
  const n = (k) => rows.filter((r) => r.servers.length === k).length;
  return `命中 ${rows.length} / ${site.crossEntries.length} 期`
    + ` · 三服 ${n(3)} · 两服 ${n(2)} · 单服 ${n(1)}`
    + ` · 6★ 不一致 ${rows.filter((r) => r.up6Same === false).length}`;
});

const statResult = computed(() => {
  const { visible, map } = site.statData;
  return `参考日期 ${site.refDate} · 可见卡池 ${visible.length} 个 · 参与统计干员 ${Object.keys(map).length} 位`;
});

/* 右栏「隐藏被置灰的干员」（2026-11-21 用户加）：勾上后 `statHideOps` 里那批**整行不渲染**。
   过滤在 store 的 `statGroups` 里做（表格 / 复制 / 截图三处共用同一份数据）；
   与「编辑模式」互斥 —— 行藏了就点不到，两个 setter 互相踢（见 store）。
   ⚠️ 别在模板里给这个复选框写含「隐藏被置灰的干员」字样的 HTML 注释：
      SSR 会原样输出，按文案数元素的断言会翻倍。 */

/* ---------------- 「一键置灰」五个批量按钮（2026-11-21 用户加） ----------------
   输入框是**本地状态**（切服 / 刷新回到默认值，不持久化）；点「确定」调 store 的
   `hideXxx` 动作，规则本身在 `lib/stats.js` 的 `bulk*` 纯函数里。
   ⚠️ 置灰是**追加**（不覆盖已手动置灰的）；点完给一句「新增 N 位」——
      否则默认值点下去可能 0 命中（如「标准实装 ＜ 开服日」），看着像坏了。 */
const bulk = ref({
  upDays: '70',        // 距今＜N 天（用户 2026-11-21 定 70，原定 84）
  shopTop: '6',        // 进店等待前 N 名
  stdBefore: '2019-04-30', // 标准内实装 ＜ 日期
  firstUp: '2',        // 首次UP队列第 N 名起
  firstShop: '2',      // 首次进店队列第 N 名起
});
const bulkMsg = ref('');
/* 「高亮 / 置灰干员」的「清除全部」按钮放在**标签那一行、贴右**（2026-11-21 用户指定位置），
   由 `.fhead` 那层 flex 包住；不用 `<div class="opclear">` 单独占一行。
   ⚠️ 别在模板里给它写 HTML 注释：注释会被 SSR 原样输出，`verify-render` 里
      `count(html, /清除全部/g) === 2` 那条会数成 4。 */

/** 「置灰干员 · 清除全部」—— 连「一键置灰」的提示一起清掉（否则清完还挂着「已新增 N 位」） */
function clearHideOps() {
  site.setStatHideOps([]);
  bulkMsg.value = '';
}

/** 执行一条批量置灰：`fn` 返回**合并后**的总数；提示里给出「新增几位」 */
function runBulk(fn) {
  const before = site.statHideOps.length;
  const total = fn();
  const added = total - before;
  bulkMsg.value = added
    ? `已新增置灰 ${added} 位（共 ${total} 位）`
    : `没有新增（共 ${total} 位）—— 条件里没有符合条件的干员`;
}

/* 「今天 / 标准最晚 / 中坚最晚」三个快捷参考日（后两个 2026-10-29 用户加）：
   · 标准最晚 = **标准寻访 + 限定寻访**里最晚的卡池结束日；
   · 中坚最晚 = **中坚寻访**大类里最晚的卡池结束日。
   ⚠️ 取值走 store 的 `stdLatestDate` / `midLatestDate`，它们基于**当前统计口径**（`banners`）——
      **自定义卡池计不计入统计会改变这个日期**（用户特意强调）。
   ⚠️ 不按参考日期过滤（不是「可见卡池」的最晚），否则点一次之后结果会自己漂。
   ⚠️ 说明**只能放这儿**：写进 `<template>` 的 HTML 注释会被 SSR 原样输出，
      里面的「标准最晚 / 中坚最晚」会被字面量断言数进去。 */

/* 「中坚寻访不看标准次数」（用户 2026-10-16 加）：中坚干员迁入后就不再进标准寻访，
   「标准次数」只是他们**迁入之前**的老记录 → 勾上后中坚表藏掉「总次数 / 标准次数」两列，
   每组只剩「结束时间 / 距今天数 / 中坚次数」（**总次数一并藏**：总 = 中坚 + 标准）。
   纯展示层开关：不改数据、不改排序、不动标准寻访表；复制内容跟着一起收。
   ⚠️ 这段说明**只能放这儿** —— 写进 `<template>` 的话 Vue SSR 会**原样输出**注释，
      里面的「总次数 / 标准次数」会被 `verify-render` 的字面量断言数进去（2026-10-16 踩到）。 */

/* 统计页「高亮干员 / 置灰干员」的候选池 —— 取当前统计口径下**真正会出现在四张表里**的干员。
   ⚠️ 不铺全量干员表：不在池里的选了也永远高亮不到（该服还没实装 / 只在被排除的中坚甄选里
      露过面 …），白选一次还会让人以为功能坏了。名字都是国服名，与表格行上的 `r.name` 同源。 */
const hlPool = computed(() => site.statRows.map((r) => r.name));

const firstUpResult = computed(() => {
  const { six, five, rows, mode, poolType } = site.firstUp;
  return `命中 六星 ${six.length} 位 / 五星 ${five.length} 位`
    + `（共 ${rows.length} 位有${modeWord(mode, poolType)}记录）`;
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

/* ---------------- 卡池列表：UP 干员多选 ----------------
   ⚠️ 2026-11-17 起**改用 `OpPicker.vue`**：原来这里是一份手写的内联实现（搜索框 + 浮层 + chip），
   与弹窗 / 统计页那几处重复了 ~50 行。收编进组件后，新加的「未输入时给默认候选」自动也用上了。
   `input-id="f-op"` 是为了保住 `<label for="f-op">` 的可点聚焦。

   ⚠️ 候选池 = **全部干员**（`Object.keys(site.operators)`，原来手写实现就是这么取的）——
   别写成 `site.opPool`，store 里没有这个 getter（2026-11-17 迁移时踩过：池子是 undefined，
   于是默认候选和搜索全都是空的，页面看不出报错）。 */

/** 卡池列表「UP 干员」的候选池：全部干员名（筛选是筛**卡池**，不是筛干员） */
const bannerOpPool = computed(() => Object.keys(site.operators));

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
  site.setUpAllOps(false);
  site.setUpFullBar(false);
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
        <!-- 打字 → 浮层里出候选；**没打字时**给「距今天数最久」的 6 标准 + 6 中坚作为默认候选。
             回车取第一个候选、Esc 清空（都得先选进来才算筛选条件） -->
        <OpPicker
          :model-value="site.filters.ops" :pool="bannerOpPool" :suggest="site.opSuggest"
          input-id="f-op" @update:model-value="site.setBannerOps"
          placeholder="名字 / 全拼 / 首字母，如 银灰 / yinhui / yh"
        />
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
      <div class="btn-row ref-row">
        <button class="btn" type="button" @click="site.setRefDate(site.today)">今天</button>
        <button
          class="btn" type="button" :disabled="!site.stdLatestDate"
          :title="site.stdLatestDate
            ? `跳到「标准 + 限定」里最晚的卡池结束日：${site.stdLatestDate}（${site.customInStats ? '含' : '不含'}自定义卡池）`
            : '本服没有标准 / 限定卡池'"
          @click="site.setRefDate(site.stdLatestDate)"
        >标准最晚</button>
        <button
          class="btn" type="button" :disabled="!site.midLatestDate"
          :title="site.midLatestDate
            ? `跳到「中坚寻访」里最晚的卡池结束日：${site.midLatestDate}（${site.customInStats ? '含' : '不含'}自定义卡池）`
            : '本服没有中坚寻访卡池'"
          @click="site.setRefDate(site.midLatestDate)"
        >中坚最晚</button>
      </div>
      <div class="fhint">
        仅统计 <code>卡池开启日期 ≤ 参考日期</code> 的卡池，用于回看任意历史时点的出率提升记录。
        不影响「卡池列表」页。
      </div>
      <!-- 中坚甄选（clafes）默认不计入出率提升（2026-10-08 用户定）：
           甄选池每期一次性放出 30+ 位中坚干员，与常驻中坚不是一回事，混进来会把次数抬得很难看。
           不影响卡池列表 / 图表 / 进行中判定。 -->
      <label class="chk">
        <input
          type="checkbox" :checked="site.statIncludeClafesUp"
          @change="site.setStatIncludeClafesUp($event.target.checked)"
        />
        <span>中坚甄选计入出率提升</span>
      </label>
      <!-- 「中坚寻访只看中坚」（2026-10-14 用户加）：中坚干员的「结束时间 / 距今天数」
           改按**中坚记录**算；从未在中坚 UP 过的，结束时间显示 —、天数自「迁入中坚寻访」日起算。
           口径见 lib/stats.js 的 viewEndInfo()。 -->
      <label class="chk">
        <input
          type="checkbox" :checked="site.statMidOnly"
          @change="site.setStatMidOnly($event.target.checked)"
        />
        <span>中坚寻访只看中坚<small>勾选后中坚干员只看中坚寻访里的上次UP / 进店；从未轮过的按「迁入中坚寻访」日起算</small></span>
      </label>
      <label class="chk">
        <input
          type="checkbox" :checked="site.statMidNoStd"
          @change="site.setStatMidNoStd($event.target.checked)"
        />
        <span>中坚寻访不看标准次数<small>勾选后中坚寻访表只显示中坚次数</small></span>
      </label>
      <label class="chk">
        <input
          type="checkbox" :checked="site.statGrayedHidden"
          @change="site.setStatGrayedHidden($event.target.checked)"
        />
        <span>隐藏被置灰的干员<small>勾选后置灰的那些行整行不显示（进「编辑模式」会自动取消）</small></span>
      </label>
      <!-- 「高亮干员」（2026-10-16 用户加）：选中的干员在下面四张表里那一行加**浅黄底**。
           纯浏览辅助 —— 不筛行、不改次数、不进复制内容；切服不重置（见 store 的说明）。
           交互复用 OpPicker（与卡池列表右栏的「UP 干员」同一套：名字 / 全拼 / 首字母 + chip）。 -->
      <div class="fgroup">
        <div class="fhead">
          <label>
            高亮干员<span class="fcount">{{ site.statHighlightOps.length ? `已选 ${site.statHighlightOps.length} 位` : '可多选' }}</span>
          </label>
          <button
            class="btn sm clear-all" type="button" :disabled="!site.statHighlightOps.length"
            @click="site.setStatHighlightOps([])"
          >清除全部</button>
        </div>
        <OpPicker
          :model-value="site.statHighlightOps"
          :pool="hlPool" :suggest="site.opSuggest"
          @update:model-value="site.setStatHighlightOps"
        />
      </div>
      <!-- 「置灰干员」（2026-11-17 用户加）：选中的干员那一行**盖灰罩**（与复制模式的遮罩同款，
           只是复制模式后来加深了一档以便区分）。⚠️ 与「高亮干员」**互斥** —— 名额先给谁就是谁的，
           后选的一边会把同名条目从另一边摘掉（store 的两个 setter 里做的，见 `_excludeOps`）。 -->
      <div class="fgroup">
        <div class="fhead">
          <label>
            置灰干员<span class="fcount">{{ site.statHideOps.length ? `已选 ${site.statHideOps.length} 位` : '可多选' }}</span>
          </label>
          <button
            class="btn sm clear-all" type="button" :disabled="!site.statHideOps.length"
            @click="clearHideOps()"
          >清除全部</button>
        </div>
        <OpPicker
          :model-value="site.statHideOps"
          :pool="hlPool" :suggest="site.opSuggest"
          @update:model-value="site.setStatHideOps"
        />
      </div>
      <!-- 「一键置灰」（2026-11-21 用户加）：五条规则各一个输入框 + 确定，点确定就**并入**
           上面的置灰名单（追加，不覆盖）。规则口径见 lib/stats.js 的 `bulk*` 纯函数。
           布局复用右栏既有的紧凑行（`.quick-row` / `.btn.sm`）—— 抽屉内容宽只有 ~221px，
           四条**一行一条**、日期那条**折两行**（一行放不下，日期会被截断），解释文字放 `title`。 -->
      <div class="fgroup bulk">
        <label>一键置灰<span class="fcount">并入上面的置灰名单</span></label>
        <div class="quick-row" title="出率提升距今天数 ＜ N 天的干员全部置灰（进行中算 0 天；显示「—」的无数据不算）">
          <span class="q-txt">距今＜</span>
          <input v-model="bulk.upDays" class="q-num" type="number" min="1" step="1" inputmode="numeric" aria-label="距今小于多少天" />
          <span class="q-txt">天</span>
          <button class="btn sm" type="button" @click="runBulk(() => site.hideRecentDays('up', bulk.upDays))">确定</button>
        </div>
        <div class="quick-row" title="每张表（6/5 星 × 标准/中坚）各取商店兑换距今天数最大的 N 名置灰（进行中 / 无数据的都不算「在等」）">
          <span class="q-txt">进店等待前</span>
          <input v-model="bulk.shopTop" class="q-num" type="number" min="1" step="1" inputmode="numeric" aria-label="进店等待前几名" />
          <span class="q-txt">名</span>
          <button class="btn sm" type="button" @click="runBulk(() => site.hideShopWaitingTop(bulk.shopTop))">确定</button>
        </div>
        <div class="bulk-stack" title="只针对标准寻访的干员：实装时间 ＜ 该日期的全部置灰（严格小于；默认开服日 = 一位都不命中）">
          <span class="q-txt">标准实装＜</span>
          <div class="quick-row">
            <input v-model="bulk.stdBefore" class="q-date" type="date" aria-label="标准干员实装早于哪一天" />
            <button class="btn sm" type="button" @click="runBulk(() => site.hideStdBefore(bulk.stdBefore))">确定</button>
          </div>
        </div>
        <div class="quick-row" title="每张表各排：出率提升次数只有 1 次的干员按实装时间从早到晚排，从第 N 名起全部置灰（默认 2 = 每张表各放过最早的 1 名）">
          <span class="q-txt">首次UP第</span>
          <input v-model="bulk.firstUp" class="q-num" type="number" min="1" step="1" inputmode="numeric" aria-label="首次UP队列从第几名起" />
          <span class="q-txt">名起</span>
          <button class="btn sm" type="button" @click="runBulk(() => site.hideUpOnceFrom(bulk.firstUp))">确定</button>
        </div>
        <div class="quick-row" title="每张表各排：商店兑换次数为 0（一次都没进过店）的干员按实装时间从早到晚排，从第 N 名起全部置灰（默认 2 = 每张表各放过最早的 1 名）">
          <span class="q-txt">首次进店第</span>
          <input v-model="bulk.firstShop" class="q-num" type="number" min="1" step="1" inputmode="numeric" aria-label="首次进店队列从第几名起" />
          <span class="q-txt">名起</span>
          <button class="btn sm" type="button" @click="runBulk(() => site.hideShopNoneFrom(bulk.firstShop))">确定</button>
        </div>
        <div v-if="bulkMsg" class="bulk-msg">{{ bulkMsg }}</div>
      </div>
      <div class="fresult">{{ statResult }}</div>
    </div>

    <!-- 首次UP间隔：统计模式 + 横轴 / 纵轴口径 + 按首次日期筛选 -->
    <div v-else-if="isFirstUp" class="drawer-bd pane pane-firstup">
      <!-- 卡池类型（2026-10-31 用户加）：标准 = 现行口径；中坚 = 只看「常驻中坚寻访」。
           ⚠️ 切换时**不动**日期范围（用户明确要求），所以切到中坚后左边可能空一段。
           ⚠️ 「中坚」不含中坚甄选 —— 甄选一次放 30+ 位，会把首次日期挤成一堆。 -->
      <div class="fgroup">
        <label>卡池类型</label>
        <div class="seg">
          <button
            v-for="p in FIRST_UP_POOLS" :key="p.id"
            type="button" :class="{ on: site.firstUpPool === p.id }"
            @click="site.setFirstUpPool(p.id)"
          >{{ p.label }}</button>
        </div>
      </div>
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
          >按{{ firstLabel }}日</button>
          <!-- ⚠️ 中坚模式下这个口径的基准不是实装日，而是「迁入前最后一次在标准池露面」
               —— 文案跟着变（用户 2026-11-01 指定），别写死「按实装日期」 -->
          <button
            type="button" :class="{ on: site.firstUpAxis === 'release' }"
            @click="site.setFirstUpAxis('release')"
          >{{ site.firstUpPool === 'mid' ? `按最后标准${lastStdWord}日` : '按实装日' }}</button>
        </div>
      </div>
      <div class="fgroup">
        <label>纵轴</label>
        <div class="seg">
          <button
            type="button" :class="{ on: site.firstUpMetric === 'gap' }"
            @click="site.setFirstUpMetric('gap')"
          >距上一个干员</button>
          <button
            type="button" :class="{ on: site.firstUpMetric === 'sinceRelease' }"
            @click="site.setFirstUpMetric('sinceRelease')"
          >{{ site.firstUpPool === 'mid' ? `距最后标准${lastStdWord}日` : '距实装日' }}</button>
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
        <label for="fup-to">结束日期</label>
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
      <div class="fresult">{{ firstUpResult }}</div>
    </div>

    <!-- 跨服卡池对比（2026-11-04）：三服并列，右栏只管类型 / **国服**日期范围 / UP 干员 -->
    <div v-else-if="isCross" class="drawer-bd pane pane-cross">
      <div class="fgroup">
        <TypeButtons
          :selected="site.crossFilters.types" :only-types="CROSS_ALLOWED_TYPES"
          :label-text="crossTypesLabel"
          @toggle="site.toggleCrossType"
          @toggle-category="site.toggleCrossCategory"
          @clear="site.setCrossTypes([])"
        />
      </div>
      <div class="fgroup">
        <label for="cs-from">开始日期（国服）≥</label>
        <input
          id="cs-from" v-model="site.crossFilters.from" type="date"
          :min="site.crossBounds.min" :max="site.crossBounds.max"
        />
      </div>
      <div class="fgroup">
        <label for="cs-to">开始日期（国服）≤</label>
        <input
          id="cs-to" v-model="site.crossFilters.to" type="date"
          :min="site.crossBounds.min" :max="site.crossBounds.max"
        />
      </div>
      <div class="fgroup">
        <label>
          UP 干员<span class="fcount">{{ site.crossFilters.ops.length ? `已选 ${site.crossFilters.ops.length} 位` : '可多选' }}</span>
        </label>
        <OpPicker
          :model-value="site.crossFilters.ops" :pool="site.crossOpPool" :suggest="site.opSuggest"
          placeholder="名字 / 全拼 / 首字母"
          @update:model-value="site.setCrossOps"
        />
      </div>
      <!-- 「额外显示仅国服存在的卡池」：表格版专用（图表版那些点没有差值，见 script 里的 isCrossTable） -->
      <label v-if="isCrossTable" class="chk">
        <input
          id="cs-show-sc"
          type="checkbox" :checked="site.crossFilters.showScOnly"
          @change="site.setCrossShowScOnly($event.target.checked)"
        />
        <span>额外显示仅国服存在的卡池<small>这批池只有国服有、日期又晚于上面的上界，平时被切掉了；勾选后<b>追加</b>列出（其余行不受影响）</small></span>
      </label>
      <button class="btn" type="button" @click="site.resetCrossFilters()">重置筛选</button>
      <div class="fresult">{{ crossResult }}</div>
    </div>

    <!-- UP 历史一览 -->
    <div v-else class="drawer-bd pane pane-up">
      <div class="fgroup">
        <div class="sortrows">
          <div class="sortrow">
            <span class="sortlabel">切换星级</span>
            <div class="seg mini">
              <button
                type="button" :class="{ on: site.upRarity === 6 }"
                @click="site.setUpRarity(6)"
              >六星</button>
              <button
                type="button" :class="{ on: site.upRarity === 5 }"
                @click="site.setUpRarity(5)"
              >五星</button>
            </div>
          </div>
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
        <label for="up-from">开始日期</label>
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

      <!-- 两个「始终」选项（2026-10-30 用户加）：拆成「纵轴」和「横条」两件事。 -->
      <label class="chk">
        <input
          type="checkbox" :checked="site.upAllOps"
          @change="site.setUpAllOps($event.target.checked)"
        />
        <span>纵轴始终显示所有干员</span>
      </label>
      <label class="chk">
        <input
          type="checkbox" :checked="site.upFullBar"
          @change="site.setUpFullBar($event.target.checked)"
        />
        <span>始终显示日期范围内完整横条</span>
      </label>

      <label class="chk">
        <input
          type="checkbox" :checked="site.upShopOnly"
          @change="site.setUpShopOnly($event.target.checked)"
        />
        <span>只看进店</span>
      </label>

      <label class="chk">
        <input
          type="checkbox" :checked="site.upHideMid"
          @change="site.setUpHideMid($event.target.checked)"
        />
        <span>隐藏在结束日期已属中坚的干员</span>
      </label>

      <label class="chk">
        <input
          type="checkbox" :checked="site.upShowGaps"
          @change="site.setUpShowGaps($event.target.checked)"
        />
        <span>显示两次 UP 的间隔天数</span>
      </label>

      <div class="btn-row">
        <button class="btn" type="button" @click="resetUp">全部重置</button>
      </div>
      <div class="fresult">{{ upResult }}</div>
    </div>
  </aside>
</template>

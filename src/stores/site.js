/**
 * 站点数据与界面状态（Pinia）。
 *
 * 分两类状态：
 *  1. 数据：meta / operators / bannersByServer（启动时加载一次）；
 *     categories（type → 大类）是常量，见 constants.js 的 BANNER_CATEGORIES
 *  2. 界面：server、refDate、filters、各表排序
 *
 * 关键语义（勿混用）：
 *  - `today`       = 页面打开时的真实当天，**参考日期的初始值**，也是「进行中」的判定基准，
 *                    还是 UP 历史 / 首次UP间隔**结束日期的默认值**（2026-10-04，见 fullUpRange）
 *  - `updateDates` = 三个服务器各自的**数据更新日**（纯展示，不参与计算）：
 *                    国服 = metadata.generatedAt、国际服 = enGeneratedAt、繁中服 = tcGeneratedAt
 *                    ⚠️ 口径是 **wiki 抓来的卡池**数据的更新日，**不含中坚**（中坚见 `claUpdateDates`）
 *  - `claUpdateDates` = 三个服务器各自的**中坚系列**（官方解包）数据更新日：
 *                    取自 `metadata.cla[服].generatedAt`（镜像），缺失时退回中坚文件自带的日期
 *  - `banners`     = **当前口径**下的卡池（`customInStats` 关 = 只有已公布数据；
 *                    开 = 再加上本服的自定义卡池）→ **统计页 / 图表**都用它
 *  - `allBanners`  = **总是**含自定义卡池 → **卡池列表**与左栏计数用它
 *                    （用户 2026-10-04 定：「默认只显示」= 自定义池只在卡池列表出现）
 */
import { defineStore } from 'pinia';
import { BANNER_CATEGORIES } from '../lib/constants.js';
import { loadSiteData, toBannerList } from '../lib/loadData.js';
import { SERVER_FIELD, SERVER_CLASSIC_FIELD } from '../lib/constants.js';
import { localToday, shiftYears } from '../lib/date.js';
import {
  bulkCountRange, bulkRecentDays, bulkShopWaitingTop, bulkStdBefore,
  computeStats, daysSortValue, isMidAt, latestEndDate, sortStatRows, viewEndInfo,
} from '../lib/stats.js';
import { computeFirstUp } from '../lib/firstUp.js';
import { computeUpHistory, typesWithoutShop } from '../lib/upHistory.js';
import { bannerRows, emptyFilters, nextBannerSort, nextStatSort } from '../lib/banners.js';
import {
  CROSS_SERVERS, buildCrossEntries, crossBounds, crossRows, emptyCrossFilters, nextCrossSort,
} from '../lib/crossServer.js';
import {
  dedupe, loadEntries, nextUid, parseImport, saveEntries, serialize, validate,
} from '../lib/customBanners.js';

/**
 * 时间范围的**结束日期默认值** = 访问网站时的**真实今天**（用户 2026-10-04 指定）。
 *
 * ⚠️ 只用于 **UP 历史**（`fullUpRange`）与**首次UP间隔**（`fullFirstUpRange`）——
 * 这两处的右栏 / 时间轴不该默认伸到未来。**卡池列表**（`fullBannerRange`）刻意**不**用它，
 * 结束日期仍取数据的最晚结束日（列表要照常列出已预告、还没开的池子）。
 *
 * 数据下界比今天还晚时（刚开服、或数据里全是预告池）取下界 —— 否则会得到
 * 「结束 < 开始」的反向区间，日期框一打开就是冲突状态。
 */
const endDefault = (min, today) => (min && today < min ? min : today);

/**
 * 干员选择框「默认候选」的分组核心 —— 下面几个 `opSuggest*` getter 共用这一份。
 *
 * 口径（2026-11-17 用户要求）：
 * · 天数走 `viewEndInfo(row, 'up', refDate, midOnly)` + `daysSortValue()` —— 与统计表
 *   「距今天数」那一列**完全同源**（进行中 = 0、无数据 = -1）；
 * · 标准 / 中坚用 `isMidAt(row, refDate)` 分（**不是** `everMid`，见 lib/stats.js 的说明）；
 * · 参考日期用当前 `refDate` —— 与表格里看到的一致，换了参考日候选也跟着变；
 * · 每组取前 **6** 位，平局按名字码点序。
 *
 * @param {Array}   rows      统计行（`statRows`）
 * @param {string}  refDate   参考日期
 * @param {boolean} midOnly   右栏「中坚寻访只看中坚」开关（决定天数的口径）
 * @param {number|null} rarity 只取该星级（`null` = 不分星级）
 * @returns {{std: string[], mid: string[]}}
 */
function suggestGroups(rows, refDate, midOnly, rarity = null) {
  const pick = (isMid) => rows
    .filter((r) => isMidAt(r, refDate) === isMid && (rarity == null || r.rarity === rarity))
    .map((r) => ({ name: r.name, v: daysSortValue(viewEndInfo(r, 'up', refDate, midOnly)) }))
    .sort((a, b) => (b.v - a.v) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, 6)
    .map((x) => x.name);
  return { std: pick(false), mid: pick(true) };
}

export const useSiteStore = defineStore('site', {
  state: () => ({
    // ---- 数据 ----
    ready: false,
    loading: false,
    error: '',
    meta: { servers: [], defaultServer: 'sc', generatedAt: '', cla: {} },
    operators: {},
    /* 每服的 extras 索引：`{ sc|en|tc: { skins, memoirs, modules } }` —— 来自
       `skins_<srv>.json` / `memoirs_<srv>.json` / `modules_<srv>.json`（**按服分文件**）。
       某服缺文件时它就是空对象 → UP 历史页只是不显示**对应的**标记，不报错。 */
    extrasByServer: {},
    /* type → 大类：来自 constants.js（不再由 JSON 数据文件提供） */
    categories: BANNER_CATEGORIES,
    bannersByServer: {},
    /* ---- 自定义卡池（浏览器本地自设）----
       `customEntries` = v3 条目（**与卡池数据同构**：`upOperators` + `endDate` +
       `rerunKind`/`canRerun`，三服混在一起、每条自带 server）；
       `customByServer` / `customActiveUids` = 与已公布卡池**去重后**的结果（在 loadData 里算好）；
       `customDropped` = 「撞了但还没清理」的（= 用户**本次会话刚添加**的那种，见 `_syncCustom`）；
       `customAutoRemoved` = **加载时已被自动删除**的（撞上的自设在加载时就从存储里删掉了）。
       ⚠️ **绝不并进 `bannersByServer`** —— 那样就分不出「哪些是自设」了。 */
    customEntries: [],
    customByServer: {},
    customActiveUids: {},
    customDropped: [],
    customAutoRemoved: [],

    // ---- 界面 ----
    server: 'sc',
    refDate: '',                       // 参考日期，仅作用于统计页
    today: localToday(),               // 页面打开时的真实当天
    filters: emptyFilters(),
    firstUpRange: { from: '', to: '' }, // 首次UP间隔页：按首次日期筛（空 = 不限）
    firstUpPool: 'std',                // 卡池类型：std 标准寻访 | mid 中坚寻访（只看常驻中坚）
    firstUpMode: 'shop',               // 统计模式：shop 首次进店 | rotation 首次轮换
    firstUpAxis: 'first',              // 横轴口径：first 按首次日期 | release 按实装日期
    firstUpMetric: 'gap',              // 纵轴口径：gap 距上个首次日期 | sinceRelease 距实装日期
    upRange: { from: '', to: '' },     // UP 历史：控制图表横轴范围，**同时**决定哪些干员占行
                                       //（范围内没有任何标记的干员不显示，见 computeUpHistory）
    /* 「**纵轴始终显示所有干员**」（2026-10-30 由「显示范围内未 UP 干员」改名，行为不变）：
       勾上则忽略上面那条 —— 范围内没有 UP 的干员也占一行。 */
    upAllOps: false,
    /* 「**始终显示日期范围内完整横条**」（2026-10-30 用户加）：横条改从**首次 UP** 画到**最后一次 UP**
       （默认从**实装日**画起），仍只在日期范围边界处裁剪。默认关 = 与改造前完全一致。 */
    upFullBar: false,
    upSort: 'release-asc',             // UP 历史：纵轴排序
    upRarity: 6,                       // UP 历史：一次只显示一个星级（默认六星）
    upTypes: [],                       // UP 历史：选中的卡池类型（空 = 全部）
    upShopOnly: false,                 // UP 历史：只看进店（与 upTypes **正交、可叠加**）
    upHideMid: false,                  // UP 历史：隐藏「在结束日期已属中坚寻访」的干员
    upShowGaps: false,                 // UP 历史：两次 UP 之间写日期差（**默认关**）
    avatarMode: 'text',                // 干员展示：text 简洁（名字）| image 图片（头像）
    bannerSort: { key: 'startDate', dir: 'desc' },
    /* 跨服卡池对比（/cross-server）：筛选与排序。⚠️ 与 server 无关，`setServer` **不重置**它们 */
    crossFilters: emptyCrossFilters(),
    crossSort: { key: 'scStart', dir: 'desc' },   // 默认按国服开始日期倒序
    statSort: {},                      // { '6-std': {key,dir}, ... } 每张统计表各自记排序
    statIncludeClafesUp: false,        // 统计页：中坚甄选（clafes）是否计入**出率提升**（默认关 = 排除）
    statMidOnly: false,                // 统计页：中坚寻访是否**只看中坚**（默认关，见 lib/stats.js）
    statMidNoStd: false,               // 统计页：中坚寻访表是否**藏掉「总次数 / 标准次数」两列**（默认关）
    /* 统计页「合并中坚寻访三个次数」（2026-11-22 用户加）：中坚表把「总次数 / 中坚次数 / 标准次数」
       并成**一列「次数」**，值写成 `总/中坚/标准`（中坚蓝、标准黄），排序按中坚次数。
       ⚠️ 与上面的 `statMidNoStd` **互斥**（两个都改列结构，后点的赢）。默认关。 */
    statMidMergeCounts: false,
    /* 统计页「隐藏被置灰的干员」（2026-11-21 用户加）：勾上后 `statHideOps` 里的人**整行不渲染**。
       ⚠️ 与「编辑模式」**互斥**：编辑模式靠点行循环状态，行被藏掉就点不到了 ——
          两个 setter 互相踢（进编辑模式自动取消隐藏，反之亦然）。默认关。 */
    statGrayedHidden: false,
    /* ⚠️ 这两个名单按**干员名**存，而名字是**分服**的（`scName` / 三服各一套）→
       **切服务器一律清空**（2026-11-21 用户要求，见 `setServer`）。其余情况（刷新、切页）不动。 */
    statHighlightOps: [],              // 统计页：要**高亮**的干员名（空 = 不高亮；纯浏览辅助，不筛行）
    statHideOps: [],                   // 统计页：要**置灰**（盖灰罩）的干员名；与上面那个**互斥**
    /* 统计页「编辑模式」（2026-11-21 用户加）：开着的时候**点某一行**就循环它的状态
       普通 → 置灰 → 高亮 → 普通。纯界面状态：不筛行、不改数据、切服不重置、不持久化。 */
    statEditMode: false,
    customInStats: false,              // 自定义卡池：是否**计入统计与图表**（默认关 = 只显示在卡池列表）
  }),

  getters: {
    /** 全部服务器（含不可用，左栏下拉只渲染 available 的） */
    servers: (s) => s.meta.servers ?? [],
    availableServers: (s) => (s.meta.servers ?? []).filter((x) => x.available),
    serverMeta: (s) => (s.meta.servers ?? []).find((x) => x.id === s.server) ?? {},

    /** 三个服务器各自的「数据更新日」（左栏展示用；缺值显示 —）
     *  ⚠️ 口径 = **wiki 抓来的卡池**数据，**不含中坚** —— 中坚另有来源、另有日期，见下面 */
    updateDates: (s) => ({
      sc: s.meta.generatedAt || '—',
      en: s.meta.enGeneratedAt || '—',
      tc: s.meta.tcGeneratedAt || '—',
    }),

    /** 三个服务器各自的**中坚系列**（官方解包）数据更新日（左栏展示用；缺值显示 —） */
    claUpdateDates: (s) => ({
      sc: s.meta.cla?.sc?.generatedAt || '—',
      en: s.meta.cla?.en?.generatedAt || '—',
      tc: s.meta.cla?.tc?.generatedAt || '—',
    }),
    operatorCount: (s) => s.meta.operatorCount ?? Object.keys(s.operators).length,

    /** 当前服务器的**已公布**卡池（数组，带 id）—— 主表 + 中坚，**不含**自定义 */
    publishedBanners(s) {
      return toBannerList(s.bannersByServer[s.server]);
    },

    /** 当前服务器的自定义卡池（**已去重**；被吃掉的在 `myDroppedCustom`） */
    myCustomBanners: (s) => s.customByServer[s.server] ?? [],

    /**
     * **当前口径**下的卡池 —— **统计页与图表**用它。
     * 全局开关 `customInStats` 关（默认）= 只有已公布数据；开 = 再加上自定义。
     */
    banners(s) {
      return s.customInStats
        ? [...this.publishedBanners, ...this.myCustomBanners]
        : this.publishedBanners;
    },

    /**
     * **总是**含自定义 —— **卡池列表**与左栏计数用它。
     * 用户 2026-10-04 定「默认只显示」= 自定义池**只在卡池列表出现**，不进统计 / 图表。
     */
    allBanners() {
      return [...this.publishedBanners, ...this.myCustomBanners];
    },

    /** 左栏计数用：当前服**生效的**自定义条数（被去重吃掉的不算） */
    customCount: (s) => (s.customByServer[s.server] ?? []).length,

    /** 当前服「被去重吃掉、**但还没清理**」的自定义（= 用户本次会话刚添加的）
        —— 弹窗要单列提醒，否则用户以为没保存成功。⚠️ **下次打开页面就会被自动删除** */
    myDroppedCustom: (s) => s.customDropped.filter((d) => d.server === s.server),

    /** 当前服**加载时已被自动删除**的自定义（撞上的自设已在 `loadData` 里从存储删掉）
        —— 弹窗提示一声「这几条为什么不见了」 */
    myAutoRemovedCustom: (s) => s.customAutoRemoved.filter((d) => d.server === s.server),

    /** 当前服的自定义**原始输入**（弹窗的编辑列表用；顺序 = 添加顺序） */
    myCustomEntries: (s) => s.customEntries.filter((e) => e.server === s.server),

    /**
     * 当前服**真正生效**的自设原始输入（= 去重后活下来的那些）。
     * ⚠️ 与 `myCustomEntries` 的区别就在这 —— 弹窗的「已生效」列表必须用这个，
     *    否则被去重吃掉的条目也会混进去（用户 2026-10-04 定：那个列表只列生效的）。
     */
    myActiveEntries(s) {
      const uids = new Set(s.customActiveUids[s.server] || []);
      return s.customEntries.filter((e) => e.server === s.server && uids.has(e.uid));
    },

    /**
     * **三服**所有生效的自设（弹窗「已生效」列表用，用户 2026-11-15 要求跨服全列出）。
     * 每项自带 `server`，弹窗据此打服务器标签；顺序跟 `metadata.servers`（国服 → 国际服 → 繁中服），
     * 表里没有的服（正常不会有）按出现顺序垫在后面。
     * ⚠️ 只有「已生效」这一段跨服 —— 「已忽略 / 已自动删除」两段仍是当前服。
     */
    allActiveEntries(s) {
      const known = (s.meta.servers || []).map((x) => x.id);
      const extra = [...new Set(s.customEntries.map((e) => e.server))].filter((id) => !known.includes(id));
      const out = [];
      for (const srv of [...known, ...extra]) {
        const uids = new Set(s.customActiveUids[srv] || []);
        for (const e of s.customEntries) {
          if (e.server === srv && uids.has(e.uid)) out.push(e);
        }
      }
      return out;
    },

    /** 干员名 → charId（自设卡池的干员列表要存 charId；查不到给 null —— 允许强存新干员） */
    charIdOf: (s) => (name) => s.operators[name]?.charId ?? null,

    /** 干员名 → 国服实装日（自设卡池的 `upOperators` 排序用；查不到给 null） */
    releaseDateOf: (s) => (name) => s.operators[name]?.scReleaseDate ?? null,

    /** 干员名 → { rarity, isLimited }，统计计算用 */
    operatorIndex(s) {
      const idx = {};
      for (const name of Object.keys(s.operators)) {
        const o = s.operators[name];
        idx[name] = { rarity: o.rarity, isLimited: o.isLimited };
      }
      return idx;
    },

    /** 当前服的 extras 索引（皮肤 / 密录 / 模组，按干员名索引）—— 该服没有就返回空的三张表 */
    extras: (s) => s.extrasByServer[s.server] ?? { skins: {}, memoirs: {}, modules: {} },

    /** 干员在当前服务器的实装日；该服尚未实装则为 null */
    relDateOf: (s) => (op) => (op ? op[SERVER_FIELD[s.server]] || null : null),

    /** 干员在当前服务器**进入常驻中坚寻访**的日期；没有则 null（= 一直还在标准寻访） */
    classicDateOf: (s) => (op) => (op ? op[SERVER_CLASSIC_FIELD[s.server]] || null : null),

    /** 当前服务器最早的卡池开始日（「全部」快捷按钮用） */
    earliestDate() {
      let m = null;
      for (const b of this.banners) if (!m || b.startDate < m) m = b.startDate;
      return m;
    },

    /** 当前服务器卡池的开始 / 结束日边界（右栏日期输入的 min 用；也是卡池列表默认值的上界）
     *  ⚠️ 用 `allBanners`（**含自定义**）—— 否则日期上界盖不住自设的池子，
     *     卡池列表的默认范围会把它筛掉、看起来像「加了没生效」。
     *     UP 历史 / 首次UP间隔的默认下界另用 `earliestDate`（当前口径），见 `fullUpRange`。 */
    bannerBounds() {
      let min = null;
      let max = null;
      for (const b of this.allBanners) {
        if (!min || b.startDate < min) min = b.startDate;
        if (!max || b.endDate > max) max = b.endDate;
      }
      return { min, max };
    },

    /**
     * **卡池列表**日期范围控件的**默认值** = 本服卡池的完整跨度 `[最早开始日, 最晚结束日]`。
     *
     * 为什么要有它：`type="date"` 的输入框在值为空时浏览器只画「年/月/日」三个字，
     * 完全看不出可用范围，所以初始（以及重置 / 切服务器）就把跨度填进去。
     * ⚠️ 这个跨度与「不限」**完全等价**（没有任何卡池落在范围外），所以筛选结果一字不变，
     * 已预告但还没开始的卡池也照常列出。
     * ⚠️ 结束日期**不取「今天」**（2026-10-04 用户只要求改另外两处）：这里仍取数据上界，
     * 否则列表默认就少了未来池。UP 历史 / 首次UP间隔见 `fullUpRange` / `fullFirstUpRange`。
     */
    fullBannerRange() {
      const { min, max } = this.bannerBounds;
      return { from: min || '', to: max || '' };
    },

    /**
     * **UP 历史**时间范围的默认值 = `[本服最早卡池开始日, 今天]`。
     * ⚠️ 结束日期取「访问网站时的真实今天」（2026-10-04 用户要求，以前取 `bannerBounds.max`）——
     * 时间轴右端因此不再伸到未来，数据里「已预告但还没开始」的卡池默认不参与（要看得往后调）。
     */
    fullUpRange() {
      /* ⚠️ 下界用 `earliestDate`（**当前口径**的最早开始日），不是 `bannerBounds.min` ——
         后者含自定义池、是给卡池列表用的；跟着它走的话，开关关着时 UP 历史的横轴
         也会被自设池拉早（而图上并没有对应标记）。 */
      const min = this.earliestDate;
      return { from: min || '', to: endDefault(min, this.today) };
    },

    /** 首次UP间隔的默认值 = `[当前模式下首次日期下界, 今天]`（结束日期口径见 fullUpRange） */
    fullFirstUpRange() {
      const { min } = this.firstUp.bounds;
      return { from: min || '', to: endDefault(min, this.today) };
    },

    /** 卡池列表：筛选 + 排序后的行（**含自定义**，见 `allBanners`；与参考日期无关） */
    bannerRows(s) {
      return bannerRows(this.allBanners, s.filters, s.categories, s.bannerSort);
    },

    /* ---------------- 跨服卡池对比（/cross-server，2026-11-04） ----------------
       ⚠️ 取数**只用 `bannersByServer`**（三服原始映射：已 merge 中坚文件、已 unwrap `.banners`、
          不含自定义）。别用 `banners` / `allBanners` —— 那两个是「当前服 + 自定义」，
          跨服配对会串出「自定义_常驻标准寻访197」这种三服对不上的行。
       口径见 lib/crossServer.js 的文件头。 */

    /** 三服按名称配对后的全部行（不筛不排） */
    crossEntries(s) {
      return buildCrossEntries(s.bannersByServer);
    },

    /** 日期上下界：min = 有国服日期的最早；max = **至少两服有数据**的行里最晚的国服日期 */
    crossBounds() {
      return crossBounds(this.crossEntries);
    },

    /** 日期框默认值 = 上下界（空框只显示「年/月/日」，看不出可用范围，理由同 fullBannerRange） */
    crossFullRange() {
      const { min, max } = this.crossBounds;
      return { from: min || '', to: max || '' };
    },

    /** UP 干员候选池 = 入页卡池里出现过的干员名（三服并集）。
     *  ⚠️ 刻意**不跟着日期/类型筛选收窄** —— 否则已选的干员会变成「幽灵项」（选项没了、筛还在） */
    crossOpPool() {
      const out = new Set();
      for (const r of this.crossEntries) {
        for (const s of CROSS_SERVERS) {
          for (const o of r.banners[s]?.upOperators || []) out.add(o.scCharName);
        }
      }
      return [...out];
    },

    /** 表格行（筛选 + 排序后，与右栏结果条同一个数） */
    crossRows(s) {
      return crossRows(this.crossEntries, s.crossFilters, s.crossSort);
    },

    /**
     * **图表版**用的行：与表格同一套筛选，但**忽略 `showScOnly`**（2026-11-16）。
     *
     * 「额外显示仅国服存在的卡池」是表格版专用的排查口径 —— 那批行的 `servers` 只有国服，
     * `gapEnSc` / `gapTcSc` 恒为 null，画出来只是几个没有线的空 x 位置，还会把横轴拉长；
     * 所以图表侧不掺这一项。其余筛选（类型 / 日期 / UP 干员）两页共用，切换不丢。
     */
    crossRowsForChart(s) {
      return crossRows(this.crossEntries, { ...s.crossFilters, showScOnly: false }, s.crossSort);
    },

    /** 统计页：参考日期下的可见卡池与统计表 */
    statData(s) {
      return computeStats({
        banners: s.banners,
        categories: s.categories,
        operatorByName: s.operators,
        operatorIndex: this.operatorIndex,
        refDate: s.refDate || this.today,
        relDateOf: this.relDateOf,
        /* 中坚甄选（clafes）默认不计入出率提升，由右栏开关决定（见 lib/stats.js 文件头） */
        includeClafesUp: s.statIncludeClafesUp,
        /* 「只看中坚」时要拿本服的「迁入中坚寻访」日当兜底基准（同上） */
        classicDateOf: this.classicDateOf,
      });
    },

    /** 统计行数组（含 everMid / releaseDate） */
    statRows(s) {
      return Object.values(this.statData.map);
    },

    /**
     * 干员选择框的**默认候选**：按「出率提升距今天数」从大到小，标准 6 位 + 中坚 6 位。
     * 返回 `{ std, mid }` 两组（各组已按天数降序，平局按名字码点序）。口径见 `suggestGroups()`。
     *
     * ⚠️ 这一组**不分星级** —— 右栏那三个框（卡池列表 UP 干员 / 高亮 / 置灰）与跨服的池子
     *    都是全干员，正好直接用。**按星级切池子的框**（自定义卡池弹窗的六星 / 五星）要用
     *    下面 `opSuggestSix*` / `opSuggestFive*`，否则中坚那 6 位里只有 2~3 位是六星，
     *    被 `pool` 一滤就只剩三个（2026-11-17 用户报的就是这个）。
     * ⚠️ 只在**没输入文本**时用（OpPicker 的 `suggest` prop），输入了照常走搜索。
     */
    opSuggestGroups(s) {
      const refDate = s.refDate || this.today;
      return suggestGroups(this.statRows, refDate, s.statMidOnly);
    },

    /** 默认候选 · **按星级分组**：`{ 6: { std, mid }, 5: { std, mid } }`（同上口径，只多一层星级筛） */
    opSuggestGroupsByRarity(s) {
      const refDate = s.refDate || this.today;
      return {
        6: suggestGroups(this.statRows, refDate, s.statMidOnly, 6),
        5: suggestGroups(this.statRows, refDate, s.statMidOnly, 5),
      };
    },

    /** 默认候选 · **标准在前**（统计页两个选择框、卡池列表 / 跨服的 UP 干员都用这个） */
    opSuggest(s) {
      const g = this.opSuggestGroups;
      return [...g.std, ...g.mid];
    },

    /** 默认候选 · **中坚在前**（自定义卡池弹窗里卡池类型选到中坚类时才用，用户 2026-11-17 指定） */
    opSuggestMidFirst(s) {
      const g = this.opSuggestGroups;
      return [...g.mid, ...g.std];
    },

    /* 下面四个 = 上面两个的**按星级版**，专供自定义卡池弹窗的「六星」「五星」两个框。
       ⚠️ 那两个框的 `pool` 只含本星级的干员，用不分星级的那组会被滤剩两三位（中坚每期
          只有 2 六星 + 3 五星，所以中坚组前 6 位里六星本来就少）。 */

    /** 弹窗「六星」框 · 标准在前 */
    opSuggestSix(s) {
      const g = this.opSuggestGroupsByRarity[6];
      return [...g.std, ...g.mid];
    },
    /** 弹窗「六星」框 · 中坚在前 */
    opSuggestSixMidFirst(s) {
      const g = this.opSuggestGroupsByRarity[6];
      return [...g.mid, ...g.std];
    },
    /** 弹窗「五星」框 · 标准在前 */
    opSuggestFive(s) {
      const g = this.opSuggestGroupsByRarity[5];
      return [...g.std, ...g.mid];
    },
    /** 弹窗「五星」框 · 中坚在前 */
    opSuggestFiveMidFirst(s) {
      const g = this.opSuggestGroupsByRarity[5];
      return [...g.mid, ...g.std];
    },

    /**
     * 右栏「**标准最晚**」快捷参考日 —— 标准寻访 + 限定寻访里**最晚的卡池结束日**（2026-10-29）。
     * ⚠️ 走 `this.banners`（当前统计口径）→ **自定义池计不计入统计会改变这个日期**（用户特意强调）。
     * ⚠️ 不看参考日期（不是「可见卡池」的最晚），见 `lib/stats.js` 的 `latestEndDate()`。
     */
    stdLatestDate(s) {
      return latestEndDate(this.banners, s.categories, ['标准寻访', '限定寻访']);
    },

    /** 右栏「**中坚最晚**」—— 中坚寻访大类里最晚的卡池结束日（口径同上，随 `customInStats` 变） */
    midLatestDate(s) {
      return latestEndDate(this.banners, s.categories, ['中坚寻访']);
    },

    /** 首次UP间隔页：全部干员按选定口径排序后的序列（含六星 / 五星分组） */
    firstUp(s) {
      return computeFirstUp({
        banners: this.banners,
        operatorByName: s.operators,
        relDateOf: this.relDateOf,
        poolType: s.firstUpPool,
        mode: s.firstUpMode,
        from: s.firstUpRange.from,
        to: s.firstUpRange.to,
        axis: s.firstUpAxis,
        metric: s.firstUpMetric,
      });
    },

    /** UP 历史一览：每位干员一条横条（实装日 → 最后一次 UP），条上按卡池开始日打标记 */
    upHistory(s) {
      /* 当前服的皮肤 / 密录 / 模组索引 —— 用来判断「该期卡池与该干员的这些内容是否时间重合」。
         三服现在都有数据（国服皮肤来自 PRTS，其余来自官方解包），所以**不再按服门控**。 */
      const ex = this.extras;
      return computeUpHistory({
        banners: this.banners,
        categories: s.categories,
        operatorByName: s.operators,
        relDateOf: this.relDateOf,
        classicDateOf: this.classicDateOf,
        skinsByOperator: ex.skins,
        memoirsByOperator: ex.memoirs,
        modulesByOperator: ex.modules,
        /* 「在结束日期已属中坚」的判据时点 = 右栏结束日期（默认值就是今天），没设才按 today */
        today: s.today,
        hideMid: s.upHideMid,
        types: s.upTypes,
        shopOnly: s.upShopOnly,
        /* 时间范围既决定横轴可视范围，也决定哪些干员占行（范围内没标记的不占行）；
           勾了「纵轴始终显示所有干员」就传 null，等于不做这层过滤 */
        range: s.upAllOps ? null : s.upRange,
        sort: s.upSort,
      });
    },

    /** 「只看进店」模式下**不可能有记录**的卡池类型（右栏据此把它们置灰，见 lib/upHistory.js） */
    noShopTypes(s) {
      return typesWithoutShop(s.banners, Object.keys(s.categories));
    },

    /** 卡池大类 → 该大类下的类型列表（右栏二级菜单用，数据驱动） */
    typesByCategory(s) {
      const out = {};
      for (const [type, cat] of Object.entries(s.categories)) {
        (out[cat] ||= []).push(type);
      }
      return out;
    },

    /** 四个分节：每组已按各自记录的排序排好 */
    statGroups(s) {
      const refDate = s.refDate || this.today;
      /* ⚠️ `s.statMidOnly` 必须一路传到排序里 —— 否则「只看中坚」下按距今天数排序
         会和屏幕上的数字对不上（排序与显示必须同一口径，见 lib/stats.js 的 viewEndInfo）。
         ⚠️ 分组判据是 **`isMidAt(r, refDate)`**（迁入中坚日 <= 参考日期），不是 `r.everMid`：
            参考日期往回拨时，「后来才迁入中坚」的干员当时还在标准寻访，不该出现在中坚表里
            （2026-10-31 用户报的就是这个）。`everMid` 是「现在属于中坚」，只当作前置条件。 */
      const pick = (rarity, isMid) =>
        sortStatRows(
          this.statRows.filter((r) => r.rarity === rarity && isMidAt(r, refDate) === isMid),
          s.statSort[`${rarity}-${isMid ? 'mid' : 'std'}`],
          refDate,
          s.statMidOnly,
        );
      /* 「隐藏被置灰的干员」：在**这里**过滤（不在 `StatTable` 里）——
         因为表格、复制（`statCopyRows` 吃的是同一个 `statGroups`）、截图三处必须一致，
         只在组件里滤会导致「屏幕 3 行、复制出来 5 行」。
         ⚠️ 只影响**显示**：`statRows` / 一键置灰的规则仍然按全量算（隐藏不是删除）。 */
      const dropGrayed = s.statGrayedHidden ? new Set(s.statHideOps) : null;
      const keep = (rows) => (dropGrayed ? rows.filter((r) => !dropGrayed.has(r.name)) : rows);
      return {
        '6-std': keep(pick(6, false)),
        '6-mid': keep(pick(6, true)),
        '5-std': keep(pick(5, false)),
        '5-mid': keep(pick(5, true)),
      };
    },
  },

  actions: {
    async load() {
      if (this.ready || this.loading) return;
      this.loading = true;
      this.error = '';
      try {
        const data = await loadSiteData();
        this.meta = data.meta;
        this.operators = data.operators;
        this.extrasByServer = data.extrasByServer || {};
        this.categories = data.categories;
        this.bannersByServer = data.bannersByServer;
        /* 自定义卡池：原始输入 + 按服去重后的结果（都在 loadData 里读/算好）
           ⚠️ `customEntries` 已经是**清理过**的那份 —— 撞上已公布卡池的自设在 loadData 里
              就被删掉并写回存储了，删掉的那些记在 `customAutoRemoved` 里（弹窗提示用） */
        this.customEntries = data.customEntries || [];
        this.customByServer = data.customByServer || {};
        this.customActiveUids = data.customActiveUids || {};
        this.customDropped = [];
        this.customAutoRemoved = data.customAutoRemoved || [];
        this.server = data.meta.defaultServer;
        /* 参考日期初始值 = 打开页面的真实当天（2026-10-01 口径调整；以前取数据快照日） */
        this.refDate = this.today;
        /* 日期范围框初始就填上默认范围（否则只显示「年/月/日」）：
           卡池列表 = 本服完整跨度，UP 历史 / 首次UP间隔 = 到「今天」，见三个 fullXxxRange */
        this.filters = { ...emptyFilters(), ...this.fullBannerRange };
        this.firstUpRange = { ...this.fullFirstUpRange };
        this.upRange = { ...this.fullUpRange };
        /* 跨服对比页的日期范围也初始成上下界 —— 漏了这条会变成「两个空日期框 + 全部 163 行」，
           看着能用，实际把 9 条国服独有尾部也列进来了（与设计好的默认范围不一致） */
        this.crossFilters = { ...emptyCrossFilters(), ...this.crossFullRange };
        this.ready = true;
      } catch (err) {
        this.error = err?.message || String(err);
      } finally {
        this.loading = false;
      }
    },

    /* ---------------- 自定义卡池（浏览器本地自设） ----------------
       口径见 akGachaDocs/site/自定义卡池功能预研.md。四条约定：
       · 存的是 **v3 条目**（与 `banners_<server>.json` 的卡池对象同构，只多 `server` / `uid`），
         由 lib/customBanners.js 负责读写与容错（v1 / v2 老数据自动迁移）；
       · **去重**（撞上已公布的就丢自设）在 loadData / _syncCustom 里统一做；
       · 增删改一律「先校验、再写盘、再重算」，校验不过**不写盘**；
       · `customInStats`（是否计入统计与图表）是**界面状态**，不持久化 ——
         与全站其它界面状态一样，刷新即回默认（默认关）。
       ⚠️ **自动删除只发生在 `loadData`（页面加载）里**：那里撞上的自设会被真的从存储删掉
          （用户 2026-10-06 定）。本文件里的 `_syncCustom` **只算不删** —— 用户刚添加就撞车时
          得先看见「已忽略，撞了哪个池」，立刻静默删掉会让人以为没保存成功。 */

    /** 本地存储里的自设变了之后，重算「按服去重后的结果」（**只算不删**，见上） */
    _syncCustom() {
      const entries = this.customEntries;
      const byServer = {};
      const active = {};
      const dropped = [];
      for (const s of this.availableServers) {
        const mine = entries.filter((e) => e.server === s.id);
        const { kept, dropped: gone } = dedupe(
          mine, toBannerList(this.bannersByServer[s.id] || {}), this.charIdOf,
        );
        byServer[s.id] = kept.map((x) => x.banner);
        active[s.id] = kept.map((x) => x.entry.uid);
        for (const d of gone) dropped.push({ ...d, server: s.id });
      }
      this.customByServer = byServer;
      this.customActiveUids = active;
      this.customDropped = dropped;
    },

    /** 校验一条原始输入（弹窗的「保存」与实时提示都走这里，保证同一套口径） */
    validateCustom(entry) {
      return validate(entry, (name) => this.operators[name]);
    },

    /**
     * 新增一条。`ok:false` 时**什么都不写**。
     * @returns {{ok:boolean, errors:string[], warnings:string[]}}
     */
    addCustom(entry) {
      const res = this.validateCustom(entry);
      if (!res.ok) return res;
      const next = [...this.customEntries, { ...entry, uid: nextUid(this.customEntries) }];
      saveEntries(next);
      this.customEntries = next;
      this._syncCustom();
      return res;
    },

    /** 改写一条 —— **uid 不变**（id 就不变，列表里排序位置也稳定） */
    updateCustom(uid, entry) {
      const res = this.validateCustom(entry);
      if (!res.ok) return res;
      const next = this.customEntries.map((e) => (e.uid === uid ? { ...entry, uid } : e));
      saveEntries(next);
      this.customEntries = next;
      this._syncCustom();
      return res;
    },

    /** 删除一条 */
    removeCustom(uid) {
      const next = this.customEntries.filter((e) => e.uid !== uid);
      saveEntries(next);
      this.customEntries = next;
      this._syncCustom();
    },

    /** 导出**全部**自设（三服一份文件）—— 清缓存前的唯一备份手段 */
    exportCustom() {
      return serialize(this.customEntries);
    },

    /**
     * 导入：逐条走**同一套校验**，合法的进来（**重新分配 uid**），非法的汇总返回给界面。
     * ⚠️ 文件里带的 uid 可能与现有的撞，所以一律丢掉重编。
     * ⚠️ 2026-10-06 起**界面已不用它**了 —— 弹窗底部改成了 JSON 编辑框（走下面的
     *    `replaceCustom`，语义是**覆盖**）。保留是因为它俩语义不同（这个是**追加**），
     *    以后若要「把一段 JSON 合并进来」直接可用；别在当前 UI 里找它的调用点。
     * @returns {{ok:boolean, error:string|null, added:number, skipped:Array<{entry:object,errors:string[]}>}}
     */
    importCustom(text) {
      const parsed = parseImport(text, { charIdOf: this.charIdOf, releaseOf: this.releaseDateOf });
      if (!parsed.ok) return { ok: false, error: parsed.error, added: 0, skipped: [] };
      const add = [];
      const skipped = [];
      let uid = nextUid(this.customEntries);
      for (const raw of parsed.entries) {
        const { uid: _ignored, ...entry } = raw;
        const res = this.validateCustom(entry);
        if (!res.ok) { skipped.push({ entry: raw, errors: res.errors }); continue; }
        add.push({ ...entry, uid });
        uid += 1;
      }
      if (add.length) {
        const next = [...this.customEntries, ...add];
        saveEntries(next);
        this.customEntries = next;
        this._syncCustom();
      }
      return { ok: true, error: null, added: add.length, skipped };
    },

    /**
     * **整体替换**成 JSON 编辑框里的内容（弹窗底部那个框，2026-10-06 起取代了
     * 「导出文件 / 导入文件」那对按钮）。
     * ⚠️ 与 `importCustom`（**追加**）不同：这里是**覆盖** —— 框里就是全部自设，
     *    删掉的行就等于删掉那条。uid 一律**重编**（从 1 开始），免得框里带的 uid 撞车。
     * ⚠️ 框里若是**旧格式（v1 / v2）**的老 JSON，会自动迁移成 v3（返回值里 `migrated: true`）。
     * @returns {{ok:boolean, error:string|null, count:number, skipped:Array, migrated:boolean}}
     */
    replaceCustom(text) {
      const parsed = parseImport(text, { charIdOf: this.charIdOf, releaseOf: this.releaseDateOf });
      if (!parsed.ok) return { ok: false, error: parsed.error, count: 0, skipped: [], migrated: false };
      const kept = [];
      const skipped = [];
      for (const raw of parsed.entries) {
        const { uid: _ignored, ...entry } = raw;
        const res = this.validateCustom(entry);
        if (!res.ok) { skipped.push({ entry: raw, errors: res.errors }); continue; }
        kept.push({ ...entry, uid: kept.length + 1 });
      }
      saveEntries(kept);
      this.customEntries = kept;
      this._syncCustom();
      return { ok: true, error: null, count: kept.length, skipped, migrated: parsed.migrated };
    },

    /** 切换服务器：重置参考日期与全部筛选条件（见 akGachaDocs/site/工作指令.md 5.5） */
    setServer(id) {
      if (!id || !this.bannersByServer[id]) return;
      this.server = id;
      this.refDate = this.today;
      /* 日期范围回到新服的默认范围（不是空；空框只显示「年/月/日」，见三个 fullXxxRange） */
      this.filters = { ...emptyFilters(), ...this.fullBannerRange };
      this.firstUpRange = { ...this.fullFirstUpRange };
      this.upRange = { ...this.fullUpRange };
      this.upRarity = 6;
      this.upTypes = [];
      this.upShopOnly = false;
      this.upAllOps = false;
      this.upFullBar = false;
      this.upHideMid = false;
      /* ⚠️ 与 state 的初值、FilterDrawer 的 resetUp 三处**必须一致**：
         2026-10-02 这三处曾走散（初值 false / 这里 true / 右栏重置 false），
         表现是「切一下服务器，间隔文案自己又冒出来了」。改默认值要三处一起改。 */
      this.upShowGaps = false;
      this.statSort = {};
      this.bannerSort = { key: 'startDate', dir: 'desc' };
      /* 高亮 / 置灰名单**按干员名**存，而名字分服（`scName` 三服各一套）——
         换服后旧名字在新服多半**根本不存在**（或指向另一位干员）→ 一律清空（2026-11-21 用户要求）。
         ⚠️ 只清名单，**不动** `statEditMode` / `statGrayedHidden` 两个开关：
            它们描述的是「怎么看」，与哪个服无关（已开的编辑模式切完服还能接着点）。
         ⚠️ 与 `upHideMid`（隐藏已属中坚的干员）不同 —— 那个是口径判断，切服保留。 */
      this.statHighlightOps = [];
      this.statHideOps = [];
      /* ⚠️ `crossFilters` / `crossSort` **刻意不在这里重置** ——
         跨服卡池对比页三服并列、与 `server` 无关（2026-11-04 用户定），切服不该动它的筛选。 */
    },

    setFirstUpRange(from, to) {
      this.firstUpRange = { from: from ?? this.firstUpRange.from, to: to ?? this.firstUpRange.to };
    },

    /**
     * 「近 N 年」：**从右栏当前的结束日期**往前推 N 年（2026-10-04 用户要求；以前固定以今天为上界）。
     * 这样「先把结束日期调到某个时点，再点近 N 年」得到的区间正好以那个时点收尾。
     * ⚠️ 结束日期被调得比数据下界还早时，算出来的起点会落到区间右侧 → 起点夹到数据下界。
     */
    applyFirstUpYears(n) {
      const years = Number(n);
      if (!Number.isFinite(years) || years <= 0) return false;
      const to = this.firstUpRange.to || this.today;
      const from = shiftYears(to, -Math.floor(years));
      const min = this.firstUp.bounds.min;
      this.firstUpRange = { from: !min || from < min ? min : from, to };
      return true;
    },

    /** 「全部」：回到默认范围 `[最早首次日, 今天]`（日期框里看得到范围，见 fullFirstUpRange） */
    resetFirstUpRange() {
      this.firstUpRange = { ...this.fullFirstUpRange };
    },

    /* ⚠️ 下面三个「口径」**不随切服务器重置**（setServer 里没有它们）——
       它们是看数据的角度，不是筛选条件；与 firstUpRange 那种筛选项的待遇不同。 */

    /* 卡池类型：与 firstUpMode / Axis / Metric 同待遇（切服不重置）——
       ⚠️ 但**不动** firstUpRange（用户 2026-10-31 明确：切换类型时日期范围保持不动）。
          代价是切到中坚时若起点是 2019 年，左边会空一段；这是用户要的行为，别擅自重置。 */
    setFirstUpPool(pool) {
      this.firstUpPool = pool === 'mid' ? 'mid' : 'std';
    },

    setFirstUpMode(mode) {
      this.firstUpMode = mode === 'rotation' ? 'rotation' : 'shop';
    },

    setFirstUpAxis(axis) {
      this.firstUpAxis = axis === 'release' ? 'release' : 'first';
    },

    setFirstUpMetric(metric) {
      this.firstUpMetric = metric === 'sinceRelease' ? 'sinceRelease' : 'gap';
    },

    /* ---------------- UP 历史一览 ---------------- */

    /**
     * UP 历史的横轴范围（不影响纵轴的干员集合）。
     * ⚠️ 开始日期会**强制顶到本服第一个卡池的开始日**：比它还早的时间轴上一条记录都没有，
     * 只会拖出一大段空白。夹在 store 里（而不是只挂在输入框上）是为了把**手输**与
     * **「近 N 年」快速填入**两条路径一起盖住 —— 输入框的 `min` 只管得住原生选择器。
     */
    setUpRange(from, to) {
      const min = this.bannerBounds.min;
      const f = (typeof from === 'string' && from && min && from < min) ? min : from;
      this.upRange = { from: f ?? this.upRange.from, to: to ?? this.upRange.to };
    },

    /** 「全部重置」：回到默认范围 `[本服最早卡池开始日, 今天]`（见 fullUpRange） */
    resetUpRange() {
      this.upRange = { ...this.fullUpRange };
    },

    /** 「近 N 年」：从右栏**当前的结束日期**往前推 N 年（开始日期同样受本服第一个卡池约束） */
    applyUpYears(n) {
      const years = Number(n);
      if (!Number.isFinite(years) || years <= 0) return false;
      const to = this.upRange.to || this.today;
      this.setUpRange(shiftYears(to, -Math.floor(years)), to);
      return true;
    },

    /**
     * 右栏「近 N 年」下面那排**快捷预设**（2026-10-04 用户要求，两处右栏各一对）：
     * - `'today'` = `[最早, 今天]` —— 结束日期改成「今天」之后的默认口径
     * - `'full'`  = `[最早, 数据里最晚]` —— 结束日期改成「今天」之前的旧口径（想看完整跨度时用）
     *
     * ⚠️ 两个都是**即时生效**的动作（与「全部」一样）：草稿由 `useRangeDraft` 的 watch 同步回来，
     * 所以点完不会描红。开始日期一律取数据下界，不接受参数。
     */
    setFirstUpRangePreset(kind) {
      const { min, max } = this.firstUp.bounds;
      this.setFirstUpRange(min || '', (kind === 'full' ? max : this.today) || '');
    },

    /** 同上，UP 历史的时间范围 */
    setUpRangePreset(kind) {
      const { min, max } = this.bannerBounds;
      this.setUpRange(min || '', (kind === 'full' ? max : this.today) || '');
    },

    setUpSort(id) {
      const ok = ['release-asc', 'release-desc', 'lastUp-asc', 'lastUp-desc'];
      if (ok.includes(id)) this.upSort = id;
    },

    /** 一次只显示一个星级（六星 / 五星） */
    setUpRarity(n) {
      this.upRarity = Number(n) === 5 ? 5 : 6;
    },

    setUpTypes(list) {
      this.upTypes = Array.isArray(list) ? [...list] : [];
    },

    /** 单个类型勾选 / 取消 */
    toggleUpType(type) {
      const set = new Set(this.upTypes);
      if (set.has(type)) set.delete(type);
      else set.add(type);
      this.upTypes = [...set];
    },

    /** 整组（某个大类下的全部类型）勾选 / 取消 */
    toggleUpCategory(types) {
      const set = new Set(this.upTypes);
      const allOn = types.every((t) => set.has(t));
      for (const t of types) {
        if (allOn) set.delete(t);
        else set.add(t);
      }
      this.upTypes = [...set];
    },

    /**
     * 只看进店：只保留 `isShop` 的记录。
     * ⚠️ 与卡池类型筛选**正交、可叠加**（2026-10-03 改）：以前是「勾选就禁用 + 清空类型筛选」，
     * 但进店记录本身就只落在常驻标准 / 常驻中坚这两类池子里，按类型再收窄才有用。
     * 这里只把**在本模式下不可能有记录的类型**从已选里剪掉（留着它们等于画空图）；
     * 那几类由右栏置灰，判据见 getter `noShopTypes`。
     */
    setUpShopOnly(on) {
      this.upShopOnly = !!on;
      if (this.upShopOnly) {
        const dead = new Set(this.noShopTypes);
        this.upTypes = this.upTypes.filter((t) => !dead.has(t));
      }
    },

    /** 纵轴是否**始终显示所有干员**（默认关 = 只显示范围内有 UP 的；2026-10-30 改名，
     *  原标签「显示范围内未 UP 干员」） */
    setUpAllOps(on) {
      this.upAllOps = !!on;
    },

    /** 横条是否**始终从首次 UP 画到最后一次 UP**（默认关 = 从实装日画起；2026-10-30 用户加） */
    setUpFullBar(on) {
      this.upFullBar = !!on;
    },

    /** 是否隐藏「在结束日期已属中坚寻访」的干员（默认不隐藏） */
    setUpHideMid(on) {
      this.upHideMid = !!on;
    },

    /** 是否在两次 UP 之间写日期差（默认**关**；写不写还取决于屏幕距离，见 upTimeline 的 gapMinPx） */
    setUpShowGaps(on) {
      this.upShowGaps = !!on;
    },

    /** 干员展示模式：简洁（名字）/ 图片（头像） */
    setAvatarMode(mode) {
      this.avatarMode = mode === 'image' ? 'image' : 'text';
    },

    setRefDate(date) {
      this.refDate = date || this.today;
    },

    resetRefDate() {
      this.refDate = this.today;
    },

    /* ⚠️ 与 `firstUpMode` / `firstUpAxis` 那批一样：这是**看数据的角度**、不是筛选条件，
       所以 `setServer` 里**不重置**（切服务器保持用户的勾选）。默认**关**（= 排除中坚甄选）。 */

    /** 中坚甄选是否计入**出率提升**（默认关） */
    setStatIncludeClafesUp(on) {
      this.statIncludeClafesUp = !!on;
    },

    /** 中坚寻访是否**只看中坚**（默认关）—— 口径见 `lib/stats.js` 的 `viewEndInfo()` */
    setStatMidOnly(on) {
      this.statMidOnly = !!on;
    },

    /**
     * 中坚寻访表是否**藏掉「总次数 / 标准次数」两列**（默认关，用户 2026-10-16 加）。
     *
     * 用途：干员迁入中坚后**不再进标准寻访**，标准寻访表里也见不到他们 ——
     * 「标准次数」只是他们**迁入之前**的老记录，占着两列反而让中坚表显得嘈杂。
     * 勾上后中坚寻访表每组只剩「结束时间 / 距今天数 / 中坚次数」三列（与标准表一样宽）。
     * **总次数一并藏掉**：总 = 中坚 + 标准，既然不看标准，总数也就没有参考价值。
     *
     * ⚠️ **纯展示层开关**：不动 `computeStats` 的数据、不改任何数值、不动排序，
     *    只影响中坚表（`split`）的表头与单元格渲染；标准寻访表那一列仍叫「次数」、不受影响。
     * ⚠️ 复制内容**跟着一起收**（复制必须与屏幕一致，见 `lib/tableCopy.js`）。
     * ⚠️ 与上面两个统计开关同处理：**切服不重置**。
     */
    setStatMidNoStd(on) {
      this.statMidNoStd = !!on;
      /* 与「合并中坚寻访三个次数」互斥 —— 两个开关都在改中坚表的列结构，
         同时开会打架（一个想只留中坚次数、一个想把三个并成一列）。后点的赢。 */
      if (this.statMidNoStd) this.statMidMergeCounts = false;
    },

    /**
     * 中坚寻访表是否把**三个次数并成一列**（默认关，用户 2026-11-22 加）。
     *
     * 勾上后中坚表每组由「总次数 / 中坚次数 / 标准次数」三列收成**一列「次数」**，
     * 单元格写成 `总/中坚/标准`（如 `8/1/9`），其中**中坚数字标蓝、标准数字标黄**
     * —— 既省两列宽度，又能一眼看出「这三次里几次是中坚的」。
     *
     * ⚠️ 排序**以中坚次数为准**（用户指定）：表头那个「次数」挂的是 `upMid` / `shopMid`
     *    这两个已有的排序 key，点它排的就是中坚次数。
     * ⚠️ 纯展示层：不动 `computeStats` 的数据、不动标准寻访表；复制内容跟着合并（输出 `8/1/9` 文本）。
     * ⚠️ 与「中坚寻访不看标准次数」**互斥**（后点的赢，见上）。
     * ⚠️ 与其它统计开关同处理：**切服不重置**、不持久化。
     */
    setStatMidMergeCounts(on) {
      this.statMidMergeCounts = !!on;
      if (this.statMidMergeCounts) this.statMidNoStd = false;
    },

    /**
     * 统计页「高亮干员」（默认空数组）—— 命中的行在四张表里加底色，方便盯某几位干员
     * （用户 2026-10-16 加）。
     *
     * ⚠️ 与上面两个统计开关同理：**切服不重置**（干员名都是国服名，三服通用；
     *    某位干员在该服不存在时，他本来就占不到行，高亮自然落空，无害）。
     * ⚠️ 它**纯粹是渲染层的高亮**：不筛行、不改次数、不参与 `computeStats` 的任何输入，
     *    也**不进复制内容**（复制的是数据，不是样式）。
     */
    setStatHighlightOps(list) {
      const arr = Array.isArray(list) ? [...list] : [];
      this.statHighlightOps = arr;
      this._excludeOps('statHideOps', arr);
    },

    /**
     * 统计页「置灰干员」—— 选中后那一行**盖一层灰罩**（2026-11-17 用户加）。
     *
     * 与「高亮干员」**互斥**：同一个干员不能既高亮又置灰（两边都染色的话谁也看不出来）。
     * 实现方式是「谁后选就归谁」—— 这里把已经选在另一边的同名条目摘掉，见 `_excludeOps`。
     * 与高亮一样：纯渲染层，不筛行、不改次数、不进复制内容、切服不重置。
     */
    setStatHideOps(list) {
      const arr = Array.isArray(list) ? [...list] : [];
      this.statHideOps = arr;
      this._excludeOps('statHighlightOps', arr);
    },

    /* ---------------- 统计页「一键置灰」（2026-11-21 用户加） ----------------
       右栏五个「批量置灰」按钮。**挑选规则全在 `lib/stats.js` 的 `bulk*` 纯函数里**
       （那边用假数据就能测，见 verify-data），这里只做三件事：
         ① 传当前参考日期 / 「只看中坚」开关进去（口径与表格同源）；
         ② 把结果**并进** `statHideOps` —— 追加，不覆盖用户手动置灰的那些；
         ③ 与「高亮干员」互斥（同 `setStatHideOps`，后选归谁）。
       ⚠️ 与手动置灰完全同一份状态：**切服不重置、不持久化、不筛行**。
       ⚠️ 返回值是**合并后的总数**（界面据此算「新增几位」并给提示）。 */

    /** 批量置灰的内部收口：合并 + 摘掉高亮里的同名；返回合并后的总数 */
    _addHideOps(names) {
      if (!names || !names.length) return this.statHideOps.length;
      const set = new Set(this.statHideOps);
      for (const n of names) set.add(n);
      this.statHideOps = [...set];
      this._excludeOps('statHighlightOps', this.statHideOps);
      return this.statHideOps.length;
    },

    /** ① 距今 ＜ `days` 天（`which` = `'up'` 出率提升 / `'shop'` 商店兑换） */
    hideRecentDays(which, days) {
      const refDate = this.refDate || this.today;
      return this._addHideOps(
        bulkRecentDays(this.statRows, refDate, this.statMidOnly, which, days),
      );
    },

    /** ② 进店等待最久的 `k` 名（商店兑换距今天数最大的几名） */
    hideShopWaitingTop(k) {
      const refDate = this.refDate || this.today;
      return this._addHideOps(
        bulkShopWaitingTop(this.statRows, refDate, this.statMidOnly, k),
      );
    },

    /** ③ 标准干员里实装时间 ＜ `before`（`YYYY-MM-DD`）的 */
    hideStdBefore(before) {
      const refDate = this.refDate || this.today;
      return this._addHideOps(bulkStdBefore(this.statRows, refDate, before));
    },

    /** ④ 出率提升次数**恰好 1 次**的，**每张表**按实装时间升序取**第 `from` ~ `to` 名**（闭区间） */
    hideUpOnceRange(from, to) {
      const refDate = this.refDate || this.today;
      return this._addHideOps(bulkCountRange(this.statRows, 'up', refDate, 1, from, to));
    },

    /** ⑤ 商店兑换次数**恰好 0 次**的（一次都没进过店），**每张表**按实装时间升序取第 `from` ~ `to` 名 */
    hideShopNoneRange(from, to) {
      const refDate = this.refDate || this.today;
      return this._addHideOps(bulkCountRange(this.statRows, 'shop', refDate, 0, from, to));
    },

    /**
     * 统计页「编辑模式」开关（开着时点行循环状态，见 `cycleStatOp`）。
     * ⚠️ 进编辑模式会**自动取消「隐藏被置灰的干员」**（用户 2026-11-21 明确要求）——
     *    行被藏掉了就点不到，也就没法把它从置灰改回普通。
     */
    setStatEditMode(on) {
      this.statEditMode = !!on;
      if (this.statEditMode) this.statGrayedHidden = false;
    },

    /** 统计页「隐藏被置灰的干员」—— 勾上后置灰的那批**整行不渲染**（与编辑模式互斥，见上） */
    setStatGrayedHidden(on) {
      this.statGrayedHidden = !!on;
      if (this.statGrayedHidden) this.statEditMode = false;
    },

    /**
     * 编辑模式下点一行：**普通 → 置灰 → 高亮 → 普通** 循环（2026-11-21 用户定）。
     *
     * 三个状态正好对应用户概念里的三档；而置灰 / 高亮在 store 里本来就是**互斥**的两个名单
     * （`setStatHideOps` / `setStatHighlightOps` 会互相摘除同名），所以这里顺序改名单即可，
     * 不用额外维护第三份状态。
     * ⚠️ 顺序是「先置灰后高亮」：置灰是「不想看」，通常比高亮常用。
     */
    cycleStatOp(name) {
      if (!name) return;
      if (this.statHideOps.includes(name)) {
        this.setStatHideOps(this.statHideOps.filter((n) => n !== name));
        this.setStatHighlightOps([...this.statHighlightOps, name]);
      } else if (this.statHighlightOps.includes(name)) {
        this.setStatHighlightOps(this.statHighlightOps.filter((n) => n !== name));
      } else {
        this.setStatHideOps([...this.statHideOps, name]);
      }
    },

    /** 从 `field` 那个名单里摘掉 `names` 里已有的项（两处互斥共用；没有交集时不产生新数组） */
    _excludeOps(field, names) {
      if (!names.length || !this[field].length) return;
      const set = new Set(names);
      const kept = this[field].filter((n) => !set.has(n));
      if (kept.length !== this[field].length) this[field] = kept;
    },

    /** 重置卡池筛选：日期范围回到本服完整跨度（不是空框，见 fullBannerRange） */
    resetFilters() {
      this.filters = { ...emptyFilters(), ...this.fullBannerRange };
    },

    /* ---------------- 卡池列表：寻访筛选（多选，与 UP 历史同一套按钮组） ---------------- */

    setBannerTypes(list) {
      this.filters = { ...this.filters, types: Array.isArray(list) ? [...list] : [] };
    },

    /** 单个寻访类型勾选 / 取消（空数组 = 全部类型） */
    toggleBannerType(type) {
      const set = new Set(this.filters.types);
      if (set.has(type)) set.delete(type);
      else set.add(type);
      this.setBannerTypes([...set]);
    },

    /** 整组（某个大类下的全部类型）勾选 / 取消 */
    toggleBannerCategory(types) {
      const set = new Set(this.filters.types);
      const allOn = types.every((t) => set.has(t));
      for (const t of types) {
        if (allOn) set.delete(t);
        else set.add(t);
      }
      this.setBannerTypes([...set]);
    },

    /**
     * UP 干员多选。存的是**精确干员名**（模糊 / 拼音匹配在右栏搜索框里完成，
     * 见 lib/opSearch.js），空数组 = 不按干员筛。
     */
    setBannerOps(list) {
      this.filters = { ...this.filters, ops: Array.isArray(list) ? [...list] : [] };
    },

    /** 单个干员勾选 / 取消（右栏点候选加入、点 chip 移除，走的是同一个动作） */
    toggleBannerOp(name) {
      const set = new Set(this.filters.ops);
      if (set.has(name)) set.delete(name);
      else set.add(name);
      this.setBannerOps([...set]);
    },

    toggleBannerSort(key) {
      this.bannerSort = nextBannerSort(this.bannerSort, key);
    },

    /* ---------------- 跨服卡池对比：筛选与排序 ----------------
       与卡池列表那套一一对应，只是状态**分开存**（`crossFilters` / `crossSort`）——
       两页的筛选互不影响，且切服务器时不该被重置（见 setServer 的注释）。 */

    setCrossTypes(list) {
      this.crossFilters = { ...this.crossFilters, types: Array.isArray(list) ? [...list] : [] };
    },

    /** 单个寻访类型勾选 / 取消（空数组 = 全部类型） */
    toggleCrossType(type) {
      const set = new Set(this.crossFilters.types);
      if (set.has(type)) set.delete(type);
      else set.add(type);
      this.setCrossTypes([...set]);
    },

    /** 整组（某个大类下的全部可见类型）勾选 / 取消 —— 入参是按钮组传下来的可见子集 */
    toggleCrossCategory(types) {
      const set = new Set(this.crossFilters.types);
      const allOn = types.every((t) => set.has(t));
      for (const t of types) {
        if (allOn) set.delete(t);
        else set.add(t);
      }
      this.setCrossTypes([...set]);
    },

    setCrossOps(list) {
      this.crossFilters = { ...this.crossFilters, ops: Array.isArray(list) ? [...list] : [] };
    },

    /** 跨服表格：是否**额外显示仅国服存在**的卡池（2026-11-16 用户加，默认关） */
    setCrossShowScOnly(v) {
      this.crossFilters = { ...this.crossFilters, showScOnly: !!v };
    },

    toggleCrossOp(name) {
      const set = new Set(this.crossFilters.ops);
      if (set.has(name)) set.delete(name);
      else set.add(name);
      this.setCrossOps([...set]);
    },

    toggleCrossSort(key) {
      this.crossSort = nextCrossSort(this.crossSort, key);
    },

    /** 重置：日期范围回到上下界（不是空框，理由同 resetFilters） */
    resetCrossFilters() {
      this.crossFilters = { ...emptyCrossFilters(), ...this.crossFullRange };
    },

    toggleStatSort(tableId, key) {
      this.statSort = { ...this.statSort, [tableId]: nextStatSort(this.statSort[tableId], key) };
    },

    /** 某张统计表当前的排序状态 */
    statSortOf(tableId) {
      return this.statSort[tableId];
    },
  },
});

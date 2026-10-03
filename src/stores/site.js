/**
 * 站点数据与界面状态（Pinia）。
 *
 * 分两类状态：
 *  1. 数据：meta / operators / bannersByServer（启动时加载一次）；
 *     categories（type → 大类）是常量，见 constants.js 的 BANNER_CATEGORIES
 *  2. 界面：server、refDate、filters、各表排序
 *
 * 关键语义（勿混用）：
 *  - `today`       = 页面打开时的真实当天，**参考日期的初始值**，也是「进行中」的判定基准
 *  - `updateDates` = 三个服务器各自的**数据更新日**（纯展示，不参与计算）：
 *                    国服 = metadata.generatedAt、国际服 = enGeneratedAt、繁中服 = tcGeneratedAt
 */
import { defineStore } from 'pinia';
import { BANNER_CATEGORIES } from '../lib/constants.js';
import { loadSiteData, toBannerList } from '../lib/loadData.js';
import { SERVER_FIELD, SERVER_CLASSIC_FIELD } from '../lib/constants.js';
import { localToday, shiftYears } from '../lib/date.js';
import { computeStats, endInfo, sortStatRows } from '../lib/stats.js';
import { computeFirstUp } from '../lib/firstUp.js';
import { computeUpHistory } from '../lib/upHistory.js';
import { bannerRows, emptyFilters, nextBannerSort, nextStatSort } from '../lib/banners.js';

export const useSiteStore = defineStore('site', {
  state: () => ({
    // ---- 数据 ----
    ready: false,
    loading: false,
    error: '',
    meta: { servers: [], defaultServer: 'sc', generatedAt: '' },
    operators: {},
    /* type → 大类：来自 constants.js（不再由 JSON 数据文件提供） */
    categories: BANNER_CATEGORIES,
    bannersByServer: {},

    // ---- 界面 ----
    server: 'sc',
    refDate: '',                       // 参考日期，仅作用于统计页
    today: localToday(),               // 页面打开时的真实当天
    filters: emptyFilters(),
    firstUpRange: { from: '', to: '' }, // 首次UP间隔页：按首次日期筛（空 = 不限）
    firstUpMode: 'shop',               // 统计模式：shop 首次进店 | rotation 首次轮换
    firstUpAxis: 'first',              // 横轴口径：first 按首次日期 | release 按实装日期
    firstUpMetric: 'gap',              // 纵轴口径：gap 距上个首次日期 | sinceRelease 距实装日期
    upRange: { from: '', to: '' },     // UP 历史：控制图表横轴范围，**同时**决定哪些干员占行
                                       //（范围内没有任何标记的干员不显示，见 computeUpHistory）
    upShowAll: false,                  // UP 历史：勾上则忽略上面那条，范围内没 UP 的干员也占行
    upSort: 'release-asc',             // UP 历史：纵轴排序
    upRarity: 6,                       // UP 历史：一次只显示一个星级（默认六星）
    upTypes: [],                       // UP 历史：选中的卡池类型（空 = 全部）
    upShopOnly: false,                 // UP 历史：只看进店（与 upTypes 互斥）
    upHideMid: false,                  // UP 历史：隐藏「在结束日期已属中坚寻访」的干员
    upShowGaps: false,                 // UP 历史：两次 UP 之间写日期差（**默认关**）
    avatarMode: 'text',                // 干员展示：text 简洁（名字）| image 图片（头像）
    bannerSort: { key: 'startDate', dir: 'desc' },
    statSort: {},                      // { '6-std': {key,dir}, ... } 每张统计表各自记排序
  }),

  getters: {
    /** 全部服务器（含不可用，左栏下拉只渲染 available 的） */
    servers: (s) => s.meta.servers ?? [],
    availableServers: (s) => (s.meta.servers ?? []).filter((x) => x.available),
    serverMeta: (s) => (s.meta.servers ?? []).find((x) => x.id === s.server) ?? {},

    /** 三个服务器各自的「数据更新日」（左栏展示用；缺值显示 —） */
    updateDates: (s) => ({
      sc: s.meta.generatedAt || '—',
      en: s.meta.enGeneratedAt || '—',
      tc: s.meta.tcGeneratedAt || '—',
    }),
    operatorCount: (s) => s.meta.operatorCount ?? Object.keys(s.operators).length,

    /** 当前服务器的卡池（数组，带 id） */
    banners(s) {
      return toBannerList(s.bannersByServer[s.server]);
    },

    /** 干员名 → { rarity, isLimited }，统计计算用 */
    operatorIndex(s) {
      const idx = {};
      for (const name of Object.keys(s.operators)) {
        const o = s.operators[name];
        idx[name] = { rarity: o.rarity, isLimited: o.isLimited };
      }
      return idx;
    },

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

    /** 当前服务器卡池的开始 / 结束日边界（右栏日期输入的 min / max 用） */
    bannerBounds() {
      let min = null;
      let max = null;
      for (const b of this.banners) {
        if (!min || b.startDate < min) min = b.startDate;
        if (!max || b.endDate > max) max = b.endDate;
      }
      return { min, max };
    },

    /** 卡池列表：筛选 + 排序后的行（与参考日期无关） */
    bannerRows(s) {
      return bannerRows(s.banners, s.filters, s.categories, s.bannerSort);
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
      });
    },

    /** 统计行数组（含 everMid / releaseDate） */
    statRows(s) {
      return Object.values(this.statData.map);
    },

    /** 首次UP间隔页：全部干员按选定口径排序后的序列（含六星 / 五星分组） */
    firstUp(s) {
      return computeFirstUp({
        banners: this.banners,
        operatorByName: s.operators,
        relDateOf: this.relDateOf,
        mode: s.firstUpMode,
        from: s.firstUpRange.from,
        to: s.firstUpRange.to,
        axis: s.firstUpAxis,
        metric: s.firstUpMetric,
      });
    },

    /** UP 历史一览：每位干员一条横条（实装日 → 最后一次 UP），条上按卡池开始日打标记 */
    upHistory(s) {
      return computeUpHistory({
        banners: this.banners,
        categories: s.categories,
        operatorByName: s.operators,
        relDateOf: this.relDateOf,
        classicDateOf: this.classicDateOf,
        /* 「在结束日期已属中坚」的判据时点 = 右栏结束日期，没设就按真实今天 */
        today: s.today,
        hideMid: s.upHideMid,
        types: s.upTypes,
        shopOnly: s.upShopOnly,
        /* 时间范围既决定横轴可视范围，也决定哪些干员占行（范围内没标记的不占行）；
           勾了「显示范围内未 UP 干员」就传 null，等于不做这层过滤 */
        range: s.upShowAll ? null : s.upRange,
        sort: s.upSort,
      });
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
      const pick = (rarity, everMid) =>
        sortStatRows(
          this.statRows.filter((r) => r.rarity === rarity && r.everMid === everMid),
          s.statSort[`${rarity}-${everMid ? 'mid' : 'std'}`],
          refDate,
        );
      return {
        '6-std': pick(6, false),
        '6-mid': pick(6, true),
        '5-std': pick(5, false),
        '5-mid': pick(5, true),
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
        this.categories = data.categories;
        this.bannersByServer = data.bannersByServer;
        this.server = data.meta.defaultServer;
        /* 参考日期初始值 = 打开页面的真实当天（2026-10-01 口径调整；以前取数据快照日） */
        this.refDate = this.today;
        this.ready = true;
      } catch (err) {
        this.error = err?.message || String(err);
      } finally {
        this.loading = false;
      }
    },

    /** 切换服务器：重置参考日期与全部筛选条件（见 docs/工作指令.md 5.5） */
    setServer(id) {
      if (!id || !this.bannersByServer[id]) return;
      this.server = id;
      this.refDate = this.today;
      this.filters = emptyFilters();
      this.firstUpRange = { from: '', to: '' };
      this.upRange = { from: '', to: '' };
      this.upRarity = 6;
      this.upTypes = [];
      this.upShopOnly = false;
      this.upShowAll = false;
      this.upHideMid = false;
      /* ⚠️ 与 state 的初值、FilterDrawer 的 resetUp 三处**必须一致**：
         2026-10-02 这三处曾走散（初值 false / 这里 true / 右栏重置 false），
         表现是「切一下服务器，间隔文案自己又冒出来了」。改默认值要三处一起改。 */
      this.upShowGaps = false;
      this.statSort = {};
      this.bannerSort = { key: 'startDate', dir: 'desc' };
    },

    setFirstUpRange(from, to) {
      this.firstUpRange = { from: from ?? this.firstUpRange.from, to: to ?? this.firstUpRange.to };
    },

    /** 「近 N 年」：以真实今天为上界，往前推 N 年（n 必须为正整数） */
    applyFirstUpYears(n) {
      const years = Number(n);
      if (!Number.isFinite(years) || years <= 0) return false;
      const to = this.today;
      this.firstUpRange = { from: shiftYears(to, -Math.floor(years)), to };
      return true;
    },

    resetFirstUpRange() {
      this.firstUpRange = { from: '', to: '' };
    },

    /* ⚠️ 下面三个「口径」**不随切服务器重置**（setServer 里没有它们）——
       它们是看数据的角度，不是筛选条件；与 firstUpRange 那种筛选项的待遇不同。 */

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

    resetUpRange() {
      this.upRange = { from: '', to: '' };
    },

    /** 「近 N 年」：以真实今天为上界往前推 N 年（开始日期同样受本服第一个卡池约束） */
    applyUpYears(n) {
      const years = Number(n);
      if (!Number.isFinite(years) || years <= 0) return false;
      this.setUpRange(shiftYears(this.today, -Math.floor(years)), this.today);
      return true;
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
     * 只看进店：勾选时**禁用并清空**卡池类型筛选（两者互斥，见右栏）。
     * 取消勾选后卡池类型筛选恢复可用（但选择已被清空）。
     */
    setUpShopOnly(on) {
      this.upShopOnly = !!on;
      if (this.upShopOnly) this.upTypes = [];
    },

    /** 是否显示「时间范围内没有 UP 过」的干员（默认不显示） */
    setUpShowAll(on) {
      this.upShowAll = !!on;
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

    resetFilters() {
      this.filters = emptyFilters();
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

    toggleBannerSort(key) {
      this.bannerSort = nextBannerSort(this.bannerSort, key);
    },

    toggleStatSort(tableId, key) {
      this.statSort = { ...this.statSort, [tableId]: nextStatSort(this.statSort[tableId], key) };
    },

    /** 某张统计表当前的排序状态 */
    statSortOf(tableId) {
      return this.statSort[tableId];
    },

    /** 单行的「最后一次」信息（视图层用） */
    endInfo(arr) {
      return endInfo(arr, this.refDate || this.today);
    },
  },
});

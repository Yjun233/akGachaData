/**
 * 站点数据与界面状态（Pinia）。
 *
 * 分两类状态：
 *  1. 数据：meta / operators / bannersByServer（启动时加载一次）；
 *     categories（type → 大类）是常量，见 constants.js 的 BANNER_CATEGORIES
 *  2. 界面：server、refDate、filters、各表排序
 *
 * 关键语义（勿混用）：
 *  - `snapshotDate`  = metadata.generatedAt，数据快照日，**参考日期的初始值**
 *  - `today`         = 页面打开时的真实当天，**卡池列表「进行中」的判定基准**
 */
import { defineStore } from 'pinia';
import { BANNER_CATEGORIES } from '../lib/constants.js';
import { loadSiteData, toBannerList } from '../lib/loadData.js';
import { SERVER_FIELD } from '../lib/constants.js';
import { localToday, shiftYears } from '../lib/date.js';
import { computeStats, endInfo, sortStatRows } from '../lib/stats.js';
import { computeFirstShop } from '../lib/firstShop.js';
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
    shopRange: { from: '', to: '' },   // 首次进店间隔页：按首次进店日期筛（空 = 不限）
    shopAxis: 'firstShop',             // 横轴口径：firstShop 按首次进店日期 | release 按实装日期
    shopMetric: 'gap',                 // 纵轴口径：gap 距上个首次进店 | sinceRelease 距实装日期
    upRange: { from: '', to: '' },     // UP 历史：控制图表横轴范围，**同时**决定哪些干员占行
                                       //（范围内没有任何标记的干员不显示，见 computeUpHistory）
    upShowAll: false,                  // UP 历史：勾上则忽略上面那条，范围内没 UP 的干员也占行
    upSort: 'release-asc',             // UP 历史：纵轴排序
    upRarity: 6,                       // UP 历史：一次只显示一个星级（默认六星）
    upTypes: [],                       // UP 历史：选中的卡池类型（空 = 全部）
    upShopOnly: false,                 // UP 历史：只看进店（与 upTypes 互斥）
    avatarMode: 'text',                // 干员展示：text 简洁（名字）| image 图片（头像）
    bannerSort: { key: 'startDate', dir: 'desc' },
    statSort: {},                      // { '6-std': {key,dir}, ... } 每张统计表各自记排序
  }),

  getters: {
    /** 全部服务器（含不可用，左栏下拉只渲染 available 的） */
    servers: (s) => s.meta.servers ?? [],
    availableServers: (s) => (s.meta.servers ?? []).filter((x) => x.available),
    serverMeta: (s) => (s.meta.servers ?? []).find((x) => x.id === s.server) ?? {},

    /** 数据快照日 —— 参考日期的初始值 */
    snapshotDate: (s) => s.meta.generatedAt || '',
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

    /** 当前服务器最早的卡池开始日（「全部」快捷按钮用） */
    earliestDate() {
      let m = null;
      for (const b of this.banners) if (!m || b.startDate < m) m = b.startDate;
      return m;
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
        refDate: s.refDate || this.snapshotDate,
        relDateOf: this.relDateOf,
      });
    },

    /** 统计行数组（含 everMid / releaseDate） */
    statRows(s) {
      return Object.values(this.statData.map);
    },

    /** 首次进店间隔页：全部干员按选定口径排序后的序列（含六星 / 五星分组） */
    firstShop(s) {
      return computeFirstShop({
        banners: this.banners,
        operatorByName: s.operators,
        relDateOf: this.relDateOf,
        from: s.shopRange.from,
        to: s.shopRange.to,
        axis: s.shopAxis,
        metric: s.shopMetric,
      });
    },

    /** UP 历史一览：每位干员一条横条（实装日 → 最后一次 UP），条上按卡池开始日打标记 */
    upHistory(s) {
      return computeUpHistory({
        banners: this.banners,
        categories: s.categories,
        operatorByName: s.operators,
        relDateOf: this.relDateOf,
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
      const refDate = s.refDate || this.snapshotDate;
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
        this.refDate = data.meta.generatedAt || '';
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
      this.refDate = this.snapshotDate;
      this.filters = emptyFilters();
      this.shopRange = { from: '', to: '' };
      this.upRange = { from: '', to: '' };
      this.upRarity = 6;
      this.upTypes = [];
      this.upShopOnly = false;
      this.upShowAll = false;
      this.statSort = {};
      this.bannerSort = { key: 'startDate', dir: 'desc' };
    },

    setShopRange(from, to) {
      this.shopRange = { from: from ?? this.shopRange.from, to: to ?? this.shopRange.to };
    },

    /** 「近 N 年」：以真实今天为上界，往前推 N 年（n 必须为正整数） */
    applyShopYears(n) {
      const years = Number(n);
      if (!Number.isFinite(years) || years <= 0) return false;
      const to = this.today;
      this.shopRange = { from: shiftYears(to, -Math.floor(years)), to };
      return true;
    },

    resetShopRange() {
      this.shopRange = { from: '', to: '' };
    },

    setShopAxis(axis) {
      this.shopAxis = axis === 'release' ? 'release' : 'firstShop';
    },

    setShopMetric(metric) {
      this.shopMetric = metric === 'sinceRelease' ? 'sinceRelease' : 'gap';
    },

    /* ---------------- UP 历史一览 ---------------- */

    /** 横轴范围（不影响纵轴的干员集合） */
    setUpRange(from, to) {
      this.upRange = { from: from ?? this.upRange.from, to: to ?? this.upRange.to };
    },

    resetUpRange() {
      this.upRange = { from: '', to: '' };
    },

    /** 「近 N 年」：以真实今天为上界往前推 N 年 */
    applyUpYears(n) {
      const years = Number(n);
      if (!Number.isFinite(years) || years <= 0) return false;
      const to = this.today;
      this.upRange = { from: shiftYears(to, -Math.floor(years)), to };
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

    /** 干员展示模式：简洁（名字）/ 图片（头像） */
    setAvatarMode(mode) {
      this.avatarMode = mode === 'image' ? 'image' : 'text';
    },

    setRefDate(date) {
      this.refDate = date || this.today;
    },

    resetRefDate() {
      this.refDate = this.snapshotDate;
    },

    resetFilters() {
      this.filters = emptyFilters();
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
      return endInfo(arr, this.refDate || this.snapshotDate);
    },
  },
});

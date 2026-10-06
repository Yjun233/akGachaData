/**
 * lib/customBanners.js
 * ----------
 * **自定义卡池**（浏览器本地自设）—— 数据层。
 *
 * 口径的权威说明在 `akGachaDocs/site/自定义卡池功能预研.md`（用户 2026-10-05 拍板）。
 * 本文件只负责实现四件事：
 *   1. **本地存储的读写与容错** —— 全站唯一一处持久化（此前 0 处）；
 *   2. **写入前校验**：类型白名单 / 日期 / **进店数量硬校验** + 六星五星数量**只提醒**；
 *   3. **名字生成**（空名才生成）与 `自定义_` 前缀、id 合成；
 *   4. **与已有卡池去重**（同一场就不重复显示）。
 *
 * 关键设计：
 * - 存的是**用户填的原始字段**（不是解析后的 banner）—— 便于以后改解析规则、或再次编辑。
 * - 三服的自设混在**一个数组**里，每条自带 `server`；切服只是切视图，不换 key。
 * - 解析失败 / 版本不符 **一律当空数组，绝不抛异常**（本地存储里可能是任何脏数据）；
 *   `localStorage` 不存在（SSR / 隐私模式）时同样静默返回空 —— `verify-render` 走 SSR，必须容错。
 */
import { TYPE_LABEL } from './constants.js';
import { diffDays, shiftDays } from './date.js';

/** 本地存储 key（**独占一个**，别与将来其它持久化混用） */
export const STORAGE_KEY = 'akgacha:custom-banners';
/** 存储结构版本（不符就当空，见文件头） */
export const STORE_VERSION = 1;

/**
 * 允许的类型（用户 2026-10-05 收窄到 6 个）。
 * 即「标准寻访大类掐掉 `mainfes`（前路回响）与 `five`（双五寻访），中坚两大类全收，限定全不收」。
 */
export const CUSTOM_TYPES = ['double', 'joint', 'stdfes', 'single', 'classic', 'clafes'];

/** 名字前缀 —— 站点上一眼能看出「这是自设数据」 */
export const NAME_PREFIX = '自定义_';

/** 去重的「时间相近」阈值：**开始日**相差 ≤ 15 天（用户 2026-10-04 定，只比开始日） */
export const NEAR_DAYS = 15;

/**
 * 自设卡池的时长（天）—— 用户 2026-10-06 定：**表单不给结束日期**，一律「开始日 + 14 天」。
 * 于是 `endDate` 不再是用户输入，而是**派生值**（见 `endDateOf`）。
 */
export const DURATION_DAYS = 14;

/** 由开始日算结束日 —— 自设卡池的**唯一**结束口径 */
export const endDateOf = (startDate) =>
  (/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') ? shiftDays(startDate, DURATION_DAYS) : '');

/**
 * 弹窗里干员名前面那个「**标 / 中**」一字标记 —— 该干员在此刻属**标准**还是**中坚**寻访。
 *
 * @param {string|null} classicDate 该服「进入中坚寻访」的日期（`operators.json` 的
 *        `classicDate` / `enClassicDate` / `tcClassicDate`；`null` = 尚未进入）
 * @param {string} today           **当前现实时间**（`localToday()`）
 * @returns {'标'|'中'}
 *
 * 口径与右栏「隐藏已属中坚的干员」**一致**（那边用可改的参考日期当判据时点，
 * 这里按用户 2026-10-06 的要求用**现实时间**）；相等当天即算「中」（闭区间）。
 * ⚠️ **只作提醒，不校验跟所选卡池类型是否相符**（用户明确不要强制）。
 */
export const midTag = (classicDate, today) =>
  (classicDate && classicDate <= today ? '中' : '标');

/**
 * **进店数量的硬校验**（用户 2026-10-05 定）。
 * 依据：三服全部 1190 个卡池无一例外 —— `double` / `classic` 恒为 1×6★ + 1×5★，其余 4 类恒为 0。
 */
const SHOP_COUNT = { double: 2, classic: 2, joint: 0, stdfes: 0, single: 0, clafes: 0 };

/** 常见构成 `[六星数, 五星数]` —— **只用于「提醒」，不做硬校验**（见 validate 的说明） */
const COMPOSE_HINT = {
  double: [2, 3], joint: [4, 6], stdfes: [6, 6], single: [1, 2], classic: [2, 3], clafes: [12, 24],
};

/* ---------------------------------------------------------------- 基础工具 */

/**
 * 干员名列表 → 数组。
 * ⚠️ **两种都吃**：新数据是**数组**（弹窗里用多选框），老数据是**顿号分隔的文本**
 *    （2026-10-06 之前的存法）—— 老数据不能因为改了 UI 就废掉。
 */
export const splitList = (v) => {
  const arr = Array.isArray(v)
    ? v
    : String(v ?? '').split(/[、,，;；\s]+/);
  return arr.map((s) => String(s).trim()).filter(Boolean);
};

/**
 * 剥掉已有的 `自定义_` 前缀（**循环剥**，脏数据里叠了两层也清得掉）。
 * 用途：编辑一条老条目时，名字里已经带了前缀，不剥就会叠成 `自定义_自定义_x`。
 */
export const stripPrefix = (name) => String(name ?? '').replace(/^(?:自定义_)+/, '').trim();

const pad4 = (n) => String(n).padStart(4, '0');

/** 本地存储可用吗（SSR / 隐私模式下不可用） */
function storageAvailable() {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- 读写 */

/** 读全部自设（三服混在一起）。任何异常都返回空数组 */
export function loadEntries() {
  if (!storageAvailable()) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!raw || raw.version !== STORE_VERSION || !Array.isArray(raw.banners)) return [];
    return raw.banners.filter((e) => e && typeof e === 'object' && e.type && e.startDate);
  } catch {
    return [];
  }
}

/** 写回全部自设；返回是否成功（配额满 / 无本地存储 → false） */
export function saveEntries(list) {
  if (!storageAvailable()) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORE_VERSION, banners: list }));
    return true;
  } catch {
    return false;
  }
}

/** 下一个可用的 uid（= 现有最大值 + 1；用于合成 id，删除后不复用） */
export const nextUid = (list) =>
  list.reduce((m, e) => Math.max(m, Number(e.uid) || 0), 0) + 1;

/* ---------------------------------------------------------------- 名字与 id */

/**
 * 生成展示名（**总是**带 `自定义_` 前缀）。
 * - 用户填了名字 → 用填的（先剥前缀，避免叠加）
 * - 空的 → 自动生成：**单六寻访** `<第一个六星名>池`；**其他类型** `<类型展示名><MMdd>`（MMdd = **开始日**）
 */
export function buildName(entry) {
  const typed = stripPrefix(entry.name);
  if (typed) return NAME_PREFIX + typed;
  const six = splitList(entry.star6);
  const auto = entry.type === 'single' && six.length
    ? `${six[0]}池`
    : `${TYPE_LABEL[entry.type] || entry.type}${String(entry.startDate || '').slice(5, 10).replace('-', '')}`;
  return NAME_PREFIX + auto;
}

/** 合成 id：`YYYYMMDD_<type>_custom_<uid>` —— 与 wiki 的 id（数字后缀）不会撞 */
export const makeCustomId = (entry) =>
  `${String(entry.startDate).replace(/-/g, '')}_${entry.type}_custom_${pad4(entry.uid || 0)}`;

/**
 * 原始输入 → banner（与 `banners_<server>.json` 的条目同构，另加 `custom: true` 作来源标记）。
 * `upOperators` 的**顺序照用户的顿号顺序**（六星在前、五星在后，进店的打 `isShop`）。
 */
export function entryToBanner(entry) {
  const shop = new Set(splitList(entry.shop));
  const mk = (rarity, text) => splitList(text).map((name) => ({
    name, rarity, isLimited: false, isShop: shop.has(name),
  }));
  const name = buildName(entry);
  return {
    id: makeCustomId(entry),
    name,
    scName: name,
    enName: null,
    type: entry.type,
    startDate: entry.startDate,
    /* ⚠️ 结束日**不是**用户填的，由开始日派生（用户 2026-10-06 定） */
    endDate: endDateOf(entry.startDate),
    upOperators: [...mk(6, entry.star6), ...mk(5, entry.star5)],
    custom: true,
  };
}

/* ---------------------------------------------------------------- 校验 */

/**
 * 写入前校验。
 *
 * **硬校验（error，拒存）**：类型白名单 / 开始日期格式 / 进店数量（见 `SHOP_COUNT`）。
 *    ⚠️ 没有「结束 > 开始」这条了 —— 结束日由开始日派生（`endDateOf`），不存在填错的可能。
 * **只提醒（warning，照存）**：
 * - 六星 / 五星数量与常见构成不一致 —— 因为**复刻单六寻访的五星可能与首发不一致、也可能先留空**，
 *   硬校验会误杀真实数据（用户 2026-10-05 原话）。
 * - 干员名不在 `operators.json` 里 —— 用户可能提前知道解包信息，允许强存。
 *
 * @param {object} entry 原始输入
 * @param {(name:string)=>({rarity:number}|undefined)} [lookup] 干员名 → 干员（用于「查不到」提醒）
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function validate(entry, lookup = () => undefined) {
  const errors = [];
  const warnings = [];

  if (!CUSTOM_TYPES.includes(entry.type)) {
    errors.push('寻访类型不在允许范围内（只能选白名单里的 6 类）');
  }

  const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  if (!isDate(entry.startDate)) errors.push('开始时间格式不对（应为 YYYY-MM-DD）');
  /* ⚠️ **不校验结束日期**：自设卡池不设结束日，一律 `开始日 + DURATION_DAYS`
     （用户 2026-10-06 定）→「结束 > 开始」恒成立，没什么可校验的。 */

  const six = splitList(entry.star6);
  const five = splitList(entry.star5);
  const shop = splitList(entry.shop);

  /* ---- 进店数量：硬校验 ---- */
  const wantShop = SHOP_COUNT[entry.type];
  if (wantShop !== undefined && shop.length !== wantShop) {
    errors.push(wantShop === 0
      ? `${TYPE_LABEL[entry.type] || entry.type}不该填进店干员（实测三服该类卡池的进店数恒为 0）`
      : `${TYPE_LABEL[entry.type] || entry.type}的进店必须是 1 个六星 + 1 个五星，当前填了 ${shop.length} 个`);
  }
  if (wantShop === 2 && shop.length === 2) {
    /* 能判星级就判（进店名出现在六星/五星列表里），判不了只提示 —— 名字可能没填全 */
    const asSix = shop.filter((n) => six.includes(n)).length;
    const asFive = shop.filter((n) => five.includes(n)).length;
    if (asSix + asFive < 2) warnings.push('有进店干员不在上面的六星/五星列表里，请核对');
    else if (asSix !== 1 || asFive !== 1) errors.push('进店必须是 1 个六星 + 1 个五星');
  }

  /* ---- 六星 / 五星数量：只提醒 ---- */
  const hint = COMPOSE_HINT[entry.type];
  if (hint) {
    if (six.length !== hint[0]) {
      warnings.push(`常见构成是 ${hint[0]} 个六星，当前 ${six.length} 个`);
    }
    /* ⚠️ 单六寻访的五星**允许留空**（复刻池可能与首发不一致）→ 只在自己填了才比 */
    if (entry.type !== 'single' && five.length !== hint[1]) {
      warnings.push(`常见构成是 ${hint[1]} 个五星，当前 ${five.length} 个`);
    }
  }

  /* ---- 干员名：查不到只提醒 ---- */
  const unknown = [...six, ...five].filter((n) => !lookup(n));
  if (unknown.length) {
    warnings.push(`这些干员名不在干员表里（可能是新干员或写错了）：${unknown.join('、')}`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

/* ---------------------------------------------------------------- 去重 */

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * 与**已有卡池**去重（判据 = 用户 2026-10-04 定的两条，**同时成立**才算同一场）：
 *   1. **六星名字集合相等**（Set 相等、顺序无关；**名字不参与比对**）
 *   2. **开始日相差 ≤ `NEAR_DAYS` 天**
 *
 * ⚠️ `existing` 必须是**全量**（主表 + 中坚合并后的），否则自设的中坚池永远撞不上
 *   已公布的中坚池 —— 中坚 2026-10-06 起在单独文件里，见预研 §3.2。
 * ⚠️ 优先级 `wiki > 自定义`：撞上就**丢自定义**。
 *
 * @returns {{kept:Array<{entry:object,banner:object}>, dropped:Array<{entry:object,banner:object,hit:object,gap:number}>}}
 */
export function dedupe(entries, existing) {
  const kept = [];
  const dropped = [];
  for (const entry of entries) {
    const banner = entryToBanner(entry);
    const sixSet = new Set(splitList(entry.star6));
    const hit = (existing || []).find((b) => {
      const gap = diffDays(banner.startDate, b.startDate);
      if (Math.abs(gap) > NEAR_DAYS) return false;
      const bSix = new Set((b.upOperators || []).filter((o) => o.rarity === 6).map((o) => o.name));
      return sameSet(sixSet, bSix);
    });
    if (hit) {
      dropped.push({ entry, banner, hit, gap: Math.abs(diffDays(banner.startDate, hit.startDate)) });
    } else {
      kept.push({ entry, banner });
    }
  }
  return { kept, dropped };
}

/* ---------------------------------------------------------------- 导出 / 导入 */

/** 导出的 JSON 文本（**含 `version` 与 `exportedAt`**，导入时校验） */
export function serialize(list) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return `${JSON.stringify({ version: STORE_VERSION, exportedAt: today, banners: list }, null, 2)}\n`;
}

/**
 * 解析导入的文本。
 * ⚠️ **只做结构校验**（版本 / 是不是数组）；逐条的字段校验交给调用方走同一套 `validate` +
 *    `dedupe`（用户：「导入的条目要走同一套校验与去重」）。
 * @returns {{ok:boolean, entries:object[], error:string|null}}
 */
export function parseImport(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, entries: [], error: '不是合法的 JSON' };
  }
  const list = Array.isArray(raw) ? raw : raw?.banners;
  if (!Array.isArray(list)) return { ok: false, entries: [], error: '结构不对：找不到 banners 数组' };
  if (!Array.isArray(raw) && raw.version !== STORE_VERSION) {
    return { ok: false, entries: [], error: `版本不符（文件是 v${raw.version}，当前支持 v${STORE_VERSION}）` };
  }
  return { ok: true, entries: list.filter((e) => e && typeof e === 'object'), error: null };
}

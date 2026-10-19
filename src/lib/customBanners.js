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
 * ⭐⭐ **2026-10-19 存储结构升到 v3：每条自设 = 一个「与数据库同构」的卡池对象**
 *    （用户要求「把自定义卡池里每个卡池的 json 的字段改成和数据库里每个卡池的 json 差不多一致」）：
 *
 *      {
 *        "scName": "自定义_凯尔希池",          // 最终显示名（含前缀）
 *        "type": "single",
 *        "startDate": "2026-10-20",
 *        "endDate": "2026-11-03",
 *        "upOperators": [                       // 取代 v2 的 star6 / star5 / shop 三个平行数组
 *          { "scCharName": "凯尔希", "charId": "char_003_kalts",
 *            "rarity": 6, "isLimited": false, "isShop": false }
 *        ],
 *        "rerunKind": "首发",                   // 只有单六寻访才有这个键（与 DB 一致）
 *        "canRerun": true,                      // 同上；**自动推导**，不可手填
 *        "server": "sc",                        // 自设专有
 *        "uid": 3                               // 自设专有（去重 / 合成 id 用）
 *      }
 *
 *    与 `akGachaResource/data/banners_<server>.json` 的条目相比**只多 `server` / `uid`**、
 *    少一个 `enName`（自设没有英文名）。
 *    · `scName` 存的是**最终显示名**（带 `自定义_`）—— v2 及以前存的是用户输入的**原始名**；
 *    · `endDate` 表单不给输入框，恒为「开始日 + 14 天」；**但手工改 JSON 时以你写的为准**
 *      （只要求格式合法且晚于开始日）；
 *    · `rerunKind` ∈ 首发 / 返场 / 复刻；`canRerun` = `type === 'single' && rerunKind === '首发'`。
 *      ⚠️ 这是**简化口径**：DB 里 `canRerun` 还要求「之后确实没被复刻过」（60 个首发里
 *      只有 27 个 true）—— 自设卡池没有后续记录可言，所以按用户 2026-10-19 的规则直接推。
 *
 * ⚠️ v1 / v2 的老数据**自动迁移并写回**（`loadEntries`），导入老文件同样自动转换
 *    （`parseImport`）；入口统一是 `toEntry()`（幂等，三种形态都吃）。
 * - 三服的自设混在**一个数组**里，每条自带 `server`；切服只是切视图，不换 key。
 * - 解析失败 / 版本不符 **一律当空数组，绝不抛异常**（本地存储里可能是任何脏数据）；
 *   `localStorage` 不存在（SSR / 隐私模式）时同样静默返回空 —— `verify-render` 走 SSR，必须容错。
 */
import { TYPE_LABEL } from './constants.js';
import { diffDays, shiftDays } from './date.js';

/** 本地存储 key（**独占一个**，别与将来其它持久化混用） */
export const STORAGE_KEY = 'akgacha:custom-banners';

/**
 * 存储结构版本。
 *   v1 = 2026-10-12 之前（`name` + 名字数组 / 顿号文本）
 *   v2 = 2026-10-12 的字段规范化（`scName` + `[{ scCharName, charId }]`）
 *   v3 = **2026-10-19 与 DB 同构**（`upOperators` + `endDate` + `rerunKind` / `canRerun`）
 * 老版本都会自动迁移并写回（`loadEntries`），老导出文件也能直接导入（`parseImport`）。
 */
export const STORE_VERSION = 3;

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
 * ⚠️ 2026-10-19 起 `endDate` 会**写进存储**（与 DB 同构），手工改 JSON 时可覆盖这个派生值。
 */
export const DURATION_DAYS = 14;

/**
 * 「卡池开启类型」的取值（= DB 的 `rerunKind`）—— 用户 2026-10-19 加。
 * ⚠️ **只有单六寻访（`single`）才有这个概念**（DB 里 85 个带它的池全是单六），
 *    其余类型不写这两个键。
 */
export const RERUN_KINDS = ['首发', '返场', '复刻'];

/** 由开始日算结束日 —— 表单路径的**唯一**结束口径（手工 JSON 里写了就听你的） */
export const endDateOf = (startDate) =>
  (/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') ? shiftDays(startDate, DURATION_DAYS) : '');

/**
 * `canRerun` 的推导规则（用户 2026-10-19 定）：**单六寻访 + 首发** 才是 true。
 * ⚠️ 见文件头：这是比 DB 更宽的简化口径（DB 还要求「之后没被复刻过」）。
 */
export const computeCanRerun = (type, rerunKind) =>
  type === 'single' && rerunKind === RERUN_KINDS[0];

/**
 * 弹窗里干员名前面那个「**标 / 中**」一字标记 —— 该干员在此刻属**标准**还是**中坚**寻访。
 *
 * @param {string|null} classicDate 该服「进入中坚寻访」的日期（`operators.json` 的
 *        `scClassicDate` / `enClassicDate` / `tcClassicDate`；`null` = 尚未进入）
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

const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

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
 * 干员列表归一化 → `[{ scCharName, charId }]`（**表单层**用，v3 的 `upOperators` 由它加工而来）。
 * **三种形态都吃**：
 *   · v2 对象数组 `[{ scCharName, charId }]`
 *   · v1 名字数组 `['克莱门莎']`
 *   · v0 顿号分隔文本 `'克莱门莎、德·托莱多'`
 * 名字为空的条目丢掉；`charId` 缺失时用 `charIdOf(name)` 补，仍查不到就是 `null`
 * （用户 2026-10-12 定：允许强存「不在干员表里」的新干员，charId 写 null、不阻止保存）。
 */
export function toOpList(v, charIdOf = () => null) {
  const arr = Array.isArray(v) ? v : String(v ?? '').split(/[、,，;；\s]+/);
  const out = [];
  for (const raw of arr) {
    const o = raw && typeof raw === 'object'
      ? { scCharName: String(raw.scCharName ?? raw.name ?? '').trim(), charId: raw.charId ?? null }
      : { scCharName: String(raw ?? '').trim(), charId: null };
    if (!o.scCharName) continue;
    out.push({ scCharName: o.scCharName, charId: o.charId ?? charIdOf(o.scCharName) ?? null });
  }
  return out;
}

/** 归一化后的干员列表 → **名字数组**（比较 / 去重 / 校验都用它） */
export const opNames = (list) => toOpList(list).map((o) => o.scCharName);

/**
 * `upOperators` 归一化：补齐 `charId` / `rarity` / `isLimited` / `isShop` 四个键，
 * 键序与 DB 一致。`rarity` 只认 6，其余一律按 5（自设只允许五六星）。
 */
const normalizeUpOperators = (list, charIdOf = () => null) => {
  const out = [];
  for (const raw of (list || [])) {
    const o = raw && typeof raw === 'object' ? raw : { scCharName: raw };
    const name = String(o.scCharName ?? o.name ?? '').trim();
    if (!name) continue;
    out.push({
      scCharName: name,
      charId: o.charId ?? charIdOf(name) ?? null,
      rarity: Number(o.rarity) === 6 ? 6 : 5,
      isLimited: !!o.isLimited,
      isShop: !!o.isShop,
    });
  }
  return out;
};

/** v2 及以前的 `star6 / star5 / shop` 三个平行数组 → `upOperators` */
const opsFromLegacy = (old, charIdOf = () => null) => {
  const shop = new Set(opNames(old.shop));
  const mk = (rarity, list) => toOpList(list, charIdOf).map((o) => ({
    scCharName: o.scCharName,
    charId: o.charId,
    rarity,
    isLimited: false,
    isShop: shop.has(o.scCharName),
  }));
  return [...mk(6, old.star6), ...mk(5, old.star5)];
};

/* ---------- 从 v3 条目里按维度取子集（校验 / 去重 / 弹窗都走它们） ---------- */

const opsOf = (entry, rarity) => (entry?.upOperators || []).filter((o) => (o?.rarity || 0) === rarity);
/** 六星干员（`upOperators` 里 rarity === 6 的那些） */
export const sixOf = (entry) => opsOf(entry, 6);
/** 五星干员 */
export const fiveOf = (entry) => opsOf(entry, 5);
/** 进店干员 */
export const shopOf = (entry) => (entry?.upOperators || []).filter((o) => o?.isShop);
/** `upOperators` 里的名字数组 */
export const namesOf = (list) => (list || []).map((o) => o?.scCharName).filter(Boolean);

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

/* ---------------------------------------------------------------- 名字与 id */

/**
 * 自动名（**不含前缀**）：**单六寻访** `<第一个六星名>池`；**其他类型** `<类型展示名><MMdd>`。
 * @param {string} type      卡池类型
 * @param {string} startDate 开始日（MMdd 取它）
 * @param {string[]} sixNames 六星名（单六寻访取第一个）
 */
export function autoName(type, startDate, sixNames = []) {
  if (type === 'single' && sixNames.length) return `${sixNames[0]}池`;
  return `${TYPE_LABEL[type] || type}${String(startDate || '').slice(5, 10).replace('-', '')}`;
}

/**
 * 生成展示名（**总是**带 `自定义_` 前缀）。
 * - 用户填了名字 → 用填的（先剥前缀，避免叠加）
 * - 空的 → `autoName()` 自动生成
 *
 * @param {{scName?:string, type?:string, startDate?:string, six?:string[], star6?:any}} entry
 *        表单层传 `six: form.star6`（名字数组）；老调用方传 `star6` 也吃。
 */
export function buildName(entry = {}) {
  const typed = stripPrefix(entry.scName);
  if (typed) return NAME_PREFIX + typed;
  const six = entry.six ? [...entry.six] : opNames(entry.star6);
  return NAME_PREFIX + autoName(entry.type, entry.startDate, six);
}

/** 合成 id：`YYYYMMDD_<type>_custom_<uid>` —— 与 wiki 的 id（数字后缀）不会撞 */
export const makeCustomId = (entry) =>
  `${String(entry.startDate).replace(/-/g, '')}_${entry.type}_custom_${pad4(entry.uid || 0)}`;

/* ---------------------------------------------------------------- 归一化 / 迁移 */

/**
 * 任意形态的条目 → **v3 条目**（幂等：v3 进 v3 出，一字不差）。
 * 迁移（v1 / v2）、导入、手写 JSON、以及 `entryToBanner` 都走这里。
 *
 * @param {object} raw 任何版本的记录
 * @param {(name:string)=>(string|null)} [charIdOf] 干员名 → charId（补老数据用）
 * @param {{ defaultRerunKind?: string|null }} [opts]
 *        `defaultRerunKind`：单六寻访缺 `rerunKind` 时填什么（**迁移**时填「首发」；
 *        导入手写 JSON 时留 null → 交给 `validate` 报错，别替用户猜）
 */
export function toEntry(raw, charIdOf = () => null, { defaultRerunKind = null } = {}) {
  const old = raw || {};
  const type = old.type;
  const startDate = old.startDate;
  const upOperators = Array.isArray(old.upOperators)
    ? normalizeUpOperators(old.upOperators, charIdOf)
    : opsFromLegacy(old, charIdOf);
  const wantRerun = type === 'single';
  const rerunKind = wantRerun
    ? (RERUN_KINDS.includes(old.rerunKind) ? old.rerunKind : defaultRerunKind)
    : null;
  const out = {
    scName: buildName({ scName: old.scName, type, startDate, six: namesOf(opsOf({ upOperators }, 6)) }),
    type,
    startDate,
    endDate: isDate(old.endDate) ? old.endDate : endDateOf(startDate),
    upOperators,
  };
  /* ⚠️ 只有单六寻访才写 `rerunKind` / `canRerun` —— 与 DB 的 schema 一致
     （DB 里 345 个池只有 85 个单六带这两个键）。 */
  if (wantRerun) {
    out.rerunKind = rerunKind;
    out.canRerun = computeCanRerun(type, rerunKind);
  }
  out.server = old.server;
  out.uid = old.uid;
  return out;
}

/** v1 条目（`name` + 名字数组 / 顿号文本）→ v3 */
export function migrateV1Entry(entry, charIdOf = () => null) {
  const old = entry || {};
  return toEntry({ ...old, scName: old.scName ?? old.name }, charIdOf, { defaultRerunKind: RERUN_KINDS[0] });
}

/** v2 条目（`scName` 原始名 + `star6/star5/shop`）→ v3 */
export function migrateV2Entry(entry, charIdOf = () => null) {
  return toEntry(entry, charIdOf, { defaultRerunKind: RERUN_KINDS[0] });
}

/* ---------------------------------------------------------------- 读写 */

/**
 * 读全部自设（三服混在一起）。任何异常都返回空数组。
 *
 * ⭐ **老版本自动迁移并写回**（v1 / v2 → v3，幂等）：
 *    不写回的话每次打开都要迁一遍，导出的 JSON 也会夹着旧格式。
 *
 * @param {{charIdOf?: (name:string)=>(string|null)}} [opts] 干员名 → charId（迁移老数据用）
 */
export function loadEntries({ charIdOf = () => null } = {}) {
  if (!storageAvailable()) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!raw || !Array.isArray(raw.banners)) return [];
    const base = raw.banners.filter((e) => e && typeof e === 'object' && e.type && e.startDate);
    if (raw.version === STORE_VERSION) return base;
    const migrate = raw.version === 1 ? migrateV1Entry : (raw.version === 2 ? migrateV2Entry : null);
    if (!migrate) return [];
    const migrated = base.map((e) => migrate(e, charIdOf));
    saveEntries(migrated);
    console.info(`[自定义卡池] 本地存储 v${raw.version} → v${STORE_VERSION} 已自动迁移 ${migrated.length} 条`);
    return migrated;
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

/* ---------------------------------------------------------------- 表单 ↔ 条目 */

/**
 * 弹窗表单 → v3 条目。
 *
 * 表单里三个干员列表是**名字数组**（`OpPicker` 的 v-model 就是名字），
 * 这里按星级加成 `upOperators`、按进店集合打 `isShop`；`scName` 走 `buildName()` 补前缀；
 * `endDate` 由开始日派生；`rerunKind` 只对单六寻访保留。
 *
 * ⚠️ `uid` 不在这里给 —— 由 store 的 `addCustom` / `updateCustom` 统一分配 / 保留。
 * @param {object} form `{ scName, type, startDate, rerunKind, star6, star5, shop, server }`
 */
export function formToEntry(form, charIdOf = () => null) {
  const type = form.type;
  const shopSet = new Set(opNames(form.shop));
  const mk = (rarity, list) => toOpList(list, charIdOf).map((o) => ({
    scCharName: o.scCharName,
    charId: o.charId,
    rarity,
    isLimited: false,
    isShop: shopSet.has(o.scCharName),
  }));
  const entry = {
    scName: buildName({ ...form, six: form.star6 }),
    type,
    startDate: form.startDate,
    endDate: endDateOf(form.startDate),
    upOperators: [...mk(6, form.star6), ...mk(5, form.star5)],
  };
  if (type === 'single') {
    const kind = RERUN_KINDS.includes(form.rerunKind) ? form.rerunKind : RERUN_KINDS[0];
    entry.rerunKind = kind;
    entry.canRerun = computeCanRerun(type, kind);
  }
  entry.server = form.server;
  return entry;
}

/**
 * v3 条目 → 弹窗表单（编辑时回填）。
 * `scName` 剥掉 `自定义_` 前缀，好让输入框里是用户当初打的名字。
 */
export function entryToForm(entry) {
  return {
    scName: stripPrefix(entry?.scName),
    type: entry?.type,
    startDate: entry?.startDate,
    rerunKind: entry?.rerunKind || RERUN_KINDS[0],
    star6: namesOf(sixOf(entry)),
    star5: namesOf(fiveOf(entry)),
    shop: namesOf(shopOf(entry)),
  };
}

/**
 * v3 条目 → 站点消费的 banner（与 `banners_<server>.json` 的条目同构，另加 `custom: true`）。
 * 只是补上 `id`（合成的）与 `enName`，其余字段原样带过去 —— 所以自设的
 * `rerunKind` / `canRerun` 也能像正式卡池那样被读到。
 */
export function entryToBanner(entry, charIdOf = () => null) {
  const e = toEntry(entry, charIdOf);
  const out = {
    id: makeCustomId(e),
    scName: e.scName,
    enName: null,
    type: e.type,
    startDate: e.startDate,
    endDate: e.endDate,
    upOperators: e.upOperators,
  };
  if (e.type === 'single') {
    out.rerunKind = e.rerunKind;
    out.canRerun = e.canRerun;
  }
  out.custom = true;
  return out;
}

/* ---------------------------------------------------------------- 校验 */

/**
 * 写入前校验（**入参是 v3 条目**，不是表单；表单先过 `formToEntry`）。
 *
 * **硬校验（error，拒存）**：类型白名单 / 日期 / 结束晚于开始 / 进店数量 /
 *   单六寻访必须有 `rerunKind`。
 * **只提醒（warning，照存）**：
 * - 六星 / 五星数量与常见构成不一致 —— 因为**复刻单六寻访的五星可能与首发不一致、也可能先留空**，
 *   硬校验会误杀真实数据（用户 2026-10-05 原话）。
 * - 干员名不在 `operators.json` 里 —— 用户可能提前知道解包信息，允许强存。
 *
 * ⭐ 进店的星级现在**直接读 `upOperators[].rarity`**（v2 时代要拿名字去六星/五星列表里反查，
 *    名字没填全就只能给 warning）—— 所以「进店必须是 1 六星 + 1 五星」现在是**硬校验**。
 *
 * @param {object} entry v3 条目
 * @param {(name:string)=>({rarity:number}|undefined)} [lookup] 干员名 → 干员（用于「查不到」提醒）
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function validate(entry, lookup = () => undefined) {
  const errors = [];
  const warnings = [];

  if (!CUSTOM_TYPES.includes(entry?.type)) {
    errors.push('寻访类型不在允许范围内（只能选白名单里的 6 类）');
  }

  if (!isDate(entry?.startDate)) errors.push('开始时间格式不对（应为 YYYY-MM-DD）');
  if (!isDate(entry?.endDate)) errors.push('结束时间格式不对（应为 YYYY-MM-DD）');
  else if (isDate(entry?.startDate) && entry.endDate <= entry.startDate) {
    errors.push('结束时间必须晚于开始时间');
  }

  if (entry?.type === 'single' && !RERUN_KINDS.includes(entry?.rerunKind)) {
    errors.push('单六寻访要选一个「卡池开启类型」（首发 / 返场 / 复刻）');
  }

  const six = namesOf(sixOf(entry));
  const five = namesOf(fiveOf(entry));
  const shop = shopOf(entry);

  /* ---- 进店数量：硬校验 ---- */
  const wantShop = SHOP_COUNT[entry?.type];
  if (wantShop !== undefined && shop.length !== wantShop) {
    errors.push(wantShop === 0
      ? `${TYPE_LABEL[entry.type] || entry.type}不该填进店干员（实测三服该类卡池的进店数恒为 0）`
      : `${TYPE_LABEL[entry.type] || entry.type}的进店必须是 1 个六星 + 1 个五星，当前填了 ${shop.length} 个`);
  }
  if (wantShop === 2 && shop.length === 2) {
    const asSix = shop.filter((o) => o.rarity === 6).length;
    const asFive = shop.filter((o) => o.rarity === 5).length;
    if (asSix !== 1 || asFive !== 1) errors.push('进店必须是 1 个六星 + 1 个五星');
  }

  /* ---- 六星 / 五星数量：只提醒 ---- */
  const hint = COMPOSE_HINT[entry?.type];
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
export function dedupe(entries, existing, charIdOf = () => null) {
  const kept = [];
  const dropped = [];
  for (const entry of entries) {
    const banner = entryToBanner(entry, charIdOf);
    const sixSet = new Set(namesOf(sixOf(banner)));
    const hit = (existing || []).find((b) => {
      const gap = diffDays(banner.startDate, b.startDate);
      if (Math.abs(gap) > NEAR_DAYS) return false;
      const bSix = new Set((b.upOperators || []).filter((o) => o.rarity === 6).map((o) => o.scCharName));
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
 * ⭐ **v1 / v2 的老导出文件照样能导入** —— 会自动迁移成 v3（`migrated: true`，界面可据此提示一声）。
 * ⭐ **单六寻访缺 `rerunKind` 时留空**（不替用户猜），由 `validate` 报错提示补上。
 * @param {object} text  JSON 文本
 * @param {{charIdOf?: (name:string)=>(string|null)}} [opts]
 * @returns {{ok:boolean, entries:object[], error:string|null, migrated:boolean}}
 */
export function parseImport(text, { charIdOf = () => null } = {}) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, entries: [], error: '不是合法的 JSON', migrated: false };
  }
  const list = Array.isArray(raw) ? raw : raw?.banners;
  if (!Array.isArray(list)) return { ok: false, entries: [], error: '结构不对：找不到 banners 数组', migrated: false };
  /* 裸数组（老的手写 JSON）没有版本号 → 当成当前版本 */
  const version = Array.isArray(raw) ? STORE_VERSION : raw.version;
  if (![1, 2, STORE_VERSION].includes(version)) {
    return {
      ok: false, entries: [], migrated: false,
      error: `版本不符（文件是 v${version}，当前支持 v1 / v2 / v${STORE_VERSION}）`,
    };
  }
  const entries = list.filter((e) => e && typeof e === 'object');
  const migrated = version !== STORE_VERSION;
  return {
    ok: true,
    entries: migrated
      ? entries.map((e) => (version === 1 ? migrateV1Entry(e, charIdOf) : migrateV2Entry(e, charIdOf)))
      : entries.map((e) => toEntry(e, charIdOf)),   // 当前版本也过一遍归一化（补 charId / 缺键）
    error: null,
    migrated,
  };
}

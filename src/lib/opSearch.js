/**
 * 干员名搜索（右栏「UP 干员」多选框的候选匹配，纯函数）。
 *
 * 一个干员要能被**三种写法**搜到，缺一不可：
 *  - 汉字名：`银灰`（也支持只打一部分，如 `银`）
 *  - **全拼**：`yinhui`（连续小写、不带分隔；粘来的 `yin hui` 也算，见 normalizeKeyword）
 *  - **拼音首字母**：`yh`
 * 拉丁名（`W` / `Mon3tr`）没有汉字，就没有拼音可言 —— 三种键一起退化成名字本身，
 * 于是照名字搜（大小写不敏感）依然好使。
 *
 * ⚠️ 拼音字典（pinyin-pro）是**懒加载**的，不跟着入口包走：
 *   它 unminified 就有 320KB，静态 import 会让每个页面的首屏都背上这份字典，
 *   而用到拼音的只有右栏那个搜索框 —— 所以等用户真的要搜了（输入框获得焦点）再
 *   `ensurePinyin()` 把字典拉进来。字典没到位之前只有「名字」这一种匹配可用
 *   （不影响正确性：候选少几个而已，字典一到就自动补齐）。
 * ⚠️ 结果按名字缓存；但**字典没到位时不写缓存**，否则会永久记住「这个字没有拼音」。
 * ⚠️ 计算用 pinyin-pro 按**字**取：`toneType:'none'` 去声调、`type:'array'` 拿数组、
 *   `pattern:'first'` 取首字母。`·` 之类的非汉字字符在拼音里被丢掉
 *   —— `维娜·维多利亚` → `weinaweiduoliya`。
 */
let pinyinFn = null;      // 字典到位后的 pinyin 函数
let dictPromise = null;   // 懒加载只发起一次

/**
 * 懒加载拼音字典（输入框 focus 时调一次即可）。重复调用返回同一个 promise；
 * 加载失败也不抛给调用方 —— 退化成「只能按名字搜」。
 */
export function ensurePinyin() {
  if (!dictPromise) {
    dictPromise = import('pinyin-pro')
      .then((m) => { pinyinFn = m.pinyin; })
      .catch(() => { pinyinFn = null; });
  }
  return dictPromise;
}

/** 字典是否已就位（只为调试/测试方便） */
export const pinyinReady = () => !!pinyinFn;

/** name → { name, lower, full, initials }（全部小写），字典到位后只算一次 */
const keysCache = new Map();

/** 干员名 → 搜索用的三个键 */
export function opSearchKeys(name) {
  const key = String(name ?? '');
  const hit = keysCache.get(key);
  if (hit) return hit;

  const lower = key.toLowerCase();
  const han = key.replace(/[^\u4e00-\u9fa5]/g, '');
  /* 拉丁名（W / Mon3tr…）没有汉字：三种键退化成同一个名字，无需等字典 */
  const canPinyin = !!han && !!pinyinFn;
  const full = canPinyin
    ? pinyinFn(han, { toneType: 'none', type: 'array' }).join('').toLowerCase()
    : (han ? '' : lower);
  const initials = canPinyin
    ? pinyinFn(han, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase()
    : (han ? '' : lower);

  const keys = { name: key, lower, full, initials };
  /* ⚠️ 「有汉字但字典还没到」的结果**不能缓存**（它只是暂时的空拼音） */
  if (!han || canPinyin) keysCache.set(key, keys);
  return keys;
}

/**
 * 关键词归一化：去首尾空白 + **去掉内部空格**（`yin hui` 与 `yinhui` 等价）+ 转小写。
 * 空串表示「没有关键词」——调用方据此跳过匹配。
 */
export const normalizeKeyword = (q) => String(q ?? '').trim().toLowerCase().replace(/\s+/g, '');

/** 这个名字是否命中关键词：汉字 / 全拼 / 首字母，子串命中任一即可 */
export function matchOperator(name, keyword) {
  const q = normalizeKeyword(keyword);
  if (!q) return true;
  const k = opSearchKeys(name);
  return k.lower.includes(q) || k.full.includes(q) || k.initials.includes(q);
}

/** 命中质量：0 完全相等 < 1 前缀 < 2 中间（越小越靠前，用于候选排序） */
export function matchRank(name, keyword) {
  const q = normalizeKeyword(keyword);
  if (!q) return 0;
  const k = opSearchKeys(name);
  if (k.lower === q || k.full === q || k.initials === q) return 0;
  if (k.lower.startsWith(q) || k.full.startsWith(q) || k.initials.startsWith(q)) return 1;
  return 2;
}

/**
 * 候选干员名：从 `names` 里挑出命中关键词的，去掉已选中的，按命中质量排序（同分保持原顺序）。
 * @param {string[]} names    候选池（一般是 Object.keys(site.operators)）
 * @param {string}   keyword  搜索框里的字
 * @param {object}   opts     { exclude: 已选中的名字, limit: 最多返回几个 }
 */
export function searchOperators(names, keyword, { exclude = [], limit = 30 } = {}) {
  const q = normalizeKeyword(keyword);
  if (!q) return [];
  const skip = exclude.length ? new Set(exclude) : null;
  const hits = [];
  for (const name of names) {
    if (skip && skip.has(name)) continue;
    if (!matchOperator(name, q)) continue;
    hits.push({ name, rank: matchRank(name, q) });
  }
  /* Array.prototype.sort 是稳定的（ES2019+）→ 同分保持 names 的原始顺序 */
  hits.sort((a, b) => a.rank - b.rank);
  return hits.slice(0, limit).map((x) => x.name);
}

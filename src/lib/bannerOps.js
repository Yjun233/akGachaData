/**
 * `upOperators` 的**统一排序** —— 站点侧实现（自定义卡池保存 / 回填时用）。
 *
 * 口径与爬虫侧 `akGachaResource/scripts/lib/banner-ops.mjs` **完全一致**，两处必须同步改：
 *   **星级（6★ 前）→ 限定 / 首发 / 进店 → 实装日从早到晚 → charId 数字**
 *
 * 为什么站点要自己有一份（而不是从资源仓库 import）：那是另一个仓库的 Node 脚本，
 * 站点构建不该依赖它。两份实现互为对撞 —— `verify-data` 用这份去检查资源仓库产出的数据，
 * 哪天只改了一边、或接错了地方，断言立刻红。
 *
 * 用户 2026-11-04 定；2026-11-04 追加「自定义卡池在保存时也按这个顺序重排」。
 *
 * ⚠️ 与爬虫侧唯一的表现差异：站点拿不到「本池首发」的上下文也不需要 ——
 *    自定义卡池的类型只有 6 种（double / joint / stdfes / single / classic / clafes），
 *    其中 `single` 走「首发 → 其他」那一支（判据同样是「实装最晚的那批」）。
 */

/** 限定寻访三类：按 `isLimited` 分组 */
const LIMITED_TYPES = new Set(['limcel', 'limspr', 'limsum']);

/** 单六 / 双五：按「是不是首发时登场的那批」分组 */
const SERIES_TYPES = new Set(['single', 'five']);

/** `char_4247_oxi` → 4247；认不出 → null */
export const charIdNumber = (charId) => {
  const m = /^char_(\d+)_/.exec(String(charId ?? ''));
  return m ? Number(m[1]) : null;
};

const byNumberAsc = (a, b) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return a - b;
};

const byDateAsc = (a, b) => {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : 1;
};

/** 名字兜底比较：**码点序**（不用 `localeCompare` —— SSR 与浏览器对中文排序可能不同） */
const byName = (a, b) => {
  const x = String(a ?? '');
  const y = String(b ?? '');
  return x < y ? -1 : (x > y ? 1 : 0);
};

/**
 * 排好一个卡池的 `upOperators`（**不改动入参**，返回新数组）。
 *
 * @param {Array<object>} ops
 * @param {object} ctx
 * @param {string} ctx.type  卡池类型（11 种之一）
 * @param {(op:object)=>string|null} [ctx.releaseOf] 取该干员的**国服实装日**（`YYYY-MM-DD`）
 * @returns {Array<object>}
 */
export function sortUpOperators(ops, { type, releaseOf } = {}) {
  const list = Array.isArray(ops) ? ops : [];
  if (list.length < 2) return list.slice();

  const rel = new Map();
  for (const op of list) {
    let d = null;
    try {
      d = releaseOf ? releaseOf(op) || null : null;
    } catch {
      d = null; // 取不到就当未知，别让一次排序把弹窗搞挂
    }
    rel.set(op, d);
  }

  /* 单六 / 双五：首发组 = 本池里实装最晚的那批（复刻池的陪跑都是老干员，同样成立） */
  let firstRun = null;
  if (SERIES_TYPES.has(type)) {
    let latest = null;
    for (const d of rel.values()) if (d && (!latest || d > latest)) latest = d;
    firstRun = new Set(latest ? list.filter((op) => rel.get(op) === latest) : list);
  }

  /** 顺位（只在同星级内部比）：0 = 限定 / 首发 / 进店，1 = 标准 / 其他 / 陪跑 */
  const groupOf = (op) => {
    if (LIMITED_TYPES.has(type)) return op.isLimited ? 0 : 1;
    if (firstRun) return firstRun.has(op) ? 0 : 1;
    return op.isShop ? 0 : 1;
  };

  return list.slice().sort((a, b) => {
    const r = (b.rarity || 0) - (a.rarity || 0);
    if (r) return r;
    const g = groupOf(a) - groupOf(b);
    if (g) return g;
    const d = byDateAsc(rel.get(a), rel.get(b));
    if (d) return d;
    const c = byNumberAsc(charIdNumber(a.charId), charIdNumber(b.charId));
    if (c) return c;
    return byName(a.scCharName, b.scCharName);
  });
}

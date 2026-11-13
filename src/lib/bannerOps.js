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
 * ⚠️ 2026-11-13 同步「**复刻池的首发组要沿用同系列首发池**」：
 *    爬虫侧原来一律用「本池里实装最晚的那批」，但复刻池的陪跑可能比原首发干员更新
 *    （繁中服「未致蒙尘·复刻」的寻澜 2025-01-22 > 波卜 2024-10-09），会把陪跑排到首发前面。
 *    所以 `sortUpOperators()` 多收一个 `firstRunIds`，整份数据的归位由 `resortSeriesBanners()` 做。
 *    ⚠️ 自定义卡池是**单池**、没有系列上下文，保存时仍然只调 `sortUpOperators()`（不传 firstRunIds）——
 *       这正是不把 series 逻辑塞进 `sortUpOperators` 内部的原因。
 */

/** 限定寻访三类：按 `isLimited` 分组 */
const LIMITED_TYPES = new Set(['limcel', 'limspr', 'limsum']);

/** 单六 / 双五：按「是不是首发时登场的那批」分组 */
const SERIES_TYPES = new Set(['single', 'five']);

/** 复刻 / 返场池名的后缀：`未致蒙尘·复刻`、`不羁逆流 返场` 都去掉 */
const SERIES_SUFFIX = /\s*[·:：]?\s*(复刻|返场)$/;

/** `未致蒙尘·复刻` → `未致蒙尘`（只用于找同系列首发池，别拿它当展示名） */
export const seriesKeyOf = (name) => String(name ?? '').replace(SERIES_SUFFIX, '').trim();

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

/** 取实装日（取不到 / 抛错都当未知） */
function releaseMapOf(list, releaseOf) {
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
  return rel;
}

/**
 * 排好一个卡池的 `upOperators`（**不改动入参**，返回新数组）。
 *
 * @param {Array<object>} ops
 * @param {object} ctx
 * @param {string} ctx.type  卡池类型（11 种之一）
 * @param {(op:object)=>string|null} [ctx.releaseOf] 取该干员的**国服实装日**（`YYYY-MM-DD`）
 * @param {Set<string>|string[]} [ctx.firstRunIds] 直接指定「首发组」（charId）；
 *        **复刻池要用同系列首发池的那批人**（交给 `resortSeriesBanners()` 算好传进来）。
 * @returns {Array<object>}
 */
export function sortUpOperators(ops, { type, releaseOf, firstRunIds } = {}) {
  const list = Array.isArray(ops) ? ops : [];
  if (list.length < 2) return list.slice();

  const rel = releaseMapOf(list, releaseOf);

  let firstRun = null;
  if (firstRunIds) {
    /* 复刻 / 返场池：首发组由调用方按「同系列首发池」给，按 charId 认人；
       一个都对不上（整池换人）→ null，退回纯日期序 */
    const ids = firstRunIds instanceof Set ? firstRunIds : new Set(firstRunIds);
    const hit = list.filter((op) => op.charId && ids.has(op.charId));
    firstRun = hit.length ? new Set(hit) : null;
  } else if (SERIES_TYPES.has(type)) {
    /* 首发池：本池里实装最晚的那批 = 当期新登场的干员 */
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

/** 某一期（必须是首发池）的首发组 charId —— 与 `sortUpOperators` 内部那条同口径 */
function firstRunIdsOf(ops, releaseOf) {
  const list = Array.isArray(ops) ? ops : [];
  const rel = releaseMapOf(list.filter((o) => o && o.charId), releaseOf);
  let latest = null;
  for (const d of rel.values()) if (d && (!latest || d > latest)) latest = d;
  const out = new Set();
  if (!latest) return out;
  for (const [op, d] of rel) if (d === latest) out.add(op.charId);
  return out;
}

/**
 * 对**一整份 banners** 做「复刻池首发组归位」的重排（原地改写 `upOperators`，返回改动池数）。
 *
 * 站点侧只有 `verify-data` 用它（拿这份去对撞资源仓库的产出）；自定义卡池是单池，不需要。
 *
 * @param {object|Array<object>} banners 对象（id → banner）或数组；每项要有
 *        `{ type, startDate, upOperators, scName|name }`
 * @param {object} ctx
 * @param {(op:object)=>string|null} [ctx.releaseOf]
 * @returns {number}
 */
export function resortSeriesBanners(banners, { releaseOf } = {}) {
  const list = Array.isArray(banners) ? banners : Object.values(banners || {});
  const groups = new Map();
  for (const b of list) {
    if (!b || !SERIES_TYPES.has(b.type)) continue;
    const key = seriesKeyOf(b.scName ?? b.name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }

  let changed = 0;
  for (const series of groups.values()) {
    if (series.length < 2) continue;
    /* 同系列按开始日升序，第一期就是首发池 */
    series.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    const firstRunIds = firstRunIdsOf(series[0].upOperators, releaseOf);
    if (!firstRunIds.size) continue;
    for (let i = 1; i < series.length; i += 1) {
      const b = series[i];
      const before = b.upOperators.map((o) => o.charId).join('|');
      b.upOperators = sortUpOperators(b.upOperators, { type: b.type, releaseOf, firstRunIds });
      if (b.upOperators.map((o) => o.charId).join('|') !== before) changed += 1;
    }
  }
  return changed;
}

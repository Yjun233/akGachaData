/**
 * 首次进店间隔（纯函数）。
 *
 * 口径：
 * - 「进店」= 卡池的 upOperators 里 `isShop === true`，进店日取该卡池的 `startDate`
 *   （商店兑换与卡池同期上下架）。
 * - 排除限定干员与 4 星及以下 —— 与统计页保持一致。
 * - 每位干员取其**首次进店**（最早的那个卡池）。
 * - **六星与五星各自成序列，星级之间不互相比较**：同一星级内按 axis 排序后，
 *   纵轴取 metric 指定的值；组内第一位（当 metric = gap 时）没有前序，`gap` 为 `null`（图上不画点）。
 * - 时间范围按**首次进店日期**筛选；筛选后重新排序、重新计算。
 *
 * 两个可切换的口径（用户指定）：
 * - `axis`   横轴顺序 + 轴标签日期
 *   - `firstShop`（默认）按**首次进店日期**；轴标签写首次进店日期
 *   - `release`           按**实装日期**；轴标签写实装日期
 * - `metric` 纵轴取值
 *   - `gap`（默认）距**同星级上一个点**的首次进店日之差（随 axis 变化，**可能为负**：
 *     按实装排序时，后实装却更早进店的干员会算出负数）
 *   - `sinceRelease` 该干员首次进店日 − 该干员自有实装日
 *
 * 注意：最初版本把六星五星混在一条序列里算间隔，会算出「夜莺距上一名德克萨斯 0 天」
 * 这种跨星级的假间隔 —— 已改为按星级分组，各自排序、各自算间隔。
 */
import { diffDays } from './date.js';

/**
 * @param {object} ctx
 * @param {Array}  ctx.banners         当前服务器全部卡池（含 id）
 * @param {object} ctx.operatorByName  干员名 → 干员
 * @param {(op:object)=>string|null} ctx.relDateOf 取当前服务器实装日
 * @param {string} [ctx.from]          首次进店日 ≥ from
 * @param {string} [ctx.to]            首次进店日 ≤ to
 * @param {'firstShop'|'release'} [ctx.axis]
 * @param {'gap'|'sinceRelease'} [ctx.metric]
 */
export function computeFirstShop({
  banners,
  operatorByName,
  relDateOf,
  from = '',
  to = '',
  axis = 'firstShop',
  metric = 'gap',
}) {
  /** name → { name, rarity, firstDate, count } */
  const first = {};

  for (const b of banners) {
    for (const op of b.upOperators) {
      if (!op.isShop) continue;
      if (op.isLimited) continue;
      if ((op.rarity || 0) < 5) continue;
      const cur = first[op.name];
      if (!cur) {
        first[op.name] = { name: op.name, rarity: op.rarity, firstDate: b.startDate, count: 1 };
      } else {
        cur.count += 1;
        if (b.startDate < cur.firstDate) cur.firstDate = b.startDate;
      }
    }
  }

  const allRaw = Object.values(first);
  /** 不加时间限制时的边界（「全部」按钮与日期输入的 min/max 用） */
  const bounds = {
    min: allRaw.reduce((m, x) => (!m || x.firstDate < m ? x.firstDate : m), null),
    max: allRaw.reduce((m, x) => (!m || x.firstDate > m ? x.firstDate : m), null),
  };

  const filtered = allRaw
    .filter((x) => (!from || x.firstDate >= from) && (!to || x.firstDate <= to));

  /* 实装日与「距实装天数」要先算好 —— 按实装排序要用到 releaseDate */
  for (const r of filtered) {
    const op = operatorByName[r.name];
    r.releaseDate = relDateOf(op);
    r.sinceRelease = r.releaseDate ? diffDays(r.firstDate, r.releaseDate) : null;
  }

  /**
   * 组内排序 + 逐点算出当前口径的取值。
   * 同一天 / 同实装日时按名字排序，保证顺序稳定。
   */
  function buildSeries(list) {
    const sortKey = (r) => (axis === 'release' ? (r.releaseDate || '9999-12-31') : r.firstDate);
    const sorted = list.slice().sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      if (ka !== kb) return ka < kb ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    let prev = null;
    for (const r of sorted) {
      r.gap = prev ? diffDays(r.firstDate, prev.firstDate) : null;
      r.prevName = prev ? prev.name : null;
      r.xLabel = axis === 'release' ? (r.releaseDate || '—') : r.firstDate;
      r.value = metric === 'gap' ? r.gap : r.sinceRelease;
      prev = r;
    }
    return sorted;
  }

  return {
    axis,
    metric,
    six: buildSeries(filtered.filter((r) => r.rarity === 6)),
    five: buildSeries(filtered.filter((r) => r.rarity === 5)),
    rows: filtered,
    bounds,
  };
}

/** 纵轴取值的中文名（图表说明与 tooltip 用） */
export const METRIC_LABEL = {
  gap: '距同星级上一个首次进店（天）',
  sinceRelease: '距该干员实装日（天）',
};

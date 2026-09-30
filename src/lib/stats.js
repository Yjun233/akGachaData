/**
 * 统计计算（纯函数，不依赖 Vue / 浏览器）。
 *
 * 口径（用户已确认，勿改）：
 * - 出率提升与商店兑换是**包含关系**：标准 / 中坚寻访每期 4 名干员都获得出率提升，
 *   其中 1 名六星 + 1 名五星同时可用凭证兑换 → 商店兑换次数是出率提升次数的子集。
 *   因此 `upAll` 收录全部 UP（含 isShop），`shopAll` 只收录 isShop。
 * - 限定干员（isLimited）在统计页完全排除；星级 < 5 也排除。
 * - 中坚次数 = 该干员在中坚寻访大类（classic / clafes）中的次数；
 *   标准次数 = 标准寻访大类 + 限定寻访中的次数；总次数 = 中坚 + 标准。
 */
import { diffDays } from './date.js';

/** 干员是否属于中坚寻访体系（由 obtainMethod 文案判断） */
export const isMidOp = (op) => /中坚寻访/.test(op?.obtainMethod || '');

/** 一组卡池中结束时间最晚的那个 */
export function latest(arr) {
  let best = null;
  for (const b of arr) if (!best || b.endDate > best.endDate) best = b;
  return best;
}

/**
 * 「最后一次出现」的信息：结束时间 + 是否进行中 + 距今天数。
 * 进行中时 days 为 null（界面显示「进行中」）。
 */
export function endInfo(arr, refDate) {
  const b = latest(arr);
  if (!b) return { end: null, live: false, days: null };
  const live = b.startDate <= refDate && refDate <= b.endDate;
  return { end: b.endDate, live, days: live ? null : diffDays(refDate, b.endDate) };
}

/** 排序用的「距今天数」：进行中视为 0，无数据视为 -1 */
export const daysSortValue = (info) => (info.live ? 0 : (info.days ?? -1));

/**
 * 计算参考日期下的统计表。
 * @param {object} ctx
 * @param {Array}  ctx.banners          当前服务器的卡池列表（含 id）
 * @param {object} ctx.categories       type → 大类
 * @param {object} ctx.operatorByName   干员名 → 干员
 * @param {object} ctx.operatorIndex    干员名 → { rarity, isLimited }
 * @param {string} ctx.refDate          参考日期 YYYY-MM-DD
 * @param {(op:object)=>string|null} ctx.relDateOf 取当前服务器实装日
 * @returns {{ visible:Array, map:object }}
 */
export function computeStats({ banners, categories, operatorByName, operatorIndex, refDate, relDateOf }) {
  const visible = banners.filter((b) => b.startDate <= refDate);
  const map = {};

  const rec = (name) => {
    if (map[name]) return map[name];
    const op = operatorByName[name] || {};
    return (map[name] = {
      name,
      rarity: operatorIndex[name] ? operatorIndex[name].rarity : 5,
      releaseDate: relDateOf(op),
      everMid: false,
      upAll: [], upMid: [], upStd: [],
      shopAll: [], shopMid: [], shopStd: [],
    });
  };

  for (const b of visible) {
    const mid = categories[b.type] === '中坚寻访';
    for (const op of b.upOperators) {
      if (op.isLimited) continue;
      if ((op.rarity || 0) < 5) continue;
      const r = rec(op.name);
      r.upAll.push(b);
      (mid ? r.upMid : r.upStd).push(b);
      if (op.isShop) {
        r.shopAll.push(b);
        (mid ? r.shopMid : r.shopStd).push(b);
      }
    }
  }

  /* 参与统计的干员：干员表里可能没收录（历史 UP 但已下架）时，靠 obtainMethod 判断 */
  for (const name of Object.keys(map)) {
    const op = operatorByName[name];
    map[name].everMid = op ? isMidOp(op) : false;
    map[name].releaseDate = relDateOf(op);
  }

  return { visible, map };
}

/** 统计表按「实装时间 → 名称」的默认排序：没实装日的排最后 */
export function defaultStatSort(a, b) {
  const ra = a.releaseDate || '9999';
  const rb = b.releaseDate || '9999';
  if (ra !== rb) return ra < rb ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/** 统计表某列的可比较值（key 与表头 data-sort 一致） */
export function statMetric(row, key, refDate) {
  const up = endInfo(row.upAll, refDate);
  const shop = endInfo(row.shopAll, refDate);
  switch (key) {
    case 'releaseDate': return row.releaseDate || '9999';
    case 'name': return row.name;
    case 'upEnd': return up.end || '0000';
    case 'upDays': return daysSortValue(up);
    case 'upTotal': return row.upAll.length;
    case 'upMid': return row.upMid.length;
    case 'upStd': return row.upStd.length;
    case 'shopEnd': return shop.end || '0000';
    case 'shopDays': return daysSortValue(shop);
    case 'shopTotal': return row.shopAll.length;
    case 'shopMid': return row.shopMid.length;
    case 'shopStd': return row.shopStd.length;
    default: return 0;
  }
}

/** 按指定列排序（不改原数组），无排序列时用默认排序 */
export function sortStatRows(rows, sort, refDate) {
  const arr = rows.slice();
  if (!sort) return arr.sort(defaultStatSort);
  const mul = sort.dir === 'asc' ? 1 : -1;
  return arr.sort((a, b) => {
    const va = statMetric(a, sort.key, refDate);
    const vb = statMetric(b, sort.key, refDate);
    if (va === vb) return defaultStatSort(a, b);
    return va > vb ? mul : -mul;
  });
}

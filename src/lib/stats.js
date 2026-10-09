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
 * - **中坚甄选（`clafes`）默认不计入出率提升**（2026-10-08 用户定）：中坚甄选是「官方自选
 *   中坚干员」的池子、每期一次性把 30+ 位干员全放出来，与常驻中坚（`classic`）不是一回事，
 *   混在一起会把绝大多数干员的次数抬得很难看。所以**默认排除**，由右栏一个开关控制是否计入
 *   （见下面的 `includeClafesUp`）。
 *   ⚠️ 排除只影响统计页的记录集，**卡池列表 / 图表 / 进行中判定都不受影响**（它们走各自的 getter）。
 *   ⚠️ 甄选池**没有进店位**（三服实测 0 个 isShop）→ 商店兑换**不需要**这个开关，故不做。
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
 *
 * ⚠️ **结束日期当日算「已关闭」**（2026-10-01 口径）：卡池的最后一天（`endDate`）当天
 * 就已经下架了，所以判据是 `startDate <= refDate && refDate < endDate`。
 *
 * ⚠️ **距今天数整体 +1**（2026-10-02 口径）：**结束日当天看到的是「1 天」**，不是 0。
 * 即 `days = 参考日期 − 结束日期 + 1` —— 把结束日当作第 1 天来数。
 * 于是「0」腾出来给「进行中」、「-1」给「无数据」，三者互不混淆
 * （排序值见下面的 `daysSortValue`）。
 */
export function endInfo(arr, refDate) {
  const b = latest(arr);
  if (!b) return { end: null, live: false, days: null };
  const live = b.startDate <= refDate && refDate < b.endDate;
  return { end: b.endDate, live, days: live ? null : diffDays(refDate, b.endDate) + 1 };
}

/**
 * 排序用的「距今天数」（**只用于排序，不影响显示**）：
 * - **进行中 = 0**（显示「进行中」）
 * - **无数据 = -1**（显示「—」，即该干员根本没有这类记录）
 * - 其余是真实天数：**结束日当天 = 1**、之后 2、3……（不会出现 0）
 *
 * ⚠️ 为什么要区分：2026-10-01 起「结束日当天算已关闭」，若「进行中」也按 0 算，
 * 两类行会**并列混在一起**，按距今天数排序时看不出谁是谁。把两个特殊值取成
 * 0 / -1（比最小的真实天数 1 还小），就能与真实天数彻底分开。
 */
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
 * @param {boolean} [ctx.includeClafesUp=false]    中坚甄选是否计入**出率提升**
 * @returns {{ visible:Array, map:object }}
 */
export function computeStats({
  banners, categories, operatorByName, operatorIndex, refDate, relDateOf,
  includeClafesUp = false,
}) {
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
    /* 中坚甄选（clafes）由一个开关控制它进不进「出率提升」记录集。
       ⚠️ 甄选池没有进店位（三服 0 个 isShop），所以**商店兑换不需要开关** —— shopAll 照常收
          `isShop` 的条目（甄选池永远不会命中）。 */
    const clafes = b.type === 'clafes';
    const skipUp = clafes && !includeClafesUp;
    for (const op of b.upOperators) {
      if (op.isLimited) continue;
      if ((op.rarity || 0) < 5) continue;
      /* ⚠️ 被排除的条目**连 rec() 都不进** —— 否则该干员会凭空多出一行
         （`upAll` 为空、却因为被 skip 的池子而占了一行）。 */
      if (skipUp) continue;
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

/**
 * 干员 UP 历史（时间轴图，纯函数）。
 *
 * 每位干员一条横条：
 * - 起点 = 该干员在**当前服务器**的实装日（`relDateOf`）
 * - 终点 = 当前筛选下**最后一次 UP 的卡池开始日**（勾「只看进店」时就是最后一次进店日）
 * - 条上按卡池开始日打标记，标记颜色区分卡池大类（见 constants 的 CAT_COLOR）
 *
 * 筛选口径：
 * - **排除限定干员**（`isLimited = true`）—— 本页只看非限定干员的 UP 历史。
 *   限定干员只在限定寻访里出现、轮换规律与常规池完全不同，混在一起看不出东西。
 *   （注意：非限定的 5 星仍可能出现在「限定寻访」卡池里，所以大类三色都还会出现。）
 * - `types`：只保留这些卡池类型（`null` / 空数组 = 全部）
 * - `shopOnly`：只保留 `isShop` 的记录（与 `types` 互斥，由右栏保证）
 * - **在某筛选下没有任何记录的干员不占行**（否则勾「只看进店」会出现一排空行）
 * - 时间范围**不参与**这里 —— 它只控制图表的横轴范围，纵轴始终保留全部干员
 */
import { diffDays } from './date.js';

/** 纵轴排序（右栏） */
const SORT_KEY = {
  release: (r) => r.releaseDate || '9999-12-31',
  lastUp: (r) => r.lastDate,
};

function sorter(sort) {
  const desc = String(sort).endsWith('desc');
  const key = SORT_KEY[String(sort).startsWith('release') ? 'release' : 'lastUp'];
  return (a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === kb) return a.name.localeCompare(b.name);
    return (ka < kb ? -1 : 1) * (desc ? -1 : 1);
  };
}

/**
 * @param {object} ctx
 * @param {Array}  ctx.banners         当前服务器全部卡池（含 id）
 * @param {object} ctx.categories      type → 大类
 * @param {object} ctx.operatorByName  干员名 → 干员
 * @param {(op:object)=>string|null} ctx.relDateOf 取当前服务器实装日
 * @param {string[]|null} [ctx.types]  只保留这些卡池类型
 * @param {boolean} [ctx.shopOnly]     只保留进店记录
 * @param {string}  [ctx.sort]         release-asc / release-desc / lastUp-asc / lastUp-desc
 */
export function computeUpHistory({
  banners,
  categories,
  operatorByName,
  relDateOf,
  types = null,
  shopOnly = false,
  sort = 'release-asc',
}) {
  const typeSet = types && types.length ? new Set(types) : null;

  /* 1) 收集每位干员的全部 UP 记录 */
  const byOp = {};
  for (const b of banners) {
    const cat = categories[b.type] || '其他';
    for (const op of b.upOperators) {
      if ((op.rarity || 0) < 5) continue;
      if (!byOp[op.name]) byOp[op.name] = { name: op.name, rarity: op.rarity, marks: [] };
      byOp[op.name].marks.push({
        operator: op.name,
        bannerId: b.id,
        bannerName: b.name,
        type: b.type,
        cat,
        date: b.startDate,
        endDate: b.endDate,
        isShop: !!op.isShop,
        rarity: op.rarity,
      });
    }
  }

  /* 2) 逐位干员应用筛选、算起止日期 */
  const rows = [];
  for (const r of Object.values(byOp)) {
    /* 限定干员整行排除（见文件头的口径说明） */
    if (operatorByName[r.name]?.isLimited) continue;

    r.marks.sort((a, b) => (a.date === b.date
      ? a.bannerId.localeCompare(b.bannerId)
      : (a.date < b.date ? -1 : 1)));

    const marks = r.marks.filter((m) => (!typeSet || typeSet.has(m.type))
      && (!shopOnly || m.isShop));
    if (!marks.length) continue; // 该筛选下没有任何记录 → 不占行

    const op = operatorByName[r.name];
    rows.push({
      name: r.name,
      rarity: r.rarity,
      releaseDate: relDateOf(op),
      marks,
      firstDate: marks[0].date,
      lastDate: marks[marks.length - 1].date,
      count: marks.length,
      shopCount: marks.filter((m) => m.isShop).length,
    });
  }

  rows.sort(sorter(sort));

  return {
    six: rows.filter((r) => r.rarity === 6),
    five: rows.filter((r) => r.rarity === 5),
    all: rows,
  };
}

/** 该干员实装到首次 UP 之间隔了多少天（tooltip 用） */
export const gapFromRelease = (row, date) =>
  (row.releaseDate ? diffDays(date, row.releaseDate) : null);

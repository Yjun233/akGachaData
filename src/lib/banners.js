/**
 * 卡池列表的筛选与排序（纯函数）。
 * 注意：卡池列表展示**全部**卡池，不受参考日期影响。
 */
import { TYPE_LABEL } from './constants.js';

/**
 * 空筛选条件。
 * ⚠️ `types` 是**数组**（多选，与 UP 历史右栏的类型按钮组同一套语义）：
 *   空数组 = 全部类型；大类不再单独存，由「该大类下的类型是否全被选中」体现。
 * ⚠️ `ops` 同样是**数组**（UP 干员多选）：空数组 = 不按干员筛；
 *   里面存的是**精确干员名**（由右栏那个支持拼音的搜索框挑出来，见 lib/opSearch.js），
 *   命中任意一个即保留（OR）。以前是单个字符串 `op`（自由文本子串匹配），已废弃。
 */
export const emptyFilters = () => ({ types: [], from: '', to: '', ops: [] });

/**
 * 按筛选条件过滤 + 排序。
 * @param {Array}  banners    当前服务器卡池（含 id）
 * @param {object} filters    { types, from, to, ops }
 * @param {object} categories type → 大类（**已不再参与排序** —— 「大类」列 2026-11-03 删掉了，
 *        类型徽章直接穿大类配色；保留形参是因为 store / 核对脚本都还在传，改签名不划算）
 * @param {object} sort       { key, dir }
 */
export function bannerRows(banners, filters, categories, sort) {
  const f = filters;
  const typeSet = f.types && f.types.length ? new Set(f.types) : null;
  const opSet = f.ops && f.ops.length ? new Set(f.ops) : null;
  const rows = banners.filter((b) => {
    if (typeSet && !typeSet.has(b.type)) return false;
    if (f.from && b.startDate < f.from) return false;
    if (f.to && b.startDate > f.to) return false;
    /* 干员多选：卡池的 UP 干员里**有任意一个**被选中就保留（OR）。
       ⚠️ 这里是**精确名**比对，不是子串 —— 模糊/拼音那一步在右栏搜索框里做完了
       （lib/opSearch.js），进来的都已经是确定的干员名。 */
    if (opSet && !b.upOperators.some((o) => opSet.has(o.scCharName))) return false;
    return true;
  });

  const { key, dir } = sort;
  const mul = dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    let va;
    let vb;
    if (key === 'type') { va = TYPE_LABEL[a.type]; vb = TYPE_LABEL[b.type]; }
    else { va = a[key]; vb = b[key]; }
    if (va === vb) return a.id.localeCompare(b.id);
    return va > vb ? mul : -mul;
  });
  return rows;
}

/** 点击表头后的下一个排序状态：文本列升序，日期列降序 */
export function nextBannerSort(current, key) {
  if (current.key === key) {
    return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key, dir: key === 'startDate' || key === 'endDate' ? 'desc' : 'asc' };
}

/**
 * 统计表：**第一次点就该「从大到小」**的列（2026-11-16 用户要求）。
 *
 * 只有「距今天数」这一类：看这张表就是为了找出**等得最久**的干员，
 * 首次点击给升序等于把有用的排到最后，还得再点一次。
 * ⚠️ 别顺手把「结束时间」也加进来 —— 那是日期，用户没提，改了反而要重新适应。
 */
const STAT_DESC_FIRST = new Set(['upDays', 'shopDays']);

/** 统计表：点击表头后的下一个排序状态（距今天数默认降序，其余默认升序） */
export function nextStatSort(current, key) {
  if (current && current.key === key) {
    return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key, dir: STAT_DESC_FIRST.has(key) ? 'desc' : 'asc' };
}

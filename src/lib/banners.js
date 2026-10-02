/**
 * 卡池列表的筛选与排序（纯函数）。
 * 注意：卡池列表展示**全部**卡池，不受参考日期影响。
 */
import { TYPE_LABEL } from './constants.js';

/**
 * 空筛选条件。
 * ⚠️ `types` 是**数组**（多选，与 UP 历史右栏的类型按钮组同一套语义）：
 *   空数组 = 全部类型；大类不再单独存，由「该大类下的类型是否全被选中」体现。
 */
export const emptyFilters = () => ({ types: [], from: '', to: '', op: '' });

/**
 * 按筛选条件过滤 + 排序。
 * @param {Array}  banners    当前服务器卡池（含 id）
 * @param {object} filters    { types, from, to, op }
 * @param {object} categories type → 大类（未用；保留形参以免调用方大改）
 * @param {object} sort       { key, dir }
 */
export function bannerRows(banners, filters, categories, sort) {
  const f = filters;
  const typeSet = f.types && f.types.length ? new Set(f.types) : null;
  const rows = banners.filter((b) => {
    if (typeSet && !typeSet.has(b.type)) return false;
    if (f.from && b.startDate < f.from) return false;
    if (f.to && b.startDate > f.to) return false;
    if (f.op) {
      const kw = f.op.trim().toLowerCase();
      if (!b.upOperators.some((o) => o.name.toLowerCase().includes(kw))) return false;
    }
    return true;
  });

  const { key, dir } = sort;
  const mul = dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    let va;
    let vb;
    if (key === 'type') { va = TYPE_LABEL[a.type]; vb = TYPE_LABEL[b.type]; }
    else if (key === 'cat') { va = categories[a.type]; vb = categories[b.type]; }
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

/** 统计表：点击表头后的下一个排序状态（默认升序） */
export function nextStatSort(current, key) {
  if (current && current.key === key) {
    return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key, dir: 'asc' };
}

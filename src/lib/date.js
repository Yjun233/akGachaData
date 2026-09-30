/**
 * 日期工具。
 * 全部按「纯日期字符串」(YYYY-MM-DD) 比较，用 UTC 计算避免时区导致差一天。
 */

/** 'YYYY-MM-DD' → 当天 00:00 的 UTC 毫秒数 */
export function toUTC(d) {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, dd);
}

/** b 距 a 的天数（a - b），正数表示 a 晚于 b */
export function diffDays(a, b) {
  return Math.round((toUTC(a) - toUTC(b)) / 86400000);
}

/** 本地时区的今天，YYYY-MM-DD */
export function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 区间判断（闭区间） */
export function inRange(date, start, end) {
  return start <= date && date <= end;
}

/**
 * 日期加减年数（n 可为负）。
 * 2 月 29 日遇到非闰年会退到 2 月 28 日。
 */
export function shiftYears(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const ny = y + n;
  /* 该年该月的天数（Date.UTC(y, m, 0) 即「下个月的第 0 天」= 本月最后一天） */
  const lastDay = new Date(Date.UTC(ny, m, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  const p = (x) => String(x).padStart(2, '0');
  return `${ny}-${p(m)}-${p(nd)}`;
}

/** 日期加减天数（n 可为负） */
export function shiftDays(date, n) {
  const d = new Date(toUTC(date) + n * 86400000);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * 保证日期区间「开始 < 结束」。
 *
 * 采用**强制修正**而不是报错：以用户刚确认的那一端为准，把另一端推到与它相距 1 天。
 * 例如已经填了「结束 ≤ 2025-01-01」，又确认「开始 ≥ 2026-01-01」，
 * 结束日期会被自动改成 2026-01-02。
 *
 * @param {string} from 开始日期（'' = 不限制）
 * @param {string} to   结束日期（'' = 不限制）
 * @param {'from'|'to'} confirmed 本次确认的是哪一端
 * @returns {{from:string,to:string,pushed:'from'|'to'|null}} pushed = 被自动挪动的那一端
 */
export function enforceRangeOrder(from, to, confirmed) {
  if (!from || !to || from < to) return { from, to, pushed: null };
  if (confirmed === 'from') return { from, to: shiftDays(from, 1), pushed: 'to' };
  return { from: shiftDays(to, -1), to, pushed: 'from' };
}

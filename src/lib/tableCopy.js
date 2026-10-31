/**
 * 表格「复制」的数据层 —— 把**页面上那一张表**整理成「二维数组（第一行是表头）」，
 * 交给 `components/CopyButton.vue` → `lib/clipboard.js` 的 `toTSV` → 粘进 Excel 就是一张表。
 *
 * 为什么单独一个文件、而不是让 `StatTable.vue` 自己算：
 * **按钮挂在表格标题那一行**（统计页 `Views/StatsView.vue` 的 `.sec-title`、
 * 表格版 `Views/FirstUpTableView.vue` 的 `.grp-sep`），而标题是视图层渲染的 ——
 * 数据与按钮必须在同一层，所以「怎么拼这张表」抽到这里，两边共用同一套口径。
 *
 * 两条铁律（改的时候别破）：
 *   · **照显示口径**：缺数据输出 `—`、进行中输出 `进行中`，**不**换算成排序用的 0 / -1；
 *   · **不读 DOM**：图片模式下表格里只有头像、没有干员名，读 DOM 会丢掉整列干员。
 */
import { viewEndInfo } from './stats.js';

/** 缺数据的占位（与表格里的 `.dash` 一致） */
const DASH = '—';

/** 距今天数：与 `StatTable.vue` 模板同口径（进行中 → 「进行中」，没有数据 → —） */
const daysText = (info) => (info.live ? '进行中' : (info.days === null ? DASH : info.days));

/**
 * 出率提升记录（统计页）的一张表。
 *
 * ⚠️ 两层表头并成**一行**：`出率提升 结束时间` 这种「组名 + 列名」。
 *    否则粘到 Excel 里是一行空表头 + 一行真表头，AutoFilter 不好用。
 *
 * @param {Array<object>} rows 该表的行（**已按当前排序排好** —— 复制的是屏幕上那个顺序）
 * ⚠️ 「结束时间 / 距今天数」走 `viewEndInfo()` —— 与表格同一个口径，
 *    所以**「中坚寻访只看中坚」勾上时，复制出来的也是那套值**（`midOnly` 由视图层传进来）。
 *
 * @param {{split?:boolean, refDate:string, midOnly?:boolean, noStd?:boolean}} opts
 *        `split` = 中坚表（默认多「总次数 / 中坚次数 / 标准次数」三列）；`refDate` = 参考日期；
 *        `midOnly` = 右栏「中坚寻访只看中坚」；
 *        `noStd` = 右栏「中坚寻访不看标准次数」（仅 `split` 下有意义）——
 *                  **复制的列必须与屏幕一致**，所以勾上后中坚表也只留「中坚次数」一列
 * @returns {Array<Array<string|number>>} 第一行是表头
 */
export function statCopyRows(rows, { split = false, refDate, midOnly = false, noStd = false } = {}) {
  const counts = split
    ? (noStd ? ['中坚次数'] : ['总次数', '中坚次数', '标准次数'])
    : ['次数'];
  const group = (name) => [
    `${name} 结束时间`, `${name} 距今天数`, ...counts.map((c) => `${name} ${c}`),
  ];
  const head = ['实装时间', '干员', ...group('出率提升'), ...group('商店兑换')];
  const body = (rows || []).map((r) => {
    const up = viewEndInfo(r, 'up', refDate, midOnly);
    const shop = viewEndInfo(r, 'shop', refDate, midOnly);
    /* 次数与 `counts` 一一对应：默认 [总, 中坚, 标准]、藏标准后只剩 [中坚] */
    const upCounts = split ? (noStd ? [r.upMid.length] : [r.upAll.length, r.upMid.length, r.upStd.length])
      : [r.upAll.length];
    const shopCounts = split ? (noStd ? [r.shopMid.length] : [r.shopAll.length, r.shopMid.length, r.shopStd.length])
      : [r.shopAll.length];
    return [
      r.releaseDate || DASH,
      r.name,
      up.end || DASH, daysText(up), ...upCounts,
      shop.end || DASH, daysText(shop), ...shopCounts,
    ];
  });
  return [head, ...body];
}

/**
 * 首次UP间隔 · 表格版 的一个分节。
 *
 * @param {Array<object>} rows 该分节的行（行序 = 图表的点序）
 * @param {{word?:string}} opts `word` = 「进店」/「轮换」，跟统计模式走（表头用）
 * @returns {Array<Array<string|number>>} 第一行是表头
 */
export function firstUpCopyRows(rows, { word = '进店', mid = false, lastStdWord = '进店' } = {}) {
  /* ⚠️ 中坚模式（2026-11-01）下第一列与「距…」列的基准都换成「最后标准露面日」，
     列头必须跟着变 —— 否则复制出去的表格会写着「实装日 / 距实装」而装的是另一套数。
     值统一取 `r.baseDate`（standard = 实装日，中坚 = lastStdDate），与屏幕一致。 */
  const head = [
    mid ? '最后标准日' : '实装日',
    '干员', `首次${word}日`, '所在卡池', '距上行',
    mid ? `距最后标准${lastStdWord}` : '距实装',
    '累计数',
  ];
  const body = (rows || []).map((r) => [
    /* ⚠️ 别统一读 `baseDate` —— 手工构造的夹具行可能没有这个字段（老结构只有 releaseDate）。
       按类型各取各的，语义也更清楚：中坚模式没有标准记录就该是 —，而不是退回实装日。 */
    (mid ? r.lastStdDate : r.releaseDate) || DASH,
    r.name,
    r.firstDate,
    r.firstBanner || DASH,
    r.gap === null ? DASH : r.gap,
    r.sinceRelease === null ? DASH : r.sinceRelease,
    r.count,
  ]);
  return [head, ...body];
}

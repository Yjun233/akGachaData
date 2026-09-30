/**
 * 数据层一致性核对：用 Vue 版数据层（src/lib）重算统计，与原型预渲染出来的
 * prototype/index.html 里的表格**逐个单元格**对比。
 *
 * 用途：迁移期间确认「口径没有在搬运过程中走样」，也作为后续改数据层的回归测试。
 * 用法：node scripts/verify-data.mjs          （先跑 pnpm build:prototype 生成原型）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeStats, endInfo, sortStatRows } from '../src/lib/stats.js';
import { computeFirstShop } from '../src/lib/firstShop.js';
import { computeUpHistory } from '../src/lib/upHistory.js';
import {
  buildUpTimeline, monthIndexOf, monthLabel, monthStartDate, minInnerWidth, chartHeight, TL,
} from '../src/lib/upTimeline.js';
import { bannerRows, emptyFilters } from '../src/lib/banners.js';
import { diffDays, shiftYears, shiftDays, enforceRangeOrder } from '../src/lib/date.js';
import { BANNER_CATEGORIES, TYPE_LABEL } from '../src/lib/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* 数据与头像的真身在**独立资源仓库** ../akGachaResource；
   站点里的 public/data 只是指向它的目录联接（junction）。这里直接读真身，
   免得 junction 缺失时脚本报出莫名其妙的「文件不存在」。 */
const RES_DIR = path.resolve(ROOT, '..', 'akGachaResource', 'data');
if (!fs.existsSync(RES_DIR)) {
  console.error(`找不到资源仓库 ${RES_DIR}\n请先确认 ../akGachaResource 存在（数据与头像都在那里）。`);
  process.exit(1);
}
const read = (p) => JSON.parse(fs.readFileSync(path.join(RES_DIR, p), 'utf8'));

const meta = read('metadata.json');
const rawOperators = read('operators.json');
/* type → 大类已移入 src/lib/constants.js（BANNER_CATEGORIES），不再读 JSON 数据文件 */
const categories = BANNER_CATEGORIES;
const bannerMap = read('banners_sc.json');

/* 与 src/lib/loadData.js 保持一致：operators.json 以 charId 为键，前端按 name 索引 */
const operators = {};
for (const op of Object.values(rawOperators)) operators[op.name] = op;

const banners = Object.keys(bannerMap).map((id) => ({ id, ...bannerMap[id] }));
const operatorIndex = {};
for (const name of Object.keys(operators)) {
  operatorIndex[name] = { rarity: operators[name].rarity, isLimited: operators[name].isLimited };
}
const relDateOf = (op) => (op ? op.scReleaseDate || null : null);

const refDate = meta.generatedAt;
const { visible, map } = computeStats({
  banners, categories, operatorByName: operators, operatorIndex, refDate, relDateOf,
});
const rows = Object.values(map);

const results = [];
const check = (label, actual, expected) => {
  results.push({ ok: String(actual) === String(expected), label, actual, expected });
};

// ---- 站点级 ----
check('干员总数', Object.keys(operators).length, meta.operatorCount);
check('卡池总数', banners.length, meta.servers.find((s) => s.id === 'sc').bannerCount);
check('参与统计干员数', rows.length, 204);

// ---- 卡池类型：限定寻访已拆成 庆典 / 春节 / 夏季 ----
const typeCount = {};
for (const b of banners) typeCount[b.type] = (typeCount[b.type] || 0) + 1;
check('限定寻访·庆典（limcel）卡池数', typeCount.limcel, 13);
check('限定寻访·春节（limspr）卡池数', typeCount.limspr, 8);
check('限定寻访·夏季（limsum）卡池数', typeCount.limsum, 6);
check('不再有笼统的 limited 类型', typeCount.limited || 0, 0);
check('每个 type 都在 BANNER_CATEGORIES 里有大类',
  banners.every((b) => Boolean(categories[b.type])), true);
check('三个限定子类的大类都是「限定寻访」',
  ['limcel', 'limspr', 'limsum'].every((t) => categories[t] === '限定寻访'), true);
check('TYPE_LABEL 覆盖所有出现的 type',
  banners.every((b) => Boolean(TYPE_LABEL[b.type])), true);

// ---- 口径 ----
check('商店兑换 ⊆ 出率提升（每一行都成立）',
  rows.every((r) => r.shopAll.every((b) => r.upAll.includes(b))), true);
check('总次数 = 中坚次数 + 标准次数',
  rows.every((r) => r.upAll.length === r.upMid.length + r.upStd.length), true);
check('限定干员已排除', rows.every((r) => !r.upAll.some((b) => b.upOperators.find((o) => o.name === r.name && o.isLimited))), true);

const wz = map['推进之王'];
check('推进之王 · 出率提升次数', wz?.upAll.length, 21);
check('推进之王 · 商店兑换次数', wz?.shopAll.length, 10);

// ---- 卡池列表 ----
const all = bannerRows(banners, emptyFilters(), categories, { key: 'startDate', dir: 'desc' });
check('卡池列表默认按开始日期倒序',
  all.every((b, i) => i === 0 || all[i - 1].startDate >= b.startDate), true);
check('默认筛选命中全部卡池', all.length, banners.length);

/* ---------------- 首次进店间隔 ---------------- */
const firstShop = computeFirstShop({ banners, operatorByName: operators, relDateOf });

check('有首次进店记录的干员数', firstShop.rows.length, 160);
check('其中六星 / 五星', `${firstShop.six.length}/${firstShop.five.length}`, '69/91');

/* 间隔必须在**同星级内部**比较（早期版本混排，算出了跨星级的假间隔） */
for (const [label, list, rarity] of [['六星', firstShop.six, 6], ['五星', firstShop.five, 5]]) {
  check(`${label}：组内只含 ${rarity} 星`, list.every((r) => r.rarity === rarity), true);
  check(`${label}：组内按首次进店日期升序`,
    list.every((r, i) => i === 0 || list[i - 1].firstDate <= r.firstDate), true);
  check(`${label}：组内首位没有前序间隔`, list[0]?.gap === null, true);
  check(`${label}：其余位置 gap 均 ≥ 0`, list.slice(1).every((r) => r.gap >= 0), true);
  check(`${label}：每点的前一位就是同星级的前一个干员`,
    list.slice(1).every((r, i) => r.prevName === list[i].name), true);
  check(`${label}：间隔总和 = 末位与首位首次进店日之差`,
    list.slice(1).reduce((a, r) => a + r.gap, 0),
    diffDays(list[list.length - 1].firstDate, list[0].firstDate));
}

check('只含 5 / 6 星非限定干员',
  firstShop.rows.every((r) => (r.rarity === 5 || r.rarity === 6) && !operators[r.name]?.isLimited), true);
check('六星序列首位是最早的六星首次进店日', firstShop.six[0]?.firstDate, '2019-04-30');
check('bounds.min 取全部干员的最早进店日', firstShop.bounds.min, '2019-04-30');

/* 回归：用户报过的例子 —— 六星「夜莺」的前一位不该是五星「德克萨斯」 */
const nightingale = firstShop.six.find((r) => r.name === '夜莺');
check('夜莺的前一位是六星（不是五星德克萨斯）',
  nightingale ? firstShop.six.some((r) => r.name === nightingale.prevName) : true, true);

/* 时间范围：按首次进店日期筛，区间内重新算间隔 */
const ranged = computeFirstShop({
  banners, operatorByName: operators, relDateOf, from: '2024-01-01', to: '2026-12-31',
});
check('筛选后六星首条 ≥ from', ranged.six[0]?.firstDate >= '2024-01-01', true);
check('筛选后六星末条 ≤ to', ranged.six[ranged.six.length - 1]?.firstDate <= '2026-12-31', true);
check('筛选后条数少于全量', ranged.rows.length < firstShop.rows.length, true);
check('筛选后组内首位仍为 null', ranged.six[0]?.gap === null, true);
check('筛选后每点前一位仍是同星级序列中的前一个',
  ranged.six.slice(1).every((r, i) => r.prevName === ranged.six[i].name), true);
check('筛选不影响 bounds（日期输入上下限用）',
  JSON.stringify(ranged.bounds), JSON.stringify(firstShop.bounds));

/* 口径切换：横轴按实装日期 / 纵轴距实装日 */
check('默认口径：value 就是 gap', firstShop.six.every((r) => r.value === r.gap), true);
check('默认口径：轴标签 = 首次进店日期', firstShop.six.every((r) => r.xLabel === r.firstDate), true);
check('默认口径：axis / metric 回传正确', `${firstShop.axis}/${firstShop.metric}`, 'firstShop/gap');

const byRelease = computeFirstShop({ banners, operatorByName: operators, relDateOf, axis: 'release' });
check('横轴=实装日期：组内按实装日升序',
  byRelease.six.every((r, i) => i === 0
    || (byRelease.six[i - 1].releaseDate || '9999') <= (byRelease.six[i].releaseDate || '9999')), true);
check('横轴=实装日期：轴标签改用实装日期',
  byRelease.six.every((r) => r.xLabel === (r.releaseDate || '—')), true);
check('横轴=实装日期：会出现负间隔（更晚实装却更早进店）',
  [...byRelease.six, ...byRelease.five].some((r) => typeof r.gap === 'number' && r.gap < 0), true);

const bySince = computeFirstShop({ banners, operatorByName: operators, relDateOf, metric: 'sinceRelease' });
check('纵轴=距实装：value = 首次进店日 − 实装日',
  bySince.six.every((r) => r.value === diffDays(r.firstDate, r.releaseDate)), true);
check('纵轴=距实装：序列首位也有值（不再是 null）', typeof bySince.six[0]?.value, 'number');
check('纵轴=距实装：最大跨度超过 800 天',
  Math.max(...bySince.six.concat(bySince.five).map((r) => r.value)) > 800, true);

/* 日期工具：近 N 年用（shiftYears） */
check('shiftYears：2026-09-29 往前 3 年', shiftYears('2026-09-29', -3), '2023-09-29');
check('shiftYears：闰日 2024-02-29 往前 1 年退到 2-28', shiftYears('2024-02-29', -1), '2023-02-28');
check('shiftYears：1 月 31 日不受月长影响', shiftYears('2026-01-31', 1), '2027-01-31');
check('shiftYears：往前 1 年再往后 1 年回到原值', shiftYears(shiftYears('2026-09-29', -5), 5), '2026-09-29');

/* 日期区间约束：冲突时强制修正另一端（用户要求，不再报错） */
check('shiftDays：跨月', shiftDays('2024-02-28', 2), '2024-03-01');
check('区间不冲突时原样返回',
  JSON.stringify(enforceRangeOrder('2024-01-01', '2026-01-01', 'from')),
  JSON.stringify({ from: '2024-01-01', to: '2026-01-01', pushed: null }));
check('确认起始端时，结束端被推到 +1 天',
  JSON.stringify(enforceRangeOrder('2026-01-01', '2025-01-01', 'from')),
  JSON.stringify({ from: '2026-01-01', to: '2026-01-02', pushed: 'to' }));
check('确认结束端时，起始端被推到 −1 天',
  JSON.stringify(enforceRangeOrder('2026-01-01', '2025-01-01', 'to')),
  JSON.stringify({ from: '2024-12-31', to: '2025-01-01', pushed: 'from' }));
check('两端同一天也视为冲突',
  enforceRangeOrder('2025-06-01', '2025-06-01', 'from').pushed, 'to');
check('缺一端时不修正',
  enforceRangeOrder('2026-01-01', '', 'from').pushed, null);
check('修正后必然满足 开始 < 结束',
  (() => {
    const r = enforceRangeOrder('2026-01-01', '2025-01-01', 'from');
    return r.from < r.to;
  })(), true);

/* ---------------- UP 历史一览 ---------------- */
const upAll = computeUpHistory({ banners, categories, operatorByName: operators, relDateOf });
check('UP 历史：六星 / 五星干员数', `${upAll.six.length}/${upAll.five.length}`, '92/112');
check('UP 历史：已排除限定干员（合计 = 全部 5/6 星 − 26 位限定）', upAll.all.length, 204);
check('UP 历史：不含任何限定干员',
  upAll.all.every((r) => !operators[r.name]?.isLimited), true);
/* 标记总数改成**独立算一遍**：把每个卡池里 5/6★ 且非限定的 UP 干员数加起来。
   （原来写死 2495，一更新数据就红；独立算法还能顺带核对 computeUpHistory 没漏没重。） */
const expectedMarks = banners.reduce((n, b) => n
  + b.upOperators.filter((o) => !o.isLimited && (o.rarity || 0) >= 5).length, 0);
check('UP 历史：标记总数 = 各卡池 UP 干员数之和',
  upAll.all.reduce((a, r) => a + r.count, 0), expectedMarks);
check('UP 历史：每位干员的标记按日期升序',
  upAll.all.every((r) => r.marks.every((m, i) => i === 0 || r.marks[i - 1].date <= m.date)), true);
check('UP 历史：lastDate = 最后一个标记的日期',
  upAll.all.every((r) => r.lastDate === r.marks[r.marks.length - 1].date), true);
check('UP 历史：count = 标记数', upAll.all.every((r) => r.count === r.marks.length), true);
check('UP 历史：默认按实装日升序',
  upAll.all.every((r, i) => i === 0
    || (upAll.all[i - 1].releaseDate || '9999') <= (r.releaseDate || '9999')), true);
check('UP 历史：条形起点（实装日）都有值', upAll.all.every((r) => !!r.releaseDate), true);

const upShop = computeUpHistory({
  banners, categories, operatorByName: operators, relDateOf, shopOnly: true,
});
check('UP 历史：只看进店时全部标记都是进店',
  upShop.all.every((r) => r.marks.every((m) => m.isShop)), true);
check('UP 历史：只看进店的干员数', upShop.all.length, 160);
check('UP 历史：只看进店的标记数', upShop.all.reduce((a, r) => a + r.count, 0), 536);

const upStd = computeUpHistory({
  banners, categories, operatorByName: operators, relDateOf, types: ['double'],
});
check('UP 历史：按类型筛选后只含该类型',
  upStd.all.every((r) => r.marks.every((m) => m.type === 'double')), true);
check('UP 历史：只选 double 的干员 / 标记数',
  `${upStd.all.length}/${upStd.all.reduce((a, r) => a + r.count, 0)}`, '187/970');

const upSort = computeUpHistory({
  banners, categories, operatorByName: operators, relDateOf, sort: 'lastUp-desc',
});
check('UP 历史：最近 UP 降序',
  upSort.all.every((r, i) => i === 0 || upSort.all[i - 1].lastDate >= r.lastDate), true);
check('UP 历史：没有标记的干员不占行（只看进店时排除了未进店的）',
  upShop.all.every((r) => r.marks.length > 0), true);

/* ---------------- UP 历史时间轴的坐标口径（月序号 value 轴） ---------------- */
check('月序号：1970-01-01 = 0', monthIndexOf('1970-01-01'), 0);
check('月序号：2026-01-01', monthIndexOf('2026-01-01'), 672);
check('月序号：相邻两个月相差 1', monthIndexOf('2026-02-01') - monthIndexOf('2026-01-01'), 1);
check('月序号：月内按天线性分摊（1-10 在 1-01 与 2-01 之间）',
  monthIndexOf('2026-01-10') > 672 && monthIndexOf('2026-01-10') < 673, true);
check('月标签格式：2026-01', monthLabel(672), '2026-01');
check('月标签格式：跨年 2026-12 → 2027-01', `${monthLabel(683)}/${monthLabel(684)}`, '2026-12/2027-01');
check('月标签格式：个位月份补零', monthLabel(591), '2019-04');

const tlFull = buildUpTimeline({ rows: upAll.six, operatorByName: operators });
check('时间轴：起点对齐到月初（整数月序号）', Number.isInteger(tlFull.xMin), true);
check('时间轴：起点就是最早的实装月（2019-04）', monthLabel(tlFull.xMin), '2019-04');
check('时间轴：跨度覆盖全部数据（≥ 89 个月）', tlFull.monthCount >= 89, true);
check('时间轴：范围外的标记被剔除（不超过全部标记数）',
  tlFull.markCount <= upAll.six.reduce((a, r) => a + r.count, 0), true);
check('时间轴：有横条也有标记（两个 custom 系列）',
  tlFull.bodyOption.series.length === 2 && tlFull.bodyOption.series.every((s) => s.type === 'custom'), true);
check('时间轴：横轴刻度间隔 = 1 个月（每月 1 号）',
  tlFull.axisOption.xAxis.interval === 1 && tlFull.bodyOption.xAxis.interval === 1, true);
/* 刻度条不再用 echarts 的坐标轴，改成 custom 自绘（见 upTimeline 的注释：
   给 axisLabel 设 rotate 会让 echarts 把绘图区往里缩 13px，导致与表体对不齐）。
   所以这里断言「自绘的刻度数据 = 每月一个」而不是 axisLabel.formatter。 */
check('时间轴：刻度条自绘每个月一个刻度（91 个月）',
  tlFull.axisOption.series[0].data.length, tlFull.monthCount + 1);
/* ⚠️ 不能用 `xAxis.show:false` —— 那会把 splitLine 一起关掉（表体就一条竖线都没有了）。
   必须逐项隐藏 axisLine/axisTick/axisLabel，并显式控制 splitLine。 */
check('时间轴：刻度条不画 echarts 自己的轴与线（全部逐项关闭）',
  tlFull.axisOption.xAxis.axisLine.show === false
  && tlFull.axisOption.xAxis.axisTick.show === false
  && tlFull.axisOption.xAxis.axisLabel.show === false
  && tlFull.axisOption.xAxis.splitLine.show === false, true);
check('时间轴：表体保留每月一条竖线（splitLine 开着、轴向三件套关着）',
  tlFull.bodyOption.xAxis.splitLine.show === true
  && tlFull.bodyOption.xAxis.axisLine.show === false
  && tlFull.bodyOption.xAxis.axisTick.show === false
  && tlFull.bodyOption.xAxis.axisLabel.show === false, true);
check('时间轴：刻度条与表体的竖线颜色一致（接起来看不出断口）',
  tlFull.axisOption.xAxis.splitLine.show === false
  && tlFull.bodyOption.xAxis.splitLine.lineStyle.color === TL.lineColor, true);
check('时间轴：标签旋转角度为正值（负值会让文字往右下压住竖线）',
  TL.labelRotate > 0, true);
check('时间轴：刻度数据就是月序号（首 = xMin）',
  tlFull.axisOption.series[0].data[0], tlFull.xMin);
check('时间轴：纵轴不再画名字（由左侧固定列显示）',
  tlFull.bodyOption.yAxis.axisLabel.show, false);
check('时间轴：主体高度 = 行数 × 行高 + 留白',
  chartHeight(upAll.six), upAll.six.length * TL.rowH + TL.gridTop + TL.gridBottom);

const tlRange = buildUpTimeline({
  rows: upAll.six, xRange: { from: '2024-01-01', to: '2026-09-30' }, operatorByName: operators,
});
check('时间轴：设时间范围后从 2024-01 起', monthLabel(tlRange.xMin), '2024-01');
check('时间轴：设时间范围后月数明显变少', tlRange.monthCount < tlFull.monthCount / 2, true);
check('时间轴：设时间范围后标记也被裁掉（只留范围内的）',
  tlRange.markCount < tlFull.markCount, true);
check('最小宽度：随跨度缩放（范围越窄越窄）',
  minInnerWidth(tlRange.xMin, tlRange.xMax) < minInnerWidth(tlFull.xMin, tlFull.xMax), true);
/* 口径是「1 天 = 1px」（用户指定，不管标签会不会重叠） */
check('最小宽度 = 名字列 + 天数×1px + 左右内缩',
  minInnerWidth(tlFull.xMin, tlFull.xMax),
  TL.nameW + TL.padLeft + TL.padRight
    + diffDays(monthStartDate(tlFull.xMax), monthStartDate(tlFull.xMin)) * TL.dayPx);
check('最小宽度口径：1 天 1px', TL.dayPx, 1);
check('最小宽度 ≈ 全范围天数（2019-04-01 → 2026-10-01，2740 天左右）',
  minInnerWidth(tlFull.xMin, tlFull.xMax) > 2700
  && minInnerWidth(tlFull.xMin, tlFull.xMax) < 2900, true);
check('横轴标签斜排（与首次进店间隔一致的 60°，自绘时用 TL.labelRotate）',
  TL.labelRotate, 60);
/* 刻度条与表体必须共用同一份 grid 与同一套 scale —— 这是「竖线对齐」的根据 */
check('刻度条与表体的 grid 左右内缩一致',
  `${tlFull.axisOption.grid.left}/${tlFull.axisOption.grid.right}`
  === `${tlFull.bodyOption.grid.left}/${tlFull.bodyOption.grid.right}`, true);
check('刻度条与表体的 x 轴范围一致',
  `${tlFull.axisOption.xAxis.min}-${tlFull.axisOption.xAxis.max}`
  === `${tlFull.bodyOption.xAxis.min}-${tlFull.bodyOption.xAxis.max}`, true);

/* ---------------- 与原型逐格对比 ---------------- */
const protoPath = path.join(ROOT, 'prototype/index.html');
const hasProto = fs.existsSync(protoPath);
const protoHtml = hasProto ? fs.readFileSync(protoPath, 'utf8') : '';

const stripTags = (s) => s.replace(/<[^>]+>/g, '').trim();

/** 取某个分节标题之后第一张表的 tbody，返回每行的单元格文本数组 */
function parseStatTable(html, anchorId) {
  const start = html.indexOf(`id="${anchorId}"`);
  if (start < 0) return null;
  const t = html.indexOf('<tbody>', start);
  const e = html.indexOf('</tbody>', t);
  if (t < 0 || e < 0) return null;
  return html
    .slice(t + '<tbody>'.length, e)
    .split('<tr>')
    .slice(1)
    .map((tr) => [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1])));
}

/** 我这边同一格里应该显示的文本 */
const myEnd = (info) => info.end || '—';
const myDays = (info) => (info.live ? '进行中' : info.days === null ? '—' : String(info.days));

const TABLES = [
  { anchor: 's-6-std', rarity: 6, mid: false, split: false },
  { anchor: 's-6-mid', rarity: 6, mid: true, split: true },
  { anchor: 's-5-std', rarity: 5, mid: false, split: false },
  { anchor: 's-5-mid', rarity: 5, mid: true, split: true },
];

let cellDiff = 0;
let cellTotal = 0;
const diffs = [];

if (hasProto) {
  for (const t of TABLES) {
    const parsed = parseStatTable(protoHtml, t.anchor);
    const list = sortStatRows(
      rows.filter((r) => r.rarity === t.rarity && r.everMid === t.mid), null, refDate,
    );
    check(`表 ${t.anchor} 行数与原型一致`, list.length, parsed ? parsed.length : -1);

    const byName = Object.fromEntries(list.map((r) => [r.name, r]));
    for (const cells of parsed || []) {
      const name = cells[1];
      const r = byName[name];
      if (!r) { diffs.push(`${t.anchor} 原型多出干员「${name}」`); cellDiff += 1; continue; }
      const up = endInfo(r.upAll, refDate);
      const shop = endInfo(r.shopAll, refDate);
      const expected = [
        r.releaseDate || '—',
        name,
        myEnd(up), myDays(up), String(r.upAll.length),
        ...(t.split ? [String(r.upMid.length), String(r.upStd.length)] : []),
        myEnd(shop), myDays(shop), String(r.shopAll.length),
        ...(t.split ? [String(r.shopMid.length), String(r.shopStd.length)] : []),
      ];
      cells.forEach((v, i) => {
        cellTotal += 1;
        if (v !== expected[i]) {
          cellDiff += 1;
          if (diffs.length < 12) diffs.push(`${t.anchor} ${name} 第${i}格: 原型「${v}」≠ 计算「${expected[i]}」`);
        }
      });
    }
  }
  check('与原型逐格对比（差异数）', cellDiff, 0);
} else {
  console.log('（未找到 prototype/index.html，跳过逐格对比；先运行 pnpm build:prototype）');
}

// ---- 输出 ----
let bad = 0;
for (const r of results) {
  if (r.expected === null) { console.log(`· ${r.label}: ${r.actual}`); continue; }
  if (!r.ok) bad += 1;
  console.log(`${r.ok ? '✓' : '✗'} ${r.label}: ${r.actual}${r.ok ? '' : ` （期望 ${r.expected}）`}`);
}
if (diffs.length) {
  console.log('\n差异明细：');
  for (const d of diffs) console.log('  - ' + d);
}
console.log(
  hasProto
    ? `\n逐格核对：${cellTotal - cellDiff}/${cellTotal} 格一致`
    : '',
);
console.log(bad ? `\n✗ 有 ${bad} 项不一致` : '\n✓ 数据层核对通过');
process.exit(bad ? 1 : 0);

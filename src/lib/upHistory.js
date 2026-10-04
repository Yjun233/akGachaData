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
 * - `shopOnly`：只保留 `isShop` 的记录。
 *   ⚠️ 与 `types` **正交、可叠加**（2026-10-03 改）：以前右栏把两者做成互斥
 *   （勾了「只看进店」就禁用并清空类型筛选），但进店记录本身就只落在**常驻标准寻访**与
 *   **常驻中坚寻访**这两类池子里，按类型再收窄恰恰是有意义的。真正没意义的只是
 *   「选中一个不可能有进店记录的类型」（必然空图）→ 右栏把那几类置灰，判据见 `typesWithoutShop`。
 * - **在某筛选下没有任何记录的干员不占行**（否则勾「只看进店」会出现一排空行）
 * - `hideMid`（右栏勾选框）：隐藏**在「判据时点」已经属于中坚寻访**的干员 ——
 *   即该干员在当前服务器的「进入中坚寻访日期」≤ 判据时点。这类干员的常规轮换早就
 *   转去中坚池了，留在标准寻访的时间轴上只会干扰视线。
 *   判据时点 = `range.to`（右栏的**结束日期**），没设就按 `today`。
 * - `range`：时间范围。它**同时**决定横轴可视范围与「这位干员占不占行」——
 *   范围内一个标记都没有的干员默认不显示（`null` = 不做这层过滤，
 *   对应右栏的「显示范围内未 UP 干员」勾选框）。
 *   ⚠️ 2026-09-30 口径调整：以前时间范围只改横轴、纵轴始终保留全部干员。
 *
 * 标记上的 `skinRelated`（2026-10-04 新增）：这一期卡池的开放窗口与该干员某套皮肤的
 * 上架窗口**有重叠** → `true`（页面在头像左下角打深赭色正三角）。判定见 `skinOverlapsBanner`。
 */
import { diffDays } from './date.js';

/** 纵轴排序（右栏） */
const SORT_KEY = {
  release: (r) => r.releaseDate || '9999-12-31',
  lastUp: (r) => r.lastDate,
};

/** 两个**闭区间**日期段有没有共同的一天（都是 'YYYY-MM-DD'，可以直接比大小） */
const spansOverlap = (aStart, aEnd, bStart, bEnd) =>
  !!aStart && !!aEnd && !!bStart && !!bEnd && aStart <= bEnd && bStart <= aEnd;

/**
 * 该干员的皮肤里，有没有哪一套的**上架窗口与这个卡池重叠**。
 *
 * ⚠️ 口径（闭环）：卡池取 `[startDate, endDate]`、皮肤取每个 `onShelf` 的 `[start, end]`，
 *   **闭区间求交** —— 两个区间只要有共同的一天就算重叠。
 *   （卡池在站点别处的「进行中」用的是半开 `[开始日, 结束日)`，这里刻意没用它：
 *   「有没有关联」要的是宽松信号，边界那天差一天不值得纠结。）
 * ⚠️ `longTime` 的那几个窗口（常驻类，`end = start + 14` 是脚本**造出来的**）照常参与
 *   —— 用户定过「只为讨论与 UP 的关联性，这里数据不真实也无妨」。
 * ⚠️ 皮肤数据只有国服：切到国际服 / 繁中服时，这里按同一份国服皮肤表判（页面不区分服）。
 */
function skinOverlapsBanner(skins, start, end) {
  for (const s of skins || []) {
    for (const w of s.onShelf || []) {
      if (spansOverlap(w.start, w.end, start, end)) return true;
    }
  }
  return false;
}

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
 * @param {object} [ctx.skinsByOperator] 干员名 → 该干员的时装数组（skins.json；缺省=不做皮肤关联判定）
 * @param {(op:object)=>string|null} ctx.relDateOf 取当前服务器实装日
 * @param {string[]|null} [ctx.types]  只保留这些卡池类型
 * @param {boolean} [ctx.shopOnly]     只保留进店记录
 * @param {(op:object)=>string|null} [ctx.classicDateOf] 取当前服务器「进入中坚寻访」的日期
 * @param {string}  [ctx.today]        真实当天（`range.to` 为空时当判据时点）
 * @param {boolean} [ctx.hideMid]      隐藏「判据时点已属中坚寻访」的干员
 * @param {{from?:string,to?:string}|null} [ctx.range] 横轴可视范围；给了就**同时**
 *        决定「这位干员占不占行」—— 范围内一个标记都没有的不占行（见下）
 * @param {string}  [ctx.sort]         release-asc / release-desc / lastUp-asc / lastUp-desc
 */
export function computeUpHistory({
  banners,
  categories,
  operatorByName,
  skinsByOperator = {},
  relDateOf,
  classicDateOf = null,
  today = '',
  hideMid = false,
  types = null,
  shopOnly = false,
  range = null,
  sort = 'release-asc',
}) {
  const typeSet = types && types.length ? new Set(types) : null;
  /* 「已属中坚」的判据时点：优先右栏的结束日期，没设就按今天 */
  const midCutoff = hideMid ? ((range && range.to) || today || '') : '';

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
        /* 这一期卡池与该干员的皮肤上架窗口有重叠（页面在头像左下角打深赭色正三角） */
        skinRelated: skinOverlapsBanner(skinsByOperator[op.name], b.startDate, b.endDate),
      });
    }
  }

  /* 2) 逐位干员应用筛选、算起止日期 */
  const rows = [];
  for (const r of Object.values(byOp)) {
    const op = operatorByName[r.name];

    /* 限定干员整行排除（见文件头的口径说明） */
    if (op?.isLimited) continue;

    /* 「判据时点已属中坚寻访」→ 整行隐藏（右栏勾选框） */
    if (midCutoff && classicDateOf) {
      const mid = classicDateOf(op);
      if (mid && mid <= midCutoff) continue;
    }

    r.marks.sort((a, b) => (a.date === b.date
      ? a.bannerId.localeCompare(b.bannerId)
      : (a.date < b.date ? -1 : 1)));

    const marks = r.marks.filter((m) => (!typeSet || typeSet.has(m.type))
      && (!shopOnly || m.isShop));
    if (!marks.length) continue; // 该筛选下没有任何记录 → 不占行

    /* 时间范围**也要**参与「这位干员占不占行」：
       可视范围内一个标记都没有的话，画出来只剩一根横条（甚至整条都在范围外），
       既没有信息量又白占一行。（2026-09-30 口径调整：以前时间范围只改横轴、纵轴保留全部干员。） */
    if (range && (range.from || range.to)) {
      const visible = marks.some((m) => (!range.from || m.date >= range.from)
        && (!range.to || m.date <= range.to));
      if (!visible) continue;
    }

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

/**
 * 当前数据里**不可能有进店记录**的卡池类型（`allTypes` 传类型全集）。
 *
 * 用途：勾了「只看进店」时，右栏不再禁用整个类型筛选，而是只把这类类型置灰
 * （选中它们必然一张空图）。实测国服只有 `double`（常驻标准寻访）与 `classic`（常驻中坚寻访）
 * 带进店标记，所以那两类保持可选。
 *
 * ⚠️ 判据只看**数据本身**（该类型下有没有 ≥5★ 且 `isShop` 的 UP 记录），不掺当前视图的筛选 ——
 *   否则会变成「改 A 筛选顺手把 B 筛选的可用性改掉」，那种联动没道理也难排查。
 * ⚠️ rarity 门槛与 computeUpHistory 保持一致（它只收 ≥5★ 的记录），
 *   免得「置灰判定说有、实际画不出来」。
 */
export function typesWithoutShop(banners, allTypes) {
  return (allTypes || []).filter((t) => !banners.some((b) => b.type === t
    && b.upOperators.some((o) => o.isShop && (o.rarity || 0) >= 5)));
}

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
 * 标记上的三个「时间重合」布尔（都在头像左下角的三角上体现，见 lib/upTimeline.js）：
 * - `skinRelated`：卡池窗口 ∩ 某套皮肤的**上架窗口**（区间 ∩ 区间）
 * - `memoirRelated` / `moduleRelated`：某条密录 / 模组的**推出日**落在卡池窗口内（点 ∈ 区间）
 *
 * ⚠️ **「干员实装那次」不标三角**（用户 2026-10-08 定）：判定条件是
 *   「**该标记的卡池开始日 == 该干员在当前服务器的实装日**」（严格相等，不是「首条标记」）。
 *   依据：新干员实装时**必然**带着自己的伴生时装上架（模组 / 密录也常在同期开），
 *   那个三角恒亮、没有任何信息量，反而把真正有意义的「后续复刻期又有皮肤」淹掉了。
 *   ⚠️ 用**日期相等**而不是「marks[0]」：开服那批干员（实装日 2019-04-30）的首次 UP
 *   在 5 月之后，那是他们的**第一次轮换**、不是实装 —— 那一条的三角是有意义的，得留着。
 *   ⚠️ 只压**三角**（这三个布尔），不影响进店绿点 / 中坚甄选菱形，也不影响 tooltip 里
 *   「实装 xxx · 第 n/m 次 UP」那行（那行照旧显示）。实装日拿不到（`relDateOf` 返回 null）时
 *   不做这层压制 —— 与「三份 extras 都不传就一个都不标」的降级是同一种思路。
 *
 * ⚠️ **三个判定三服都做**（2026-10-06 起）：extras 已**按服分文件**（`skins_<srv>.json` 等），
 *   调用方传进来的就是当前服那一份 → 本函数不再需要知道服务器（此前那层
 *   「只有国服才判」的门控已随数据补齐而删除，见资源仓库）。
 *   ⚠️ 但两服的**皮肤窗口精度不同**：国服来自 PRTS、是真实的上架 / 复刻窗口；
 *   en / tc 来自官方解包，官方只有「首发上架日」→ 产出时就写成 `[首发日, 首发日 + 14]`
 *   （见资源仓库 `scripts/lib/gamedata-extras.mjs`，用户 2026-10-06 定）。
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

/** 单个日期有没有落在某个闭区间内 */
const dateInSpan = (d, start, end) => !!d && !!start && !!end && start <= d && d <= end;

/**
 * 该干员的皮肤里，有没有哪一套的**上架窗口与这个卡池重叠**。
 *
 * ⚠️ 口径（闭环）：卡池取 `[startDate, endDate]`、皮肤取每个 `onShelf` 的 `[start, end]`，
 *   **闭区间求交** —— 两个区间只要有共同的一天就算重叠。
 *   （卡池在站点别处的「进行中」用的是半开 `[开始日, 结束日)`，这里刻意没用它：
 *   「有没有关联」要的是宽松信号，边界那天差一天不值得纠结。）
 * ⚠️ `longTime` 的那几个窗口（常驻类，`end = start + 14` 是脚本**造出来的**）照常参与
 *   —— 用户定过「只为讨论与 UP 的关联性，这里数据不真实也无妨」。
 * ⚠️ 这三份数据现在是**按服**传来的（`skins_<srv>.json` / `memoirs_<srv>.json` /
 *   `modules_<srv>.json`）—— 三服都有，所以**不再按服门控**；某服缺文件时调用方给的就是空表，
 *   判定自然为 false。
 */
function skinOverlapsBanner(skins, start, end) {
  for (const s of skins || []) {
    for (const w of s.onShelf || []) {
      if (spansOverlap(w.start, w.end, start, end)) return true;
    }
  }
  return false;
}

/**
 * 该干员的密录 / 模组里，有没有哪一条的**推出日落在卡池窗口内**（用户 2026-10-05 追加）。
 *
 * ⚠️ 与皮肤不同，密录 / 模组的日期是**单日**（推出日），不是窗口 → 判据是「点 ∈ 区间」。
 * ⚠️ 同样是国服数据 → 门控同上（见 `skinOverlapsBanner` 的说明）。
 */
const anyDateInBanner = (dates, start, end) =>
  (dates || []).some((d) => dateInSpan(d, start, end));

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
 * @param {object} [ctx.skinsByOperator] 干员名 → 该干员的时装数组（`skins_<srv>.json`；缺省=不做皮肤关联判定）
 * @param {object} [ctx.memoirsByOperator] 干员名 → 该干员密录的**推出日期数组**（`memoirs_<srv>.json`）
 * @param {object} [ctx.modulesByOperator] 干员名 → 该干员模组的**推出日期数组**（`modules_<srv>.json`）
 * @param {(op:object)=>string|null} [ctx.relDateOf] 取当前服务器实装日；**可选**，缺省（null）
 *        时 `releaseDate` 一律为 null、且不做「实装那次不标三角」的压制
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
  memoirsByOperator = {},
  modulesByOperator = {},
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
      /* 「实装那次」—— 该次卡池开始日 == 该干员在本服的实装日（严格相等，见文件头）。
         实装日拿不到（null）时不算实装那次，照旧标三角。 */
      const isRelease = !!relDateOf && relDateOf(operatorByName[op.name]) === b.startDate;
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
        /* 这一期卡池与该干员的这些内容「时间重合」（页面在头像左下角打三角，样式见 upTimeline）：
           皮肤 = 上架窗口与卡池窗口重叠；密录 / 模组 = 推出日落在卡池窗口内。
           三份数据都是**当前服**的（调用方按服取好传进来）。
           ⚠️ 「实装那次」强制为 false（三个都压掉）—— 见文件头的口径说明。 */
        skinRelated: !isRelease && skinOverlapsBanner(skinsByOperator[op.name], b.startDate, b.endDate),
        memoirRelated: !isRelease && anyDateInBanner(memoirsByOperator[op.name], b.startDate, b.endDate),
        moduleRelated: !isRelease && anyDateInBanner(modulesByOperator[op.name], b.startDate, b.endDate),
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
      releaseDate: relDateOf ? relDateOf(op) : null,
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

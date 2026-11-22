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
 * - ⭐ **「中坚寻访只看中坚」**（2026-10-14 用户加，右栏开关 `statMidOnly`，默认关）：
 *   勾上后，**中坚干员**（`everMid`）的「结束时间 / 距今天数」两组列改看**中坚记录**
 *   （`upMid` / `shopMid`，与「中坚次数」列同一个口径 = 中坚寻访**大类**，含中坚甄选、
 *   受上面那个甄选开关控制），而不是 `upAll` / `shopAll`。
 *   · 之所以要它：干员迁入中坚后就**不再进标准寻访**，所以「上次 UP」本该在中坚里看；
 *     而**迁入后一次都没轮过**的干员，`upAll` 里只剩他们**还在标准寻访时**的老记录 ——
 *     那日期跟「中坚轮换」毫无关系，看着误导。
 *   · 这种「从未在中坚 UP 过」的情况：**结束时间显示 `—`**，
 *     **距今天数改从「迁入中坚寻访」那天起算**（`classicDate` = 本服的 `*ClassicDate`）。
 *   · ⚠️ 迁入日**晚于参考日期**时（回看到迁入之前）两者都显示 `—` —— 那时他确实还没有中坚记录。
 *   · ⚠️ 实测（2026-10-14）：116 位中坚干员里，**有中坚记录的，其「上次中坚 UP」与
 *     「上次全口径 UP」100% 相同** → 这项切换实际只改变「一次都没轮过」的那些行
 *     （国服 6 位 / 国际服·繁中服各 14 位）。
 *   · ⚠️ **次数列不跟着变**（总 / 中坚 / 标准三列本来就分列，是看「轮过几次」的参考）。
 */
import { diffDays } from './date.js';

/** 干员是否属于中坚寻访体系（由 obtainMethod 文案判断） */
export const isMidOp = (op) => /中坚寻访/.test(op?.obtainMethod || '');

/**
 * 该统计行在**参考日期那一刻**是否已经属于中坚寻访 —— 决定它进「中坚表」还是「标准表」。
 *
 * ⚠️ 别用 `row.everMid`（= **现在**是否属于中坚体系）直接分组（2026-10-31 修的就是这个 bug）：
 *    参考日期往回拨时，那些「后来才迁入中坚」的干员当时还在标准寻访里，
 *    却会因为 `everMid = true` 一直卡在中坚表里（用户报的：2026-03 那批，回看到 2025 年仍在）。
 *    正确判据是 **`classicDate <= refDate`** —— 迁入日之前，他还没进中坚。
 *
 * ⚠️⚠️ **`classicDate` 是「移出标准/限定寻访」那天，不是「上中坚池」那天**（用户 2026-10-31 澄清）：
 *    它来自 PRTS「寻访规则」页的**移出时间**，比「开始能在中坚寻访里抽到」**早几天到三周**
 *    （实测批次：2026-03-26 移出 → 2026-04-16 才上中坚池）。
 *    **分界刻意用移出日**：一旦从标准池抽不到，他就不该再算在「标准寻访」那张表里，
 *    哪怕中坚池还没轮到他 —— 中间那段空档他两边都抽不到，留在标准表更误导。
 *    所以这里别改成「按中坚池实际开始日判断」，那反而会把这批人多留在标准表三周。
 *
 * @param {object} row      统计行（含 `everMid` / `classicDate`）
 * @param {string} refDate  参考日期 `YYYY-MM-DD`
 * @returns {boolean}
 *
 * 三种情形：
 *   · 不属于中坚体系（`everMid = false`）→ 恒为 false（标准表）；
 *   · 属于中坚体系、且 `classicDate <= refDate` → true（中坚表）；
 *   · 属于中坚体系、但**查不到** `classicDate` → 仍算 true。
 *     数据缺陷时宁可保持原样（留在中坚表），也不要把他甩回标准表 —— 那会凭空多出一条
 *     「在标准寻访里 UP 过 N 次」的假记录，更误导。真值缺失的情况极少（obtainMethod 含中坚，
 *     基本都有迁入批次）。
 */
export function isMidAt(row, refDate) {
  if (!row || !row.everMid) return false;
  const cd = row.classicDate || null;
  if (!cd) return true;
  return cd <= refDate;
}

/** 一组卡池中结束时间最晚的那个 */
export function latest(arr) {
  let best = null;
  for (const b of arr) if (!best || b.endDate > best.endDate) best = b;
  return best;
}

/**
 * **某几个大类里最晚的卡池结束日期**（`YYYY-MM-DD`，一个都没有则 `null`）。
 *
 * 用途：统计页右栏的两个快捷参考日 ——「**标准最晚**」= 标准寻访 + 限定寻访、
 * 「**中坚最晚**」= 中坚寻访（2026-10-29 用户加）。
 *
 * ⚠️ 传进来的 `banners` 必须是**当前统计口径**的那一份（store 的 `banners`：
 *    `customInStats` 关 = 只有已公布；开 = 加上自定义）—— 用户特意强调：
 *    **自定义卡池计不计入统计会改变这个日期**。
 * ⚠️ **不按参考日期过滤**（不看 `startDate`）：要的就是「这堆池子里最晚的那个结束日」，
 *    否则结果会随当前参考日自己漂移、点一下还可能跳回去。
 * ⚠️ 大类查不到（`categories[type]` 为空）的卡池直接略过，别把它当「标准寻访」。
 *
 * @param {Array<object>} banners 卡池（含 `type` / `endDate`）
 * @param {Record<string,string>} categories type → 大类（`BANNER_CATEGORIES`）
 * @param {string[]} wanted 要统计的大类名
 * @returns {string|null}
 */
export function latestEndDate(banners, categories, wanted) {
  const set = new Set(wanted || []);
  const hit = latest((banners || []).filter((b) => b?.endDate && set.has(categories?.[b.type])));
  return hit ? hit.endDate : null;
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
 * 表格真正显示用的「最后一次」信息 —— 在 `endInfo()` 之上套一层**「只看中坚」**口径。
 *
 * @param {object} row      统计行（含 `upAll/upMid/shopAll/shopMid/everMid/classicDate`）
 * @param {'up'|'shop'} which  看「出率提升」还是「商店兑换」
 * @param {string} refDate  参考日期
 * @param {boolean} [midOnly=false] 右栏「中坚寻访只看中坚」开关
 * @returns {{end:string|null, live:boolean, days:number|null, fromClassic:boolean}}
 *          `fromClassic` = 该行的天数是**从迁入中坚寻访那天**起算的（界面据此挂 tooltip）
 *
 * 三种情形：
 *   · 开关关着、或**参考日期那一刻还不属于中坚**（见 `isMidAt`）→ 与以前完全一样（`upAll` / `shopAll`）；
 *   · 开关开着 + 已是中坚 + **有**中坚记录 → 按中坚记录算（与「中坚次数」列同口径）；
 *   · 开关开着 + 已是中坚 + **从未在中坚 UP 过** → 结束时间 `—`、天数自 `classicDate` 起算。
 *     ⚠️ `classicDate` 缺失时给「无数据」（`days: null`），界面显示 `—`。
 *     （`classicDate > refDate` 这种「回看到迁入之前」已在 `isMidAt` 那一关滤掉，走不到这里。）
 */
export function viewEndInfo(row, which, refDate, midOnly = false) {
  const all = which === 'shop' ? row.shopAll : row.upAll;
  const mid = which === 'shop' ? row.shopMid : row.upMid;
  /* ⚠️ 这里用 `isMidAt(row, refDate)` 而不是 `row.everMid`：参考日期在迁入之前时，
     他当时还在标准寻访，「只看中坚」不该把标准记录也套成中坚口径（否则那一行会显示成「—」，
     与「他那时确实在标准池里有记录」相矛盾）。分组与口径必须同一判据。 */
  if (!midOnly || !isMidAt(row, refDate)) return { ...endInfo(all, refDate), fromClassic: false };
  if (mid.length) return { ...endInfo(mid, refDate), fromClassic: false };
  const cd = row.classicDate || null;
  if (!cd) return { end: null, live: false, days: null, fromClassic: false };
  /* 「结束日当天算 1 天」的口径与 `endInfo` 保持一致（`diffDays + 1`） */
  return { end: null, live: false, days: diffDays(refDate, cd) + 1, fromClassic: true };
}

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
 * @param {(op:object)=>string|null} [ctx.classicDateOf] 取「迁入中坚寻访」日（**只看中坚**用）
 * @returns {{ visible:Array, map:object }}
 */
export function computeStats({
  banners, categories, operatorByName, operatorIndex, refDate, relDateOf,
  includeClafesUp = false, classicDateOf = () => null,
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
      classicDate: classicDateOf(op),   // 「迁入中坚寻访」日（只看中坚时的兜底基准）
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
      const r = rec(op.scCharName);
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
    map[name].classicDate = classicDateOf(op);
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

/**
 * 统计表某列的可比较值（key 与表头 data-sort 一致）。
 * ⚠️ 排序必须与**界面显示**同一口径 —— 所以走 `viewEndInfo`、并且 `midOnly` 一路传进来，
 *    否则「只看中坚」下按距今天数排序会和屏幕上的数字对不上。
 */
export function statMetric(row, key, refDate, midOnly = false) {
  const up = viewEndInfo(row, 'up', refDate, midOnly);
  const shop = viewEndInfo(row, 'shop', refDate, midOnly);
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

/** 按指定列排序（不改原数组），无排序列时用默认排序。`midOnly` 见 `viewEndInfo` */
export function sortStatRows(rows, sort, refDate, midOnly = false) {
  const arr = rows.slice();
  if (!sort) return arr.sort(defaultStatSort);
  const mul = sort.dir === 'asc' ? 1 : -1;
  return arr.sort((a, b) => {
    const va = statMetric(a, sort.key, refDate, midOnly);
    const vb = statMetric(b, sort.key, refDate, midOnly);
    if (va === vb) return defaultStatSort(a, b);
    return va > vb ? mul : -mul;
  });
}

/* ---------------- 统计页「一键置灰」的挑选规则（2026-11-21 用户加） ----------------
   五个按钮各一条规则，都做成**纯函数**（给统计行 → 返回该置灰的干员名），
   store 只负责把结果并进 `statHideOps`，`verify-data` 直接用假数据钉规则。

   口径统一：
   · 「距今天数」走 `viewEndInfo()` + `daysSortValue()` —— 与表格那一列同源，
     并且把「中坚寻访只看中坚」开关一路传进来；
   · 「次数」走 `row.upAll` / `row.shopAll` —— 与表格的次数列同源（含「中坚甄选计入」开关）。
   ⚠️ `daysSortValue` 三个值：进行中 **0**、无数据 **-1**、真实天数 **≥1**。 */

/**
 * ① 距今 **≤** `days` 天（`which` = `'up'` 出率提升 / `'shop'` 商店兑换）。
 *
 * ⚠️ **含等号**（2026-11-22 用户由「＜」改成「≤」）：正好 `days` 天的那批也算命中。
 * ⚠️ **进行中（0）算命中** —— 它确实「距今很近」；
 * ⚠️ **无数据（-1）不算** —— 那表示根本没有这类记录，不是「很近了」。
 */
export function bulkRecentDays(rows, refDate, midOnly, which, days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return [];
  return rows
    .filter((r) => {
      const v = daysSortValue(viewEndInfo(r, which, refDate, midOnly));
      return v >= 0 && v <= n;
    })
    .map((r) => r.name);
}

/* ---------------- 「按名次」的三条规则要**分表**算（2026-11-21 用户追加） ----------------
   统计页是**四张表**（6★标准 / 6★中坚 / 5★标准 / 5★中坚），彼此独立成表。
   ②④⑤ 都是「取第几名」，名次必须在**各自的表内**排 —— 否则 6★ 的人会把 5★ 的名额吃掉，
   一张表里点「前 6 名」可能一个都轮不到。所以下面三个函数都先按表切、再各自取。 */

/** 四张统计表的 id（顺序即结果顺序：6★标准 → 6★中坚 → 5★标准 → 5★中坚） */
export const STAT_TABLES = ['6-std', '6-mid', '5-std', '5-mid'];

/** 该统计行属于哪张表（判据 = 星级 + `isMidAt(row, refDate)`，与表格分组同一套） */
export function statTableOf(row, refDate) {
  return `${row.rarity === 5 ? 5 : 6}-${isMidAt(row, refDate) ? 'mid' : 'std'}`;
}

/** 按四张表切开（保持表的固定顺序；空表跳过；万一出现别的星级也照样成组，排在后面） */
function splitByTable(rows, refDate) {
  const buckets = new Map(STAT_TABLES.map((k) => [k, []]));
  for (const r of rows) {
    const k = statTableOf(r, refDate);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }
  return [...buckets.values()].filter((list) => list.length);
}

/**
 * ② 进店等待最久的 `k` 名 —— 即「商店兑换距今天数最大」的几名，**每张表各取 k 名**
 * （四张表合计最多 4k 位；某张表不够 k 位就有多少取多少）。
 *
 * ⚠️ 只认**真实天数（≥1）**：进行中（0）不叫等待，无数据（-1）是没记录。
 * 同天数按名字码点序（保证结果稳定，不随 `statRows` 的顺序变）。
 */
export function bulkShopWaitingTop(rows, refDate, midOnly, k) {
  const n = Math.floor(Number(k));
  if (!Number.isFinite(n) || n <= 0) return [];
  const out = [];
  for (const bucket of splitByTable(rows, refDate)) {
    out.push(...bucket
      .map((r) => ({ name: r.name, v: daysSortValue(viewEndInfo(r, 'shop', refDate, midOnly)) }))
      .filter((x) => x.v > 0)
      .sort((a, b) => (b.v - a.v) || a.name.localeCompare(b.name))
      .slice(0, n)
      .map((x) => x.name));
  }
  return out;
}

/**
 * ③ **标准**干员里实装时间 **≤** `before`（`YYYY-MM-DD`）的。
 *
 * ⚠️ 「标准」用 `isMidAt(row, refDate)` 判（参考日期那一刻还没进中坚）——
 *    与两张表的分组同一判据，别用 `everMid`。
 * ⚠️ **含等号**（2026-11-22 用户由「＜」改成「≤」）：当天实装的那批也算命中。
 *    默认值 `2019-04-30` = 开服日 —— 那天实装的 35 位**全都已进中坚**，
 *    所以在默认值下这条仍然 **0 命中**（等于「没设置」）。
 * ⚠️ `releaseDate` 为 `null`（该服还没实装 / 查不到）不参与。
 */
export function bulkStdBefore(rows, refDate, before) {
  const d = String(before || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return [];
  return rows
    .filter((r) => !isMidAt(r, refDate) && r.releaseDate && r.releaseDate <= d)
    .map((r) => r.name);
}

/**
 * ④⑤ **次数恰好 `count` 次**的干员，按**实装时间升序**排，取**第 `from` ~ `to` 名**（闭区间，含两端）。
 * **每张表各排各的**（四张表各有一份「第几名到第几名」的名额）。
 *
 * 两条规则只差一个 `count`：
 *   · ④ 「首次UP 队列」= 出率提升次数 **1 次**（只轮过一次的那批）；
 *   · ⑤ 「首次进店队列」= 商店兑换次数 **0 次**（一次都没进过店的那批）。
 *
 * @param {'up'|'shop'} which `'up'` = 出率提升次数（`upAll`）、`'shop'` = 商店兑换次数（`shopAll`）
 * @param {string} refDate 参考日期（要它才能分表：`isMidAt` 的判据时点）
 * @param {number} count 次数**恰好等于**它才入选（`0` / `1`）
 * @param {number} from 起始名次（`1`-based，含）
 * @param {number} to 结束名次（`1`-based，含；超过该表人数就自动截断）
 *
 * ⚠️ **区间含两端**（2026-11-22 用户由「第 N 名起」改成「第 A - B 名」，默认 2-6）。
 * ⚠️ `to < from` → 空结果（不自动交换：交换会把「填反了」变成静默生效）。
 * ⚠️ 实装日缺失的排**最后**（`defaultStatSort` 的 `9999`），不会白占「最早几名」的名额。
 */
export function bulkCountRange(rows, which, refDate, count, from, to) {
  const a = Math.floor(Number(from));
  const b = Math.floor(Number(to));
  /* ⚠️ 空串不当作 0：`Number('')` 是 0，会静默变成「次数 0 次」那一档 / 第 0 名 */
  if (!String(count ?? '').trim() || !String(from ?? '').trim() || !String(to ?? '').trim()) return [];
  const want = Math.floor(Number(count));
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < a) return [];
  if (!Number.isFinite(want) || want < 0) return [];
  const out = [];
  for (const bucket of splitByTable(rows, refDate)) {
    out.push(...bucket
      .filter((r) => (which === 'shop' ? r.shopAll : r.upAll).length === want)
      .sort(defaultStatSort)
      .slice(a - 1, b)
      .map((r) => r.name));
  }
  return out;
}

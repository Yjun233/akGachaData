/**
 * 首次UP间隔（纯函数）。
 *
 * 「首次UP」有两种口径（右栏的「统计模式」切换，用户 2026-10-02 指定）：
 * - `mode: 'shop'`（默认）**首次进店** —— 卡池的 upOperators 里 `isShop === true`，
 *   日期取该卡池的 `startDate`（商店兑换与卡池同期上下架）。
 * - `mode: 'rotation'` **首次轮换** —— 出现在**常驻标准寻访 / 联合行动 / 定向甄选 / 前路回响**
 *   这四类卡池里最早的一次（名单见 constants.js 的 `ROTATION_TYPES`）。⚠️ 不看进店标记。
 *
 * **卡池类型**（右栏最上方的切换，用户 2026-10-31 加，`poolType`）：
 * - `'std'`（默认）**标准寻访** —— **排除**中坚两类（`classic` / `clafes`）；
 * - `'mid'` **中坚寻访** —— **只取常驻中坚寻访**（`classic`）。
 *   ⚠️ 刻意**不含中坚甄选**：甄选一次放 30+ 位自选干员，会把一大批人的「首次」挤到同一天，
 *      整条间隔曲线就不成样子（实测含甄选 110 人 / 只看常驻 102 人，62 人日期会提前）。
 * 它同时决定两件事，**别只改一处**：① 哪些卡池参与「首次」判定；② 「累计 N 次」数哪些池
 * （用户明确：累计次数跟着类型分开数，所以标准模式不再把中坚池的次数算进去）。
 *
 * 两种模式共用的规则：
 * - 排除限定干员与 4 星及以下 —— 与统计页保持一致。
 * - 每位干员取其**首次**（最早的那个卡池）。
 * - `firstDate` 与 `firstBanner` **同源**：都取自那次首次所在的卡池，所以浮窗里
 *   「首次轮换：2021-01-14」与「所在卡池：联合行动」必然指的是同一场卡池。
 *   ⚠️ 更新条件用**严格小于**：同一天有多个候选池时保留先遇到的那个，两者一起不动。
 * - **六星与五星各自成序列，星级之间不互相比较**：同一星级内按 axis 排序后，
 *   纵轴取 metric 指定的值；组内第一位（当 metric = gap 时）没有前序，`gap` 为 `null`（图上不画点）。
 * - 时间范围按**首次日期**筛选；筛选后重新排序、重新计算。
 *
 * ⚠️ 实测（三服、2026-10-02）：**进店 ⊆ 轮换** —— 有进店记录的干员必定也有轮换记录，
 * 而且「首次轮换日 ≤ 首次进店日」（进店标记只出现在常驻标准 / 常驻中坚两类卡池上，
 * 而常驻中坚的日期一定晚于该干员首次上标准轮换）。核对脚本按这两条守不变量。
 *
 * 两个可切换的口径（用户指定）：
 * - `axis`   横轴顺序 + 轴标签日期
 *   - `first`（默认）按**首次日期**（进店日 / 轮换日，看 mode）；轴标签写该日期
 *   - `release`       按**实装日期**；轴标签写实装日期
 * - `metric` 纵轴取值
 *   - `gap`（默认）距**同星级上一个点**的首次日期之差（随 axis 变化，**可能为负**：
 *     按实装排序时，后实装却更早进店的干员会算出负数）
 *   - `sinceRelease` 该干员首次日期 − 该干员自有实装日
 *
 * 注意：最初版本把六星五星混在一条序列里算间隔，会算出「夜莺距上一名德克萨斯 0 天」
 * 这种跨星级的假间隔 —— 已改为按星级分组，各自排序、各自算间隔。
 */
import { diffDays } from './date.js';
import { FIRST_UP_MODE_LABEL, MID_BANNER_TYPES, MID_FIRSTUP_TYPES, ROTATION_TYPES } from './constants.js';

/** 该卡池是否属于当前「卡池类型」（右栏最上方那个切换，2026-10-31 加）
 *  - `mid` 只收**常驻中坚寻访**（`classic`，不含中坚甄选 —— 理由见 `MID_FIRSTUP_TYPES`）；
 *  - `std` 把中坚两类**都排除**（限定 / 单六 / 双五那些仍在内；进店标记本来也只在常驻标准上有）。
 */
export const inFirstUpPool = (b, poolType) => (poolType === 'mid'
  ? MID_FIRSTUP_TYPES.includes(b.type)
  : !MID_BANNER_TYPES.includes(b.type));

/** 「首次XX」的口径词（`首次进店` / `首次轮换`；中坚模式下加「中坚」二字） */
export const modeFirstLabel = (mode, poolType = 'std') => {
  const base = FIRST_UP_MODE_LABEL[mode] ?? FIRST_UP_MODE_LABEL.shop;
  return poolType === 'mid' ? base.replace(/^首次/, '首次中坚') : base;
};

/** 「进店」/「轮换」—— 不带「首次」，用在「累计 N 次」「没有 N 记录」这类句子里的词 */
export const modeWord = (mode, poolType = 'std') =>
  modeFirstLabel(mode, poolType).replace(/^首次/, '');

/** 纵轴取值的中文名（图表说明与 tooltip 用；随模式变） */
export function metricLabel(mode, metric, poolType = 'std') {
  return metric === 'gap'
    ? `距同星级上一个${modeFirstLabel(mode, poolType)}（天）`
    : '距该干员实装日（天）';
}

/** 横轴口径的短中文名（卡片头一行里用）：`按实装日期` / `按首次进店日期` */
export const axisLabel = (mode, axis, poolType = 'std') =>
  (axis === 'release' ? '按实装日期' : `按${modeFirstLabel(mode, poolType)}日期`);

/** 纵轴口径的短中文名（卡片头一行里用）：`距实装日` / `距上个首次进店`
 *  （长名见上面的 `metricLabel` —— 那个带「（天）」后缀，给图表说明与 tooltip） */
export const metricShort = (mode, metric, poolType = 'std') =>
  (metric === 'sinceRelease' ? '距实装日' : `距上个${modeFirstLabel(mode, poolType)}`);

/**
 * 卡片头「筛选范围」的文案。
 * ⚠️ 日期框现在**默认就填满范围**（否则只显示「年/月/日」；结束日期 = 今天，见 store 的
 *   fullFirstUpRange），所以「等于默认范围」也要算「全部」—— 不然卡片头会从「全部」
 *   变成一串日期。
 * @param {{from:string,to:string}} range 当前区间
 * @param {{from:string,to:string}} full  当前模式的默认范围（store 的 fullFirstUpRange）
 */
export const firstUpRangeLabel = (range, full) => {
  const { from, to } = range;
  if (!from && !to) return '全部';
  if (full && from === full.from && to === full.to) return '全部';
  return `${from || '…'} ~ ${to || '…'}`;
};

/**
 * @param {object} ctx
 * @param {Array}  ctx.banners         当前服务器全部卡池（含 id）
 * @param {object} ctx.operatorByName  干员名 → 干员
 * @param {(op:object)=>string|null} ctx.relDateOf 取当前服务器实装日
 * @param {'std'|'mid'} [ctx.poolType] 卡池类型（见 `inFirstUpPool`；默认标准）
 * @param {'shop'|'rotation'} [ctx.mode]  统计模式（见文件头）
 * @param {string} [ctx.from]          首次日期 ≥ from
 * @param {string} [ctx.to]            首次日期 ≤ to
 * @param {'first'|'release'} [ctx.axis]
 * @param {'gap'|'sinceRelease'} [ctx.metric]
 */
export function computeFirstUp({
  banners,
  operatorByName,
  relDateOf,
  poolType = 'std',
  mode = 'shop',
  from = '',
  to = '',
  axis = 'first',
  metric = 'gap',
}) {
  const isRotation = mode === 'rotation';
  /* ⚠️ 「轮换」只在**标准**模式下才需要再收窄到 `ROTATION_TYPES` 那四类。
     中坚模式的类型范围已经由 `inFirstUpPool` 收成「只留常驻中坚」了 ——
     再套 `ROTATION_TYPES` 会一个都匹配不上（2026-10-31 第一次写就是这样，中坚轮换出 0 人）。 */
  const rotationTypes = isRotation && poolType !== 'mid' ? new Set(ROTATION_TYPES) : null;

  /** name → { name, rarity, firstDate, firstBanner, count } */
  const first = {};

  for (const b of banners) {
    /* ① 先按「卡池类型」筛 —— 标准模式排除中坚两类、中坚模式只留常驻中坚。
          ⚠️ 这一层同时决定「累计次数」的口径：标准模式不再把中坚池的次数算进去
             （用户 2026-10-31 明确：累计次数跟着类型分开数）。 */
    if (!inFirstUpPool(b, poolType)) continue;
    /* ② 再按统计模式筛：轮换模式只看那 4 类卡池；进店模式看剩下的全部（进店标记本就只在
          常驻标准 / 常驻中坚上） */
    if (rotationTypes && !rotationTypes.has(b.type)) continue;
    for (const op of b.upOperators) {
      if (!isRotation && !op.isShop) continue;
      if (op.isLimited) continue;
      if ((op.rarity || 0) < 5) continue;
      const cur = first[op.scCharName];
      if (!cur) {
        first[op.scCharName] = {
          name: op.scCharName, rarity: op.rarity, firstDate: b.startDate, firstBanner: b.scName, count: 1,
        };
      } else {
        cur.count += 1;
        /* ⚠️ firstDate 与 firstBanner 必须**一起**更新 —— 否则会出现
           「日期是 A 池的、池名是 B 池的」这种自相矛盾的浮窗 */
        if (b.startDate < cur.firstDate) {
          cur.firstDate = b.startDate;
          cur.firstBanner = b.scName;
        }
      }
    }
  }

  const allRaw = Object.values(first);
  /** 不加时间限制时的边界（「全部」按钮与日期输入的 min/max 用） */
  const bounds = {
    min: allRaw.reduce((m, x) => (!m || x.firstDate < m ? x.firstDate : m), null),
    max: allRaw.reduce((m, x) => (!m || x.firstDate > m ? x.firstDate : m), null),
  };

  const filtered = allRaw
    .filter((x) => (!from || x.firstDate >= from) && (!to || x.firstDate <= to));

  /* 实装日与「距实装天数」要先算好 —— 按实装排序要用到 releaseDate */
  for (const r of filtered) {
    const op = operatorByName[r.name];
    r.releaseDate = relDateOf(op);
    r.sinceRelease = r.releaseDate ? diffDays(r.firstDate, r.releaseDate) : null;
  }

  /**
   * 组内排序 + 逐点算出当前口径的取值。
   * 同一天 / 同实装日时按名字排序，保证顺序稳定。
   */
  function buildSeries(list) {
    const sortKey = (r) => (axis === 'release' ? (r.releaseDate || '9999-12-31') : r.firstDate);
    const sorted = list.slice().sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      if (ka !== kb) return ka < kb ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    let prev = null;
    for (const r of sorted) {
      r.gap = prev ? diffDays(r.firstDate, prev.firstDate) : null;
      r.prevName = prev ? prev.name : null;
      r.xLabel = axis === 'release' ? (r.releaseDate || '—') : r.firstDate;
      r.value = metric === 'gap' ? r.gap : r.sinceRelease;
      prev = r;
    }
    return sorted;
  }

  return {
    mode,
    poolType,
    axis,
    metric,
    six: buildSeries(filtered.filter((r) => r.rarity === 6)),
    five: buildSeries(filtered.filter((r) => r.rarity === 5)),
    rows: filtered,
    bounds,
  };
}

/**
 * lib/crossServer.js
 * ----------
 * **跨服卡池对比**（页面 `/cross-server`，用户 2026-11-04 加）的纯计算层。
 *
 * 三服（sc 国服 / en 国际服 / tc 繁中服）的卡池**按 `scName` 配对**，算「同一期在各服分别什么时候开」。
 *
 * ## 口径（都对过真实数据）
 * - **排除**：`double` 常驻标准寻访、`classic` 常驻中坚寻访（这两类是「第 N 期」的周更轮换，
 *   三服各自独立编号，同编号根本不是同一场）；以及 `single` 里 `rerunKind === '返场'` 的
 *   （国服特供，2026-11-04 时只有 2 条，外服没有对应条目）。
 *   ⚠️ **`复刻` 不排除** —— 它的名字自带「复刻」后缀，三服能配上，是正常的对比对象。
 * - **配对键是 `scName`**：单服内唯一（零重名），三服交集实测 376 条。
 *   ⚠️ **绝不能用 `id`**：三服 id 零交集（同一个卡池在各服 id 里的日期段不同）。
 *   也**不能用 UP 干员集合**：`single` 的 5★ 第三位跨服有替换（29/80），`返场` 与首发内容完全相同。
 * - **时间差 = 后者减前者**：SC-EN = EN − SC、SC-TC = TC − SC、EN-TC = TC − EN，负数保留。
 *   ⚠️⚠️ `diffDays(a, b)` 返回的是 **`a − b`**（`lib/date.js`，正数表示 a 晚于 b），
 *   所以「EN 减 SC」必须写 `diffDays(enStart, scStart)`。**参数顺序就是符号，别调换。**
 *   真实数据里外服恒晚于国服（en−sc 最小 +56 天），写反了页面照样「好看」——
 *   唯一能抓住它的是 `verify-data` 里那条「外服更早 → 负数」的 fixture 用例。
 * - **「不一致」的信号只比 6★ 名单**（`up6Same`）：那是「是不是同一场」的判断依据。
 *   界面上它表现为「出率提升」那个按钮换色（2026-11-04 由不等号改过来）。
 *   全 UP 集合不一致的行比 6★ 更多（`single` 有 29 条只是 5★ 换了人），
 *   那些不标（否则 30 个信号被稀释成 59 个）；5★ 只作弹窗里的旁注（`up5Same`）。
 * - 三服里缺那一期的行**照列**，缺的格显示 `—`，相关差值也是 `—`。
 * - **自定义卡池不参与**：它们按服存在浏览器本地，跨服配对没有意义。
 *
 * ## 数据来源
 * 入参一律是 store 的 state **`bannersByServer`**（`{ sc|en|tc: { <id>: banner } }`，
 * 已由 `loadData` 合并中坚文件、**已 unwrap `.banners`**、**不含自定义**）。
 * ⚠️ 别在这里自己 fetch `banners_cla_*.json` —— 它顶层是
 * `{ generatedAt, dataVersion, source, banners }`，直接遍历会把 4 个元信息字段当卡池。
 *
 * 纯函数、零 store 依赖，所以 SSR 与两个核对脚本都能直接跑。
 */
import { TYPE_LABEL } from './constants.js';
import { diffDays } from './date.js';

/** 三服固定顺序 —— 列序、比较序、遍历序的唯一来源，别在各处再写 `['sc','en','tc']` */
export const CROSS_SERVERS = ['sc', 'en', 'tc'];

/** 列头里的服名。⚠️ 必须与 `metadata.servers[].label` 一致（verify-data 有断言钉着） */
export const CROSS_SERVER_LABELS = { sc: '国服', en: '国际服', tc: '繁中服' };

/**
 * 「差异对比」能选的那几服（**不含国服** —— 对比永远是「国服 vs 某一服」，
 * 两两互斥，同一时刻最多选中一个）。用户 2026-11-04 追加。
 */
export const CROSS_DIFF_SERVERS = ['en', 'tc'];

/**
 * 国服 vs 指定服的 UP 干员**对称差集**（名字集合）—— 弹窗里画「深蓝下划线」的依据。
 *
 * - 一边有、另一边没有的才算差异（两边都有的不标）；限定 / 进店标记不参与判断。
 * - 那一服**没有这一期**时，国服的全部干员都算差异（对方一份都没有）——
 *   语义上没错，弹窗里也有「该服没有这一期卡池」的文案兜着。
 * - 只按**名字**比：同一期的干员名单在数据里本来就用 `scCharName` 对齐（`charId` 三服一致）。
 *
 * @param {object} row CrossRow（`buildCrossEntries()` 产出的行）
 * @param {'en'|'tc'} server 要对比的服（传 `sc` 或空 → 空集合，调用方自己判空）
 * @returns {Set<string>}
 */
export function upDiffNames(row, server) {
  const out = new Set();
  if (!server || server === 'sc') return out;
  const namesIn = (s) => new Set(
    (row?.banners?.[s]?.upOperators || []).map((o) => o?.scCharName).filter(Boolean),
  );
  const base = namesIn('sc');
  const other = namesIn(server);
  for (const n of base) if (!other.has(n)) out.add(n);
  for (const n of other) if (!base.has(n)) out.add(n);
  return out;
}

/** 不参与对比的类型：常驻标准 / 常驻中坚（三服各自独立编号，同名不是同一场） */
export const CROSS_EXCLUDED_TYPES = ['double', 'classic'];

/** 右栏类型按钮的白名单（传给 `TypeButtons` 的 `onlyTypes`） */
export const CROSS_ALLOWED_TYPES = Object.keys(TYPE_LABEL)
  .filter((t) => !CROSS_EXCLUDED_TYPES.includes(t));

/** 空筛选条件（形状与 `lib/banners.js` 的 `emptyFilters` 一致，便于复用同一套交互） */
export const emptyCrossFilters = () => ({ types: [], from: '', to: '', ops: [] });

const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

/**
 * 单个卡池是否进入本页。
 * @param {{type?:string, rerunKind?:string|null}} banner
 * @returns {boolean}
 */
export function isCrossEligible(banner) {
  if (!banner || !banner.type) return false;
  if (CROSS_EXCLUDED_TYPES.includes(banner.type)) return false;
  /* ⚠️ 只排「返场」，**别写成 `/返场|复刻/`** —— 复刻是正常对比对象（名字自带后缀，三服能配上） */
  if (banner.type === 'single' && banner.rerunKind === '返场') return false;
  return true;
}

/** 某星级 UP 干员的「集合指纹」—— 按 charId 排序后拼串，用来判两服名单是否相同 */
const rosterKey = (banner, rarity) => (banner?.upOperators || [])
  .filter((o) => (o?.rarity || 0) === rarity)
  .map((o) => o.charId || o.scCharName)
  .sort()
  .join('|');

/** 该行在 `rarity` 星级的名单是否**各服一致**；只有 1 服 → null（无从比较） */
function sameRoster(banners, servers, rarity) {
  if (servers.length < 2) return null;
  return new Set(servers.map((s) => rosterKey(banners[s], rarity))).size === 1;
}

/**
 * 三服卡池 → 按名称配对的行。**不筛选、不排序**（顺序 = 名字首次出现的顺序）。
 * @param {object} bannersByServer `{ sc|en|tc: { <id>: banner } }`
 * @returns {Array} CrossRow[]
 */
export function buildCrossEntries(bannersByServer = {}) {
  /** name → { name, type, banners: { sc, en, tc } } */
  const map = new Map();
  for (const server of CROSS_SERVERS) {
    for (const [id, raw] of Object.entries(bannersByServer?.[server] || {})) {
      if (!isCrossEligible(raw)) continue;
      const banner = raw.id ? raw : { id, ...raw };
      if (!banner.scName) continue;
      let g = map.get(banner.scName);
      if (!g) {
        g = { name: banner.scName, type: banner.type, banners: { sc: null, en: null, tc: null } };
        map.set(banner.scName, g);
      }
      /* 同一服里理论上不会重名（实测 438/396/376 条零重名）；真撞了以后来的为准 */
      g.banners[server] = banner;
    }
  }

  const out = [];
  for (const g of map.values()) {
    const { banners } = g;
    const servers = CROSS_SERVERS.filter((s) => !!banners[s]);
    const startOf = (s) => (isDate(banners[s]?.startDate) ? banners[s].startDate : null);
    const scStart = startOf('sc');
    const enStart = startOf('en');
    const tcStart = startOf('tc');
    out.push({
      /* 配对键 = 卡池名称（单服内唯一） */
      name: g.name,
      type: g.type,
      /** 有数据的服，按 CROSS_SERVERS 顺序 */
      servers,
      /** 原样卡池对象（含 id），弹窗按服取 UP 名单 */
      banners,
      scStart,
      enStart,
      tcStart,
      /* ⚠️ 三条都写 `diffDays(后, 前)`：`diffDays(a, b) = a − b`，
         所以「EN 减 SC」= `diffDays(enStart, scStart)`。**参数顺序就是符号，别调换。** */
      gapEnSc: scStart && enStart ? diffDays(enStart, scStart) : null,
      gapTcSc: scStart && tcStart ? diffDays(tcStart, scStart) : null,
      gapTcEn: enStart && tcStart ? diffDays(tcStart, enStart) : null,
      /** 三服 6★ 名单是否一致（false → 表格里「查看」按钮换色）；单服行 = null */
      up6Same: sameRoster(banners, servers, 6),
      /** 5★ 名单是否一致 —— **不进表格**，只作弹窗里的旁注 */
      up5Same: sameRoster(banners, servers, 5),
    });
  }
  return out;
}

/**
 * 日期上下界（右栏两个日期框的 `min` / `max`，也是默认范围）。
 * - `min` = 有国服日期的行里**最早**的那个（实测 2019-05-23 —— 开服那期是常驻标准，已被排除）
 * - `max` = **至少两服有数据**的行里最晚的国服日期（用户 2026-11-04 指定：
 *   「最晚是最后一个至少有两个服的数据的卡池」）。只在一服的池子没有可比性，不参与上界。
 *
 * ⚠️ 单服行若落在 `max` 之后（当前 9 条国服独有未来池就是这样），默认范围会把它们切掉；
 *    清空日期框仍能看到（结果条会显示 `命中 N / M`，差额可见）。
 *
 * @param {Array} entries
 * @returns {{min:string|null, max:string|null}}
 */
export function crossBounds(entries = []) {
  let min = null;
  let max = null;
  for (const r of entries) {
    if (!r.scStart) continue;
    if (!min || r.scStart < min) min = r.scStart;
    if (r.servers.length >= 2 && (!max || r.scStart > max)) max = r.scStart;
  }
  return { min, max };
}

/**
 * 点击表头后的下一个排序状态：文本列首点升序，日期 / 差值列首点降序（与 `nextBannerSort` 同规矩）。
 * @param {{key:string, dir:string}|null} current
 * @param {string} key
 */
export function nextCrossSort(current, key) {
  if (current?.key === key) {
    return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key, dir: key === 'name' || key === 'type' ? 'asc' : 'desc' };
}

/** 取排序值；缺数据（null / 空串）统一成 null，交给排序函数丢到末尾 */
function sortValue(row, key) {
  if (key === 'name') return row.name;
  if (key === 'type') return TYPE_LABEL[row.type] || row.type;
  const v = row[key];
  return v === undefined || v === '' ? null : v;
}

/**
 * 筛选 + 排序。**返回新数组**，绝不动入参 —— `crossEntries` 是 Pinia 的缓存 getter，
 * 原地 `sort()` 会永久改写它，表现是「点过一次表头后默认排序再也回不去」。
 *
 * 筛选口径：
 * - `types`：空 = 全部；非空时按白名单外的类型也会被自然过滤（行里根本没有那些类型）
 * - `from` / `to`：**以国服开始日期为准**（闭区间）。没有国服日期的行，只要设了任一端就不参与
 * - `ops`：**任意一服**的 UP 干员命中即保留（精确名 OR，与卡池列表同语义）
 *
 * 排序口径：差值 / 日期按**数值**比（`-3` 排在 `-10` 前面，别用字符串比）；
 * 空值**恒排末尾**（与方向无关）；平局用 `scStart` 降序兜不住时按名字**码点序**
 * （不用 `localeCompare`：它在 Node 与浏览器里对中文的排序可能不同，会让「首行是谁」的断言偶发失败）。
 *
 * @param {Array} entries
 * @param {{types?:string[], from?:string, to?:string, ops?:string[]}} filters
 * @param {{key?:string, dir?:string}} sort
 * @returns {Array}
 */
export function crossRows(entries = [], filters = {}, sort = {}) {
  const f = filters || {};
  const typeSet = f.types && f.types.length ? new Set(f.types) : null;
  const opSet = f.ops && f.ops.length ? new Set(f.ops) : null;

  const rows = entries.filter((r) => {
    if (typeSet && !typeSet.has(r.type)) return false;
    if (f.from && (!r.scStart || r.scStart < f.from)) return false;
    if (f.to && (!r.scStart || r.scStart > f.to)) return false;
    if (opSet && !CROSS_SERVERS.some((s) => (r.banners[s]?.upOperators || [])
      .some((o) => opSet.has(o.scCharName)))) return false;
    return true;
  });

  const key = sort?.key || 'scStart';
  const mul = sort?.dir === 'asc' ? 1 : -1;
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

  rows.sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    const na = va === null;
    const nb = vb === null;
    if (na || nb) {
      if (na && nb) return byName(a, b);
      return na ? 1 : -1;          // 空值恒在末尾
    }
    if (va === vb) return byName(a, b);
    return va > vb ? mul : -mul;
  });
  return rows;
}

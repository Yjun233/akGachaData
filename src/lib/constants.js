/**
 * 全局常量：卡池类型、分类、服务器字段、阈值、列宽。
 * 这些值同时被数据层与视图层使用，改动时注意 `akGachaDocs/site/工作指令.md` 里的口径说明。
 */

/** 卡池 type → 展示名 */
export const TYPE_LABEL = {
  double: '常驻标准寻访',
  classic: '常驻中坚寻访',
  clafes: '中坚甄选',
  limcel: '限定寻访·庆典',
  limspr: '限定寻访·春节',
  limsum: '限定寻访·夏季',
  joint: '联合行动',
  stdfes: '定向甄选',
  mainfes: '前路回响',
  single: '单六寻访',
  five: '双五寻访',
};

/**
 * type → 大类。
 * ⚠️ 这份映射**以前放在 `data/banner-categories.json` 里，现已移入本文件**并删掉了那个 JSON ——
 * 它与服务器无关（各服共用），没必要当数据文件去 fetch，放在常量里还能让核对脚本直接引用。
 */
export const BANNER_CATEGORIES = {
  double: '标准寻访',
  joint: '标准寻访',
  stdfes: '标准寻访',
  mainfes: '标准寻访',
  single: '标准寻访',
  five: '标准寻访',
  classic: '中坚寻访',
  clafes: '中坚寻访',
  limcel: '限定寻访',
  limspr: '限定寻访',
  limsum: '限定寻访',
};

/** 筛选用：类型的列举顺序（右栏的类型按钮组按这个顺序排列，核对脚本也会用） */
export const TYPE_ORDER = Object.keys(TYPE_LABEL);

/** 大类展示顺序 */
export const CAT_ORDER = ['标准寻访', '中坚寻访', '限定寻访'];

/** 大类 → 其下的 type（右栏的类型按钮组按这个分组渲染） */
export const TYPES_BY_CATEGORY = CAT_ORDER.map((cat) => ({
  cat,
  types: Object.keys(BANNER_CATEGORIES).filter((t) => BANNER_CATEGORIES[t] === cat),
}));

/**
 * 卡池大类 → 颜色。
 * 全站统一：UP 历史时间轴的标记、卡池列表/统计页的「大类」徽章都用这套。
 */
export const CAT_COLOR = {
  标准寻访: '#FFD524',
  中坚寻访: '#0098DC',
  限定寻访: '#8b5cf6',
};

/** 大类 → 徽章用的 CSS 类名 */
export const CAT_CLASS = {
  标准寻访: 'c-std',
  中坚寻访: 'c-mid',
  限定寻访: 'c-lim',
};

/** 大类颜色对应的前景色（**画在饱和色底上**：黄底用深字，蓝紫底用白字） */
export const CAT_INK = {
  标准寻访: '#5c4500',
  中坚寻访: '#ffffff',
  限定寻访: '#ffffff',
};

/** 大类颜色的**浅色底**（用作表头 / 卡片标题栏，避免大面积饱和色刺眼） */
export const CAT_TINT = {
  标准寻访: '#fff8d9',
  中坚寻访: '#e6f5fd',
  限定寻访: '#f2ecfe',
};

/** 大类颜色的**深色墨**（画在浅底上写字用，保证对比度） */
export const CAT_DEEP = {
  标准寻访: '#7a5c00',
  中坚寻访: '#00628f',
  限定寻访: '#5b21b6',
};

/**
 * **商店兑换 = 绿色**（全站统一：卡池列表的「兑」标记、统计表的「商店兑换」组、
 * UP 历史里进店的小圆点、各处 tooltip）。
 * 取的是偏深的绿（白字可读），配浅绿底做表头 —— 与蓝白主色和谐、不刺眼。
 */
export const SHOP = {
  color: '#15803d', // 主色（白字/白描边可读）
  tint: '#e8f7ee', // 浅底（表头 / 标记填充）
  border: '#9fd9b8', // 浅底上的描边
  ink: '#0f5132', // 浅底上的深色字
};

/**
 * UP 历史时间轴的纵轴排序（右栏按钮组）。
 * 两个维度 × 两个方向 —— 界面固定渲染成两行「左标签 + 右侧升/降序分段按钮」，
 * 所以这里按维度成对给出，避免在模板里硬编码 4 组 id。
 */
export const UP_SORT_ROWS = [
  { label: '实装日期', asc: 'release-asc', desc: 'release-desc' },
  { label: '最近 UP', asc: 'lastUp-asc', desc: 'lastUp-desc' },
];

/** 干员实装日字段：各服一份，靠字段名区分 */
export const SERVER_FIELD = {
  sc: 'scReleaseDate',
  en: 'enReleaseDate',
  tc: 'tcReleaseDate',
};

/**
 * 干员**进入常驻中坚寻访**的日期字段：各服一份。
 * ⚠️ 国服那个叫 `classicDate`（没有 `sc` 前缀），别想当然写成 `scClassicDate`。
 * 语义 = 该干员从标准寻访「移出」、开始在中坚寻访轮换的批次日期；
 * 想知道「某个时间点这位干员是不是中坚干员」就比这个日期。
 */
export const SERVER_CLASSIC_FIELD = {
  sc: 'classicDate',
  en: 'enClassicDate',
  tc: 'tcClassicDate',
};

/**
 * **「首次轮换」的口径**（首次UP间隔页的两种统计模式之一，用户 2026-10-02 指定）：
 * 进入「常驻标准寻访 / 联合行动 / 定向甄选 / 前路回响」这四类卡池，**不看进店标记**。
 *
 * ⚠️ **不含中坚寻访**（常驻中坚 / 中坚甄选）—— 实测三服把它们加进来结果**完全一致**
 * （中坚干员的首次标准 UP 必然更早，日期集合一个都不变），所以按这四类即可。
 * ⚠️ 也不含单六寻访 / 双五寻访（那两类算「标准寻访」大类，但不是轮换池）。
 */
export const ROTATION_TYPES = ['double', 'joint', 'stdfes', 'mainfes'];

/**
 * 首次UP间隔页的两种统计模式（右栏切换）。
 * ⚠️ 右栏按钮组的顺序、卡片头的口径文案、分节标题、tooltip 都从这份映射取词，
 * 别再各处硬编码「首次进店 / 首次轮换」。
 */
export const FIRST_UP_MODES = [
  { id: 'shop', label: '首次进店' },
  { id: 'rotation', label: '首次轮换' },
];
export const FIRST_UP_MODE_LABEL = Object.fromEntries(FIRST_UP_MODES.map((m) => [m.id, m.label]));

/** 距今天数着色阈值（出率提升 / 商店兑换共用） */
export const WARN_DAYS = 180; // ≥ 180 天标黄
export const DANGER_DAYS = 365; // ≥ 365 天标红

/**
 * 卡池列表的列宽（px）—— 既决定各列的**比例**（`width: w/total%`），
 * 也作为各列的 **min-width 下限**；合计 1225px 是表格的 `min-width`，
 * 低于它才横向滚动，宽屏时按比例铺满。
 */
export const BANNER_COLS = [190, 130, 105, 100, 100, 280, 320];

/** 统计页四个分节的锚点（顶栏定位按钮用）——要与 StatsView 里的分区标题文案一致 */
export const STAT_SECTIONS = [
  { id: 's-6-std', label: '六星干员·标准寻访' },
  { id: 's-6-mid', label: '六星干员·中坚寻访' },
  { id: 's-5-std', label: '五星干员·标准寻访' },
  { id: 's-5-mid', label: '五星干员·中坚寻访' },
];

/**
 * 全局常量：卡池类型、分类、服务器字段、阈值、列宽。
 * 这些值同时被数据层与视图层使用，改动时注意 README 里的口径说明。
 */

/** 卡池 type → 展示名 */
export const TYPE_LABEL = {
  double: '常驻标准寻访',
  classic: '常驻中坚寻访',
  clafes: '中坚甄选',
  /* 限定寻访细分为三类（2026-09-30）：庆典 / 春节 / 夏季。
     原 `limited` 已不再产出 —— 数据里现在是这三个子类。 */
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

/** 筛选用：类型的列举顺序（卡池列表页的下拉、核对脚本都会用） */
export const TYPE_ORDER = Object.keys(TYPE_LABEL);

/** 大类展示顺序 */
export const CAT_ORDER = ['标准寻访', '中坚寻访', '限定寻访'];

/** 大类 → 其下的 type（UP 历史右栏的按钮组按这个分组渲染） */export const TYPES_BY_CATEGORY = CAT_ORDER.map((cat) => ({
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

/** UP 历史时间轴的纵轴排序方式（右栏） */
export const UP_SORTS = [
  { id: 'release-asc', label: '实装日期 ↑' },
  { id: 'release-desc', label: '实装日期 ↓' },
  { id: 'lastUp-asc', label: '最近 UP ↑' },
  { id: 'lastUp-desc', label: '最近 UP ↓' },
];

/** 干员实装日字段：各服一份，靠字段名区分 */
export const SERVER_FIELD = {
  sc: 'scReleaseDate',
  en: 'enReleaseDate',
  tc: 'tcReleaseDate',
};

/** 距今天数着色阈值（出率提升 / 商店兑换共用） */
export const WARN_DAYS = 180; // ≥ 180 天标黄
export const DANGER_DAYS = 365; // ≥ 365 天标红

/** 卡池列表列宽（px）—— table-layout:fixed + colgroup，全屏不拉伸 */
export const BANNER_COLS = [190, 130, 105, 100, 100, 280, 320];

/** 统计页四个分节的锚点（顶栏定位按钮用） */
export const STAT_SECTIONS = [
  { id: 's-6-std', label: '六星 · 标准寻访' },
  { id: 's-6-mid', label: '六星 · 中坚寻访' },
  { id: 's-5-std', label: '五星 · 标准寻访' },
  { id: 's-5-mid', label: '五星 · 中坚寻访' },
];

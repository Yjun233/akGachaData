/**
 * 「干员列」的名字自适应字号（用户 2026-10-16 要求）。
 *
 * ## 为什么
 * 这两个表格的干员列是**定宽**的（它是 sticky 冻结的第 2 列，第 3 列的 `left` 偏移要求
 * 第 1、2 列宽度精确），而定宽原来按「**7 个汉字**」取 103px ——
 * 那是**为了容纳最长名**（`凯尔希·思衡托` / `维娜·维多利亚`）而让**所有**名字跟着变宽，
 * 可实测 2 字的名字占了 123/232 位、≤5 字的占 95%。
 *
 * 所以改成：列宽按**常见长度**收到 **84px**（内容区 72px），
 * **超字数的名字不截断、不溢出，而是把字号降一档塞进去**（13 → 11 → 10px）。
 *
 * ## 两个容易搞错的地方
 * ⚠️ **宽度按「等效汉字数」算，不是字符数** —— 半角字符（ASCII 字母数字、U+00B7 `·`）
 *    只占半格。否则 `Mon3tr`（6 字符）会被判成比 `德·托莱多` 还宽。
 * ⚠️ **要留跨平台余量** —— 同一个名字在 Windows / iOS PingFang / Android Roboto 下宽度
 *    能差 3% 上下（`FIT_RATIO` 就是留这个的）。**别把字号顶满内容区**：
 *    溢出的一小截会被右边相邻列的不透明背景盖住，看起来就是「名字显示不全」
 *    （2026-10-16 的「实装时间」列就是这么出事的）。
 *
 * ## 实测（2026-10-16，232 位干员）
 * 等效宽度分布：1(18) / 2(123) / 3(39) / 4(31) / 4.5(1) / 5(13) / 6(5) / 6.5(2)。
 * 套上本模块后：**95% 的名字仍是 13px**，6 宽的那 5 位用 11px，6.5 宽的 2 位用 10px。
 *
 * ## 改动时要一起改的地方
 * 改 `OP_NAME_COL_W` / `_PAD` / `_MAX_FS` / `_MIN_FS` / `_FIT_RATIO` 时，
 * `main.css` 干员列的 `width/min-width/max-width` 与两个组件的 `<colgroup>` 要同步
 * （`verify-render` 有断言盯着这三处一致，并会拿**真实干员名**验算「一个都不会溢出」）。
 */

/** 干员列**总宽**（含左右内边距）—— 三处必须一致：本文件 / main.css / `<colgroup>` */
export const OP_NAME_COL_W = 84;
/** 单元格左右内边距合计（`table.grid.stat-tbl th, td{padding:4px 6px}` → 6+6） */
export const OP_NAME_PAD = 12;
/** 常规字号 / 最小字号（px） */
export const OP_NAME_MAX_FS = 13;
export const OP_NAME_MIN_FS = 10;
/** 给跨平台字体宽度差异留的余量（可用宽 = 内容区 × 它） */
export const OP_NAME_FIT_RATIO = 0.94;

/**
 * 名字的**等效汉字宽度**：半角字符按 0.5 计，其余（汉字 / 全角标点）按 1 计。
 * 按**码点**遍历，代理对（罕见字）不会被拆成两半。
 * @param {string} name
 * @returns {number}
 */
export function opNameWidth(name) {
  let w = 0;
  for (const ch of String(name ?? '')) {
    w += ch.codePointAt(0) < 0x2e80 ? 0.5 : 1;
  }
  return w;
}

/**
 * 该名字在干员列里该用的字号（px）—— 放得下就用常规字号，放不下就逐档降。
 * ⚠️ 纯函数（只看名字本身）→ SSR 能渲染、`verify-render` 能直接断言。
 * @param {string} name
 * @returns {number} 10 ~ 13 的整数
 */
export function opNameFontSize(name) {
  const w = opNameWidth(name);
  if (!w) return OP_NAME_MAX_FS;
  const usable = (OP_NAME_COL_W - OP_NAME_PAD) * OP_NAME_FIT_RATIO;
  const fit = Math.floor(usable / w);
  return Math.max(OP_NAME_MIN_FS, Math.min(OP_NAME_MAX_FS, fit));
}

/** 直接给模板用的行内样式（`<b :style="opNameStyle(r.name)">`） */
export const opNameStyle = (name) => ({ fontSize: `${opNameFontSize(name)}px` });

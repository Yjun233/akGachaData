/**
 * lib/bannerCopy.js
 * ----------
 * 「点击卡池名称 → 复制这个卡池的信息」（用户 2026-10-19 加）。
 *
 * 输出**多行「字段：值」纯文本** —— 粘到聊天 / 笔记 / 文档里都整齐好读。
 * （要「能横着粘进 Excel」的表格数据，请用统计页 / 表格版的「复制」按钮，那边是 TSV：
 *   一个是「一行数据」，一个是「一段说明」，刻意不共用一套格式，见 `lib/clipboard.js` 文件头。）
 *
 * 字段与**表里看到的列**一一对应：卡池名称 / 类型 / 大类 / 开始日期 / 结束日期 /
 * 出率提升 6★ / 出率提升 5★。
 * ⭐ 干员名后面带上与表格同款的标记：`（限）` = 限定干员、`（店）` = 商店兑换
 *    （标记字 2026-10-19 由「兑」改成「店」）—— 否则复制出来就丢了「谁进店」这个信息。
 *   两个都占时写成 `（限·店）`。
 *
 * ⚠️ **纯函数**（不读 store、不碰 DOM、不碰剪贴板），所以 SSR 与核对脚本都能直接跑；
 *    写剪贴板是 `composables/useBannerCopy.js` 的事。
 */
import { TYPE_LABEL } from './constants.js';
import { opName } from './opFields.js';

/** 缺数据的占位（与表格里的 `.dash` 一致） */
const DASH = '—';

/** 单个 UP 干员：名字 + 标记（限 / 店） */
function opText(op) {
  const name = opName(op) || DASH;
  const marks = [];
  if (op?.isLimited) marks.push('限');
  if (op?.isShop) marks.push('店');
  return marks.length ? `${name}（${marks.join('·')}）` : name;
}

/** 某星级的 UP 干员，用「、」连接；没有就给 `—`（与表格里的空列一致） */
function opsOf(banner, rarity) {
  const list = (banner?.upOperators || []).filter((o) => (o?.rarity || 0) === rarity);
  return list.length ? list.map(opText).join('、') : DASH;
}

/**
 * 一个卡池 → 多行文本。
 * @param {object} banner      卡池对象（`{ id, scName, type, startDate, endDate, upOperators }`）
 * @param {object} [categories] type → 大类（store 的 `site.categories`；缺省时大类显示 `—`）
 * @returns {string} 七行，行间 `\n`，末尾无换行
 */
export function bannerText(banner, categories = {}) {
  const b = banner || {};
  return [
    `卡池名称：${b.scName || DASH}`,
    `类型：${TYPE_LABEL[b.type] || b.type || DASH}`,
    `大类：${categories[b.type] || DASH}`,
    `开始日期：${b.startDate || DASH}`,
    `结束日期：${b.endDate || DASH}`,
    `出率提升 6★：${opsOf(b, 6)}`,
    `出率提升 5★：${opsOf(b, 5)}`,
  ].join('\n');
}

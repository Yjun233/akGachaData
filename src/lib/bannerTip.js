/**
 * lib/bannerTip.js
 * ----------
 * 「结束时间」悬停气泡里的**干员 UP 情况**（2026-11-22 用户加）。
 *
 * 气泡原来是「卡池名 + 起止日期」两行，用户要求把 UP 干员也带出来 ——
 * 否则只知道是哪个池，却不知道那个池 UP 了谁。
 *
 * 输出按**星级从高到低**分组，每组 `{ rarity, ops: [{ name, limited, shop }] }`：
 *   · `name`    = 干员显示名（`opName()`，卡池 UP 项取 `scCharName`）；
 *   · `limited` = 限定干员（气泡里标「限」）；
 *   · `shop`    = 商店兑换（气泡里标「店」）。
 * 顺序就是 `upOperators` 里的原顺序（**不重排**：那个顺序是资源仓排好的首发 / 陪跑次序）。
 *
 * ⚠️ **纯函数**（不读 store、不碰 DOM），SSR 与核对脚本都能直接跑；
 *    标记的「限 / 店」两个字与 `lib/bannerCopy.js` 的 `opText()` 是同一套口径，
 *    只是一个给文本（`（限·店）`）、一个给 DOM（小方块标记）。
 * ⚠️ 星级用 `upOperators[].rarity`（1~6）；缺字段的按 0 归到最后一组，不会丢人。
 */
import { opName } from './opFields.js';

/**
 * 卡池 → 分组后的 UP 干员。
 * @param {object|null} banner 卡池对象（`{ upOperators: [...] }`）
 * @returns {Array<{rarity:number, ops:Array<{name:string, limited:boolean, shop:boolean}>}>}
 *          星级降序；空卡池 / 无 UP 项 → `[]`
 */
export function tipOps(banner) {
  const list = banner?.upOperators || [];
  const byRarity = new Map();
  for (const op of list) {
    const rarity = Number(op?.rarity) || 0;
    if (!byRarity.has(rarity)) byRarity.set(rarity, []);
    byRarity.get(rarity).push({
      name: opName(op) || '—',
      limited: !!op?.isLimited,
      shop: !!op?.isShop,
    });
  }
  return [...byRarity.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rarity, ops]) => ({ rarity, ops }));
}

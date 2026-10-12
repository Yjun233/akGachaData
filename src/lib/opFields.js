/**
 * lib/opFields.js
 * ----------
 * 「干员对象」在站内有**两种形状**，字段名不同 —— 这里把取值收口成两个函数，
 * 免得每处都写一遍 `??` 链、也免得漏掉一种形状（表现是**名字 / 头像静默变空**）。
 *
 *   · **完整干员**（`operators.json` 的值；`loadData.js` 把整份按名字索引进 store）：
 *       `{ scName, enName, jpName, charId, rarity, scReleaseDate, … }`
 *   · **卡池的 UP 项**（`banners[*].upOperators[i]`，三服一致）：
 *       `{ scCharName, charId, rarity, isLimited, isShop }`
 *
 * ⚠️ 2026-10-12 的字段规范**之前**这两种形状各自都叫 `name`，随手写 `op.name` 就对；
 *    改名后**再写 `.name` 会静默拿到 `undefined`**（界面变成空标签 / 空头像，不报错）。
 *    所以一律走这两个函数。
 *
 * 📌 「名字」在站内**就是国服中文名**（`scName` / `scCharName` 值相同）——
 *    PRTS / wiki.gg / 金山 三个源都按中文名对齐，`operators` 也按它索引。
 */

/** 干员显示名（国服中文名）。两种形状都吃，取不到给空串 */
export const opName = (op) => op?.scName ?? op?.scCharName ?? '';

/** 干员 charId（头像素材按它取）。取不到给 null */
export const opCharId = (op) => op?.charId ?? null;

/**
 * 干员头像。
 *
 * **真实素材**放在**独立资源仓库** `../akGachaResource/avatars/<charId>.png`
 * （远程 github.com/Yjun233/akGachaResource），站点主仓库里不含任何图片。
 * 开发时读本地、构建时读 jsDelivr CDN —— 见 `resource.js`。
 *
 * 素材源自 yuanyan3060/ArknightsGameResource 的 `avatar/<charId>.png`（原始 180×180 RGBA），
 * 由 `../akGachaResource/scripts/fetch-avatars.mjs` 下载并**压缩到 96×96**
 * （页面实际只显示 20~26px，96px 已有约 3.7 倍余量；想换回 180px 重跑脚本加 `--size=180` 即可）。
 *
 * ⚠️ 素材是**方形半身像**，不是圆图标。表格里由 CSS 裁成圆角方块；
 * 而画在 canvas 上的两处（UP 历史标记、首次进店间隔的折线点）需要**圆形**，
 * 由图表侧用 clipPath / 圆形蒙版处理（见 `upTimeline.js`、`ShopIntervalView.vue`）。
 *
 * `placeholderAvatar()` 保留作为兜底：素材缺失时用它（内联 data URI，不产生网络请求）。
 *
 * 形状：
 * - `square` —— 卡池列表 / 出率提升记录（表格里的头像）
 * - `circle` —— 首次进店间隔（画在 canvas 上的点，圆形）
 */
import { avatarFileUrl } from './resource.js';

const AVATAR_SIZE = 96; // 与本仓库 ../akGachaResource/avatars 里的素材一致（源图为 180，已压缩）
const USE_REAL_AVATARS = true;

const cache = new Map();

const escapeXml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[c]));

/**
 * 生成占位头像（data URI）。
 * @param {string} name  干员名（取首字）
 * @param {'square'|'circle'} shape
 */
export function placeholderAvatar(name, shape = 'square') {
  const key = `${shape}:${name}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const ch = escapeXml((name || '?').trim().charAt(0) || '?');
  const clip = shape === 'circle'
    ? '<circle cx="90" cy="90" r="90"/>'
    : '<rect width="180" height="180"/>';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" '
    + 'viewBox="0 0 180 180">'
    + `<defs><clipPath id="c">${clip}</clipPath></defs>`
    + '<g clip-path="url(#c)">'
    + '<rect width="180" height="180" fill="#dbeafe"/>'
    + '<text x="90" y="92" text-anchor="middle" dominant-baseline="central" '
    + 'font-family="system-ui,-apple-system,\'Microsoft YaHei\',sans-serif" '
    + `font-size="88" font-weight="700" fill="#1b4f9c">${ch}</text>`
    + '</g></svg>';

  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  cache.set(key, url);
  return url;
}

/**
 * 干员头像地址。有真实素材就用素材，否则回退占位图。
 * @param {object} op    干员对象（需要 charId / name）
 * @param {'square'|'circle'} shape
 */
export function avatarUrl(op, shape = 'square') {
  if (USE_REAL_AVATARS && op?.charId) return avatarFileUrl(op.charId);
  return placeholderAvatar(op?.name, shape);
}

export { AVATAR_SIZE, USE_REAL_AVATARS };

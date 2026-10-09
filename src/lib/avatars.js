/**
 * 干员头像。
 *
 * **真实素材**放在**独立资源仓库** `../akGachaResource/avatars/<charId>.png`
 * （远程 github.com/Yjun233/akGachaResource），站点主仓库里不含任何图片。
 * 开发时读本地、构建时读 jsDelivr CDN —— 见 `resource.js`。
 *
 * 素材源自 ArknightsAssets/ArknightsAssets2（`cn` 分支）的
 * `assets/dyn/arts/charavatars/<charId>.png`（原始 180×180 RGBA），
 * 由 `../akGachaResource/scripts/fetch-avatars.mjs` 下载并**压缩到 96×96**
 * （页面实际只显示 20~26px，96px 已有约 3.7 倍余量；想换回 180px 重跑脚本加 `--size=180` 即可）。
 * ⚠️ 2026-10-09 从 `yuanyan3060/ArknightsGameResource` 换到此处（后者更新更快）。
 *
 * ⚠️ 素材是**方形半身像**，不是圆图标。表格里由 CSS 裁成圆角方块；
 * 而画在 canvas 上的两处（UP 历史标记、首次UP间隔的折线点）需要**圆形**，
 * 由图表侧用 clipPath / 圆形蒙版处理（见 `upTimeline.js`、`FirstUpView.vue`）。
 *
 * `placeholderAvatar()` 保留作为兜底：素材缺失时用它（内联 data URI，不产生网络请求）。
 *
 * **加载中 / 加载失败**（2026-10-09 起）：图片模式下头像要先经 CDN / 本地请求，慢一点就露白、
 * 挂了就裂图。所以统一退化成**干员名首字占位图**（就是下面这个 `placeholderAvatar`）：
 * - DOM 三处（卡池列表 / 出率提升记录 / 首次UP表格版）→ `<AvatarImg>` 组件（监 load/error）；
 * - canvas 两处（UP 历史时间轴 / 首次UP图表版）→ `loadAvatar()` 预加载，
 *   未就绪时先画首字、就绪后再 `setOption` 重绘（见各自的 `avatarReady` 缓存）。
 *
 * 形状：
 * - `square` —— 卡池列表 / 出率提升记录（表格里的头像）
 * - `circle` —— 首次UP间隔（画在 canvas 上的点，圆形）
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

/**
 * 是否在**浏览器**里（能真的加载图片）。
 * ⚠️ SSR（`verify-render` / 构建时预渲染）没有 `Image` / `document`：
 *   既没法预加载、也不该按「未就绪」画首字占位 —— 那样整张图会变成圆底首字，
 *   断言「图片模式出现 <image>」直接红。所以 SSR 下**一律当真图已就绪**，
 *   直接把 `<image>` / `<img src=真素材>` 渲出去（浏览器接过去自己会加载）。
 */
const CAN_LOAD = typeof Image !== 'undefined' && typeof document !== 'undefined';

/**
 * 头像**加载状态**缓存：`charId → 'ok' | 'fail' | 'loading'`。
 * 只在 `preloadAvatar()` 里写，供 canvas 两处判断「能不能画真图」。
 * ⚠️ 不用 Map 存 Image 对象 —— 状态就够了，Image 本体在加载完后可以释放。
 */
const loadState = new Map();

/** 一个「加载完成」的订阅者集合（canvas 处加载完后要重绘） */
const listeners = new Set();

/** 订阅「某张头像加载完成（成功或失败都算）」的通知；返回取消订阅函数。 */
export function onAvatarLoad(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * 该干员的头像是否**已就绪且可用**（可以画真图）。
 * - SSR：恒 true（见 `CAN_LOAD` 说明）；
 * - 浏览器：只有明确加载成功才 true —— 加载中、失败、没查过都 false。
 */
export function avatarReady(op) {
  if (!op?.charId) return false;
  if (!CAN_LOAD) return true; // SSR：直接当真图
  return loadState.get(op.charId) === 'ok';
}

/**
 * 预加载干员头像（幂等；加载完通知订阅者）。
 * @param {object} op 干员对象（需要 charId）
 * @returns {boolean} 是否**已就绪可用**（同步返回当前状态，不等待）
 */
export function preloadAvatar(op) {
  const charId = op?.charId;
  if (!charId || !USE_REAL_AVATARS) return false;
  if (!CAN_LOAD) return true; // SSR：没有 Image，直接算就绪
  const st = loadState.get(charId);
  if (st) return st === 'ok'; // 已在加载 / 已定论

  loadState.set(charId, 'loading');
  const img = new Image();
  const done = (ok) => {
    loadState.set(charId, ok ? 'ok' : 'fail');
    listeners.forEach((fn) => fn(charId, ok));
  };
  img.onload = () => done(img.naturalWidth > 0);
  img.onerror = () => done(false);
  img.src = avatarFileUrl(charId);
  return false; // 刚发起，一定还没就绪
}

export { AVATAR_SIZE, USE_REAL_AVATARS };

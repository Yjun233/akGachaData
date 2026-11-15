/**
 * 把一张表格「复制为图片」—— 截图 + 写剪贴板（失败则下载）。
 *
 * 用 `html-to-image`（懒加载，只在点按钮时才 import，不进首屏包）：
 * 它把 DOM 转成 SVG `foreignObject` 让浏览器自己渲染，中文字体 / 头像这种
 * 交给浏览器处理，比手绘 canvas 保真得多。
 *
 * ⚠️ **移动端现实**：站点常用「手机连局域网 IP」打开（`http://192.168.x.x:5173`），
 *    那是**非安全上下文**，`navigator.clipboard` / `ClipboardItem` 直接不可用。
 *    所以写剪贴板失败时要**退化成下载 PNG**（`<a download>`），并且界面要如实说清
 *    「已下载图片」而不是假装复制成功 —— 这与 `lib/clipboard.js` 里文本那条兜底是同一个道理。
 *
 * ⚠️ **部分复制**（复制模式里选了某一行）：不是截完再裁 —— 表头与选中的行未必连续，
 *    裁不掉中间那段。改成**截图前临时把不要的行 `display:none`**，让布局自己收缩，截完再恢复。
 *
 * ⚠️ **冻结列 / 表头 sticky**：截图时 `position: sticky` 会按当前滚动位置算，出来可能错位或重叠，
 *    所以截图期间给容器加 `.shot-capturing`（CSS 里把 th/td 的 sticky 全改成 static）。
 */

/**
 * 表格容器 → PNG Blob。
 * @param {HTMLElement} container 表格外层（通常是 `.tbl-scroll`）
 * @param {object} [opts]
 * @param {((i:number)=>boolean)|null} [opts.keepRow] 只保留哪些 `tbody tr`（下标 0 起）；
 *        `null` = 全表
 * @param {number} [opts.pixelRatio] 输出倍率（默认 2，手机上够清晰又不太大）
 * @returns {Promise<Blob|null>} 失败返回 null（调用方显示「失败」，不静默）
 */
export async function tableToBlob(container, { keepRow = null, pixelRatio = 2 } = {}) {
  if (!container) return null;
  const trs = [...container.querySelectorAll('tbody tr')];
  /* 记录被隐藏的行 —— 无论成功失败都必须在 finally 里恢复，否则表格会「缺行」 */
  const hidden = [];
  if (keepRow) {
    trs.forEach((tr, i) => {
      if (!keepRow(i)) { tr.style.display = 'none'; hidden.push(tr); }
    });
  }
  container.classList.add('shot-capturing');
  try {
    const { toBlob } = await import('html-to-image');
    const blob = await toBlob(container, {
      pixelRatio,
      backgroundColor: '#ffffff',
      /* 同源图片（头像）直接内联；跨域图（理论上没有）失败时会让整张图挂掉，所以关掉跨域抓取 */
      cacheBust: true,
      skipFonts: true,
    });
    return blob && blob.size > 0 ? blob : null;
  } catch {
    return null;
  } finally {
    for (const tr of hidden) tr.style.display = '';
    container.classList.remove('shot-capturing');
  }
}

/** 把 PNG 写进剪贴板；非安全上下文 / 浏览器不支持 / 无权限都返回 false（不抛错） */
export async function copyImageBlob(blob) {
  if (!blob) return false;
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
  if (typeof window === 'undefined' || typeof window.ClipboardItem === 'undefined') return false;
  try {
    await navigator.clipboard.write([new window.ClipboardItem({ [blob.type || 'image/png']: blob })]);
    return true;
  } catch {
    return false;
  }
}

/** 退路：触发下载（局域网 http / 不支持写图片剪贴板时用） */
export function downloadBlob(blob, filename) {
  if (!blob || typeof document === 'undefined') return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}

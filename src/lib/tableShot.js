/**
 * 把一张表格「截图」—— 截图 + 写剪贴板（真写不进去才下载）。
 * ⚠️ 界面文案 2026-11-21 起统一叫「截图」（原「复制为图片」），内部函数名不变。
 *
 * 用 `html-to-image`（懒加载，只在点按钮时才 import，不进首屏包）：
 * 它把 DOM 转成 SVG `foreignObject` 让浏览器自己渲染，中文字体 / 头像这种
 * 交给浏览器处理，比手绘 canvas 保真得多。
 *
 * ⚠️ **写剪贴板有两条路，按顺序试**（用户 2026-11-15：「我希望复制到剪贴板而不是下载」）：
 *    1. 异步剪贴板 `navigator.clipboard.write([ClipboardItem])` —— 唯一的「原生图片剪贴板」，
 *       但它**只在安全上下文**里存在。手机连局域网 IP（`http://192.168.x.x:5173`）是**非安全上下文**，
 *       `navigator.clipboard` 直接是 undefined；
 *    2. 老接口 `document.execCommand('copy')` —— 把 PNG 转成 data URL 塞进一个选中状态的
 *       `<img>`，让浏览器按「复制富文本」写进剪贴板。粘到 Word / WPS / 富文本编辑器里是图，
 *       粘到纯文本框里会退化成一行 data URI（这是老接口的固有代价）。
 *    两条都失败才 `downloadBlob()` 兜底，并且界面如实显示「已下载图片」而不是假装复制成功。
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
  /* 复制模式的「范围外染灰」（`.row-out`）是给人看的操作提示，**不能进截图** ——
     用户 2026-11-15 明确要求「截图里不要有因为选中而染的色」。
     摘掉类最稳（比用 CSS 覆盖回去好：覆盖要跟 `!important` 打架，还会丢掉隔行底色）。 */
  const tinted = [...container.querySelectorAll('tbody tr.row-out')];
  for (const tr of tinted) tr.classList.remove('row-out');
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
    for (const tr of tinted) tr.classList.add('row-out');
    container.classList.remove('shot-capturing');
  }
}

/**
 * 把 PNG 写进剪贴板 —— **能复制就复制，别偷偷下载**（用户 2026-11-15 明确要求）。
 *
 * 顺序：异步剪贴板 → `execCommand` 富文本兜底。两条都不行才返回 false（调用方去下载）。
 * @param {Blob} blob
 * @returns {Promise<boolean>}
 */
export async function copyImage(blob) {
  if (!blob) return false;
  if (await copyImageBlob(blob)) return true;
  return copyImageByDom(blob);
}

/** 走异步剪贴板（安全上下文 + 支持 ClipboardItem 才行）；任何异常都返回 false */
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

/** Blob → data URL（老接口那条路要的是「能被粘贴时带走的内容」，blob: URL 活不过这一次粘贴） */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(new Error('read fail'));
    fr.readAsDataURL(blob);
  });
}

/**
 * 老接口兜底：把图片塞进一个**被选中**的临时节点，`execCommand('copy')` 写进剪贴板。
 *
 * 非安全上下文（http + 局域网 IP）里没有异步剪贴板，但 `execCommand` 还能用 —— 它复制的是
 * 「富文本」，浏览器会把选中内容拼成 `text/html` + `text/plain` 交给剪贴板。
 * ⚠️ 节点必须**离屏但可见**（`opacity:0` + 固定在视口外）—— `display:none` 的节点选不中。
 * ⚠️ 用完必须还原用户原来的选区，否则页面上「刚选中的文字」会被这次复制弄丢。
 */
export async function copyImageByDom(blob) {
  if (!blob || typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  let url = '';
  try {
    url = await blobToDataUrl(blob);
  } catch {
    return false;
  }
  const host = document.createElement('div');
  host.setAttribute('contenteditable', 'true');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;';
  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  host.appendChild(img);

  const sel = window.getSelection ? window.getSelection() : null;
  const saved = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  let ok = false;
  try {
    document.body.appendChild(host);
    const range = document.createRange();
    range.selectNodeContents(host);
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    try {
      if (sel) {
        sel.removeAllRanges();
        if (saved) sel.addRange(saved);
      }
      host.remove();
    } catch { /* 清场失败不影响结果 */ }
  }
  return ok;
}

/** 最后兜底：触发下载（两条剪贴板路都不通时用，界面会显示「已下载图片」） */
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

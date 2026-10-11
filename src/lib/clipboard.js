/**
 * 剪贴板 —— 把表格复制成**能直接粘进 Excel 的二维数据**。
 *
 * 用途：统计页（出率提升记录）四张表 + 首次UP间隔表格版两张表右上角的「复制」按钮
 * （用户 2026-10-11 要求：「复制后可在 Excel 里粘贴为表格」）。
 *
 * 为什么是 **TSV（Tab 分隔）** 而不是 HTML 表格：Excel / WPS / Numbers 都认
 * 「多行纯文本 + 单元格之间一个 Tab」这种剪贴板格式，粘进去就是规规矩矩的表格；
 * 纯文本编辑器里也仍然可读。HTML 那份在部分工具里会带进样式，反而更难用。
 * 换行用 **CRLF**：Excel 两种都吃，但 Windows 记事本只认 CRLF。
 *
 * ⚠️⚠️ 这个函数**不是**只在 HTTPS 下才工作 —— 站点常用「手机连局域网 IP」的方式打开
 * （`http://192.168.x.x:5173`），那是**非安全上下文**，`navigator.clipboard` 直接是
 * `undefined`。所以必须有 `execCommand('copy')` 那条兜底路径，否则手机上点「复制」没反应。
 */

/** 单元格里的制表符 / 换行会把表格结构顶歪 → 一律压成空格（并去掉首尾空白） */
const cellText = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();

/**
 * 二维数组 → TSV 文本。
 * ⚠️ 入参**含表头行**（第一行），单元格必须是原始值（数字直接用数字，`null` / `undefined` → 空）。
 * @param {Array<Array<string|number|null|undefined>>} rows
 * @returns {string}
 */
export function toTSV(rows) {
  return (rows || []).map((r) => (r || []).map(cellText).join('\t')).join('\r\n');
}

/**
 * 把文本写进剪贴板，返回是否成功。
 * ① 优先异步剪贴板 API（HTTPS / localhost 且用户手势触发时可用）；
 * ② 否则退回「临时 textarea + `execCommand('copy')`」—— 局域网 http 访问靠它。
 * 两条都失败才返回 false（界面据此显示「复制失败」，不静默）。
 *
 * ⚠️ 只在**点击回调**里调用：两个 API 都要求用户手势，且 SSR 阶段没有 `navigator` / `document`。
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyText(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 落到下面的兜底：权限被拒 / 非安全上下文 / 浏览器不给写 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');          // 只读，免得手机上弹键盘
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';                 // 不占版面、也不引发滚动
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length); // iOS Safari 要这一下才选得中
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

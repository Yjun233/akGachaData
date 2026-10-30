/**
 * 日期框的**粘贴增强**（2026-10-30 用户要求）：
 * 「电脑网页端的所有日期框，希望允许复制粘贴 `2026-10-29` 这种格式的日期，
 *   方便快速复制某个卡池的日期去设定范围」。
 *
 * 原生 `<input type="date">` 对粘贴很挑剔：它按**本地化分段**（年 / 月 / 日）理解剪贴板，
 * 粘一长串（尤其整段「卡池名称：… 开始日期：2026-10-29 …」）时经常整段被忽略。
 * 这里在 document 上挂一个**捕获阶段**的 paste 监听：认出目标就是日期框时，
 * 自己从文本里抠日期、`preventDefault()`、写 `value` 再补发 `input` / `change` ——
 * 于是 `v-model` 与 `:value` + `@change` 两种写法都能收到更新。
 *
 * 认得的写法：`2026-10-29` / `2026/10/29` / `2026.10.29` / `2026年10月29日` / `20261029`，
 * 前后有别的字也行（取第一个能当日期用的片段）。
 *
 * ⚠️ **一段文本里有多个日期时**（比如用户直接粘「点名称复制」出来的七行）：
 *    · 框上写了 `data-date-pick="last"` → 取**最后一个**；
 *    · 否则 id 以 `-to` 结尾（`f-to` / `fup-to` / `up-to` 这些「结束日期」框）→ 取最后一个；
 *    · 其余 → 取**第一个**。
 *   复制文本里「开始日期」在「结束日期」之前（见 `lib/bannerCopy.js` 的 `bannerText`），
 *   所以粘进「开始 / 结束」两个框都能各取所需，不用手动删一半。
 */

/** 拆成 { y, m, d } 并做基本范围校验；不合法 → null */
function toParts(y, m, d) {
  const yy = Number(y);
  const mm = Number(m);
  const dd = Number(d);
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  if (yy < 1900 || yy > 2200 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  /* 真实存在的日期才收（2026-02-30 这类直接判掉，免得写进 input 变成空值） */
  const probe = new Date(Date.UTC(yy, mm - 1, dd));
  if (probe.getUTCFullYear() !== yy || probe.getUTCMonth() !== mm - 1 || probe.getUTCDate() !== dd) return null;
  return { y: yy, m: mm, d: dd };
}

const pad2 = (n) => String(n).padStart(2, '0');

/** 文本里**所有**能当日期用的片段 → `['2026-10-29', …]`（按出现顺序） */
export function findDates(text) {
  const s = String(text ?? '');
  const out = [];
  /* 带分隔符：2026-10-29 / 2026/10/29 / 2026.10.29 / 2026年10月29日 */
  const reSep = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/g;
  /* 纯数字：20261029（前后不能紧贴别的数字） */
  const reNum = /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/g;
  const hits = [];
  for (const re of [reSep, reNum]) {
    re.lastIndex = 0;
    let m = re.exec(s);
    while (m) {
      const parts = toParts(m[1], m[2], m[3]);
      if (parts) hits.push({ at: m.index, iso: `${parts.y}-${pad2(parts.m)}-${pad2(parts.d)}` });
      m = re.exec(s);
    }
  }
  hits.sort((a, b) => a.at - b.at);
  for (const h of hits) out.push(h.iso);
  return out;
}

/**
 * 从文本里取**一个**日期（没认出 → `null`）。
 * @param {string} text 剪贴板内容
 * @param {'first'|'last'} [pick] 有多个日期时取哪个（默认 first）
 */
export function extractDate(text, pick = 'first') {
  const all = findDates(text);
  if (!all.length) return null;
  return pick === 'last' ? all[all.length - 1] : all[0];
}

/** 这个日期框在「一段文本有多个日期」时该取哪个 */
function pickModeOf(el) {
  if (!el) return 'first';
  if (el.dataset?.datePick === 'last') return 'last';
  if (el.dataset?.datePick === 'first') return 'first';
  return /-to$/i.test(el.id || '') ? 'last' : 'first';
}

/**
 * 装上粘贴增强（**幂等**，重复调用不会挂两次）。返回卸载函数。
 * @param {Document} [doc] 便于测试注入
 */
export function installDatePaste(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || typeof d.addEventListener !== 'function' || d.__akDatePaste) {
    return () => {};
  }
  const onPaste = (ev) => {
    const el = ev.target;
    if (!el || el.tagName !== 'INPUT' || el.type !== 'date') return;
    if (el.disabled || el.readOnly) return;
    const text = ev.clipboardData ? ev.clipboardData.getData('text') : '';
    const date = extractDate(text, pickModeOf(el));
    if (!date) return;                    // 认不出 → 交回浏览器的默认行为，别把用户粘的内容吞掉
    ev.preventDefault();
    el.value = date;
    /* 两种绑定都要能收到：v-model 听 input，FilterDrawer 那几个是 @change */
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  d.addEventListener('paste', onPaste, true);
  d.__akDatePaste = onPaste;
  return () => {
    d.removeEventListener('paste', onPaste, true);
    delete d.__akDatePaste;
  };
}

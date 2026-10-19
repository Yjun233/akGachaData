/**
 * composables/useBannerCopy.js
 * ----------
 * 「点击卡池名称复制」的交互状态（用户 2026-10-19 加）。
 *
 * 宽屏表格（`BannerTable`）与窄屏卡片（`BannerCards`）**共用这一套** ——
 * 复制内容与提示的时序都收在这里，两个组件只负责把 `copyBanner` 挂到名字上、
 * 把 `stateOf(b.id)` 渲染成名字旁那一小截提示。
 *
 * ⚠️ 提示是**临时的**（1.6 秒后自己消失），组件卸载时清掉定时器，
 *    免得往已卸载的组件上写状态（与 `CopyButton.vue` 同款处理）。
 * ⚠️ 写剪贴板走 `lib/clipboard.js` 的 `copyText` —— 它带 `execCommand` 兜底，
 *    **手机连局域网 IP（非 HTTPS）时异步剪贴板 API 是 `undefined`**，没兜底就点不动。
 */
import { onBeforeUnmount, ref } from 'vue';
import { copyText } from '../lib/clipboard.js';
import { bannerText } from '../lib/bannerCopy.js';

/** 提示停留时长（与表格右上角复制按钮的 1600ms 一致） */
const TIP_MS = 1600;

export function useBannerCopy() {
  /** 当前要提示的那一行：`{ id, state }`，state ∈ 'idle' | 'ok' | 'fail' */
  const tip = ref({ id: null, state: 'idle' });
  let timer = null;

  /**
   * 复制一个卡池的信息。
   * @param {object} banner 卡池对象
   * @param {object} categories type → 大类（`site.categories`）
   */
  async function copyBanner(banner, categories) {
    const ok = await copyText(bannerText(banner, categories));
    tip.value = { id: banner.id, state: ok ? 'ok' : 'fail' };
    clearTimeout(timer);
    timer = setTimeout(() => { tip.value = { id: null, state: 'idle' }; }, TIP_MS);
  }

  /** 这一行现在要显示什么状态：'' = 不显示、'ok' = 已复制、'fail' = 复制失败 */
  const stateOf = (id) => (tip.value.id === id ? tip.value.state : '');

  onBeforeUnmount(() => clearTimeout(timer));

  return { tip, copyBanner, stateOf };
}

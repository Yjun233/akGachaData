<script setup>
/**
 * 表格右上角的「复制」按钮（用户 2026-10-11 加：复制后可在 Excel 里粘贴为表格）。
 *
 * ⚠️ 传进来的是**二维数组**（`rows`，第一行是表头），不是 DOM ——
 *    这样图片模式（表格里只有头像、没有名字）也能复制到干员名，
 *    而且复制内容与「表格当前显示的口径」完全一致（都由视图层算好）。
 * ⚠️ 复制结果的状态（已复制 / 复制失败）是**临时**的，1.6 秒后自己回到「复制」；
 *    组件卸载时清掉定时器，免得往已卸载的组件上写状态。
 * ⚠️ 图标是**内联 SVG**（与全站一致，不引图标库）。
 * ⚠️ 状态类**只在 ok / fail 时加**（idle 不加空类）：这样 SSR 产物里是一个干净的静态 class，
 *    `verify-render` 能按整串数按钮个数。⚠️ 顺带一条坑：**不要在模板里写 HTML 注释**——
 *    Vue SSR 会把注释原样输出，注释里若出现类名字样就会把「数元素」的断言数翻倍
 *    （这一条就是踩了之后挪到 script 里的）。
 */
import { onBeforeUnmount, ref } from 'vue';
import { copyText, toTSV } from '../lib/clipboard.js';

const props = defineProps({
  /** 含表头的二维数组，见 lib/clipboard.js 的 `toTSV` */
  rows: { type: Array, required: true },
  /** 悬停提示（默认说明「粘进 Excel」这件事） */
  title: { type: String, default: '复制为表格（可直接粘进 Excel）' },
});

/** idle | ok | fail —— 只影响按钮上的文案与配色 */
const state = ref('idle');
let timer = null;

async function onCopy() {
  const ok = await copyText(toTSV(props.rows));
  state.value = ok ? 'ok' : 'fail';
  clearTimeout(timer);
  timer = setTimeout(() => { state.value = 'idle'; }, 1600);
}

onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <button
    class="copy-btn" type="button" :class="{ ok: state === 'ok', fail: state === 'fail' }"
    :title="title" :aria-label="title" @click="onCopy"
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">
      <rect x="8.6" y="8.6" width="11.4" height="11.4" rx="2.6" />
      <path d="M15.4 6.4V5.6A2.6 2.6 0 0 0 12.8 3H5.6A2.6 2.6 0 0 0 3 5.6v7.2a2.6 2.6 0 0 0 2.6 2.6h.8" />
    </svg>
    <span aria-live="polite">{{ state === 'ok' ? '已复制' : state === 'fail' ? '复制失败' : '复制' }}</span>
  </button>
</template>

<script setup>
/**
 * 表格右上角的**三个复制动作**（2026-11-15 扩展）：
 *   · 复制为文本 —— 原来的「复制」（TSV，可直接粘进 Excel）；
 *   · 复制模式   —— 点表格某一行，只复制「表头 + 该行及以上 / 及以下」；
 *   · 复制为图片 —— 把那部分截成 PNG（写剪贴板，非安全上下文退化成下载）。
 *
 * ⚠️ 传进来的是**二维数组**（`rows`，第一行是表头），不是 DOM ——
 *    这样图片模式（表格里只有头像、没有名字）也能复制到干员名，
 *    而且复制内容与「表格当前显示的口径」完全一致（都由视图层算好）。
 * ⚠️ 行选中是**直接操作表格 DOM**（`tableId` 指向 `.tbl-scroll`）而不是把状态提上去：
 *    按钮在标题栏、表格是**兄弟节点**，提状态要改 3 个组件的 props 链；
 *    而 `.copy-mode` / `.row-sel` 只是纯视觉，不进数据流，用 DOM 反而更省。
 *    代价：**只在客户端可用**（SSR 下 `mode` 恒 false，渲染出来的还是三个按钮 + 无选中态）。
 * ⚠️ 复制结果的状态（已复制 / 复制失败 / 已下载图片）是**临时**的，1.6~2 秒后自己落回；
 *    组件卸载时清掉定时器，免得往已卸载的组件上写状态。
 * ⚠️ 状态类**只在 ok / fail / download 时加**（idle 不加空类），`verify-render` 能按整串数按钮。
 * ⚠️ **不要在模板里写 HTML 注释** —— Vue SSR 会原样输出，注释里的类名字样会把断言数翻倍。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { copyText, toTSV } from '../lib/clipboard.js';
import { sliceCopyRows } from '../lib/tableCopy.js';

const props = defineProps({
  /** 含表头的二维数组，见 lib/clipboard.js 的 `toTSV` */
  rows: { type: Array, required: true },
  /** 表格外层容器的 DOM id（`.tbl-scroll`）—— 复制模式与截图都靠它定位 */
  tableId: { type: String, default: '' },
  /** 复制模式选中某行后取哪一段：`above` = 该行及以上（统计页）/ `below` = 该行及以下（首次UP表格版） */
  range: { type: String, default: 'above' },
  /** 「复制为文本」的悬停提示 */
  title: { type: String, default: '复制为表格（可直接粘进 Excel）' },
});

/** 文本 / 图片各自的临时状态：idle | ok | fail | working | download */
const textState = ref('idle');
const imgState = ref('idle');
/** 复制模式开关 */
const mode = ref(false);
/** 选中的行（`tbody tr` 下标，0 起）；null = 未选（整表复制） */
const sel = ref(null);
let textTimer = null;
let imgTimer = null;

const tableEl = () => (props.tableId && typeof document !== 'undefined'
  ? document.getElementById(props.tableId)
  : null);

/** 按选中行裁出的复制范围：**永远含表头**（算法在 lib/tableCopy.js，那里单测） */
const rowsForCopy = computed(() => sliceCopyRows(props.rows, sel.value, props.range));

/** 复制模式下的提示（未选 / 已选） */
const selHint = computed(() => {
  const body = Math.max(0, (props.rows || []).length - 1);
  if (sel.value == null) {
    return props.range === 'below'
      ? `点表格里某一行：只复制它及以下（含表头，共 ${body} 行）`
      : `点表格里某一行：只复制它及以上（含表头，共 ${body} 行）`;
  }
  return `已选第 ${sel.value + 1} 行 · 将复制 ${rowsForCopy.value.length - 1} 行（含表头）`;
});

async function onCopy() {
  const ok = await copyText(toTSV(rowsForCopy.value));
  textState.value = ok ? 'ok' : 'fail';
  clearTimeout(textTimer);
  textTimer = setTimeout(() => { textState.value = 'idle'; }, 1600);
}

/** 行点击（只在复制模式下绑定） */
function onRowClick(e) {
  const box = tableEl();
  if (!box) return;
  const tr = e.target?.closest?.('tbody tr');
  if (!tr || !box.contains(tr)) return;
  const all = [...box.querySelectorAll('tbody tr')];
  const i = all.indexOf(tr);
  if (i < 0) return;
  for (const x of all) x.classList.remove('row-sel');
  tr.classList.add('row-sel');
  sel.value = i;
}

function clearSel() {
  sel.value = null;
  const box = tableEl();
  if (!box) return;
  for (const x of box.querySelectorAll('tbody tr.row-sel')) x.classList.remove('row-sel');
}

function bindMode(on) {
  const box = tableEl();
  if (!box) return;
  box.classList.toggle('copy-mode', on);
  if (on) box.addEventListener('click', onRowClick);
  else box.removeEventListener('click', onRowClick);
}

watch(mode, (on) => {
  bindMode(on);
  if (!on) clearSel();
});

async function onImage() {
  const box = tableEl();
  if (!box) return;
  imgState.value = 'working';
  clearTimeout(imgTimer);
  try {
    const { tableToBlob, copyImageBlob, downloadBlob } = await import('../lib/tableShot.js');
    const keepRow = sel.value == null
      ? null
      : (i) => (props.range === 'below' ? i >= sel.value : i <= sel.value);
    const blob = await tableToBlob(box, { keepRow });
    if (!blob) {
      imgState.value = 'fail';
    } else if (await copyImageBlob(blob)) {
      imgState.value = 'ok';
    } else {
      downloadBlob(blob, `akgacha-${new Date().toISOString().slice(0, 10)}.png`);
      imgState.value = 'download';
    }
  } catch {
    imgState.value = 'fail';
  }
  imgTimer = setTimeout(() => { imgState.value = 'idle'; }, 2000);
}

onBeforeUnmount(() => {
  clearTimeout(textTimer);
  clearTimeout(imgTimer);
  bindMode(false);
  clearSel();
});
</script>

<template>
  <div class="copy-actions">
    <button
      class="copy-btn" type="button" data-act="text"
      :class="{ ok: textState === 'ok', fail: textState === 'fail' }"
      :title="title" :aria-label="title" @click="onCopy"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">
        <rect x="8.6" y="8.6" width="11.4" height="11.4" rx="2.6" />
        <path d="M15.4 6.4V5.6A2.6 2.6 0 0 0 12.8 3H5.6A2.6 2.6 0 0 0 3 5.6v7.2a2.6 2.6 0 0 0 2.6 2.6h.8" />
      </svg>
      <span aria-live="polite">{{ textState === 'ok' ? '已复制' : textState === 'fail' ? '复制失败' : '复制为文本' }}</span>
    </button>

    <button
      class="copy-btn" type="button" data-act="mode" :class="{ active: mode }"
      :title="mode ? '退出复制模式（恢复整表复制）' : '进入复制模式：点表格某一行，只复制那一部分'"
      :aria-pressed="mode" @click="mode = !mode"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">
        <path d="M4 7h16M4 12h10M4 17h13" />
        <circle cx="19.5" cy="17" r="2.2" />
      </svg>
      <span>{{ mode ? '退出复制' : '复制模式' }}</span>
    </button>

    <button
      class="copy-btn" type="button" data-act="image"
      :class="{ ok: imgState === 'ok' || imgState === 'download', fail: imgState === 'fail' }"
      title="把这张表截成 PNG（能直接发出去；本机不支持写图片剪贴板时会下载文件）"
      @click="onImage"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">
        <rect x="3" y="4.5" width="18" height="15" rx="2.4" />
        <circle cx="8.6" cy="10" r="1.6" />
        <path d="m4 17 4.8-4.6a2 2 0 0 1 2.7 0L20 20" />
      </svg>
      <span aria-live="polite">{{ imgState === 'working' ? '生成中…'
        : imgState === 'ok' ? '已复制图片'
          : imgState === 'download' ? '已下载图片'
            : imgState === 'fail' ? '生成失败' : '复制为图片' }}</span>
    </button>

    <span v-if="mode" class="copy-mode-hint">{{ selHint }}</span>
  </div>
</template>

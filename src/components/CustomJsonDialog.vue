<script setup>
/**
 * 自定义卡池的 **JSON 编辑子窗** —— 从主弹窗底部那个「编辑 JSON…」按钮打开
 * （用户 2026-10-06 定：编辑框别挤在主弹窗里，**单独开一个窗**）。
 *
 * 框里就是**全部自设**（三服）的 JSON —— 想备份就整段复制走，想批量改就直接改。
 * 「应用」= `store.replaceCustom()`，语义是**整体覆盖**（逐条校验、非法的跳过并报数）；
 * 「放弃修改」= 重新从 store 载入。
 *
 * ⚠️ 只要 `site.customEntries` 变了（保存 / 删除 / 应用）就刷新框里的内容，
 *    否则框里是过期数据、再点「应用」反而把别处的改动盖回去。
 * ⚠️ 层级比主弹窗高一档（`z-index:70` vs 主弹窗的 60），所以是「叠在上面」而不是替换它。
 */
import { computed, ref, watch } from 'vue';
import { useSiteStore } from '../stores/site.js';
import { summarizeCustom } from '../lib/customBanners.js';

const emit = defineEmits(['close']);
const site = useSiteStore();

/**
 * **各服有哪些类型的自设、各几个**（2026-10-30 用户要求，写在 JSON 编辑这里）。
 * 统计口径在 `lib/customBanners.js` 的 `summarizeCustom()`（与 `exportCustom()` 同源：
 * 框里写了几条，这里就报几条 —— 被去重吃掉但还没清理的也算）。
 */
const customSummary = computed(() => summarizeCustom(site.customEntries)
  .map((s) => (s.count
    ? `${s.label} ${s.count} 条（${s.byType.map((t) => `${t.label} ×${t.count}`).join('、')}）`
    : `${s.label} 无`))
  .join(' · '));

const jsonText = ref('');
const jsonMsg = ref('');

/* `immediate` 让它在打开时就填上内容；之后 store 一变就跟着刷新（**不清 `jsonMsg`**，
   好让「已应用 N 条」这类提示留得住） */
watch(() => site.customEntries, () => {
  jsonText.value = site.exportCustom();
}, { deep: true, immediate: true });

function reload() {
  jsonText.value = site.exportCustom();
  jsonMsg.value = '已重新载入当前内容';
}

/** 把框里的 JSON **整体应用**（覆盖，不是追加）—— 走与「添加」同一套校验 */
function apply() {
  const res = site.replaceCustom(jsonText.value);
  if (!res.ok) {
    jsonMsg.value = `应用失败：${res.error}`;
    return;
  }
  const tail = res.migrated ? '（旧格式 v1 / v2 已自动迁移为 v3）' : '';
  jsonMsg.value = res.skipped.length
    ? `已应用 ${res.count} 条，跳过 ${res.skipped.length} 条（${res.skipped[0].errors[0]}…）${tail}`
    : `已应用 ${res.count} 条${tail}`;
}
</script>

<template>
  <div class="cbd-mask cbd-mask-top" @click.self="emit('close')">
    <div class="cbd-box cbd-box-json" role="dialog" aria-label="自定义卡池 JSON">
      <div class="cbd-hd">
        <span class="h">JSON 编辑（全部服务器）</span>
        <button class="drawer-close" type="button" title="关闭" @click="emit('close')">✕</button>
      </div>

      <p class="cbd-tip">
        「<b>应用</b>」= 用框里的内容<b>整体覆盖</b>全部自设（删掉一段就等于删掉那条）；
        不合法的条目会被<b>跳过</b>、其余照常生效。备份就整段<b>复制走</b>。
        <br />
        每条的形状<b>与卡池数据一致</b>：<code>scName</code> / <code>type</code> /
        <code>startDate</code> / <code>endDate</code> /
        <code>upOperators: [{ scCharName, charId, rarity, isLimited, isShop }]</code>
        （单六寻访另有 <code>rerunKind</code> 与自动推导的 <code>canRerun</code>），
        只多 <code>server</code> / <code>uid</code> 两个自设专有键。
        <br />
        <b>旧格式（v1 / v2）的文件也能直接粘</b>，会自动迁移。
      </p>

      <p class="cbd-hint">框里现在有：{{ customSummary }}</p>

      <textarea
        v-model="jsonText" class="cbd-json cbd-json-big" spellcheck="false" wrap="off"
        aria-label="自定义卡池 JSON"
      ></textarea>

      <div class="cbd-iorow">
        <button class="btn primary" type="button" @click="apply">应用</button>
        <button class="btn" type="button" @click="reload">放弃修改</button>
        <button class="btn" type="button" @click="emit('close')">关闭</button>
        <span v-if="jsonMsg" class="cbd-hint">{{ jsonMsg }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * 跨服卡池对比（宽屏表格，`/cross-server`，2026-11-04 用户加）。
 *
 * 九列：卡池名称 / 类型 / 国服开始日期 / 国际服开始日期 / 繁中服开始日期 /
 *       SC-EN时间差 / SC-TC时间差 / EN-TC时间差 / 出率提升。
 *
 * 口径全在 `lib/crossServer.js` 的文件头里，这里只负责呈现：
 * - 前 8 列可点表头排序（默认国服开始日期倒序，状态在 `site.crossSort`）；
 * - 缺那一期 → `—`；差值为 `null`（缺一服）也是 `—`；
 * - 负数差值加 `.neg`（琥珀色，与「首次UP间隔·表格版」的负间隔同一套视觉语言）；
 * - 「出率提升」常态**不显示干员**，只有一个「查看」按钮；三服 6★ 名单不一致时旁边挂 `≠`
 *   （用户 2026-11-04 明确：标记挂这一列，不挂名称列）。
 *
 * ⚠️ 列宽只认 `CROSS_COLS`（`table-layout:fixed` 下 colgroup 是唯一真源）；
 *    日期列不能低于 116px，否则表头「国际服开始日期」会被 `overflow:hidden` 静默裁字。
 */
import { computed } from 'vue';
import { CROSS_COLS, CAT_CLASS, TYPE_LABEL } from '../lib/constants.js';
import { CROSS_SERVER_LABELS, CROSS_SERVERS } from '../lib/crossServer.js';
import { useSiteStore } from '../stores/site.js';

defineProps({
  rows: { type: Array, required: true },
});
const emit = defineEmits(['open']);

const site = useSiteStore();

const totalWidth = computed(() => CROSS_COLS.reduce((a, b) => a + b, 0));
const sortClass = (key) => (site.crossSort.key === key ? `sort-${site.crossSort.dir}` : '');
/** 三个差值列的排序键与列头，按显示顺序 */
const GAP_COLS = [
  { key: 'gapEnSc', label: 'SC-EN时间差', title: '国际服减国服的天数，负数表示国际服更早' },
  { key: 'gapTcSc', label: 'SC-TC时间差', title: '繁中服减国服的天数，负数表示繁中服更早' },
  { key: 'gapTcEn', label: 'EN-TC时间差', title: '繁中服减国际服的天数，负数表示繁中服更早' },
];
</script>

<template>
  <div class="tbl-scroll">
    <table class="grid floating" :style="{ width: 100 + '%', minWidth: totalWidth + 'px' }">
      <colgroup>
        <col v-for="(w, i) in CROSS_COLS" :key="i" :style="{ width: w / totalWidth + '%', minWidth: w + 'px' }" />
      </colgroup>
      <thead>
        <tr>
          <th :class="sortClass('name')" data-sort="name" @click="site.toggleCrossSort('name')">
            卡池名称<span class="arw">▲</span>
          </th>
          <th :class="sortClass('type')" data-sort="type" @click="site.toggleCrossSort('type')">
            类型<span class="arw">▲</span>
          </th>
          <th
            v-for="s in CROSS_SERVERS" :key="s"
            :class="sortClass(s + 'Start')" :data-sort="s + 'Start'"
            @click="site.toggleCrossSort(s + 'Start')"
          >{{ CROSS_SERVER_LABELS[s] }}开始日期<span class="arw">▲</span></th>
          <th
            v-for="g in GAP_COLS" :key="g.key"
            :class="sortClass(g.key)" :data-sort="g.key" :title="g.title"
            @click="site.toggleCrossSort(g.key)"
          >{{ g.label }}<span class="arw">▲</span></th>
          <th class="no-sort ops">出率提升</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!rows.length">
          <td :colspan="CROSS_COLS.length">
            <div class="empty">没有符合条件的卡池</div>
          </td>
        </tr>
        <tr v-for="r in rows" :key="r.name">
          <td class="wrapcell">{{ r.name }}</td>
          <td class="wrapcell"><span class="badge cat" :class="CAT_CLASS[site.categories[r.type]]">{{
            TYPE_LABEL[r.type] || r.type }}</span></td>
          <td class="num">
            <template v-if="r.scStart">{{ r.scStart }}</template>
            <span v-else class="dash" title="该服没有这一期">—</span>
          </td>
          <td class="num">
            <template v-if="r.enStart">{{ r.enStart }}</template>
            <span v-else class="dash" title="该服没有这一期">—</span>
          </td>
          <td class="num">
            <template v-if="r.tcStart">{{ r.tcStart }}</template>
            <span v-else class="dash" title="该服没有这一期">—</span>
          </td>
          <td v-for="g in GAP_COLS" :key="g.key" class="num xs-gap" :class="{ neg: r[g.key] < 0 }">
            <template v-if="r[g.key] === null"><span class="dash">—</span></template>
            <template v-else>{{ r[g.key] }}</template>
          </td>
          <td class="xup-cell">
            <button
              class="xup" type="button" title="查看三服这一期的 UP 干员（6★ / 5★）"
              @click="emit('open', r)"
            >查看</button>
            <i
              v-if="r.up6Same === false" class="xup-ne"
              title="三服 6★ 名单不一致 —— 这一行比的不是同一份名单"
            >≠</i>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

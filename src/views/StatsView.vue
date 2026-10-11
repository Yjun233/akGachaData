<script setup>
/**
 * 统计页：出率提升记录。
 *
 * 目录结构（与 PRTS Wiki 一致）：
 *   1 六星干员 1.1 标准寻访 / 1.2 中坚寻访
 *   2 五星干员 2.1 标准寻访 / 2.2 中坚寻访
 * 同一星级的两张表放进 .pair：宽度放得下就左右并列，放不下自动换行竖排。
 *
 * 「复制」按钮（用户 2026-10-11）挂在**每张表的标题行**（`.sec-title`）右端 ——
 * 所以复制的数据在这里算好（`lib/tableCopy.js`）再传下去，而不是让 `StatTable` 自己算：
 * 标题与按钮同属视图层，数据也得在同一层，否则要跨组件回流。
 * ⚠️ 四个分节的 id 是顶栏定位按钮的锚点（`s-6-std` 等），别删。
 */
import { computed } from 'vue';
import { useSiteStore } from '../stores/site.js';
import StatTable from '../components/StatTable.vue';
import CopyButton from '../components/CopyButton.vue';
import { statCopyRows } from '../lib/tableCopy.js';

const site = useSiteStore();

const groups = computed(() => site.statGroups);

/** 四张表各自的「复制」数据（含表头行）。⚠️ 中坚那两张多三列，用 `split: true` 区分 */
const copyRows = computed(() => {
  const refDate = site.refDate || site.today;
  const g = groups.value;
  return {
    '6-std': statCopyRows(g['6-std'], { refDate }),
    '6-mid': statCopyRows(g['6-mid'], { split: true, refDate }),
    '5-std': statCopyRows(g['5-std'], { refDate }),
    '5-mid': statCopyRows(g['5-mid'], { split: true, refDate }),
  };
});
</script>

<template>
  <div class="card">
    <div class="pair">
      <div class="pair-col">
        <div id="s-6-std" class="sec-title c-std">
          <span>六星干员·标准寻访</span>
          <CopyButton :rows="copyRows['6-std']" />
        </div>
        <StatTable table-id="6-std" :rows="groups['6-std']" />
      </div>
      <div class="pair-col">
        <div id="s-6-mid" class="sec-title c-mid">
          <span>六星干员·中坚寻访</span>
          <CopyButton :rows="copyRows['6-mid']" />
        </div>
        <StatTable table-id="6-mid" :rows="groups['6-mid']" split />
      </div>
    </div>

    <div class="grp-sep"></div>
    <div class="pair">
      <div class="pair-col">
        <div id="s-5-std" class="sec-title c-std">
          <span>五星干员·标准寻访</span>
          <CopyButton :rows="copyRows['5-std']" />
        </div>
        <StatTable table-id="5-std" :rows="groups['5-std']" />
      </div>
      <div class="pair-col">
        <div id="s-5-mid" class="sec-title c-mid">
          <span>五星干员·中坚寻访</span>
          <CopyButton :rows="copyRows['5-mid']" />
        </div>
        <StatTable table-id="5-mid" :rows="groups['5-mid']" split />
      </div>
    </div>
  </div>
</template>

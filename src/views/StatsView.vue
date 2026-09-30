<script setup>
/**
 * 统计页：出率提升记录。
 *
 * 目录结构（与 PRTS Wiki 一致）：
 *   1 六星干员 1.1 标准寻访 / 1.2 中坚寻访
 *   2 五星干员 2.1 标准寻访 / 2.2 中坚寻访
 * 同一星级的两张表放进 .pair：宽度放得下就左右并列，放不下自动换行竖排。
 */
import { computed } from 'vue';
import { useSiteStore } from '../stores/site.js';
import StatTable from '../components/StatTable.vue';

const site = useSiteStore();

const groups = computed(() => site.statGroups);
</script>

<template>
  <div class="card">
    <div class="hd"><h2>出率提升记录</h2></div>

    <div class="grp-sep" id="g1">六星干员</div>
    <div class="pair">
      <div class="pair-col">
        <div id="s-6-std" class="sec-title c-std">标准寻访</div>
        <StatTable table-id="6-std" :rows="groups['6-std']" />
      </div>
      <div class="pair-col">
        <div id="s-6-mid" class="sec-title c-mid">中坚寻访</div>
        <StatTable table-id="6-mid" :rows="groups['6-mid']" split />
      </div>
    </div>

    <div class="grp-sep" id="g2">五星干员</div>
    <div class="pair">
      <div class="pair-col">
        <div id="s-5-std" class="sec-title c-std">标准寻访</div>
        <StatTable table-id="5-std" :rows="groups['5-std']" />
      </div>
      <div class="pair-col">
        <div id="s-5-mid" class="sec-title c-mid">中坚寻访</div>
        <StatTable table-id="5-mid" :rows="groups['5-mid']" split />
      </div>
    </div>
  </div>
</template>

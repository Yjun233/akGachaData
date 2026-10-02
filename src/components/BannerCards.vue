<script setup>
/**
 * 卡池列表（窄屏卡片视图）。
 * 固定列宽的宽表格在手机上会溢出屏外，所以 (max-width:640px) 改用卡片。
 */
import { TYPE_LABEL, CAT_CLASS } from '../lib/constants.js';
import { useSiteStore } from '../stores/site.js';
import OpTag from './OpTag.vue';

defineProps({
  rows: { type: Array, required: true },
});

const site = useSiteStore();

/** 进行中 = 参考日期落在 [开始日, 结束日) —— **结束日当天算已关闭**（2026-10-01 口径） */
const isLive = (b) => b.startDate <= site.today && site.today < b.endDate;
const opsOf = (b, rarity) => b.upOperators.filter((o) => o.rarity === rarity);
</script>

<template>
  <div class="bcard-list">
    <div v-if="!rows.length" class="empty">没有符合条件的卡池</div>
    <div v-for="b in rows" :key="b.id" class="bcard">
      <div class="bcard-hd">
        <span class="bcard-name">{{ b.name }}</span>
        <span v-if="isLive(b)" class="pill-live">进行中</span>
        <span class="badge cat" :class="CAT_CLASS[site.categories[b.type]]">{{ site.categories[b.type] }}</span>
      </div>
      <div class="bcard-meta">
        <span class="bcard-date">{{ b.startDate }} ~ {{ b.endDate }}</span>
        <span class="badge">{{ TYPE_LABEL[b.type] }}</span>
      </div>
      <div v-if="opsOf(b, 6).length" class="bcard-row">
        <span class="k">出率提升 6★</span>
        <span class="v"><OpTag v-for="o in opsOf(b, 6)" :key="o.name" :op="o" /></span>
      </div>
      <div v-if="opsOf(b, 5).length" class="bcard-row">
        <span class="k">出率提升 5★</span>
        <span class="v"><OpTag v-for="o in opsOf(b, 5)" :key="o.name" :op="o" /></span>
      </div>
    </div>
  </div>
</template>

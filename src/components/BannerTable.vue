<script setup>
/**
 * 卡池列表（宽屏表格）。
 *
 * 列宽：`table-layout:fixed` + `<colgroup>`，各列按 `BANNER_COLS` 的比例分配
 * （`width: w/totalWidth%`），并给每列一个 `min-width: w` 兜底下限 ——
 * 于是**宽屏时表格铺满可用宽度、窄屏时退到 1225px 后横向滚动**。
 * （2026-09-30 起由「固定 1225px 不拉伸」改成这样。）
 *
 * 商店兑换不单独占列，而是在干员名前加「兑」标记（见 OpTag）。
 */
import { computed } from 'vue';
import { TYPE_LABEL, BANNER_COLS, CAT_CLASS } from '../lib/constants.js';
import { useSiteStore } from '../stores/site.js';
import OpTag from './OpTag.vue';

const props = defineProps({
  rows: { type: Array, required: true },
});

const site = useSiteStore();

const totalWidth = computed(() => BANNER_COLS.reduce((a, b) => a + b, 0));

/** 进行中 = 参考日期落在 [开始日, 结束日) —— **结束日当天算已关闭**（2026-10-01 口径） */
const isLive = (b) => b.startDate <= site.today && site.today < b.endDate;

/** 某星级的 UP 干员 */
const opsOf = (b, rarity) => b.upOperators.filter((o) => o.rarity === rarity);

const sortClass = (key) =>
  site.bannerSort.key === key ? `sort-${site.bannerSort.dir}` : '';
</script>

<template>
  <div class="tbl-scroll">
    <table class="grid floating" :style="{ width: 100 + '%', minWidth: totalWidth + 'px' }">
      <colgroup>
        <col v-for="(w, i) in BANNER_COLS" :key="i" :style="{ width: w / totalWidth + '%', minWidth: w + 'px' }" />
      </colgroup>
      <thead>
        <tr>
          <th :class="sortClass('name')" data-sort="name" @click="site.toggleBannerSort('name')">
            卡池名称<span class="arw">▲</span>
          </th>
          <th :class="sortClass('type')" data-sort="type" @click="site.toggleBannerSort('type')">
            类型<span class="arw">▲</span>
          </th>
          <th :class="sortClass('cat')" data-sort="cat" @click="site.toggleBannerSort('cat')">
            大类<span class="arw">▲</span>
          </th>
          <th :class="sortClass('startDate')" data-sort="startDate" @click="site.toggleBannerSort('startDate')">
            开始日期<span class="arw">▲</span>
          </th>
          <th :class="sortClass('endDate')" data-sort="endDate" @click="site.toggleBannerSort('endDate')">
            结束日期<span class="arw">▲</span>
          </th>
          <th class="no-sort ops">出率提升（6★）</th>
          <th class="no-sort ops">出率提升（5★）</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!rows.length">
          <td colspan="7">
            <div class="empty">没有符合条件的卡池</div>
          </td>
        </tr>
        <tr v-for="b in rows" :key="b.id">
          <td class="wrapcell"><span :class="{'pill-live':isLive(b)}"><b>{{ b.name }}</b>{{ ' ' }}</span></td>
          <td class="wrapcell"><span class="badge">{{ TYPE_LABEL[b.type] }}</span></td>
          <td class="wrapcell"><span class="badge cat" :class="CAT_CLASS[site.categories[b.type]]">{{
            site.categories[b.type] }}</span></td>
          <td class="num">{{ b.startDate }}</td>
          <td class="num">{{ b.endDate }}</td>
          <td class="ops">
            <span v-if="!opsOf(b, 6).length" class="dash">—</span>
            <OpTag v-for="o in opsOf(b, 6)" :key="o.name" :op="o" />
          </td>
          <td class="ops">
            <span v-if="!opsOf(b, 5).length" class="dash">—</span>
            <OpTag v-for="o in opsOf(b, 5)" :key="o.name" :op="o" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

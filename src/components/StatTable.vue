<script setup>
/**
 * 出率提升记录表（两行表头）。
 *
 * - 标准寻访表（split=false）：每组 3 列 → 结束时间 / 距今天数 / 次数
 * - 中坚寻访表（split=true） ：每组 5 列 → 结束时间 / 距今天数 / 总次数 / 中坚次数 / 标准次数
 * - 列宽按内容自适应（table-layout:auto），列间竖线与 sticky 表头对齐由全局 CSS 处理
 * - 距今天数着色：≥180 天标黄、≥365 天标红；卡池进行中显示「进行中」
 */
import { computed } from 'vue';
import { WARN_DAYS, DANGER_DAYS } from '../lib/constants.js';
import { endInfo } from '../lib/stats.js';
import { avatarUrl } from '../lib/avatars.js';
import { useSiteStore } from '../stores/site.js';

const props = defineProps({
  tableId: { type: String, required: true },
  rows: { type: Array, required: true },
  split: { type: Boolean, default: false }, // true = 中坚寻访表（多「中坚/标准次数」两列）
});

const site = useSiteStore();

/** 图片模式：干员列显示正方形头像（统计页没有 isShop/限定标记，只给头像） */
const isImage = computed(() => site.avatarMode === 'image');
const avatarOf = (name) => avatarUrl(site.operators[name] || { name }, 'square');

const refDate = computed(() => site.refDate || site.snapshotDate);
const sort = computed(() => site.statSort[props.tableId]);

/** 预计算每行的「最后一次出率提升 / 商店兑换」信息，避免模板里反复遍历 */
const viewRows = computed(() =>
  props.rows.map((r) => ({
    ...r,
    up: endInfo(r.upAll, refDate.value),
    shop: endInfo(r.shopAll, refDate.value),
  })),
);

const sortClass = (key) =>
  sort.value && sort.value.key === key ? `sort-${sort.value.dir}` : '';

const onSort = (key) => site.toggleStatSort(props.tableId, key);
</script>

<template>
  <div class="tbl-scroll plain">
    <table class="grid floating stat-tbl">
      <thead>
        <tr>
          <th
            rowspan="2" class="num" data-sort="releaseDate"
            :class="sortClass('releaseDate')" @click="onSort('releaseDate')"
          >实装时间<span class="arw">▲</span></th>
          <th
            rowspan="2" data-sort="name"
            :class="sortClass('name')" @click="onSort('name')"
          >干员<span class="arw">▲</span></th>
          <th class="group" :colspan="split ? 5 : 3">出率提升</th>
          <th class="group grp-shop" :colspan="split ? 5 : 3">商店兑换</th>
        </tr>
        <tr>
          <th class="num" data-sort="upEnd" :class="sortClass('upEnd')" @click="onSort('upEnd')">
            结束时间<span class="arw">▲</span>
          </th>
          <th class="num" data-sort="upDays" :class="sortClass('upDays')" @click="onSort('upDays')">
            距今天数<span class="arw">▲</span>
          </th>
          <th class="num" data-sort="upTotal" :class="sortClass('upTotal')" @click="onSort('upTotal')">
            {{ split ? '总次数' : '次数' }}<span class="arw">▲</span>
          </th>
          <template v-if="split">
            <th class="num" data-sort="upMid" :class="sortClass('upMid')" @click="onSort('upMid')">
              中坚次数<span class="arw">▲</span>
            </th>
            <th class="num" data-sort="upStd" :class="sortClass('upStd')" @click="onSort('upStd')">
              标准次数<span class="arw">▲</span>
            </th>
          </template>
          <th class="num shopcol" data-sort="shopEnd" :class="sortClass('shopEnd')" @click="onSort('shopEnd')">
            结束时间<span class="arw">▲</span>
          </th>
          <th class="num shopcol" data-sort="shopDays" :class="sortClass('shopDays')" @click="onSort('shopDays')">
            距今天数<span class="arw">▲</span>
          </th>
          <th class="num shopcol" data-sort="shopTotal" :class="sortClass('shopTotal')" @click="onSort('shopTotal')">
            {{ split ? '总次数' : '次数' }}<span class="arw">▲</span>
          </th>
          <template v-if="split">
            <th class="num shopcol" data-sort="shopMid" :class="sortClass('shopMid')" @click="onSort('shopMid')">
              中坚次数<span class="arw">▲</span>
            </th>
            <th class="num shopcol" data-sort="shopStd" :class="sortClass('shopStd')" @click="onSort('shopStd')">
              标准次数<span class="arw">▲</span>
            </th>
          </template>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!viewRows.length">
          <td :colspan="split ? 12 : 8"><div class="empty">暂无数据</div></td>
        </tr>
        <tr v-for="r in viewRows" :key="r.name">
          <td class="num">
            <span v-if="!r.releaseDate" class="dash">—</span><template v-else>{{ r.releaseDate }}</template>
          </td>
          <td class="wrapcell">
            <img v-if="isImage" class="avt-sq" :src="avatarOf(r.name)" :alt="r.name" :title="r.name" />
            <b v-else>{{ r.name }}</b>
          </td>
          <!-- 出率提升 -->
          <td class="num">
            <span v-if="!r.up.end" class="dash">—</span><template v-else>{{ r.up.end }}</template>
          </td>
          <td class="num">
            <span v-if="r.up.live" class="pill-live">进行中</span>
            <span v-else-if="r.up.days === null" class="dash">—</span>
            <span v-else-if="r.up.days >= DANGER_DAYS" class="hot">{{ r.up.days }}</span>
            <span v-else-if="r.up.days >= WARN_DAYS" class="warn">{{ r.up.days }}</span>
            <template v-else>{{ r.up.days }}</template>
          </td>
          <td class="num">{{ r.upAll.length }}</td>
          <template v-if="split">
            <td class="num">{{ r.upMid.length }}</td>
            <td class="num">{{ r.upStd.length }}</td>
          </template>
          <!-- 商店兑换 -->
          <td class="num">
            <span v-if="!r.shop.end" class="dash">—</span><template v-else>{{ r.shop.end }}</template>
          </td>
          <td class="num">
            <span v-if="r.shop.live" class="pill-live">进行中</span>
            <span v-else-if="r.shop.days === null" class="dash">—</span>
            <span v-else-if="r.shop.days >= DANGER_DAYS" class="hot">{{ r.shop.days }}</span>
            <span v-else-if="r.shop.days >= WARN_DAYS" class="warn">{{ r.shop.days }}</span>
            <template v-else>{{ r.shop.days }}</template>
          </td>
          <td class="num">{{ r.shopAll.length }}</td>
          <template v-if="split">
            <td class="num">{{ r.shopMid.length }}</td>
            <td class="num">{{ r.shopStd.length }}</td>
          </template>
        </tr>
      </tbody>
    </table>
  </div>
</template>

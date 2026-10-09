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
import AvatarImg from './AvatarImg.vue';
import { useSiteStore } from '../stores/site.js';

const props = defineProps({
  tableId: { type: String, required: true },
  rows: { type: Array, required: true },
  split: { type: Boolean, default: false }, // true = 中坚寻访表（多「中坚/标准次数」两列）
});

const site = useSiteStore();

/** 图片模式：干员列显示头像；统计页用**长方形蒙版**（宽是高的 2 倍），见 main.css 的 .avt-rect */
const isImage = computed(() => site.avatarMode === 'image');
/** 头像按 charId 取 —— 表格行上只有名字，用名字回查完整干员对象（取不到就用 `{ name }` 退化） */
const opOf = (name) => site.operators[name] || { name };

const refDate = computed(() => site.refDate || site.today);
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
    <!-- img-mode：图片模式的样式钩子（长方形蒙版头像 + 干员格的占位行框，见 main.css） -->
    <table class="grid floating stat-tbl" :class="{ 'img-mode': isImage }">
      <!-- 只给前两列定宽：它们要 sticky 冻结，第 2 列的 left 偏移必须等于第 1 列的实际宽度，
           不能让它随内容变。
           78px = 日期（`2026-10-01`，13px 常规字重 66px）+ 左右内边距 12px，
             与「结束时间」各列内容同类，所以取一样的宽度（用户要求「也收到一样窄」）。
           103px = **7 个汉字**（13px 下 91px）+ 左右内边距 12px（用户指定的口径）。
             最长干员名正好 7 个字（`凯尔希·思衡托`，中间是半角 `·`）≈ 81.5px，有富余。
           ⚠️ 改动这两个值要**同时**改 main.css 里对应的 width/min/max 与第 2 列的 left。 -->
      <colgroup>
        <col style="width: 78px" />
        <col style="width: 103px" />
      </colgroup>
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
            <AvatarImg v-if="isImage" :op="opOf(r.name)" shape="square" img-class="avt-rect" />
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

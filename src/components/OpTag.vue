<script setup>
/**
 * 干员标签，两种展示模式（由左栏底部的「简洁 / 图片」切换）：
 * - 简洁模式：星级配色的名字标签
 * - 图片模式：正方形头像（图片模式下不显示名字，「限」「兑」两个标记挪到右上角）
 *
 * 两种模式都带状态标记：限 = 限定干员（卡池列表展示、统计页排除）；兑 = 商店兑换。
 */
import { computed } from 'vue';
import AvatarImg from './AvatarImg.vue';
import { opName } from '../lib/opFields.js';
import { useSiteStore } from '../stores/site.js';

const props = defineProps({
  op: { type: Object, required: true },
  mark: { type: Boolean, default: true },
});

const site = useSiteStore();

/**
 * 显示名：完整干员取 `scName`、卡池 UP 项取 `scCharName`（见 `lib/opFields.js`）。
 * ⚠️ 2026-10-12 起卡池的 `upOperators` **自带 `charId`**（以前没有），理论上不必再回查；
 *    但 `fullOp` 这条回查仍留着 —— 它同时补上 `isLimited` 之外的完整字段（如头像模式下的
 *    `rarity` 配色），而且自设卡池的项可能查不到（用户强存的新干员），回退成原对象即可。
 */
const name = computed(() => opName(props.op));
const fullOp = computed(() => site.operators[name.value] || props.op);

const isImage = computed(() => site.avatarMode === 'image');
const hasBadge = computed(() => props.op.isLimited || props.op.isShop);
</script>

<template>
  <span v-if="isImage" class="avt">
    <AvatarImg :op="fullOp" shape="square" img-class="av" />
    <span v-if="mark && hasBadge" class="corners">
      <i v-if="op.isLimited" class="mk mk-lim" title="限定干员（不参与统计）">限</i>
      <i v-if="op.isShop" class="mk mk-shop" title="商店兑换">兑</i>
    </span>
  </span>

  <span v-else class="tag" :class="'r' + op.rarity">
    <template v-if="mark">
      <i v-if="op.isLimited" class="mk mk-lim" title="限定干员（不参与统计）">限</i>
      <i v-if="op.isShop" class="mk mk-shop" title="商店兑换">兑</i>
    </template>{{ name }}
  </span>
</template>

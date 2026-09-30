<script setup>
/**
 * 干员标签，两种展示模式（由左栏底部的「简洁 / 图片」切换）：
 * - 简洁模式：星级配色的名字标签
 * - 图片模式：正方形头像（图片模式下不显示名字，「限」「兑」两个标记挪到右上角）
 *
 * 两种模式都带状态标记：限 = 限定干员（卡池列表展示、统计页排除）；兑 = 商店兑换。
 */
import { computed } from 'vue';
import { avatarUrl } from '../lib/avatars.js';
import { useSiteStore } from '../stores/site.js';

const props = defineProps({
  op: { type: Object, required: true },
  mark: { type: Boolean, default: true },
});

const site = useSiteStore();

/**
 * ⚠️ 卡池数据里的 `upOperators` 只有 `name / rarity / isLimited / isShop`，**没有 `charId`**，
 * 而头像是按 `charId` 取的（`avatars/<charId>.png`）。所以这里必须用干员名回查 store 里的
 * 完整干员对象，否则 `avatarUrl()` 拿不到 charId、会静默退化成占位图
 * （表现：图片模式下卡池列表是方块占位图，而统计页却是真头像）。
 */
const fullOp = computed(() => site.operators[props.op.name] || props.op);

const isImage = computed(() => site.avatarMode === 'image');
const src = computed(() => avatarUrl(fullOp.value, 'square'));
const hasBadge = computed(() => props.op.isLimited || props.op.isShop);
</script>

<template>
  <span v-if="isImage" class="avt">
    <img class="av" :src="src" :alt="op.name" :title="op.name" />
    <span v-if="mark && hasBadge" class="corners">
      <i v-if="op.isLimited" class="mk mk-lim" title="限定干员（不参与统计）">限</i>
      <i v-if="op.isShop" class="mk mk-shop" title="商店兑换">兑</i>
    </span>
  </span>

  <span v-else class="tag" :class="'r' + op.rarity">
    <template v-if="mark">
      <i v-if="op.isLimited" class="mk mk-lim" title="限定干员（不参与统计）">限</i>
      <i v-if="op.isShop" class="mk mk-shop" title="商店兑换">兑</i>
    </template>{{ op.name }}
  </span>
</template>

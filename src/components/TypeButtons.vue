<script setup>
/**
 * 卡池类型的**两级按钮组**（右栏共用控件）。
 *
 * 卡池列表页与 UP 历史一览页都用它 —— 两处的「寻访筛选」保持完全一致的操作手感：
 * - **类型按钮**：点一下切换该类型的选中态（可多选；空数组 = 全部类型）
 * - **大类按钮**：点一下把该大类下的类型**全选 / 全不选**；选中态用大类实色底 +
 *   `CAT_INK` 字色（黄底要深字，白字看不清），半选时只描边
 * - **`disabledTypes`**：这些类型置灰不可点（UP 历史勾了「只看进店」时，把
 *   `noShopTypes` 传进来）。⚠️ 大类按钮只作用于本大类里**没被置灰**的类型
 *   （判定全选 / 半选也只看这些），整个大类都被置灰时该按钮自己也是禁用的。
 *
 * 父组件负责状态，本组件只发事件。判定「全选 / 半选」用的是 `selected` 数组，
 * 不依赖任何 store —— 两处的状态形状不同（`upTypes` / `filters.types`），都能复用。
 */
import {
  TYPES_BY_CATEGORY, TYPE_LABEL, CAT_COLOR, CAT_INK,
} from '../lib/constants.js';

const props = defineProps({
  selected: { type: Array, default: () => [] },
  /** 置灰（不可点）的类型；空数组 = 全部可选 */
  disabledTypes: { type: Array, default: () => [] },
  labelText: { type: String, default: '' },
});
const emit = defineEmits(['toggle', 'toggleCategory', 'clear']);

const typesOf = (cat) => TYPES_BY_CATEGORY.find((g) => g.cat === cat)?.types ?? [];
const isOff = (t) => props.disabledTypes.includes(t);
/** 某大类里**可选**的类型 —— 大类按钮只带走这些，判定也只看这些 */
const enabledOf = (cat) => typesOf(cat).filter((t) => !isOff(t));
const allOn = (cat) => {
  const list = enabledOf(cat);
  return list.length > 0 && list.every((t) => props.selected.includes(t));
};
const someOn = (cat) => enabledOf(cat).some((t) => props.selected.includes(t));
const isOn = (t) => props.selected.includes(t);
</script>

<template>
  <label>寻访筛选<span class="fcount">{{ labelText }}</span></label>
  <div class="typebtns">
    <!-- 大类按钮：点击 = 该大类**里可选的**类型全选 / 取消全选（被置灰的带不动）。 -->
    <div v-for="g in TYPES_BY_CATEGORY" :key="g.cat" class="tgroup">
      <button
        class="tcat" type="button" :disabled="!enabledOf(g.cat).length"
        :class="{ on: allOn(g.cat), half: someOn(g.cat) && !allOn(g.cat) }"
        :style="allOn(g.cat) ? { background: CAT_COLOR[g.cat], color: CAT_INK[g.cat] } : null"
        :title="`${g.cat}：点击${allOn(g.cat) ? '取消全选' : '全选'}`"
        @click="emit('toggleCategory', enabledOf(g.cat))"
      >
        <i class="dot" :style="{ background: CAT_COLOR[g.cat] }" />
        <span>{{ g.cat }}</span>
        <span class="tcat-act">{{ allOn(g.cat) ? '取消' : '全选' }}</span>
      </button>

      <div class="trow">
        <button
          v-for="t in g.types" :key="t" class="ttype" type="button"
          :disabled="isOff(t)" :class="{ on: isOn(t) }"
          @click="emit('toggle', t)"
        >{{ TYPE_LABEL[t] }}</button>
      </div>
    </div>

    <div class="tfoot">
      <button class="btn" type="button" :disabled="!selected.length" @click="emit('clear')">
        清空
      </button>
    </div>
  </div>
</template>

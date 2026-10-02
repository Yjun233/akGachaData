<script setup>
/**
 * 卡池类型的**两级按钮组**（右栏共用控件）。
 *
 * 卡池列表页与 UP 历史一览页都用它 —— 两处的「寻访筛选」保持完全一致的操作手感：
 * - **类型按钮**：点一下切换该类型的选中态（可多选；空数组 = 全部类型）
 * - **大类按钮**：点一下把该大类下的类型**全选 / 全不选**；选中态用大类实色底 +
 *   `CAT_INK` 字色（黄底要深字，白字看不清），半选时只描边
 * - **`disabled`**：整体禁用（UP 历史勾了「只看进店」时会用上）
 *
 * 父组件负责状态，本组件只发事件。判定「全选 / 半选」用的是 `selected` 数组，
 * 不依赖任何 store —— 两处的状态形状不同（`upTypes` / `filters.types`），都能复用。
 */
import {
  TYPES_BY_CATEGORY, TYPE_LABEL, CAT_COLOR, CAT_INK,
} from '../lib/constants.js';

const props = defineProps({
  selected: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  labelText: { type: String, default: '' },
});
const emit = defineEmits(['toggle', 'toggleCategory', 'clear']);

const typesOf = (cat) => TYPES_BY_CATEGORY.find((g) => g.cat === cat)?.types ?? [];
const allOn = (cat) => {
  const list = typesOf(cat);
  return list.length > 0 && list.every((t) => props.selected.includes(t));
};
const someOn = (cat) => typesOf(cat).some((t) => props.selected.includes(t));
const isOn = (t) => props.selected.includes(t);
</script>

<template>
  <label>寻访筛选<span class="fcount">{{ labelText }}</span></label>
  <div class="typebtns" :class="{ disabled }">
    <!-- 大类按钮：点击 = 该大类全选 / 取消全选。 -->
    <div v-for="g in TYPES_BY_CATEGORY" :key="g.cat" class="tgroup">
      <button
        class="tcat" type="button" :disabled="disabled"
        :class="{ on: allOn(g.cat), half: someOn(g.cat) && !allOn(g.cat) }"
        :style="allOn(g.cat) ? { background: CAT_COLOR[g.cat], color: CAT_INK[g.cat] } : null"
        :title="`${g.cat}：点击${allOn(g.cat) ? '取消全选' : '全选'}`"
        @click="emit('toggleCategory', typesOf(g.cat))"
      >
        <i class="dot" :style="{ background: CAT_COLOR[g.cat] }" />
        <span>{{ g.cat }}</span>
        <span class="tcat-act">{{ allOn(g.cat) ? '取消' : '全选' }}</span>
      </button>

      <div class="trow">
        <button
          v-for="t in g.types" :key="t" class="ttype" type="button"
          :disabled="disabled" :class="{ on: isOn(t) }"
          @click="emit('toggle', t)"
        >{{ TYPE_LABEL[t] }}</button>
      </div>
    </div>

    <div class="tfoot">
      <button class="btn" type="button" :disabled="disabled || !selected.length" @click="emit('clear')">
        清空
      </button>
    </div>
  </div>
</template>

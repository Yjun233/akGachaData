<script setup>
/**
 * 干员多选（搜索 + chip）—— 就是右栏「UP 干员」那套交互，抽出来给自定义卡池弹窗复用。
 *
 * 交互：打字 → 出候选（名字 / 全拼 / 首字母，见 `lib/opSearch.js`）→ 点候选加入、点 chip 移除；
 *       回车取第一个候选、Esc 清空输入。
 * ⚠️ 拼音库**按需加载**（`ensurePinyin()`），加载完才开始出候选 —— 只在真正用到时才加载，
 *    不占首屏（照抄 FilterDrawer 的做法）。
 * ⚠️ **候选池由调用方给**（`pool`）：六星 / 五星给该星级的全部干员；**进店**只给
 *    「已选的六星 + 五星」—— 它只能是这两组里的人（用户 2026-10-06 定）。
 * ⚠️ **可选的 `tagOf`**：给每个名字前缀一个小标记（弹窗里用来标该干员现在属「标」还是「中」）。
 *    怎么判、什么颜色由调用方定 —— 这里只负责「有就画在名字前面」。
 * ⚠️ **候选列表是浮层**（`.opbox` 里绝对定位）：它出现 / 消失**不会改变容器高度**
 *    （2026-10-06 用户要求 —— 以前打字时整个弹窗会被撑高、选完又缩回去，很晃）。
 *    下方空间不够时改成**向上弹**（`dropUp`），免得被父级的 `overflow` 裁掉。
 */
import { computed, nextTick, ref } from 'vue';
import { ensurePinyin, searchOperators } from '../lib/opSearch.js';

const props = defineProps({
  /** 已选（v-model），干员名数组 */
  modelValue: { type: Array, required: true },
  /** 候选池：干员名数组 */
  pool: { type: Array, required: true },
  placeholder: { type: String, default: '名字 / 全拼 / 首字母' },
  /** 候选池为空时的提示（进店的池子要先选上面两组才非空） */
  emptyHint: { type: String, default: '' },
  /** 可选：`(name) => '标' | '中' | ''` —— 名字前面那个一字的标记（空串则不画） */
  tagOf: { type: Function, default: null },
});
const emit = defineEmits(['update:modelValue']);

const q = ref('');
const pinyinReady = ref(false);
/** 取标记（没传 `tagOf` 就恒空，右栏那种用法完全不受影响） */
const tag = (n) => (props.tagOf ? props.tagOf(n) || '' : '');

/** 输入框外面那层（浮层的定位基准） */
const boxEl = ref(null);
/** 浮层朝上还是朝下 —— 下方放不下（且上方放得下）就朝上 */
const dropUp = ref(false);
const SUG_MAX = 200; // ≈ `.opsug` 的 max-height + 一点余量

function focusIn() {
  askPinyin();
  nextTick(() => {
    const el = boxEl.value;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    dropUp.value = below < SUG_MAX && r.top > SUG_MAX;
  });
}

function askPinyin() {
  if (pinyinReady.value) return;
  ensurePinyin().then(() => { pinyinReady.value = true; });
}

const candidates = computed(() => {
  if (!pinyinReady.value) return [];
  return searchOperators(props.pool, q.value, { exclude: props.modelValue });
});

function pick(n) {
  if (!props.modelValue.includes(n)) emit('update:modelValue', [...props.modelValue, n]);
  q.value = '';
}

function drop(n) {
  emit('update:modelValue', props.modelValue.filter((x) => x !== n));
}
</script>

<template>
  <div class="oppick">
    <!-- ⚠️ 输入框与候选列表包在 `.opbox` 里：`.opsug` 相对它**绝对定位** →
         候选出现 / 消失**不占流**、容器高度恒定（用户 2026-10-06 要求） -->
    <div ref="boxEl" class="opbox">
      <input
        v-model="q" type="text" autocomplete="off" :placeholder="placeholder"
        @focus="focusIn"
        @keyup.enter="candidates.length && pick(candidates[0])"
        @keyup.esc="q = ''"
      />
      <!-- 候选：点一下加入已选 -->
      <div v-if="q.trim()" class="opsug" :class="{ up: dropUp }">
        <div v-if="!candidates.length" class="opsug-empty">{{ emptyHint || '没有匹配的干员' }}</div>
        <button v-for="n in candidates" :key="n" class="opsug-item" type="button" @click="pick(n)">
          <em v-if="tag(n)" :class="tag(n) === '中' ? 'optag mid' : 'optag std'">{{ tag(n) }}</em>{{ n }}
        </button>
      </div>
    </div>
    <!-- 已选：点一下移除 -->
    <div v-if="modelValue.length" class="opchips">
      <button
        v-for="n in modelValue" :key="n" class="opchip" type="button"
        :title="`移除 ${n}`" @click="drop(n)"
      ><em v-if="tag(n)" :class="tag(n) === '中' ? 'optag mid' : 'optag std'">{{ tag(n) }}</em>{{ n }}<i>×</i></button>
    </div>
  </div>
</template>

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
 * ⚠️ **名字前面两个小标记，全站都有**（2026-11-17 用户要求扩到所有选择框）：
 *    ① 「**标 / 中**」= 该干员**此刻**属标准还是中坚寻访（`midTag()`，判据是**现实今天**）；
 *    ② 「**★6 / ★5**」= 星级。
 *    以前①是调用方可选的 `tagOf` prop（只有自定义卡池弹窗传了）→ 现在都收进组件自己算，
 *    右栏 / 跨服那几处也自动有了，调用方不用再管。
 * ⚠️ **候选列表是浮层**（`.opbox` 里绝对定位）：它出现 / 消失**不会改变容器高度**
 *    （2026-10-06 用户要求 —— 以前打字时整个弹窗会被撑高、选完又缩回去，很晃）。
 *    下方空间不够时改成**向上弹**（`dropUp`），免得被父级的 `overflow` 裁掉。
 * ⚠️ **默认候选**（2026-11-17 用户加）：**没输入文本**、且输入框**聚焦**时，下拉里直接给出
 *    `suggest` 那一组名字（通常是「出率提升距今天数最高的 6 标准 + 6 中坚」，由 store 的
 *    `opSuggest*` 给；自定义卡池的「进店」框给的是**上面已选的六星 + 五星**）。
 *    点一下就加入，不用先打字。
 *    ⚠️ 会用 `pool` 过滤一遍 —— 弹窗里六星框只给六星、进店框只给已选的，建议了也点不上。
 * ⚠️ **`disabled`**（2026-10-24）：整块**灰掉、不可编辑** —— 自定义卡池里「该类没有进店」时用它。
 *    灰显而不是隐藏：位置固定不跳动，用户也能看出「这里本来有个框，只是这类卡池用不上」。
 */
import { computed, nextTick, ref } from 'vue';
import { ensurePinyin, searchOperators } from '../lib/opSearch.js';
import { midTag } from '../lib/customBanners.js';
import { useSiteStore } from '../stores/site.js';

const props = defineProps({
  /** 已选（v-model），干员名数组 */
  modelValue: { type: Array, required: true },
  /** 候选池：干员名数组 */
  pool: { type: Array, required: true },
  placeholder: { type: String, default: '名字 / 全拼 / 首字母' },
  /** 候选池为空时的提示（进店的池子要先选上面两组才非空） */
  emptyHint: { type: String, default: '' },
  /** 未输入文本时的**默认候选**（干员名数组；调用方给顺序，这里不重排） */
  suggest: { type: Array, default: () => [] },
  /** 输入框的 id（右栏那个 `<label for>` 要用；不传就不写 id） */
  inputId: { type: String, default: '' },
  /** 禁用：灰掉、不可编辑（不加载拼音、不出候选、不能加 / 删） */
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const site = useSiteStore();

const q = ref('');
const pinyinReady = ref(false);
/** 输入框是否聚焦 —— 默认候选只在聚焦时露出来，否则满屏浮层（2026-11-17） */
const focused = ref(false);
/**
 * 未输入时的默认候选：按 `pool` 与「已选」过滤。
 * ⚠️ **不截断** —— 上限由调用方给的 `suggest` 长度决定（`opSuggest*` 本身最多 12 位；
 *    自定义卡池「进店」框给的是上面已选的全部干员，可能几十位，`.opsug` 自己带滚动）。
 */
const suggestList = computed(() => {
  if (props.disabled) return [];
  const chosen = new Set(props.modelValue);
  const pool = new Set(props.pool);
  return props.suggest.filter((n) => pool.has(n) && !chosen.has(n));
});
/** 下拉里现在要画的那一串：有输入 → 搜索结果；没输入但聚焦 → 默认候选 */
const shown = computed(() => (q.value.trim() ? candidates.value : (focused.value ? suggestList.value : [])));
/** 空态提示只对「搜索没结果」有意义，默认候选为空时不要跳一句「没有匹配的干员」 */
const showEmpty = computed(() => !!q.value.trim() && !candidates.value.length);

/**
 * 名字 → 两个标记的数据（见文件头 ⚠️ 那段）。
 * ⚠️ 判据时点用 `site.today`（= 页面打开那天，与左栏 / 卡池列表同一口径），
 *    不是统计页可改的参考日期 —— 标记说的是「现在属哪边」。
 * ⚠️ 名字不在干员表里（自设强存的新干员 / 该服还没有）→ 两个标记都不画。
 */
function marks(n) {
  const op = site.operators[n];
  if (!op) return { mid: '', rarity: null, midTip: '' };
  const mid = midTag(site.classicDateOf(op), site.today);
  return {
    mid,
    rarity: op.rarity ?? null,
    midTip: mid === '中' ? '已属中坚寻访' : '仍在标准寻访',
  };
}
/** 候选 / 已选都先算好标记，模板里就不用对同一位干员反复查表 */
const shownItems = computed(() => shown.value.map((n) => ({ name: n, ...marks(n) })));
const chipItems = computed(() => props.modelValue.map((n) => ({ name: n, ...marks(n) })));

/** 输入框外面那层（浮层的定位基准） */
const boxEl = ref(null);
/** 浮层朝上还是朝下 —— 下方放不下（且上方放得下）就朝上 */
const dropUp = ref(false);
const SUG_MAX = 200; // ≈ `.opsug` 的 max-height + 一点余量

function focusIn() {
  if (props.disabled) return;
  focused.value = true;
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
  if (props.disabled || !pinyinReady.value) return [];
  return searchOperators(props.pool, q.value, { exclude: props.modelValue });
});

function pick(n) {
  if (props.disabled) return;
  if (!props.modelValue.includes(n)) emit('update:modelValue', [...props.modelValue, n]);
  q.value = '';
  /* 默认候选点完继续留在聚焦态（还要接着选）；搜索态清空输入后仍然聚焦，浮层会切回默认候选 */
}

/** 失焦关掉默认候选。⚠️ 用 `mousedown.prevent` 挡住候选上的 mousedown，点击时就不会先失焦 */
function focusOut() {
  focused.value = false;
}

function drop(n) {
  if (props.disabled) return;
  emit('update:modelValue', props.modelValue.filter((x) => x !== n));
}
</script>

<template>
  <div class="oppick" :class="{ 'is-disabled': disabled }">
    <!-- ⚠️ 输入框与候选列表包在 `.opbox` 里：`.opsug` 相对它**绝对定位** →
         候选出现 / 消失**不占流**、容器高度恒定（用户 2026-10-06 要求） -->
    <div ref="boxEl" class="opbox">
      <input
        :id="inputId || undefined"
        v-model="q" type="text" autocomplete="off" :placeholder="placeholder" :disabled="disabled"
        @focus="focusIn"
        @blur="focusOut"
        @keyup.enter="candidates.length && pick(candidates[0])"
        @keyup.esc="q = ''"
      />
      <!-- 候选：点一下加入已选。没输入文本时这里放的是**默认候选**（聚焦才出现） -->
      <div v-if="shown.length || showEmpty" class="opsug" :class="{ up: dropUp }">
        <div v-if="showEmpty" class="opsug-empty">{{ emptyHint || '没有匹配的干员' }}</div>
        <button
          v-for="it in shownItems" :key="it.name" class="opsug-item" type="button"
          @mousedown.prevent @click="pick(it.name)"
        >
          <em v-if="it.mid" class="optag" :class="it.mid === '中' ? 'mid' : 'std'" :title="it.midTip">{{ it.mid }}</em>
          <em v-if="it.rarity" class="optag rar" :class="`rar-${it.rarity}`">★{{ it.rarity }}</em>{{ it.name }}
        </button>
      </div>
    </div>
    <!-- 已选：点一下移除 -->
    <div v-if="modelValue.length" class="opchips">
      <button
        v-for="it in chipItems" :key="it.name" class="opchip" type="button" :disabled="disabled"
        :title="disabled ? it.name : `移除 ${it.name}`" @click="drop(it.name)"
      ><em v-if="it.mid" class="optag" :class="it.mid === '中' ? 'mid' : 'std'" :title="it.midTip">{{ it.mid }}</em><em v-if="it.rarity" class="optag rar" :class="`rar-${it.rarity}`">★{{ it.rarity }}</em>{{ it.name }}<i v-if="!disabled">×</i></button>
    </div>
  </div>
</template>

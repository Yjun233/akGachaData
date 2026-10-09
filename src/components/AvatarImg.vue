<script setup>
/**
 * 图片模式下的干员头像 `img`（DOM 三处共用）。
 *
 * 三处用法：卡池列表 / 出率提升记录表 / 首次UP表格版 —— 都是「一个 class + 一个 src」，
 * 唯一差别是 class（`.av` 26px 方头像 / `.avt-rect` 68×34 长方蒙版）。所以统包成这个组件，
 * 把「**加载中 / 加载失败都退化成干员名首字占位图**」的逻辑收在一处。
 *
 * 做法：把占位图放在 `<img>` **下面一层**（同一格子里的 `background-image`），
 * 真图 `load` 成功后才把占位层撤掉：
 * - **加载中**：真图还是透明的（或还没开始下载）→ 看到的是下层的首字占位图；
 * - **加载失败**（404 / 断网 / CDN 裂图）：真图撤掉、占位图留着 → 永远显示首字；
 * - **加载成功**：占位层隐去 → 只有真头像。
 *
 * ⚠️ 为什么**不**直接把 `<img>` 的 `src` 换成占位图（另一种直觉写法）：
 *   - `verify-render` 有「头像必须是真素材、不是 `data:image/svg`」的断言，
 *     SSR 时 `src` 就是占位图会让它红；
 *   - 换 `src` 还得盯着 `load` 再换回来，缓存命中时会闪一下。
 *   叠两层是**纯 CSS 可见性**，SSR 渲染出来的 `src` 恒为真素材，断言天然通过。
 * ⚠️ 两层必须**完全重合**（同尺寸、同定位）—— 所以占位层照抄 `.avt-rect` / `.av` 的几何：
 *   这里不复刻尺寸，而是用 `inset:0` 铺满外层 `.avt-img`，外层尺寸交给各处的 class 决定。
 */
import { ref, computed, watch } from 'vue';
import { avatarUrl, placeholderAvatar } from '../lib/avatars.js';

const props = defineProps({
  /** 干员对象（需要 charId / name） */
  op: { type: Object, required: true },
  /** 形状：square / circle —— 只影响占位图（真素材都是同一张方形 PNG，形状交给 CSS） */
  shape: { type: String, default: 'square' },
  /** 透传给 <img> 的 class（.av / .avt-rect …） */
  imgClass: { type: String, default: '' },
});

/** 真素材地址（charId 缺失时它自己就是占位图 —— 那种情况不需要叠层） */
const realSrc = computed(() => avatarUrl(props.op, props.shape));
/** 首字占位图（内联 data URI，不产生网络请求） */
const fallbackSrc = computed(() => placeholderAvatar(props.op?.name, props.shape));
/** 该干员有没有真素材（没 charId 时真素材本身就是占位图，不必再叠一层） */
const hasReal = computed(() => !!props.op?.charId);

/** 真图是否已**成功加载**（成功后撤掉占位层） */
const loaded = ref(false);

/** 真图是否**加载失败**（失败后把真图整个撤掉，只留占位层） */
const failed = ref(false);

/** 换人 / 换形状时重置（列表复用组件实例） */
watch(realSrc, () => {
  loaded.value = false;
  failed.value = false;
});

function onLoad() {
  loaded.value = true;
  failed.value = false;
}

/** 加载失败 → 撤掉真图（避免浏览器渲染成破碎图标），只留下面的占位层 */
function onError() {
  failed.value = true;
}

/** 是否显示占位层：没有真素材、还没加载完、或已失败 */
const showFallback = computed(() => !hasReal.value || failed.value || !loaded.value);

/** 占位层的背景图（拼成 CSS `url(...)` —— ⚠️ 不能在模板里写反引号模板串，
 *  Vue 模板编译器会把反引号当成自己的模板字面量，撞上里面 data URI 的引号就报 Unterminated template）。 */
const fallbackStyle = computed(() => ({ backgroundImage: 'url("' + fallbackSrc.value + '")' }));
</script>

<template>
  <span class="avt-img">
    <!-- 占位层（首字）：垫在真图下面，加载中 / 失败时露出来 -->
    <span
      v-if="hasReal && showFallback"
      class="avt-fallback" aria-hidden="true" :style="fallbackStyle"
    />
    <!-- 真素材：加载成功前它是透明的（下层占位图透出来） -->
    <img
      v-if="!failed"
      :class="imgClass" class="avt-real" :src="realSrc"
      :alt="op.name" :title="op.name" @load="onLoad" @error="onError"
    />
  </span>
</template>

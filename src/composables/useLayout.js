/**
 * 布局状态：响应式断点 + 左右抽屉开合。
 *
 * 抽屉在两种形态下含义不同（与原型一致）：
 *  - **停靠**（横屏宽屏 `orientation:landscape and min-width:900px`）：默认展开并挤压内容，
 *    `navToggled` 表示「用户把它收起」；此时没有遮罩。
 *  - **浮层**（竖屏 / 窄屏）：默认收起，`navToggled` 表示「用户把它展开」；展开时盖住内容并显示遮罩。
 *
 * 统一对外暴露 `navShow` / `filterShow`：**true = 抽屉可见**，视图直接用这个值即可。
 * 形态切换时清掉用户临时开合，回到当前形态的默认值。
 */
import { ref, computed } from 'vue';

const mqCard = window.matchMedia('(max-width: 640px)');
const mqNarrow = window.matchMedia('(max-width: 900px), (orientation: portrait)');
const mqDocked = window.matchMedia('(orientation: landscape) and (min-width: 900px)');

const isCard = ref(mqCard.matches);      // 手机宽度 → 卡池列表用卡片
const isNarrow = ref(mqNarrow.matches);
const isDocked = ref(mqDocked.matches);  // 停靠形态

const navToggled = ref(false);
const filterToggled = ref(false);

const navShow = computed(() => (isDocked.value ? !navToggled.value : navToggled.value));
const filterShow = computed(() => (isDocked.value ? !filterToggled.value : filterToggled.value));
const backdropShow = computed(() => !isDocked.value && (navShow.value || filterShow.value));

const toggleNav = () => { navToggled.value = !navToggled.value; };
const toggleFilter = () => { filterToggled.value = !filterToggled.value; };
const closeDrawers = () => { navToggled.value = false; filterToggled.value = false; };

function sync() {
  const docked = mqDocked.matches;
  if (docked !== isDocked.value) {
    isDocked.value = docked;
    // 两种形态默认状态相反，切换时清掉临时开合
    closeDrawers();
  }
  isCard.value = mqCard.matches;
  isNarrow.value = mqNarrow.matches;
}

/** 只在 App.vue 里调用一次 */
export function initLayoutWatchers() {
  mqCard.addEventListener('change', sync);
  mqDocked.addEventListener('change', sync);
  mqNarrow.addEventListener('change', sync);
}

export function useLayout() {
  return {
    isCard, isNarrow, isDocked,
    navShow, filterShow, backdropShow,
    toggleNav, toggleFilter, closeDrawers,
  };
}

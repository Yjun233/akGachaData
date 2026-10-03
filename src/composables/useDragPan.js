/**
 * useDragPan —— 鼠标按住拖拽、平移一个**原生可滚动容器**。
 *
 * 用在两个图表页：
 *   · `.tl-scroll`（UP 历史）—— `overflow: auto`，横竖都能滚 → 拖拽**自然可以斜向**
 *   · `.chart-scroll`（首次UP间隔）—— `overflow-y: hidden`，纵向没得滚 → 只能横向
 * **能不能斜向是「容器」决定的，不是这里决定的**：两轴都写成「跟手」，容器不可滚的那个
 * 方向浏览器会自己忽略。
 *
 * 为什么不用 echarts 的 dataZoom：两个图表页的滚动架构（顶部自绘刻度条、左侧 sticky
 * 名字列、「1 天 = 1px」的宽度算法）全都建立在「外层容器滚动」之上，换成 dataZoom 会牵连
 * 这些脆弱对齐 —— 2026-10-02 试过一版并**全部回退**，别再走那条路。
 *
 * ⚠️⚠️ **只认鼠标**：`pointerType === 'mouse'` 且**左键**；触摸 / 触控笔 / 中键右键一律
 *   直接 return —— **手机端的滑动手势必须完整交给浏览器原生滚动**（含惯性）。
 *    所以**绝不要**给容器加 `touch-action: none`，那会把手机端的滑动一起杀掉。
 *
 * ⚠️ 按在**滚动条**上不接管（否则用户想拖滚动条，却把内容拖走了）。
 *
 * 用法（模板里直接绑，不需要手动管理监听器 —— 靠指针捕获把后续事件都收在同一元素上）：
 *   <div class="tl-scroll" :class="{ dragging }"
 *        @pointerdown="onPointerDown" @pointermove="onPointerMove"
 *        @pointerup="onPointerUp" @pointercancel="onPointerUp">
 */
import { ref } from 'vue';

/** 位移小于这个像素数就当成「点击」，不动滚动（手抖不至于把内容挪走） */
const THRESHOLD = 4;

/**
 * 这一下 `pointerdown` 该不该由我们接管？
 * 抽成**纯函数**便于核对脚本直接断言（尤其是「触摸一律不接管」这条硬约束）。
 *
 * ⚠️ 滚动条判断必须用**相对容器**的坐标：`e.offsetX / offsetY` 是相对**事件目标**的，
 *    而这里的事件目标通常是内层的 canvas（比容器大得多 —— 92 行 × 30px ≈ 2700px 高），
 *    于是 `offsetY` 会远大于容器的 `clientHeight`，被误判成「按在滚动条上」→ **永远拖不动**。
 *    （2026-10-02 真机踩到；当时的假事件测试用了小 offset 值，所以没抓到。）
 *
 * @param {PointerEvent} e
 * @param {{clientWidth:number, clientHeight:number, getBoundingClientRect?:Function}} node 滚动容器
 * @returns {boolean}
 */
export function shouldStartDrag(e, node) {
  if (!e || !node) return false;
  if (e.pointerType !== 'mouse') return false;   // 触摸 / 触控笔 → 交给原生滚动（手机端）
  if (e.button !== 0) return false;              // 只认左键
  const r = typeof node.getBoundingClientRect === 'function'
    ? node.getBoundingClientRect()
    : { left: 0, top: 0 };
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  /* 落在滚动条 / 边框上（坐标超出 client 区域那几像素）→ 不接管，让用户拖滚动条 */
  if (x > node.clientWidth || y > node.clientHeight) return false;
  return true;
}

export function useDragPan() {
  const dragging = ref(false);

  let el = null;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let moved = false;

  const onPointerDown = (e) => {
    const node = e.currentTarget;
    if (!shouldStartDrag(e, node)) return;
    el = node;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = node.scrollLeft;
    startTop = node.scrollTop;
    moved = false;
    /* 指针捕获：鼠标拖到容器外面也继续跟手（省掉一套 window 监听） */
    try { node.setPointerCapture(pointerId); } catch { /* 环境不支持就退回普通模式 */ }
    /* 从按下这一刻就掐掉文本选择，否则会边拖边选中一片干员名 */
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (!el || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved) {
      if (Math.abs(dx) + Math.abs(dy) < THRESHOLD) return;
      moved = true;
      dragging.value = true;
    }
    e.preventDefault();
    el.scrollLeft = startLeft - dx;   // 纵向不可滚的容器会自动忽略下面那句
    el.scrollTop = startTop - dy;
  };

  const onPointerUp = (e) => {
    if (el && e.pointerId === pointerId) {
      try { el.releasePointerCapture(pointerId); } catch { /* 忽略 */ }
    }
    el = null;
    pointerId = null;
    moved = false;
    dragging.value = false;
  };

  return { dragging, onPointerDown, onPointerMove, onPointerUp };
}

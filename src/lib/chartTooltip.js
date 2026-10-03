/**
 * 图表浮窗（tooltip）的挂载点、贴边定位与互斥。
 *
 * 背景：两个图表页（UP 历史 / 首次UP间隔）的图表都比屏幕宽，装在 `.chart-scroll`
 * （`overflow-x:auto; overflow-y:hidden`）里横向滚动，而 echarts 默认把浮窗挂成
 * **图表容器的子元素**，于是有三个毛病：
 * 1. 浮窗会被 `.chart-scroll` 的 overflow **裁掉**（横向越界的部分还会把滚动区撑宽）；
 * 2. **手机竖屏**上手指按住的那个点，常常正好是浮窗该出现的位置 —— 浮窗挡住要看的点；
 * 3. 图表比屏幕宽时浮窗也跟着图表跑，经常整块被推出屏幕外（只露一半甚至完全看不见）。
 *
 * 做法由 `EChart.vue` 在**每次 `setOption` 前**给 `option.tooltip` 打补丁：
 *
 * **① 换挂载点（所有屏幕尺寸都生效）**：浮窗挂到 `position:fixed; inset:0` 的**全屏图层**上。
 * zrender 的 `transformLocalCoord` 会按两个元素各自的 `getBoundingClientRect` 把「图表内坐标」
 * 换算成「图层内坐标」；全屏固定图层的坐标系**就是视口坐标系** —— 于是浮窗自动落到正确的
 * 屏幕位置，同时彻底跳出 `.chart-scroll` 的裁剪（这也是 echarts 自己提供 `appendTo` 的用途）。
 *
 * **② 贴边（窄屏 / 竖屏）**：`position` 回调接管定位，把浮窗放进调用方给的**可用带**（band）里：
 * - `mode:'flip'`（UP 历史）：点在屏幕**下半** → 贴带子的**上沿**；点在**上半** → 贴带子的**下沿**。
 *   带子由视图给（「横轴刻度条下沿 ~ 滚动区下沿」），所以浮窗既不会压住 sticky 的横轴，
 *   也不会跑出滚动区（用户 2026-10-03 报「太靠边缘、上方挡了横轴」）。
 * - `mode:'bottom'`（首次UP间隔）：**恒定贴带子的下沿** —— 视图把下沿设在「该图表的绘图区上方」，
 *   于是浮窗**统一落在该图表的标题那一带**，不管点在哪都一个位置、且不挡折线图
 *   （用户 2026-10-03 指定「统一放在所在图表标题的高度」）。横向以该点居中再夹进屏幕。
 *
 * **③ 浮窗互斥**：手机上是「点一下」出浮窗、不会自动消失，于是点完六星再点五星会**两个都留着**
 * （用户 2026-10-03 报）。这里集中管一下：任何一张图的浮窗一显示，就把别的图的收起。
 *
 * 几个容易踩的点：
 * - ⚠️ 打补丁时会**关掉 `confine`**：`confine` 是「夹在**图表**的范围内」，而图表本身比屏幕
 *   宽/高 —— 夹在图表里等于放任浮窗跑到屏幕外（正是上面 ①③ 的根源）；贴边时它还会把
 *   我们算出来的负坐标硬夹回 0。**屏幕内**的夹取由这里自己做（见 `pinAt`）。
 * - ⚠️ `position` 回调返回的是**图表内坐标**，不是屏幕坐标 —— echarts 随后自己换算成图层坐标，
 *   所以这里要把「想要的屏幕位置」减掉图表容器的 `getBoundingClientRect().left/top` 再返回。
 * - ⚠️ `appendTo` 只在 **echarts 建浮窗 DOM 时读一次**（`TooltipView.init`），改 `orientation`
 *   不会重建 → 所以挂载点恒定是图层、**不随断点切换**；只有 `position` / `extraCssText`
 *   是每次显示时重新读的 —— 所以 `EChart.vue` 除了每次 `setOption` 重打补丁，
 *   还要在**断点变化时**再打一次（否则窄屏的紧凑样式会过期）。
 * - ⚠️ 窄屏下会把浮窗**改小**（见 `NARROW_CSS`）：首次UP间隔的绘图区上方只有 ~150px 留白，
 *   而默认尺寸 6 行就 ~197px —— 不压缩就必然压到折线图上。
 */

/** 浮窗与屏幕边缘 / 顶栏 / 可用带边缘的间距（px）。视图算 band 时也用它，别各写各的 */
export const TIP_GAP = 8;

/** 浮窗图层的 z-index：要压过顶栏（70）与抽屉（75），否则贴顶的浮窗会被顶栏盖住 */
const LAYER_Z = 100;

/** 顶栏高度取不到时的兜底值（`--top-h` 见 styles/main.css） */
const TOP_H_FALLBACK = 52;

/** 窄屏（手机竖屏）下的浮窗样式：字号 / 行高 / 内边距收一档，
 *  6 行从 ~197px 压到 ~130px，才塞得进「图表标题那一带」而不碰折线图。
 *  ⚠️ 要写在 `extraCssText` 里 —— 它被拼在 echarts 自己那段 cssText **之后**，
 *  同属性后者胜（`font` 简写在前，这里只盖 `font-size` / `line-height`）。 */
const NARROW_CSS = 'font-size:11.5px;line-height:1.45;padding:6px 9px;';

/** host 元素 → 该图表的浮窗图层（每张图一个，随组件卸载一起丢掉） */
const layers = new WeakMap();

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/* ---------------- ③ 浮窗互斥 ---------------- */

/** 所有还活着的图表实例（弱引用没必要 —— 卸载时会 unregister） */
const liveCharts = new Set();

/** 注册图表：它的浮窗一显示，就把其它图表的浮窗收起来 */
export function registerChart(chart) {
  if (!chart || liveCharts.has(chart)) return;
  liveCharts.add(chart);
  /* echarts 的 tooltip 显示时会派发 `showTip` 动作（install.js 注册，event: 'showTip'） */
  chart.on('showTip', () => {
    for (const c of liveCharts) if (c !== chart) c.dispatchAction({ type: 'hideTip' });
  });
}

export function unregisterChart(chart) {
  liveCharts.delete(chart);
}

/* ---------------- ① 挂载点 ---------------- */

/** 全屏浮窗图层：`position:fixed; inset:0` → 它的坐标系就是视口坐标系。
 *  挂到 `document.body` 而不是图表容器上：万一将来有祖先元素带 `transform`/`filter`，
 *  `fixed` 就会被那个祖先「抓住」，又会重新被 `.chart-scroll` 裁掉。
 *  `pointer-events:none` 让图层本身不挡页面操作；浮窗自己有 `pointer-events:auto`（`enterable`）。 */
function layerFor(host) {
  if (typeof document === 'undefined' || !document.body) return null;
  const old = layers.get(host);
  if (old && old.isConnected) return old;
  const layer = document.createElement('div');
  layer.className = 'tt-layer';
  layer.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${LAYER_Z};`;
  document.body.appendChild(layer);
  layers.set(host, layer);
  return layer;
}

/** 组件卸载时把图层摘掉（浮窗是 echarts 自己 append 进去的，跟着图层一起走） */
export function disposeTooltipLayer(host) {
  const layer = layers.get(host);
  if (layer) {
    layer.remove();
    layers.delete(host);
  }
}

/** 视口尺寸：优先用 `visualViewport`（手机上地址栏收放时它才是真正可见的那块） */
function viewportSize() {
  const vv = typeof window === 'undefined' ? null : window.visualViewport;
  if (vv) return { w: vv.width, h: vv.height };
  return { w: window.innerWidth, h: window.innerHeight };
}

/** 顶栏高度：贴顶的浮窗要让开它（登录态/未登录态高度一样，都是 `--top-h`） */
function topbarHeight() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--top-h');
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : TOP_H_FALLBACK;
}

/* ---------------- ② 贴边定位 ---------------- */

/**
 * 贴边定位。参数与 echarts `tooltip.position` 回调一致。
 *
 * @param {HTMLElement} host 图表容器（`echarts.init` 的那个元素）
 * @param {number[]} point 悬停点在**图表内**的坐标
 * @param {{contentSize: number[]}} size 浮窗自身尺寸（`offsetWidth/offsetHeight`）
 * @param {{top?: number, bottom?: number, mode?: 'flip'|'bottom'}} band 可用带（视口坐标，缺项用默认值）
 * @returns {number[]} 仍是**图表内**坐标（echarts 负责换算到图层 = 屏幕）
 */
function pinAt(host, point, size, band = {}) {
  const { w: vw, h: vh } = viewportSize();
  const hostRect = host.getBoundingClientRect();
  const [tw, th] = size.contentSize;
  const [px, py] = point;

  /* 可用带：缺项时用「顶栏下方 ~ 屏幕下方」。带子可能比浮窗还矮（手机竖屏常见），
     所以下面先算好 lo/hi，再把 y 夹回 [lo, maxY] —— 至少保证不跑到带子外面去。 */
  const top = Number.isFinite(band.top) ? band.top : topbarHeight() + TIP_GAP;
  const bottom = Number.isFinite(band.bottom) ? band.bottom : vh - TIP_GAP;
  const lo = Math.min(top, bottom);
  const hi = Math.max(top, bottom);
  const maxY = Math.max(lo, hi - th);
  /* 浮窗比带子还高时：以带子的**上沿**为准（宁可往下溢一点，也不要顶到屏幕外） */
  const minY = lo;

  const screenY = hostRect.top + py;
  let y;
  if (band.mode === 'bottom') y = maxY;              // 恒定贴带子下沿（= 图表标题那一带）
  else y = screenY > vh / 2 ? lo : maxY;             // 反面：点在下半 → 贴带子上沿
  y = clamp(y, minY, maxY);

  /* 横向以该点居中，再夹进屏幕 —— 图表比屏幕宽，不夹就会被推出屏幕 */
  const x = clamp(hostRect.left + px - tw / 2, TIP_GAP, Math.max(TIP_GAP, vw - tw - TIP_GAP));

  return [x - hostRect.left, y - hostRect.top];
}

/* ---------------- 打补丁 ---------------- */

/**
 * 给 `option.tooltip` 打补丁（①+②）。
 *
 * @param {object} tooltip 原 tooltip 配置
 * @param {HTMLElement} host 图表容器
 * @param {object} [opts]
 * @param {() => boolean} [opts.isPin] 是否贴边（窄屏 / 竖屏）—— 传函数而不是布尔值，
 *   `position` 每次移动都会重新调用，这样转屏后立刻跟着变
 * @param {(host: HTMLElement) => ({top?: number, bottom?: number, mode?: string})} [opts.band]
 *   可用带回调（视口坐标）。由视图给 —— 只有视图知道「哪块区域不能压」
 * @returns {object} 新的 tooltip 配置（不修改入参）
 */
export function patchTooltip(tooltip, host, opts = {}) {
  const layer = layerFor(host);
  if (!layer) return tooltip;
  const { isPin = () => false, band } = opts;
  const base = tooltip.position;
  const pinned = isPin();

  /** 当前可用带（每次调用都重算 —— 滚动 / 筛选后 rect 会变） */
  const readBand = () => {
    const b = typeof band === 'function' ? band(host) : null;
    return b && typeof b === 'object' ? b : {};
  };

  return {
    ...tooltip,
    /* 见文件头：confine 夹的是「图表范围」，与这里的两条目标冲突 */
    confine: false,
    /* 窄屏把浮窗收一档（否则塞不进图表标题那一带）+ 比屏幕还宽时换行 */
    extraCssText: `${tooltip.extraCssText || ''}`
      + (pinned ? NARROW_CSS : '')
      + `max-width:calc(100vw - ${TIP_GAP * 2}px);white-space:normal;`,
    appendTo: () => layer,
    position: (point, params, el, rect, size) => {
      if (isPin()) return pinAt(host, point, size, readBand());
      /* 宽屏横屏沿用原生行为：`position` 没配就是「贴着光标放」（返回 undefined 即回落默认） */
      return typeof base === 'function' ? base(point, params, el, rect, size) : base;
    },
  };
}

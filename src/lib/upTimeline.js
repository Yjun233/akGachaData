/**
 * UP 历史时间轴的 ECharts option（纯函数，与 Vue 无关）。
 *
 * 布局总览（三段式，见 UpHistoryView.vue 的模板）：
 *
 *   ┌──────────────┬────────────────────────────────────┐
 *   │ .tl-corner   │ .tl-headchart  顶部刻度条（sticky top）│  ← 横轴固定在顶部
 *   ├──────────────┼────────────────────────────────────┤
 *   │ .tl-names    │ .tl-body       主体（条 + 标记）       │
 *   │ （sticky left）│                                     │
 *   └──────────────┴────────────────────────────────────┘
 *
 * 为什么拆成两张图/两段 DOM：
 * 1. **横轴要固定在顶部** —— echarts 的轴会跟着画布滚走，只能把轴单独做成一条
 *    高度固定的图，外层 `.tl-head` 用 `position:sticky` 钉住。
 * 2. **干员名要固定在左侧** —— 图表可以有 4000+ px 宽（见下），横向滚动时
 *    纵轴标签会滚出视野，所以名字抽成 DOM 列（`.tl-names`，`position:sticky;left:0`）。
 *
 * 坐标口径：**不用 `time` 轴，改用「月序号」value 轴**。
 * - `monthIndexOf('2026-09-10')` = 1986-09 + 9/30 → 浮点月序号（1970-01 = 0）
 * - 轴 `type:'value' + interval:1` → 刻度**正好落在每个月的 1 号**，
 *   标签格式化成 `2026-01`（用户指定的格式），竖线也在这些位置
 * - 用 `time` 轴做不到这一点：它的刻度间隔由内部算法挑，不保证对齐到月初
 *
 * ⚠️ **顶部刻度条是「自己画」的，不用 echarts 的坐标轴**（`axisOption` 里的 custom 系列）：
 * echarts 在 `axisLabel` 带 `rotate` 时会把**绘图区往里缩**（实测 grid 左边界 12 → 25.5），
 * 于是刻度条的竖线比表体的竖线整体右移 13px —— 而表体那边标签是隐藏的、没有被缩，
 * 两者就对不齐了（用户报过这个 bug）。自己画就没有这个问题：线的 x 由 `api.coord` 在
 * **同一份 grid + 同一套 scale** 上算出来，与表体天然一致。
 * 附带好处：不用再受 `hideOverlap` 摆布（它在窄图上会偷偷少标几个月，而且浏览器与 SSR
 * 的判断还不一致），现在是「每个月都标」。
 *
 * 三个曾经踩过的坑：
 * - **custom 系列的 data 必须带 x 值**（这里是月序号）。只放索引的话 echarts 推不出轴范围，
 *   整个图会是空白（图形由 renderItem 用 api.coord 定位，光靠 data 里的值不够）。
 * - **`src/lib/charts.js` 必须注册 `CustomChart`**，否则整个系列被静默跳过（只剩坐标轴）。
 * - **手绘 text 的样式要用 zrender 的属性**（`fontSize` / `align` / `verticalAlign`），
 *   写 CSS 的 `font` 简写或 `textAlign` 都不生效；旋转用元素的 `rotation` + `originX/Y`。
 */
import { TYPE_LABEL,BANNER_CATEGORIES , CAT_COLOR, CAT_TINT, CAT_DEEP, SHOP } from './constants.js';
import { avatarUrl } from './avatars.js';
import { diffDays } from './date.js';

/** 时间轴布局常量 */
export const TL = {
  rowH: 26,        // 每位干员占的高度
  barH: 10,        // 横条厚度
  mark: 20,        // 标记圆的直径（简洁模式=色圈+首字；图片模式=圆形头像）
  markRight: 2,    // 标记离绘图区右边的留白
  nameW: 78,       // 左侧干员名列宽（DOM，sticky）
  dayPx: 1,        // **横轴最小宽度：1 天 = 1px**（用户指定；不管标签会不会重叠）
  padLeft: 12,     // 绘图区左右内缩：给首尾的斜标签留一点空间
  padRight: 26,
  gridTop: 4,
  gridBottom: 8,
  /* 顶部刻度条：标签斜 60° 摆放（与「首次进店间隔」一致），所以需要更高的条 */
  stripH: 64,
  stripLineY: 46,     // 竖线的上端（在条内的 y）
  stripGridH: 16,     // 竖线长度
  labelGap: 6,        // 标签锚点距离竖线上端的间距
  labelRotate: 60,    // 标签倾斜角度（度）
  lineColor: '#e8f0fa', // 竖线颜色（刻度条与表体共用，保证视觉连续）
};

/* ---------------- 月序号 ↔ 日期 ---------------- */

/** 'YYYY-MM-DD' → 浮点月序号（1970-01 = 0；月内按天数线性分摊） */
export function monthIndexOf(date) {
  if (!date) return NaN;
  const [y, m, d] = String(date).split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return NaN;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // 当月天数
  return (y - 1970) * 12 + (m - 1) + ((d || 1) - 1) / lastDay;
}

/** 月序号 → 'YYYY-MM' */
export function monthLabel(mi) {
  const i = Math.round(mi);
  const y = 1970 + Math.floor(i / 12);
  const m = (i % 12 + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** 月序号 → 'YYYY-MM-01'（用来数天数） */
export function monthStartDate(mi) {
  const i = Math.round(mi);
  const y = 1970 + Math.floor(i / 12);
  const m = (i % 12 + 12) % 12 + 1;
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

/**
 * 干员名首字（简洁模式写在圆里；图片模式之外一律显示它）
 */
export const firstChar = (name) => Array.from(String(name || '?'))[0] || '?';

/* ---------------- 尺寸 ---------------- */

/** 主体高度 = 行数 × 行高 + 上下留白 */
export const chartHeight = (rows) => rows.length * TL.rowH + TL.gridTop + TL.gridBottom;

/**
 * 时间轴需要的最小宽度（外层横向滚动的阈值）。
 * **口径：1 天 = 1px**（用户指定，不管标签会不会重叠）。
 * 横轴两端都对齐到月初 / 月末，所以直接数月历天即可。
 */
export const minInnerWidth = (xMin, xMax) => {
  const days = Math.max(1, diffDays(monthStartDate(xMax), monthStartDate(xMin)));
  return TL.nameW + TL.padLeft + TL.padRight + days * TL.dayPx;
};

/* ---------------- option 构造 ---------------- */

/**
 * @param {object} ctx
 * @param {Array}  ctx.rows             当前星级、当前筛选下的干员行
 * @param {{from?:string,to?:string}} [ctx.xRange] 右栏时间范围（'YYYY-MM-DD'）
 * @param {boolean} [ctx.isImage]       图片模式
 * @param {object} [ctx.operatorByName] 干员名 → 干员（取 charId 找头像）
 */
export function buildUpTimeline({ rows, xRange = {}, isImage = false, operatorByName = {} }) {
  const startOf = (r) => (Number.isFinite(monthIndexOf(r.releaseDate))
    ? monthIndexOf(r.releaseDate)
    : monthIndexOf(r.firstDate));

  /* 1) 横轴范围：优先用右栏设置，否则用数据自身范围。
        两端都取整到「月初 / 月末」，这样刻度（每月 1 号）才不会跑偏。 */
  let dataLo = Infinity;
  let dataHi = -Infinity;
  for (const r of rows) {
    const s = startOf(r);
    const e = monthIndexOf(r.lastDate);
    if (Number.isFinite(s)) dataLo = Math.min(dataLo, s);
    if (Number.isFinite(e)) dataHi = Math.max(dataHi, e);
  }
  const fromMI = monthIndexOf(xRange.from);
  const toMI = monthIndexOf(xRange.to);
  const lo = Number.isFinite(fromMI) ? fromMI : dataLo;
  const hi = Number.isFinite(toMI) ? toMI : dataHi;

  const xMin = Number.isFinite(lo) ? Math.floor(lo) : 0;
  const xMaxRaw = Number.isFinite(hi) ? Math.ceil(hi) : xMin + 1;
  const xMax = xMaxRaw > xMin ? xMaxRaw : xMin + 1;
  const monthCount = xMax - xMin;

  /* 2) 标记摊平：series 的每个 data item = 一次 UP，悬停才有卡池信息。
        **范围外的标记直接丢掉** —— 否则会被 api.coord 定位到绘图区外面去
        （右边缘那个「往左让」的兜底会把它们错误地拉回视野内）。 */
  const markRefs = [];
  rows.forEach((r, i) => {
    for (const m of r.marks) {
      const mi = monthIndexOf(m.date);
      if (!(mi >= xMin && mi <= xMax)) continue;
      markRefs.push({ row: r, mark: m, idx: i, mi });
    }
  });

  /* 顶部刻度条：**不用 echarts 的坐标轴**，改成自己画。
     原因（实测出来的）：给 `xAxis.axisLabel` 设了 `rotate` 之后，echarts 会把**绘图区往里缩**
     （grid 左边界 12 → 25.5），于是刻度条的竖线和表体的竖线差了 13px —— 而表体那边因为
     标签是隐藏的、没有被缩，两者对不齐。自己画就没有这个问题：线的位置由 `api.coord`
     在**同一套 scale + 同一份 grid** 上算出来，和表体天然一致。
     顺带解决了另一件事：`hideOverlap` 在窄图上会偷偷少标几个月（浏览器与 SSR 判断还不一致），
     自己画就是「每个月都标」。 */
  const ticks = [];
  for (let m = xMin; m <= xMax; m++) ticks.push(m);

  const axisOption = {
    animation: false,
    grid: { left: TL.padLeft, right: TL.padRight, top: 0, height: TL.stripH },
    /* ⚠️ 用 `show:false` 会连 splitLine 一起关掉，所以这里逐项隐藏；
       竖线**全部由下面的 custom 系列自绘** —— echarts 的 splitLine 一律关掉，
       否则会出现"两套线"（实测刻度条里混了 echarts 默认的 splitLine，与自绘的差约 10px）。 */
    xAxis: {
      type: 'value',
      min: xMin,
      max: xMax,
      interval: 1,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false },
    },
    yAxis: { type: 'category', data: [''], show: false },
    series: [{
      type: 'custom',
      silent: true,
      data: ticks,
      renderItem(params, api) {
        const mi = api.value(0);
        const x = api.coord([mi, 0])[0];
        /* echarts 画网格线时会 +0.5 让它落在像素中心（表体的 splitLine 在 12.5 而不是 12），
           这里跟着 +0.5，两条线才会像素级重合、接起来看不出断口 */
        const px = x + 0.5;
        const lineTop = TL.stripLineY;
        const anchorY = lineTop - TL.labelGap;
        return {
          type: 'group',
          children: [
            /* 竖线：与表体的 splitLine 同色同宽，视觉上接得上 */
            {
              type: 'line',
              shape: { x1: px, y1: lineTop, x2: px, y2: lineTop + TL.stripGridH },
              style: { stroke: TL.lineColor, lineWidth: 1 },
            },
            /* 标签：斜 60°。⚠️ 角度符号别搞反 —— 取负值会让文字**往右下**排，
               压到竖线上、还伸出条外，看起来就像"刻度线错位"（实测踩过）。
               正值才是往右上抬头，与「首次进店间隔」页的观感一致。 */
            {
              type: 'text',
              rotation: TL.labelRotate * Math.PI / 180,
              originX: px,
              originY: anchorY,
              style: {
                text: monthLabel(mi),
                x: px,
                y: anchorY,
                fill: '#7b8794',
                fontSize: 10,
                fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
                align: 'left',
                verticalAlign: 'middle',
              },
            },
          ],
        };
      },
    }],
  };

  /* ---- 主体 ---- */
  const bodyOption = {
    animation: false,
    grid: {
      left: TL.padLeft,
      right: TL.padRight,
      top: TL.gridTop,
      height: rows.length * TL.rowH,
    },
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: (p) => {
        const ref = markRefs[p.dataIndex];
        if (!ref) return '';
        const { row, mark } = ref;
        const lines = [
          `<b>${row.name}</b>（${row.rarity}★）`,
          `${mark.bannerName}`,
          `卡池时间：${mark.date} ~ ${mark.endDate}`,
          `类型：${TYPE_LABEL[mark.type]}（${mark.cat}）`,
        ];
        if (mark.isShop) lines.push(`<b style="color:${SHOP.color}">商店兑换</b>`);
        if (row.releaseDate) {
          lines.push(`实装 ${row.releaseDate} · 第 ${row.marks.indexOf(mark) + 1}/${row.count} 次 UP`);
        }
        return lines.join('<br/>');
      },
    },
    /* 表体只保留「每月一条竖线」（splitLine），轴本身的三件套都隐藏 ——
       ⚠️ 不能用 `show:false`：那会把 splitLine 一起关掉（表体就一条竖线都没有了）。
       也不能给 axisLabel 加 `rotate`：那会让 echarts 把绘图区往里缩，导致与刻度条错位。 */
    xAxis: {
      type: 'value',
      min: xMin,
      max: xMax,
      interval: 1, // 每个整数 = 每个月的 1 号
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: true, interval: 1, lineStyle: { color: TL.lineColor } },
    },
    yAxis: {
      type: 'category',
      data: rows.map((r) => r.name),
      inverse: true,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false }, // 名字由左侧 DOM 列（sticky）显示
    },
    series: [
      /* 1) 横条：实装日 → 最后一次 UP（**两端都在绘图区边界截断**） */
      {
        type: 'custom',
        silent: true,
        data: rows.map((r, i) => [startOf(r), i]),
        renderItem(params, api) {
          const i = api.value(1);
          const r = rows[i];
          if (!r) return null;
          const cs = params.coordSys;
          const p1 = api.coord([startOf(r), i]);
          const p2 = api.coord([monthIndexOf(r.lastDate), i]);
          if (!p1 || !p2) return null;

          const left = cs.x;
          const right = cs.x + cs.width;
          /* 整条都在视野外 → 不画（右端在左边界左边 / 左端在右边界右边） */
          if (p2[0] <= left || p1[0] >= right) return null;

          const x = Math.max(p1[0], left);
          const w = Math.min(p2[0], right) - x;
          return {
            type: 'rect',
            shape: {
              x,
              y: p2[1] - TL.barH / 2,
              width: Math.max(2, w),
              height: TL.barH,
              r: TL.barH / 2,
            },
            style: { fill: '#e3edfa' },
          };
        },
      },
      /* 2) 标记：每次 UP 一个（圆**左边缘**对齐卡池开始日）
            两种模式用**同一套配色**：浅色圆底 + 大类色外圈，区别只是里面放
            头像（图片模式）还是干员名首字（简洁模式）。
            进店一律用**绿色小圆点标在右上角**。 */
      {
        type: 'custom',
        data: markRefs.map((ref) => [ref.mi, ref.idx]),
        renderItem(params, api) {
          const ref = markRefs[params.dataIndex];
          if (!ref) return null;
          const { row, mark } = ref;
          const ring = CAT_COLOR[mark.cat] || '#7b8794';
          const cs = params.coordSys;
          const cx0 = api.coord([ref.mi, ref.idx])[0];
          const cy = api.coord([ref.mi, ref.idx])[1];
          const d = TL.mark;

          /* 顶到绘图区右边界时往左让，否则最新几次 UP 会被裁掉 */
          const cx = Math.min(cx0, cs.x + cs.width - TL.markRight - d);
          const center = cx + d / 2;

          const children = [];

          if (isImage) {
            /* 素材是**方形**半身像 → 用 clipPath 裁成圆。
               ⚠️ 只裁图片本身：大类色圆环和右上角的进店点要留在裁剪之外，
               所以把图片单独包一层 group（zrender 的 group 支持 clipPath）。 */
            children.push({
              type: 'group',
              clipPath: { type: 'circle', shape: { cx: center, cy, r: d / 2 } },
              children: [
                {
                  type: 'image',
                  style: {
                    image: avatarUrl(operatorByName[row.name] || { name: row.name }, 'circle'),
                    x: cx,
                    y: cy - d / 2,
                    width: d,
                    height: d,
                  },
                },
              ],
            });
          } else {
            /* 简洁模式：**不随头像素材变图片** —— 浅色圆底 + 干员名首字 */
            children.push({
              type: 'circle',
              shape: { cx: center, cy, r: d / 2 },
              style: { fill: CAT_TINT[mark.cat] || '#f3f4f6' },
            });
            children.push({
              type: 'text',
              style: {
                text: firstChar(row.name),
                x: center,
                y: cy,
                fill: CAT_DEEP[mark.cat] || '#1f2937',
                /* 手绘 text 要用 zrender 的独立属性，写 CSS 的 `font` 简写无效 */
                fontSize: 11,
                fontWeight: 600,
                fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
                align: 'center',
                verticalAlign: 'middle',
              },
            });
          }

          /* 外圈颜色 = 卡池大类（两种模式一致） */
          children.push({
            type: 'circle',
            shape: { cx: center, cy, r: d / 2 },
            style: { fill: 'none', stroke: ring, lineWidth: 2 },
          });

          /* 进店 = 右上角的绿色小圆点（两种模式一致） */
          if (mark.isShop) {
            children.push({
              type: 'circle',
              shape: { cx: cx + d - 2, cy: cy - d / 2 + 2, r: 3.5 },
              style: { fill: SHOP.color, stroke: '#fff', lineWidth: 1.2 },
            });
          }

          /* 中坚甄选 = 右下角的蓝色小圆点（两种模式一致） */
          if (mark.type === 'clafes') {
            children.push({
              type: 'circle',
              shape: { cx: cx + d - 2, cy: cy + d / 2 - 2, r: 3.5 },
              style: { fill: CAT_COLOR[BANNER_CATEGORIES[mark.type]], stroke: '#fff', lineWidth: 1.2 },
            });
          }

          return { type: 'group', children };
        },
      },
    ],
  };

  return {
    axisOption,
    bodyOption,
    monthCount,
    xMin,
    xMax,
    markCount: markRefs.length,
  };
}

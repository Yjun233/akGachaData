/**
 * echarts 按需引入的唯一入口。
 *
 * 为什么单独一个文件：**必须是静态 import**，rollup 才能 tree-shake 掉没用到的图表类型
 * （直接 `await import('echarts/charts')` 会把所有图表都打进来，chunk 从 ~300KB 涨到 1MB）。
 * 组件侧再用 `await import('../lib/charts.js')` 动态加载本文件 —— 于是：
 *   - 构建期：只有 LineChart 等被用到的模块进 chunk
 *   - 运行期：echarts 只在浏览器里、组件挂载后才加载（SSR 渲染不会碰它）
 *
 * 需要新的图表类型 / 组件时，在这里 import 并加进 `use([...])`。
 */
import * as echarts from 'echarts/core';
import { LineChart, CustomChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

/* ⚠️ 这里漏注册任何一种用到的图表类型，echarts 只会 console.warn 一句然后把整个系列静默跳过 ——
   表现是「坐标轴画出来了、图形一个都没有」。UP 历史时间轴用 custom 手绘，务必保留 CustomChart。 */
echarts.use([
  LineChart,      // 首次进店间隔折线
  CustomChart,    // UP 历史时间轴（条形 + 标记全部手绘）
  GridComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export default echarts;

// 冒烟测试：在最小 DOM stub 下执行原型内联脚本
//  - 宽屏：卡池列表用表格；窄屏：用卡片
//  - 无 JS 兜底：构建期已把内容预渲染进 HTML
//  - 参考日期只影响出率提升记录，不影响卡池列表
// 另外做简易 CSS 级联断言，防止优先级把样式规则吃掉。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPage } from './lib/dom-shim.mjs';

const html = fs.readFileSync(process.argv[2], 'utf8');

/* ⚠️ 卡池数会随数据更新而变（2026-09-30 就从 430 变成 431），**不要写死** ——
   从资源仓库的 metadata 派生。冒烟测的是 prototype/index.html，而它就是拿这份数据生成的。 */
const META = JSON.parse(fs.readFileSync(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..',
  'akGachaResource', 'data', 'metadata.json',
), 'utf8'));
const BANNER_N = META.servers.find((s) => s.id === 'sc').bannerCount;
const SNAP = META.generatedAt;

const epilogue = `
  const ref = state.refDate;
  const pre = window.__prerender();
  const statsAtNow = statsViewHtml();
  // 卡池列表不应受参考日期影响
  state.refDate = '2020-01-01';
  renderBannerView();
  const bannersAtPast = document.getElementById('view-banners').innerHTML;
  const statsAtPast = statsViewHtml();
  state.refDate = ref;
  renderBannerView();
  renderStatsView();
  // 遮罩点击：停靠模式下不应改变抽屉状态；浮层模式下应关闭
  const navOpen = document.getElementById('navOpen');
  const filterOpen = document.getElementById('filterOpen');
  navOpen.checked = true; filterOpen.checked = true;
  document.getElementById('backdrop').onclick();
  const backdropClickResult = navOpen.checked + '/' + filterOpen.checked;
  navOpen.checked = false; filterOpen.checked = false;
  // 统计口径：出率提升应包含商店兑换（shopAll 是 upAll 的子集）
  const sm = computeStats(ref).map;
  let subsetOk = true, upTotal = 0, shopTotal = 0;
  for (const r of Object.values(sm)){
    upTotal += r.upAll.length;
    shopTotal += r.shopAll.length;
    if (r.shopAll.length > r.upAll.length) subsetOk = false;
  }
  const wendi = sm['温蒂'];
  // 服务器 / 日期基准 / 阈值分级
  const cellNormal = endCells({ live:false, days:100, end:'2026-01-01' });
  const cellWarn   = endCells({ live:false, days:200, end:'2026-01-01' });
  const cellDanger = endCells({ live:false, days:400, end:'2026-01-01' });
  const relSc = relDateOf(OP_BY_NAME['温蒂']);
  const relEn = (() => { const s = state.server; state.server = 'en'; const v = relDateOf(OP_BY_NAME['温蒂']); state.server = s; return v; })();
  return {
    stats: document.getElementById('view-stats').innerHTML,
    banners: document.getElementById('view-banners').innerHTML,
    preBanners: pre.banners,
    preStats: pre.stats,
    statsAtNow,
    bannersAtPast,
    statsAtPast,
    backdropClickResult,
    statLive: daysSortValue({ live:true, days:null }),
    statEnded: daysSortValue({ live:false, days:5 }),
    statNone: daysSortValue({ live:false, days:null }),
    allBanners: BANNER_LIST.length,
    shopSubsetOk: subsetOk,
    upTotal, shopTotal,
    wendiUp: wendi ? wendi.upAll.length : -1,
    wendiShop: wendi ? wendi.shopAll.length : -1,
    servers: SERVERS.map(s => s.id),
    server: state.server,
    defaultServer: META.defaultServer,
    serverCount: (META.servers || []).length,
    snapshotDate: SNAPSHOT_DATE,
    today: TODAY,
    refDateInit: state.refDate,
    cellNormal, cellWarn, cellDanger,
    relSc, relEn,
    bannerFileKey: Object.keys(BANNERS_BY_SERVER).join(','),
  };
`;

const wide = runPage(html, { auto: false, card: false, docked: true, epilogue }).result;
const narrow = runPage(html, { auto: true, card: true, docked: false, epilogue }).result;

// ---------------- CSS 级联检查 ----------------
// 注意：必须先剥掉 CSS 注释，注释里的花括号会打乱规则切分
const cssBlock = /<style>([\s\S]*?)<\/style>/.exec(html)[1].replace(/\/\*[\s\S]*?\*\//g, '');
function specOf(sel){
  const cls = (sel.match(/\./g) || []).length;
  const ids = (sel.match(/#/g) || []).length;
  const els = (sel.match(/(^|[\s>+~])[a-z]/gi) || []).length;
  return ids * 100 + cls * 10 + els;
}
function matchesEl(sel, el){
  // 伪类 / 兄弟组合器无法静态判定，跳过（否则 #a:checked ~ main #b 会被误判为命中）
  if (/[:~+]/.test(sel)) return false;
  const parts = sel.trim().split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return false;
  if (last.includes('#')) return false;   // id 选择器无法按元素静态判定，跳过
  const tagM = /^[a-z]+/i.exec(last);
  if (tagM && tagM[0].toLowerCase() !== el.tag) return false;
  const clsM = [...last.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
  return clsM.every(c => el.classes.includes(c));
}
function cascadeWinner(css, el, prop){
  let best = null, bestSpec = -1;
  for (const r of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
    const val = new RegExp('(?:^|;|\\s)' + prop + '\\s*:\\s*([^;]+)').exec(r[2]);
    if (!val) continue;
    for (const sel of r[1].split(',')){
      const s = sel.trim();
      if (!s || s.startsWith('@')) continue;
      if (!matchesEl(s, el)) continue;
      const sp = specOf(s);
      if (sp > bestSpec){ bestSpec = sp; best = val[1].trim(); }
    }
  }
  return best;
}

const count = (s, re) => (s.match(re) || []).length;

// 静态兜底区域（构建期预渲染进 HTML 的那部分）
const iB = html.indexOf('id="view-banners"');
const iS = html.indexOf('id="view-stats"');
const iMain = html.indexOf('<main class="content"');
const staticBanners = html.slice(iB, iS);
const staticStats = html.slice(iS, html.indexOf('</div>\n\n  <div class="note"', iS));
const topbarHtml = html.slice(html.indexOf('<header class="topbar"'), iMain);

// 统计页按星级切成块：chunk[1] = 六星分组，chunk[2] = 五星分组
const statChunks = wide.stats.split(/<div class="grp-sep"/).filter(c => c.includes('class="pair"'));

const checks = [
  // ---- 无 JS 兜底（构建期预渲染） ----
  ['兜底：卡池区已预渲染', /id="view-banners"><div class="card"/.test(html), true],
  ['兜底：卡池区预渲染为卡片（窄屏可用）', count(staticBanners, /class="bcard"/g), BANNER_N],
  ['兜底：卡池区不含宽表格', count(staticBanners, /<table/g), 0],
  ['兜底：统计区已预渲染', /id="view-stats"><div class="card"/.test(html), true],
  ['兜底：统计区含四节标题', ['1.1','1.2','2.1','2.2'].every(x => staticStats.includes('>' + x + '<')), true],
  ['兜底：占位符已全部替换', /<!--__[A-Z]+__-->/.test(html), false],
  ['兜底：不需要 JS 也能切页（CSS radio）', html.includes('#nav-stats:checked ~ main #view-stats'), true],

  // ---- 顶栏 ----
  ['顶栏存在', topbarHtml.startsWith('<header class="topbar"'), true],
  ['顶栏含卡池列表标题', topbarHtml.includes('t-banners">卡池列表'), true],
  ['顶栏含统计页标题', topbarHtml.includes('t-stats">出率提升记录'), true],
  ['顶栏含折叠按钮', topbarHtml.includes('for="navOpen"'), true],
  ['顶栏含数据筛选按钮', topbarHtml.includes('for="filterOpen"'), true],
  ['顶栏含统计页四个定位按钮', count(topbarHtml, /href="#s-[0-9]-[a-z]+"/g), 4],
  ['定位按钮指向 1.1/1.2/2.1/2.2', ['s-6-std','s-6-mid','s-5-std','s-5-mid'].every(x => topbarHtml.includes('href="#' + x + '"')), true],
  ['顶栏随页面切换标题/定位按钮', cssBlock.includes('#nav-stats:checked ~ header .tb-title .t-stats{display:inline}'), true],

  // ---- 左右抽屉 ----
  ['左抽屉存在', html.includes('class="drawer drawer-left"'), true],
  ['右抽屉存在', html.includes('class="drawer drawer-right"'), true],
  ['左抽屉默认隐藏', cssBlock.includes('translateX(-100%)'), true],
  ['右抽屉默认隐藏', cssBlock.includes('translateX(100%)'), true],
  ['抽屉用 checkbox 开合（无需 JS）', html.includes('id="navOpen"') && html.includes('id="filterOpen"'), true],
  ['遮罩存在', html.includes('id="backdrop"'), true],

  // ---- 横屏「停靠」模式 ----
  ['横屏停靠：媒体查询存在', cssBlock.includes('(orientation:landscape) and (min-width:900px)'), true],
  ['横屏停靠：默认展开', /aside\.drawer\{transform:none/.test(cssBlock), true],
  ['横屏停靠：勾选 = 收起', cssBlock.includes('#navOpen:checked ~ aside.drawer-left{transform:translateX(-100%)}'), true],
  ['横屏停靠：左侧挤压内容', cssBlock.includes('#navOpen:not(:checked) ~ main.content{margin-left:var(--drawer-w)}'), true],
  ['横屏停靠：右侧挤压内容', cssBlock.includes('#filterOpen:not(:checked) ~ main.content{margin-right:var(--drawer-w)}'), true],
  ['竖屏浮层：默认收起（勾选 = 打开）', cssBlock.includes('#navOpen:checked ~ aside.drawer-left{transform:none}'), true],
  ['横屏停靠：点内容不会收起侧栏', wide.backdropClickResult, 'true/true'],
  ['竖屏浮层：点遮罩收起侧栏', narrow.backdropClickResult, 'false/false'],
  ['横屏停靠：顶栏左侧收进中间区域', cssBlock.includes('#navOpen:not(:checked) ~ header.topbar{left:var(--drawer-w)}'), true],
  ['横屏停靠：顶栏右侧收进中间区域', cssBlock.includes('#filterOpen:not(:checked) ~ header.topbar{right:var(--drawer-w)}'), true],
  ['抽屉顶到最上方（top:0）', /aside\.drawer\{[\s\S]{0,60}top:0;bottom:0/.test(cssBlock), true],
  ['抽屉层级高于顶栏', /aside\.drawer\{[\s\S]{0,80}z-index:75/.test(cssBlock), true],
  ['遮罩覆盖整屏', /\.backdrop\{[\s\S]{0,40}inset:0/.test(cssBlock), true],

  // ---- 表格滚动条留在视野内 ----
  ['卡池表容器限高（滚动条贴在容器底）',
    cascadeWinner(cssBlock, { tag:'div', classes:['tbl-scroll'] }, 'max-height'), 'var(--tbl-max)'],
  ['统计表容器同样限高',
    cascadeWinner(cssBlock, { tag:'div', classes:['tbl-scroll','plain'] }, 'max-height'), 'var(--tbl-max-sec)'],
  ['限高变量按视口计算（dvh 优先）',
    /--tbl-max:max\(180px, calc\(100dvh\s*-\s*var\(--top-h\)\s*-\s*130px\)\)/.test(cssBlock) &&
    /--tbl-max-sec:max\(180px, calc\(100dvh\s*-\s*var\(--top-h\)\s*-\s*250px\)\)/.test(cssBlock), true],
  ['限高保留 vh 回退（老浏览器）',
    /--tbl-max:max\(180px, calc\(100vh\s*-\s*var\(--top-h\)\s*-\s*130px\)\)/.test(cssBlock) &&
    /--tbl-max-sec:max\(180px, calc\(100vh\s*-\s*var\(--top-h\)\s*-\s*250px\)\)/.test(cssBlock), true],
  ['矮视口收紧限高（滚动条不被挤出视野）',
    /@media \(max-height:620px\)\{[\s\S]*?--tbl-max-sec:max\(140px, calc\(100dvh\s*-\s*var\(--top-h\)\s*-\s*240px\)\)/.test(cssBlock), true],
  ['统计页说明行已移除（卡片头小字 + .toc-hint 都删了）',
    /toc-hint/.test(cssBlock) || /toc-hint/.test(wide.stats), false],
  ['触屏下不再取消限高（滚动条仍在视野内）', cssBlock.includes('max-height:none'), false],
  ['表格容器收缩到内容宽（纵滚条贴表格右侧）',
    /\.tbl-scroll\{[\s\S]{0,160}width:fit-content/.test(cssBlock), true],
  ['表格容器不超出父级（窄容器仍可横滚）',
    /\.tbl-scroll\{[\s\S]{0,180}max-width:100%/.test(cssBlock), true],
  ['滚动条自定义加粗上色（避免看不见）',
    /\.tbl-scroll::-webkit-scrollbar\{[^}]*height:13px/.test(cssBlock) &&
    /\.tbl-scroll::-webkit-scrollbar-thumb\{/.test(cssBlock), true],
  ['未用 scrollbar-width（它会覆盖 webkit 滚动条宽度）',
    /scrollbar-width\s*:\s*(thin|auto)/.test(cssBlock), false],
  ['表格容器横滑不触发浏览器返回手势',
    /\.tbl-scroll\{[^}]*overscroll-behavior-x:contain/.test(cssBlock), true],

  // ---- 卡池分类新规则 ----
  ['类型标签改为 单六寻访 / 双五寻访', html.includes('单六寻访（single）') && html.includes('双五寻访（five）'), true],
  ['凝电之钻 归入双五寻访', /凝电之钻[\s\S]{0,200}双五寻访/.test(wide.banners), true],
  ['雾漫荒林 归入双五寻访', /雾漫荒林[\s\S]{0,200}双五寻访/.test(wide.banners), true],
  ['单六寻访仍存在', count(wide.banners, />单六寻访</g) > 0, true],

  // ---- 右栏内容 ----
  ['右栏含卡池筛选表单', /class="drawer-bd pane pane-banners"[\s\S]{0,400}id="f-type"/.test(html), true],
  ['右栏筛选为竖排字段', ['f-type','f-cat','f-from','f-to','f-op','f-reset'].every(x => html.includes('id="' + x + '"')), true],
  ['右栏含参考日期（仅统计页）', /pane pane-stats"[\s\S]{0,200}id="refDate"/.test(html), true],
  ['右栏内容随页面切换', cssBlock.includes('#nav-stats:checked ~ aside.drawer-right .pane-banners{display:none}'), true],
  ['参考日期已静态填值', /id="refDate" value="\d{4}-\d{2}-\d{2}"/.test(html), true],

  // ---- 宽屏形态 ----
  ['宽屏：卡池列表为表格', count(wide.banners, /<table/g), 1],
  ['宽屏：卡池列表数据行', count(wide.banners, /<tr/g) - 1, BANNER_N],
  ['宽屏：无卡片标记', count(wide.banners, /class="bcard"/g), 0],
  ['宽屏：出率提升（6★）/（5★）两列',
    wide.banners.includes('出率提升（6★）') && wide.banners.includes('出率提升（5★）'), true],
  ['宽屏：已删去「距结束」字段', wide.banners.includes('距结束'), false],
  ['宽屏：不再有独立商店兑换列', /no-sort ops">商店兑换/.test(wide.banners), false],
  ['宽屏：限 标记出现', count(wide.banners, /mk-lim/g) > 0, true],
  ['宽屏：兑 标记出现', count(wide.banners, /mk-shop/g) > 0, true],
  ['宽屏：每行 7 列', count(wide.banners.split('</tr>')[1] || '', /<td/g), 7],
  ['宽屏：colgroup 固定列宽', count(wide.banners, /<colgroup>/g), 1],
  // ⚠️ 冒烟测的是 prototype/index.html —— **原型已冻结**，卡池表仍是「固定 1225px 不拉伸」的旧排版；
  //   Vue 版早就改成 width:100% + min-width:1225px（宽屏铺满）了。这里按原型的实际写法断言，
  //   并用 style="width:1225px" 精确匹配 —— 别写 includes('width:1225px')，
  //   因为 min-width:1225px 里也含这个子串，会永远通过。
  ['宽屏：卡池表固定宽 1225px（原型冻结版）', /style="width:1225px"/.test(wide.banners), true],

  // ---- 窄屏形态 ----
  ['窄屏：卡池列表改用卡片', count(narrow.banners, /class="bcard"/g), BANNER_N],
  ['窄屏：卡片视图不再输出宽表格', count(narrow.banners, /<table/g), 0],
  ['窄屏：卡片含干员标签', count(narrow.banners, /class="tag r/g) > 400, true],

  // ---- 参考日期的作用范围 ----
  ['参考日期不影响卡池列表', count(wide.bannersAtPast, /<tr/g) - 1, BANNER_N],
  ['参考日期影响出率提升记录', count(wide.statsAtPast, /<tr/g) < count(wide.statsAtNow, /<tr/g), true],

  // ---- 预渲染的卡池视图 ----
  ['预渲染：输出卡片版', count(wide.preBanners, /class="bcard"/g), BANNER_N],
  ['预渲染：不输出宽表格', count(wide.preBanners, /<table/g), 0],

  // ---- 统计页 ----
  ['统计页：数据行', count(wide.stats, /<tr/g) - 8, 204],
  ['统计页：四节标题', ['1.1','1.2','2.1','2.2'].every(x => wide.stats.includes('>' + x + '<')), true],
  ['统计页：分组表头单元格（两行表头）', count(wide.stats, /class="group"/g), 8],
  ['统计页：跨两行的表头单元格', count(wide.stats, /rowspan="2"/g), 8],
  ['统计页：无「所在寻访」列', wide.stats.includes('所在寻访'), false],
  ['统计页：中坚表拆分列表头', count(wide.stats, />中坚次数</g), 4],
  ['统计页：四张表都用内容自适应列宽', count(wide.stats, /class="grid floating stat-tbl"/g), 4],
  ['统计页：不再输出 colgroup 固定列宽', count(wide.stats, /<colgroup>/g), 0],
  ['统计页：不再内联固定宽度', count(wide.stats, /<table[^>]*style="width:/g), 0],
  ['统计页：竖线用 inset box-shadow 画（sticky 滚动后不消失）',
    /table\.grid\.stat-tbl th,\s*table\.grid\.stat-tbl td\{[^}]*box-shadow:inset -1px 0 0 var\(--border\)/.test(cssBlock), true],
  ['统计页：最后一列不画右边线',
    /table\.grid\.stat-tbl th:last-child,\s*table\.grid\.stat-tbl td:last-child\{box-shadow:none\}/.test(cssBlock), true],
  ['统计页：用 separate 边框模型（sticky 表头的边框属单元格，不会留在原地）',
    /table\.grid\.stat-tbl\{[^}]*border-collapse:separate/.test(cssBlock) &&
    !/table\.grid\.stat-tbl\{[^}]*border-collapse:collapse/.test(cssBlock), true],
  ['统计页：第二行表头 sticky top = 第一行高度（--head-h）',
    /table\.grid\.floating thead tr:nth-child\(2\) th\{top:var\(--head-h\)/.test(cssBlock), true],
  ['统计页：thead 固定 line-height:18px（内容 18 + padding 16 = 34 = --head-h）',
    /table\.grid thead th\{[^}]*height:var\(--head-h\);line-height:18px/.test(cssBlock), true],
  ['统计页：第一行表头下边线用 box-shadow（不占布局，避免第二行上缩 1px）',
    /table\.grid\.stat-tbl thead tr:first-child th\{[^}]*border-bottom:0/.test(cssBlock) &&
    /table\.grid\.stat-tbl thead tr:first-child th\{[^}]*box-shadow:inset -1px 0 0 var\(--border\),inset 0 -1px 0 var\(--blue-200\)/.test(cssBlock) &&
    /table\.grid\.stat-tbl thead tr:first-child th:last-child\{[^}]*box-shadow:inset 0 -1px 0 var\(--blue-200\)/.test(cssBlock), true],
  ['统计页：日期列头部与数据都是右对齐',
    /th\('upEnd','结束时间','num'\)/.test(html) && /th\('shopEnd','结束时间','num'\)/.test(html) &&
    /thSpan\('releaseDate','实装时间','num'\)/.test(html), true],
  ['统计页：干员列覆盖 wrapcell 为不折行',
    /table\.grid\.stat-tbl td\.wrapcell\{[^}]*white-space:nowrap/.test(cssBlock), true],
  ['统计页：wrapcell 级联结果为 nowrap（比卡池表规则更具体）',
    cascadeWinner(cssBlock, { tag:'td', classes:['wrapcell'] }, 'white-space'), 'nowrap'],
  ['统计页：table-layout = auto（按内容定列宽）',
    cascadeWinner(cssBlock, { tag:'table', classes:['grid','stat-tbl'] }, 'table-layout'), 'auto'],
  ['统计页：表格 width = auto（全屏不被拉伸）',
    cascadeWinner(cssBlock, { tag:'table', classes:['grid','stat-tbl'] }, 'width'), 'auto'],
  ['卡池列表仍为固定列宽（table-layout:fixed）',
    cascadeWinner(cssBlock, { tag:'table', classes:['grid'] }, 'table-layout'), 'fixed'],

  // ---- CSS ----
  ['CSS：td.ops 的 white-space = normal（换行生效）',
    cascadeWinner(cssBlock, { tag:'td', classes:['ops'] }, 'white-space'), 'normal'],
  ['CSS：td 默认 white-space = nowrap',
    cascadeWinner(cssBlock, { tag:'td', classes:[] }, 'white-space'), 'nowrap'],
  ['CSS：排序箭头降序翻转',
    cascadeWinner(cssBlock, { tag:'span', classes:['arw'] }, 'transform'), 'rotate(180deg)'],
  ['CSS：排序箭头可应用变换',
    cascadeWinner(cssBlock, { tag:'span', classes:['arw'] }, 'display'), 'inline-block'],
  ['CSS：抽屉为 fixed 定位',
    cascadeWinner(cssBlock, { tag:'aside', classes:['drawer'] }, 'position'), 'fixed'],

  // ---- 排序语义 ----
  ['排序：统计页「进行中」= 0', wide.statLive, 0],
  ['排序：统计页已结束 = 距今天数', wide.statEnded, 5],
  ['排序：统计页无数据 = -1', wide.statNone, -1],

  // ---- 统计口径：出率提升包含商店兑换 ----
  ['口径：商店兑换次数是出率提升的子集（每人都满足）', wide.shopSubsetOk, true],
  ['口径：全量出率提升次数 > 商店兑换次数', wide.upTotal > wide.shopTotal, true],
  ['口径：温蒂出率提升含进店 = 14 次', wide.wendiUp, 14],
  ['口径：温蒂商店兑换 = 4 次（少于出率提升）', wide.wendiShop, 4],
  ['节标题提示语已全部删除（否则两列标题行数不同、表格顶部错位）',
    count(wide.stats, /class="hint"/g) + count(wide.stats, /出率提升已含商店兑换/g), 0],

  // ---- 服务器（多服扩展预留） ----
  ['服务器：metadata 里定义了三个服务器', wide.serverCount, 3],
  ['服务器：当前只有国服可用', wide.servers.join(','), 'sc'],
  ['服务器：当前服务器 = defaultServer', wide.server, wide.defaultServer],
  ['服务器：下拉框预渲染出「国服」选项',
    count(html, /<option value="sc" selected>国服<\/option>/g), 1],
  ['服务器：未实现的服务不出现在下拉框里',
    count(html, /<option value="en"|<option value="tc"/g), 0],
  ['服务器：前端已按服务器取卡池数据（bannersByServer.sc）', wide.bannerFileKey, 'sc'],
  ['服务器：切换服务器会重算卡池集合',
    /function setServer\(id\)\{[\s\S]{0,300}BANNER_LIST = Object\.keys\(BANNERS\)/.test(html), true],

  // ---- 干员字段改名（多服实装日） ----
  ['字段：干员表含 scReleaseDate', html.includes('"scReleaseDate"'), true],
  ['字段：干员表含 enReleaseDate / tcReleaseDate', html.includes('"enReleaseDate"') && html.includes('"tcReleaseDate"'), true],
  ['字段：国服实装日按服务器字段取值（温蒂）', wide.relSc, '2020-05-01'],
  ['字段：未实装服务器（en）取值为 null', wide.relEn, null],

  // ---- 距今天数阈值：180 标黄 / 365 标红 ----
  ['阈值：100 天不着色', /class="(warn|hot)"/.test(wide.cellNormal), false],
  ['阈值：200 天标黄', /class="warn"/.test(wide.cellWarn), true],
  ['阈值：400 天标红', /class="hot"/.test(wide.cellDanger), true],
  ['阈值：WARN_DAYS = 180 且 DANGER_DAYS = 365',
    /const WARN_DAYS = 180;/.test(html) && /const DANGER_DAYS = 365;/.test(html), true],
  ['阈值：已移除旧的单一标红常量', /UP_WARN_DAYS|SHOP_WARN_DAYS/.test(html), false],
  ['阈值：CSS 里 .warn 用 --warn 色、.hot 用 --danger 色',
    /\.warn\{color:var\(--warn\)/.test(cssBlock) && /\.hot\{color:var\(--danger\)/.test(cssBlock), true],

  // ---- 日期基准 ----
  ['日期：TODAY 为真实日期格式', /^\d{4}-\d{2}-\d{2}$/.test(wide.today), true],
  ['日期：SNAPSHOT_DATE = 数据的 generatedAt', wide.snapshotDate, SNAP],
  ['日期：参考日期初始值取数据快照日', wide.refDateInit, wide.snapshotDate],
  ['日期：卡池列表「进行中」按真实日期判断（用 TODAY）',
    /const isLive = b => b\.startDate <= TODAY && TODAY <= b\.endDate;/.test(html), true],

  // ---- 同星级「标准 / 中坚」两表自适应并排 ----
  ['并排：两个星级分组各有一个配对容器', statChunks.length, 2],
  ['并排：每个配对容器含两个列（标准 + 中坚）',
    statChunks.every(c => count(c, /class="pair-col"/g) === 2), true],
  ['并排：每个配对容器含两张表',
    statChunks.every(c => count(c, /<table class="grid/g) === 2), true],
  ['并排：标准寻访在左、中坚寻访在右',
    statChunks.every(c => /标准寻访[\s\S]*?中坚寻访/.test(c)), true],
  ['并排：锚点 id 保留（s-6-std / s-6-mid / s-5-std / s-5-mid）',
    ['s-6-std','s-6-mid','s-5-std','s-5-mid'].every(id => wide.stats.includes('id="' + id + '"')), true],
  ['并排：结构已预渲染进静态 HTML（无 JS 也成立）', count(staticStats, /class="pair"/g), 2],
  ['并排：CSS 用 flex-wrap 决定是否换行', /\.pair\{[^}]*flex-wrap:wrap/.test(cssBlock), true],
  ['并排：列可收缩进容器（min-width:0）', /\.pair-col\{[^}]*min-width:0/.test(cssBlock), true],
  ['并排：列宽基准为 auto（按表格自然宽度并排，避免压出横向滚动条）',
    cascadeWinner(cssBlock, { tag:'div', classes:['pair-col'] }, 'flex'), '0 1 auto'],

  // ---- 结构 ----
  ['页签用 radio 实现', html.includes('id="nav-banners"') && html.includes('id="nav-stats"'), true],
  ['noscript 兜底提示存在', html.includes('<noscript>'), true],
];

let bad = 0;
for (const [name, got, want] of checks){
  const ok = got === want;
  if (!ok) bad++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + ' → ' + got + (ok ? '' : ' (期望 ' + want + ')'));
}
console.log(bad ? `\n✗ 冒烟测试有 ${bad} 项未通过` : `\n✓ 冒烟测试全部通过（${checks.length} 项，无异常抛出）`);
process.exit(bad ? 1 : 0);

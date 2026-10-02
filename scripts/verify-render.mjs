/**
 * Vue 渲染核对：用 Vite 的 SSR 加载 + Vue 服务端渲染把**四个页面**（卡池列表 / 出率提升记录 /
 * 首次进店间隔 / UP 历史一览）真正渲染出来，再检查结构 / 数据是否与原型一致。
 *
 * 为什么不用无头浏览器：本机 Chrome / Edge 的无头模式起不来（见 README「本地环境」），
 * 而 SSR 渲染同样会执行组件、store、数据层，足以验证「迁移没有走样」。
 *
 * 用法：node scripts/verify-render.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
/* 纯函数工具可以直接 import（无 import.meta.env / .vue 依赖），不必绕 vite */
import { shiftYears, localToday } from '../src/lib/date.js';
/* 配色常量（纯模块，可直接 import）—— 断言的期望值直接引用它，避免抄错色值；
   同理排序标签也从 `UP_SORT_ROWS` 取，别写死文案 */
import { CAT_COLOR, SHOP, UP_SORT_ROWS } from '../src/lib/constants.js';
/* 框架包用 Node 原生 import（Vite SSR 会把它们外部化，与组件里用的是同一份实例）；
   只有 .vue / 业务模块才走 vite.ssrLoadModule。 */
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createPinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** matchMedia 的最小替身 */
const makeMQ = (matches) => ({
  matches,
  media: '',
  addEventListener() {},
  removeEventListener() {},
});

/* ---------- 浏览器环境 stub ----------
   只补 window.matchMedia（composables/useLayout.js 在模块顶层就调用它）。
   注意**不要**定义 globalThis.document —— Vue 的 runtime-dom 会检测到它存在，
   进而调用 document.createElement 而崩溃；SSR 渲染本来也不需要 DOM。 */
globalThis.window = {
  matchMedia: () => makeMQ(false), // 默认：非停靠、非手机宽度 → 宽屏表格视图
  addEventListener() {},
  removeEventListener() {},
};

/* ---------- fetch stub：直接读磁盘，不发网络请求 ----------
   站点在 **dev 读本地**（`public/{data,avatars}` 目录联接）、**build 才走 CDN**（见 src/lib/resource.js）。
   SSR 走的是 Vite 的 `import.meta.env.DEV` 分支，所以这里收到的多半是相对路径（如 `/data/operators.json`）；
   但为稳妥起见，绝对地址（`https://cdn.jsdelivr.net/gh/…@main/data/operators.json`）也一并兼容。
   把 `data/` 或 `avatars/` 之后的路径截出来，直接到**资源仓库的真身**里读，
   这样核对脚本既不依赖网络、也不依赖 public/ 下的目录联接。 */
const RES_ROOT = path.resolve(ROOT, '..', 'akGachaResource');
globalThis.fetch = async (url) => {
  const s = String(url);
  const m = s.match(/(data|avatars)\/(.+)$/);
  const file = m
    ? path.join(RES_ROOT, m[1], m[2])
    : path.join(ROOT, 'public', s.replace(/^\/+/, ''));
  if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
  const text = fs.readFileSync(file, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(text) };
};

/* ---------- 渲染 ---------- */
const vite = await createServer({
  root: ROOT,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

const results = [];
/* 样式表文本：配色 / sticky / 最小宽度这些"是否成立"的关键只能从 CSS 里断言 */
const cssAll = fs.readFileSync(path.join(ROOT, 'src/styles/main.css'), 'utf8');

const check = (label, actual, expected) => {
  results.push({ ok: String(actual) === String(expected), label, actual, expected });
};
const count = (s, re) => (s.match(re) || []).length;

try {
  const { default: App } = await vite.ssrLoadModule('/src/App.vue');
  const { useSiteStore } = await vite.ssrLoadModule('/src/stores/site.js');

  const renderRoute = async (routePath, mutate) => {
    const app = createSSRApp(App);
    const pinia = createPinia();
    app.use(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'banners', component: (await vite.ssrLoadModule('/src/views/BannerListView.vue')).default },
        { path: '/operators', name: 'stats', component: (await vite.ssrLoadModule('/src/views/StatsView.vue')).default },
        { path: '/shop-interval', name: 'shopInterval', component: (await vite.ssrLoadModule('/src/views/ShopIntervalView.vue')).default },
        { path: '/up-history', name: 'upHistory', component: (await vite.ssrLoadModule('/src/views/UpHistoryView.vue')).default },
      ],
    });
    app.use(router);
    const store = useSiteStore(pinia);
    await store.load();
    /* 可选：渲染前改状态（用于验证「图片模式」「口径切换」等分支） */
    if (typeof mutate === 'function') mutate(store);
    router.push(routePath);
    await router.isReady();
    const html = await renderToString(app);
    return { html, store };
  };

  /* ---------------- 首页：卡池列表 ---------------- */
  const banners = await renderRoute('/');
  const bh = banners.html;

  /* ⚠️ 卡池数 / 快照日会随每次数据更新而变，**不要写死** —— 写成从 metadata 派生的期望值。
     （曾写死 430 / 2026-09-29，2026-09-30 数据更新到 431 后一堆断言集体变红。） */
  const META = banners.store.meta;
  const BANNER_N = META.servers.find((x) => x.id === 'sc').bannerCount;
  const SNAP = META.generatedAt;
  /* 参考日期的初始值 = 打开页面的**真实当天**（2026-10-01 口径调整；以前取数据快照日 SNAP）。
     三个服务器的「数据更新日」只用于左栏展示，不再参与计算。 */
  const TODAY = localToday();

  check('数据层加载成功', banners.store.error, '');
  check('卡池总数 = metadata.bannerCount', banners.store.banners.length, BANNER_N);
  check('干员总数', banners.store.operatorCount, 230);
  check('默认服务器', banners.store.server, 'sc');
  check('参考日期初始值 = 打开页面的当天', banners.store.refDate, TODAY);

  check('卡池列表页渲染出卡片/表格', count(bh, /class="grid floating"/g) >= 1, true);
  check('卡池数据行数 = 卡池总数',
    count(bh.slice(bh.indexOf('<tbody>'), bh.indexOf('</tbody>')), /<tr>/g), BANNER_N);
  check('表头：出率提升（6★）', count(bh, /出率提升（6★）/g), 1);
  check('表头：出率提升（5★）', count(bh, /出率提升（5★）/g), 1);
  /* ⚠️ 别再用 `includes('width:1225px')` —— `min-width:1225px` 里也含这个子串，
     断言会一直「通过」，哪怕表格早就不这么排版了。这里按实际写法分别匹配。 */
  check('卡池表：铺满可用宽度 + 1225px 兜底下限',
    /width:100%;min-width:1225px/.test(bh.replace(/\s+/g, '')), true);
  check('「进行中」胶囊', count(bh, /pill-live/g) >= 1, true);
  check('商店兑换标记「兑」', count(bh, /mk-shop/g) >= 1, true);
  check('限定标记「限」', count(bh, /mk-lim/g) >= 1, true);
  check('结果提示（命中 N / M）',
    new RegExp(`命中 ${BANNER_N} / ${BANNER_N} 个卡池`).test(bh), true);
  check('左栏元信息：干员 230 位', /干员 <b>230<\/b> 位/.test(bh), true);
  check('左栏元信息：卡池数', new RegExp(`卡池 <b>${BANNER_N}</b> 个`).test(bh), true);


  /* ---------------- 统计页 ---------------- */
  const stats = await renderRoute('/operators');
  const sh = stats.html;

  check('统计页：四张表', count(sh, /class="grid floating stat-tbl"/g), 4);
  check('统计页：两个并排容器', count(sh, /class="pair"/g), 2);
  check('统计页：四个分节标题', count(sh, /class="sec-title[ "]/g), 4);
  check('统计页：锚点 id 齐全',
    ['s-6-std', 's-6-mid', 's-5-std', 's-5-mid'].every((id) => sh.includes(`id="${id}"`)), true);
  check('统计页：中坚表有「中坚次数」列（2 表 × 出率提升/商店兑换）', count(sh, /中坚次数/g), 4);

  /* ---------------- 全站配色（大类三色 / 商店兑换绿色） ----------------
     一套颜色要同时落在 卡池列表徽章、统计页表与标题、UP 历史标记 上，
     所以断言分两层：常量正确 + 各处确实引用了它 + CSS 里的落地色值。 */
  check('配色常量：大类三色', JSON.stringify(CAT_COLOR),
    JSON.stringify({ 标准寻访: '#FFD524', 中坚寻访: '#0098DC', 限定寻访: '#8b5cf6' }));
  check('配色常量：商店兑换 = 绿色', SHOP.color, '#15803d');
  check('卡池列表：大类徽章按三色上色（c-std / c-mid / c-lim）',
    ['c-std', 'c-mid', 'c-lim'].every((c) => bh.includes(c)), true);
  check('卡池列表：「兑」标记走全站绿色变量',
    /\.mk-shop\{background:var\(--shop-600\)\}/.test(cssAll)
    && /--shop-600:#15803d/.test(cssAll), true);
  check('统计页：分节标题按大类着色（标准 = 黄 / 中坚 = 蓝）',
    count(sh, /class="sec-title c-std"/g) === 2 && count(sh, /class="sec-title c-mid"/g) === 2, true);
  check('统计页：样式表里两套标题配色存在',
    /\.sec-title\.c-std\{[\s\S]*?#FFD524/.test(cssAll)
    && /\.sec-title\.c-mid\{[\s\S]*?#0098DC/.test(cssAll), true);
  check('统计页：「商店兑换」组表头走绿色',
    count(sh, /class="group grp-shop"/g) === 4
    && /th\.group\.grp-shop\{background:var\(--shop-100\);color:var\(--shop-700\)\}/.test(cssAll), true);
  check('统计页：商店兑换的列头带 shopcol（绿色字）',
    count(sh, /class="num shopcol"/g) >= 12
    && /th\.shopcol\{color:var\(--shop-700\)\}/.test(cssAll), true);
  /* 2026-09-30 起卡片头与分组标题合并：不再有「六星干员 / 五星干员」两个大字分隔，
     改为四个分节标题自带星级（分隔块只剩一个纯占位）。 */
  check('统计页：四个分节标题自带星级',
    ['六星干员·标准寻访', '六星干员·中坚寻访', '五星干员·标准寻访', '五星干员·中坚寻访']
      .every((t) => sh.includes(t)), true);
  check('统计页：只剩一个分隔块（星级已并入分节标题）',
    count(sh, /class="grp-sep"/g), 1);

  /* 每张表的行数：与原型（44 / 48 / 44 / 68）一致 */
  const tableRows = (html, anchor) => {
    const start = html.indexOf(`id="${anchor}"`);
    const t = html.indexOf('<tbody>', start);
    const e = html.indexOf('</tbody>', t);
    return count(html.slice(t, e), /<tr>/g);
  };
  const sizes = ['s-6-std', 's-6-mid', 's-5-std', 's-5-mid'].map((a) => tableRows(sh, a));
  check('统计页：四张表行数 44 / 48 / 44 / 68', sizes.join(','), '44,48,44,68');
  check('统计页总行数 = 参与统计干员数',
    sizes.reduce((a, b) => a + b, 0), 204);

  /* 抽样：与原型逐格核对过的干员应出现在统计页 */
  check('统计页：包含「推进之王」', sh.includes('推进之王'), true);
  check('统计页：结果提示含参考日期，且等于当天', new RegExp(`参考日期 ${TODAY}`).test(sh), true);
  /* 「可见卡池」= 开始日不晚于参考日期的卡池数。参考日期现在是**当天**，
     所以如果有已公布、但还没到开始日的卡池（繁中服就有，国服将来也可能有），
     这个数会小于卡池总数 —— 别再拿 bannerCount 直接比。 */
  const visibleOf = (store) => store.banners.filter((b) => b.startDate <= TODAY).length;
  check('统计页：可见卡池数 = 开始日不晚于当天的卡池数',
    new RegExp(`可见卡池 ${visibleOf(banners.store)} 个`).test(sh), true);
  /* 参与统计的干员数只在新干员入库时才会变（不像卡池数每周都动），保留字面量当黄金值 */
  check('统计页：参与统计干员 204 位', /参与统计干员 204 位/.test(sh), true);

  /* 顶部定位按钮（统计页才有）—— 文案与 StatsView 的分节标题保持一致 */
  check('顶栏定位按钮 六星干员·标准寻访', /六星干员·标准寻访/.test(sh), true);

  /* 首页不应出现统计表；统计页不应出现卡池表 */
  check('首页没有统计表', count(bh, /stat-tbl/g), 0);
  check('统计页没有卡池表（无 1225px 兜底下限）',
    /min-width:1225px/.test(bh) && !/min-width:1225px/.test(sh), true);

  /* ---------------- 首次进店间隔 ---------------- */
  const shop = await renderRoute('/shop-interval');
  const ph = shop.html;

  /* 页面内不再重复渲染 h2 大标题，标题只在顶栏出现一次（2026-09-30 去重） */
  check('首次进店间隔页：页面内不再重复标题（顶栏那份负责）',
    !/<h2>/.test(ph) && /首次进店间隔/.test(ph), true);
  check('首次进店间隔页：卡片头统计（六星 N 位 · 五星 N 位）',
    /六星 \d+ 位 · 五星 \d+ 位/.test(ph), true);
  check('首次进店间隔页：两个分节', count(ph, /class="grp-sep"/g), 2);
  check('首次进店间隔页：六星 / 五星分节标题',
    ph.includes('六星干员 · 首次进店间隔') && ph.includes('五星干员 · 首次进店间隔'), true);
  /* ⚠️ 命中数与日期上下限都**会随数据更新变**（新增进店记录就变），不能写死 ——
     期望值一律从 store 的 firstShop 派生（它算的就是同一份数据）。 */
  const FS = shop.store.firstShop;
  check('首次进店间隔页：命中数 = firstShop 的六星 / 五星行数',
    ph.includes(`六星 ${FS.six.length} 位 · 五星 ${FS.five.length} 位`), true);
  check('首次进店间隔页：日期输入带上下限（= firstShop.bounds）',
    ph.includes(`min="${FS.bounds.min}"`) && ph.includes(`max="${FS.bounds.max}"`), true);
  check('首次进店间隔页：两个图表容器', count(ph, /class="echart"/g), 2);
  check('首次进店间隔页：图表外层可横向滚动', count(ph, /class="chart-scroll"/g), 2);
  check('首次进店间隔页：SSR 下不初始化 echarts（无 canvas）', count(ph, /<canvas/g), 0);
  /* 页内说明块已移除，横轴 / 纵轴的口径改由卡片头一行带过 */
  check('首次进店间隔页：卡片头写明横轴 / 纵轴口径',
    /横轴(按实装日期|按首次进店日期)/.test(ph) && /纵轴(距实装日|距上个首次进店)/.test(ph), true);
  check('首次进店间隔页：两侧固定刻度条（六星 + 五星各左右一条）',
    count(ph, /class="ybar ybar-l"/g) === 2 && count(ph, /class="ybar ybar-r"/g) === 2, true);
  check('首次进店间隔页：刻度条带单位标注', count(ph, /class="unit"/g), 4);
  const tickVals = [...ph.matchAll(/class="tk"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
  check('首次进店间隔页：刻度存在且都是 14 的倍数',
    tickVals.length > 0 && tickVals.every((v) => v % 14 === 0), true);
  check('首次进店间隔页：刻度从 0 起', tickVals.includes(0), true);
  check('首次进店间隔页：右栏「近 N 年」输入框', ph.includes('id="shop-years"'), true);
  check('首次进店间隔页：快速填入标题', ph.includes('快速填入日期范围'), true);
  check('首次进店间隔页：三个「确认」按钮（近 N 年 / 起始日 / 结束日）',
    count(ph, />确认<\/button>/g), 3);
  check('首次进店间隔页：未修改时不描红', !/dirty/.test(ph), true);

  const rangedShop = await renderRoute('/shop-interval', (s) => s.setShopRange('2024-01-01', '2026-01-01'));
  check('已应用的日期范围会同步进输入框',
    rangedShop.html.includes('2024-01-01') && rangedShop.html.includes('2026-01-01'), true);

  /* 筛选范围变化 → 纵轴范围与刻度跟着变（用户明确要求） */
  const ticksOf = (html) => [...html.matchAll(/class="tk"[^>]*>(-?\d+)</g)].map((m) => Number(m[1]));
  const wideTicks = ticksOf(ph);
  const narrowTicks = ticksOf(rangedShop.html);
  check('筛选范围变化后纵轴刻度随之变化',
    JSON.stringify(wideTicks) !== JSON.stringify(narrowTicks), true);
  check('刻度仍以 14 天为基准（或跨度小时降到 7）',
    wideTicks.every((v) => v % 7 === 0) && narrowTicks.every((v) => v % 7 === 0), true);

  const y3 = await renderRoute('/shop-interval', (s) => s.applyShopYears(3));
  /* 「近 N 年」以**真实今天**为上界，所以期望值要按 store 的 today 算，不能写死 */
  check('近 3 年：区间 = 今天往前 3 年', y3.store.shopRange.from, shiftYears(y3.store.today, -3));
  check('近 3 年：结束端为今天', y3.store.shopRange.to, y3.store.today);

  /* 纵轴起点贴合数据：筛到近 2 年后，能在近两年进店的干员都等了很多年 */
  const sinceShop = await renderRoute('/shop-interval', (s) => {
    s.setShopMetric('sinceRelease');
    s.setShopRange('2024-09-29', '2026-09-29');
  });
  const sinceTicks = ticksOf(sinceShop.html);
  check('纵轴=距实装 + 近 2 年：起点贴合数据（不再从 0 起）', Math.min(...sinceTicks) > 0, true);
  /* 每条刻度条内部应当是等差（条与条之间起点不同，所以按条分别看） */
  const tickGroups = [...sinceShop.html.matchAll(/class="ybar ybar-[lr]"[^>]*>([\s\S]*?)<\/div>/g)]
    .map((m) => [...m[1].matchAll(/class="tk"[^>]*>(-?\d+)</g)].map((x) => Number(x[1])));
  check('纵轴=距实装 + 近 2 年：四条刻度条各自等差',
    tickGroups.length === 4 && tickGroups.every((g) => g.length >= 3
      && g.every((v, i) => i === 0 || v - g[i - 1] === g[1] - g[0])), true);
  check('纵轴=距实装 + 近 2 年：刻度里不再出现 0 刻度',
    count(sinceShop.html, /class="tk"[^>]*>0</g), 0);
  check('首次进店间隔页：顶栏标题已切换', /首次进店间隔/.test(ph) && !/出率提升记录<\/span>/.test(ph.slice(0, ph.indexOf('<main'))), true);

  /* 右栏随页面切换：各页面自己的筛选面板（左栏导航共四项，卡池列表页不显示进店那块） */
  check('左栏导航四项',
    ['卡池列表', '出率提升记录', '首次进店间隔', 'UP 历史一览'].every((t) => ph.includes(t)), true);
  check('首次进店间隔页：右栏标题为日期范围', /首次进店日期范围/.test(ph), true);
  check('首次进店间隔页：右栏两个日期输入',
    ph.includes('id="shop-from"') && ph.includes('id="shop-to"'), true);
  check('首次进店间隔页：右栏命中提示（= firstShop 六星 / 五星行数）',
    new RegExp(`命中 六星 ${FS.six.length} 位 / 五星 ${FS.five.length} 位`).test(ph), true);
  check('首次进店间隔页：不显示卡池筛选表单', !ph.includes('id="f-type"'), true);
  check('统计页右栏不再显示进店筛选', !sh.includes('id="shop-from"'), true);

  /* ---------------- 口径切换（右栏，仅首次进店间隔页） ---------------- */
  check('首次进店间隔页：右栏有横轴口径按钮',
    ph.includes('按首次进店日期') && ph.includes('按实装日期'), true);
  check('首次进店间隔页：右栏有纵轴口径按钮',
    ph.includes('距上个首次进店') && ph.includes('距实装日期'), true);
  check('统计页右栏没有口径切换', !sh.includes('距上个首次进店'), true);

  const relShop = await renderRoute('/shop-interval', (s) => {
    s.setShopAxis('release');
    s.setShopMetric('sinceRelease');
  });
  check('口径切换：头信息跟随', /横轴按实装日期/.test(relShop.html) && /纵轴距实装日/.test(relShop.html), true);
  check('口径切换：卡片头切到「纵轴距实装日」', /纵轴距实装日/.test(relShop.html), true);
  check('口径切换：按钮高亮跟随状态', count(relShop.html, /class="on"/g) >= 2, true);

  /* ---------------- 干员展示模式（简洁 / 图片） ---------------- */
  check('左栏底部有干员展示切换', ph.includes('简洁模式') && ph.includes('图片模式'), true);
  check('「干员展示」排在「服务器」上面',
    ph.indexOf('干员展示') > 0 && ph.indexOf('干员展示') < ph.indexOf('>服务器<'), true);
  check('默认简洁模式：卡池列表仍是名字标签',
    count(bh, /class="tag r/g) > 0 && !bh.includes('class="av"'), true);

  const imgBanners = await renderRoute('/', (s) => s.setAvatarMode('image'));
  check('图片模式：卡池列表换成头像', count(imgBanners.html, /class="av"/g) > 400, true);
  check('图片模式：头像带「限」「兑」角标', count(imgBanners.html, /class="corners"/g) > 0, true);
  check('图片模式：不再渲染名字标签', count(imgBanners.html, /class="tag r/g), 0);
  /* 头像是真的素材了（不是内联占位图 —— 占位图只在素材缺失时兜底）。
     ⚠️ 来源随环境变：**dev 走本地**（`/avatars/...`，方便直接看本地新素材），
     构建产物才固定指向 jsDelivr 上某个 sha。所以这里只断言「是 avatars/ 下的真素材」，
     主机名由针对 resource.js 源码的断言守住。 */
  check('图片模式：头像用真实素材（不是内联占位图）',
    /src="(?:https:\/\/cdn\.jsdelivr\.net\/gh\/Yjun233\/akGachaResource@[0-9a-f]{40}\/|\/)avatars\/char_[A-Za-z0-9_]+\.png"/.test(imgBanners.html)
    && !/src="data:image\/svg\+xml/.test(imgBanners.html), true);

  const imgStats = await renderRoute('/operators', (s) => s.setAvatarMode('image'));
  check('图片模式：统计表每人一个正方形头像', count(imgStats.html, /class="avt-sq"/g), 204);
  check('图片模式：统计表不再渲染干员名', !/<b>推进之王<\/b>/.test(imgStats.html), true);
  check('图片模式：统计表仍保留次数数字', /class="num"/.test(imgStats.html), true);

  const imgShop = await renderRoute('/shop-interval', (s) => s.setAvatarMode('image'));
  /* 页内说明块已移除；图片模式的关键行为（点用头像）在数据层与 upTimeline 断言里守 */
  check('图片模式：折线页仍正常渲染两个分节', count(imgShop.html, /class="grp-sep"/g), 2);
  check('图片模式：折线页仍渲染两侧刻度条', count(imgShop.html, /class="ybar ybar-l"/g), 2);

  /* ---------------- UP 历史一览 ---------------- */
  const up = await renderRoute('/up-history');
  const uh = up.html;
  /* 少数「行为」没法从 SSR 产物看出来（如滚动贴右），只能读源码断言 */
  const upSrc = fs.readFileSync(path.join(ROOT, 'src/views/UpHistoryView.vue'), 'utf8');

  check('UP 历史页：页面内不再重复标题，只有单个分节',
    !/<h2>/.test(uh) && count(uh, /class="grp-sep"/g) === 1, true);
  /* 注意：模板里是 `{{ upRarity }}星干员 · UP 历史`，SSR 会在插值处插注释锚点，
     所以不能直接匹配拼接后的整句 —— 用分节 id 判断更稳 */
  /* SSR 会在插值处插注释锚点（`六<!---->星干员`），文本断言前先剥掉 */
  const plain = (h) => h.replace(/<!--[\s\S]*?-->/g, '');
  const uhPlain = plain(uh);

  check('UP 历史页：默认显示六星（分节 id = uh6）',
    uh.includes('id="uh6"') && !uh.includes('id="uh5"'), true);
  /* 曾经这里匹配的是右栏的「命中 六星 118 位」—— 于是卡片头把「六星」写成数字 6
     也照样通过。改成针对卡片头，并额外禁止数字写法。
     ⚠️ 位数会随数据更新变（新增六星就变）→ 从 store 的 upHistory 派生，别写死。 */
  check('UP 历史页：卡片头统计（六星 N 位 · …）',
    new RegExp(`六星 ${up.store.upHistory.six.length} 位 ·`).test(uhPlain), true);
  check('UP 历史页：星级一律写汉字（不出现 6星 / 5星）', /[五六]?[0-9]星/.test(uhPlain), false);
  check('UP 历史页：分节标题「六星干员」', /六星干员/.test(uhPlain), true);
  /* 顶部固定刻度条 + 左侧固定名字列 + 主体画布 = 两个图表容器 */
  check('UP 历史页：两个图表容器（顶部刻度条 + 主体）', count(uh, /class="echart"/g), 2);
  check('UP 历史页：SSR 下不初始化 echarts（无 canvas）', count(uh, /<canvas/g), 0);
  check('UP 历史页：口径说明含大类三色', /标准寻访/.test(uh) && /中坚寻访/.test(uh) && /限定寻访/.test(uh), true);

  /* --- 布局三项：顶部固定轴 / 左侧固定名字列 / 最小宽度 --- */
  check('UP 历史页：顶部刻度条 sticky',
    /class="tl-head"/.test(uh) && /\.tl-head\{[\s\S]*?position:sticky[\s\S]*?top:0/.test(cssAll), true);
  check('UP 历史页：干员名列 sticky left（横向滚动时不跑）',
    /class="tl-names"/.test(uh) && /\.tl-names\{[\s\S]*?position:sticky[\s\S]*?left:0/.test(cssAll), true);
  check('UP 历史页：滚动容器有最大高度（否则 sticky 无从生效）',
    /\.tl-scroll\{[\s\S]*?max-height/.test(cssAll), true);
  check('UP 历史页：时间轴有最小宽度（内层 min-width 内联样式）',
    /class="tl-inner" style="min-width:\s*\d{3,}px/.test(uh), true);
  /* 横向滚动条要一直停在最右：① 切服务器 / 切星级后重新贴右；
     ② 时间轴宽度变化时（动筛选会让它变窄 / 变宽）若本来就贴着右端就继续保持。 */
  check('UP 历史页：横向滚动条会重新贴到最右（切服 / 切星级 + 宽度变化）',
    /watch\(\(\) => \[site\.server, site\.upRarity\], scrollToRight\)/.test(upSrc)
    && /new ResizeObserver/.test(upSrc) && /pinned/.test(upSrc), true);
  check('UP 历史页：名字列每人一行（92 行）', count(uh, /class="tl-name"/g), 92);
  /* 页内说明块已移除（2026-09-30 精简），版权与来源声明统一放在左栏底部 */
  check('左栏底部：数据来源 + 版权声明',
    /卡池信息来源/.test(uh) && /版权属于鹰角网络/.test(uh), true);

  check('UP 历史页：左栏导航四项',
    ['卡池列表', '出率提升记录', '首次进店间隔', 'UP 历史一览'].every((t) => uh.includes(t)), true);
  check('UP 历史页：右栏标题', /时间范围与筛选/.test(uh), true);
  check('UP 历史页：星级切换按钮（六星 92 / 五星 112）',
    /六星（92）/.test(uh) && /五星（112）/.test(uh), true);
  check('UP 历史页：时间范围三件套（近 N 年 + 两个日期 + 三个确认）',
    uh.includes('id="up-years"') && uh.includes('id="up-from"') && uh.includes('id="up-to"')
    && count(uh, />确认<\/button>/g) === 3, true);
  /* 开始日期不能早于本服第一个卡池的开始日。输入框上的 `min` 只是提示（只管得住原生选择器），
     真正夹取在 store 的 `setUpRange()` 里（下面单独断言）；这里核对属性确实带了下限。
     ⚠️ 只取 `#up-from` 那一个标签来判，别用全页 includes —— 其它输入框也有 min。 */
  const upFromTag = (/<input[^>]*id="up-from"[^>]*>/.exec(uh) || [''])[0];
  check('UP 历史页：开始日期输入带下限（= 本服第一个卡池的开始日）',
    upFromTag.includes(`min="${up.store.bannerBounds.min}"`), true);
  /* 下限真正生效的地方在 store 的 setUpRange()：手输与「近 N 年」两条路径都要被夹住
     （输入框的 min 属性只管得住原生选择器）。 */
  {
    const s = up.store;
    const min = s.bannerBounds.min;
    s.setUpRange('1990-01-01', null);
    check('UP 历史：手输过早的开始日期被夹到本服第一个卡池', s.upRange.from, min);
    s.applyUpYears(100);
    check('UP 历史：「近 N 年」算出的过早开始日期同样被夹住', s.upRange.from, min);
    s.applyUpYears(1);
    check('UP 历史：「近 N 年」在范围内时不改动（= 今天 − N 年）',
      s.upRange.from > min && s.upRange.to === s.today, true);
    s.setUpRange('', null);
    check('UP 历史：清空开始日期不会被夹（空串表示「清空」而不是过早日期）', s.upRange.from, '');
  }
  /* 右栏两个新勾选框：隐藏已属中坚的干员 / 显示两次 UP 的间隔天数。
     ⚠️ 后者的**默认是「不勾」**（间隔文案默认不显示）——这个默认值在 state 初值、
     setServer 的切服重置、右栏的「全部重置」三处都有，改的时候要一起改（见 site.js 注释）。 */
  check('UP 历史页：右栏两个新勾选框',
    /隐藏在结束日期已属中坚的干员/.test(uhPlain)
    && /显示两次 UP 的间隔天数/.test(uhPlain), true);
  check('UP 历史：两个新开关的默认都是「不勾」（间隔文案默认不显示）',
    up.store.upHideMid === false && up.store.upShowGaps === false, true);
  /* 纵轴排序：两行「左标签 + 升/降序分段按钮」，共 2 个标签 + 4 个按钮。
     ⚠️ 标签文案从 `UP_SORT_ROWS` 派生，别写死（「UP 日期」曾被改成「最近 UP」，断言就红了）。 */
  const sortLabels = UP_SORT_ROWS.map((r) => r.label);
  check('UP 历史页：纵轴排序是两个维度 × 升/降序（共 4 个按钮）',
    sortLabels.every((t) => uh.includes(t))
    && count(uh, /class="sortrow"/g) === 2
    && count(uh, /class="seg mini"/g) === 2
    && count(uh, />升序<\/button>/g) === 2
    && count(uh, />降序<\/button>/g) === 2, true);
  check('UP 历史页：排序标签不再塞进 .seg（会被 flex 拉成一半宽）',
    !/class="seg"><span/.test(uh), true);
  /* 卡池类型已改为**常驻按钮组**（不再是下拉）：3 个大类按钮 + 11 个类型按钮。
     按整段标签匹配，不要假设 class 与 disabled 的先后顺序。 */
  const ttypeTags = (html) => html.match(/<button[^>]*class="ttype[^"]*"[^>]*>/g) || [];
  check('UP 历史页：卡池类型是常驻按钮组（不再有下拉）',
    count(uh, /class="typebtns"/g) === 1
    && !/class="dd-btn"/.test(uh) && !/class="dd-panel"/.test(uh), true);
  check('UP 历史页：三个大类分组', count(uh, /class="tgroup"/g), 3);
  check('UP 历史页：三个大类各带一个全选按钮', count(uh, /class="tcat"/g), 3);
  /* 11 种类型：标准 6（double/joint/stdfes/mainfes/single/five）+ 中坚 2 + 限定 3 */
  check('UP 历史页：11 个类型按钮（限定已拆成庆典/春节/夏季）',
    count(uh, /class="ttype"/g), 11);
  check('UP 历史页：限定的三个子类都出现在按钮上',
    ['限定寻访·庆典', '限定寻访·春节', '限定寻访·夏季'].every((t) => uh.includes(t)), true);
  check('UP 历史页：默认显示「全部类型」', /全部类型/.test(uh), true);
  check('UP 历史页：只看进店开关', uh.includes('只看进店'), true);
  check('UP 历史页：未勾选时 11 个类型按钮都可用',
    ttypeTags(uh).length === 11 && ttypeTags(uh).every((s) => !/disabled/.test(s)), true);

  /* 互斥：勾上「只看进店」→ 类型筛选被禁用并清空 */
  const upShop = await renderRoute('/up-history', (s) => {
    s.setUpTypes(['double', 'classic']);
    s.setUpShopOnly(true);
  });
  check('只看进店：勾选后清空已选的卡池类型', upShop.store.upTypes.length, 0);
  check('只看进店：11 个类型按钮全部被禁用',
    ttypeTags(upShop.html).length === 11 && ttypeTags(upShop.html).every((s) => /disabled/.test(s)),
    true);
  check('只看进店：标签提示已禁用', /只看进店（类型筛选已禁用）/.test(upShop.html), true);
  check('只看进店：命中数变为 六星 N 位（N = upHistory 六星行数）',
    new RegExp(`六星 ${upShop.store.upHistory.six.length} 位`).test(upShop.html), true);

  const upTypes = await renderRoute('/up-history', (s) => {
    s.setUpShopOnly(true);
    s.setUpShopOnly(false);
    s.setUpTypes(['double', 'classic']);
  });
  check('取消只看进店后类型按钮恢复可用',
    ttypeTags(upTypes.html).every((s) => !/disabled/.test(s)), true);

  /* 时间范围：**范围内一次 UP 都没有的干员默认不占行**（2026-09-30 口径调整，
     以前时间范围只改横轴、纵轴始终保留全部干员）；可用「显示范围内未 UP 干员」开关关掉这层过滤 */
  const upNoRange = await renderRoute('/up-history', () => {});
  const upRange = await renderRoute('/up-history', (s) => s.setUpRange('2026-01-01', ''));
  check('时间范围：范围内无标记的干员被隐藏（行数变少）',
    upRange.store.upHistory.six.length < upNoRange.store.upHistory.six.length, true);
  const upFullRange = await renderRoute('/up-history', (s) => s.setUpRange('2000-01-01', '2099-12-31'));
  check('时间范围：覆盖全时段时行数与不限范围一致',
    upFullRange.store.upHistory.six.length === upNoRange.store.upHistory.six.length, true);
  const upShowAll = await renderRoute('/up-history', (s) => {
    s.setUpRange('2026-01-01', '');
    s.setUpShowAll(true);
  });
  check('显示范围内未 UP 干员：勾上后行数恢复（等于不限范围）',
    upShowAll.store.upHistory.six.length === upNoRange.store.upHistory.six.length, true);
  check('显示范围内未 UP 干员：开关出现在右栏',
    /显示范围内未 UP 干员/.test(upShowAll.html), true);
  check('类型筛选生效：store 两种类型', upTypes.store.upTypes.join(), 'double,classic');

  /* 切到五星 */
  const upFive = await renderRoute('/up-history', (s) => s.setUpRarity(5));
  check('切到五星：分节切到 uh5', upFive.html.includes('id="uh5"') && !upFive.html.includes('id="uh6"'), true);
  check('切到五星：卡片头统计（五星 112 位 · …）', /五星 112 位 ·/.test(plain(upFive.html)), true);
  check('切到五星：五星行数 112', upFive.store.upHistory.five.length, 112);
  check('切到五星：仍有两个图表容器', count(upFive.html, /class="echart"/g), 2);

  /* ---------------- 时间轴「真的能画出来」吗 ----------------
     SSR 渲染页面时 echarts 不会初始化，DOM 断言看不出「图是空的」这类问题
     （曾因为 custom 系列的 data 没带 x 值，整个图画不出来）。
     所以这里直接拿 option 跑一次 echarts 的 **SVG SSR**，检查产出的图形。 */
  const { buildUpTimeline, minInnerWidth, monthLabel } = await vite.ssrLoadModule('/src/lib/upTimeline.js');
  /* ⚠️ 必须用**应用自己的** echarts 入口（src/lib/charts.js）来渲染。
     曾经这里自己 `use([CustomChart])`、而 charts.js 没注册 CustomChart ——
     测试全绿，但页面上的 custom 系列被静默跳过，只剩坐标轴（用户看到的"图是空的"）。
     复用同一个入口后，注册漏项就会直接暴露成「图形数量不足」。 */
  const { default: echartsSsr } = await vite.ssrLoadModule('/src/lib/charts.js');
  const { SVGRenderer } = await import('echarts/renderers');
  echartsSsr.use([SVGRenderer]); // 应用本身用 CanvasRenderer，SSR 只能渲染 SVG

  const chartsSrc = fs.readFileSync(path.join(ROOT, 'src/lib/charts.js'), 'utf8');
  check('图表入口注册了 CustomChart（UP 历史时间轴全靠它手绘）',
    /CustomChart/.test(chartsSrc) && /echarts\.use\(\[[\s\S]*CustomChart/.test(chartsSrc), true);

  const renderChart = (opt, w, h) => {
    const chart = echartsSsr.init(null, null, { renderer: 'svg', ssr: true, width: w, height: h });
    chart.setOption(opt);
    const svg = chart.renderToSVGString();
    chart.dispose();
    return svg;
  };
  const build = (mutate, xRange = {}) => {
    const store = up.store;
    return buildUpTimeline({
      rows: mutate === 'five' ? store.upHistory.five : store.upHistory.six,
      xRange,
      isImage: mutate === 'image',
      operatorByName: store.operators,
    });
  };

  /* 渲染期间拦截 console.warn —— echarts 对「系列类型没注册」「option 字段非法」这类问题
     只打印一行 warning 然后把系列静默跳过（页面表现是"图是空的"），不会抛异常。
     把它变成一条断言，这类问题就不可能再悄悄溜过去。 */
  const ecWarnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { ecWarnings.push(args.map(String).join(' ')); };

  const built6 = build('six');
  const builtFive = build('five');
  const builtImg = build('image');
  const builtRanged = build('six', { from: '2024-01-01', to: '2026-09-30' });
  const W = minInnerWidth(built6.xMin, built6.xMax); // 用真实宽度渲染，月标签才放得下
  let svgAxis; let svgBody; let svgFive; let svgImg; let svgRangedAxis; let svgRangedBody;
  try {
    svgAxis = renderChart(built6.axisOption, W, 46);
    svgBody = renderChart(built6.bodyOption, W, 900);
    svgFive = renderChart(builtFive.bodyOption, W, 900);
    svgImg = renderChart(builtImg.bodyOption, W, 900);
    svgRangedAxis = renderChart(builtRanged.axisOption, minInnerWidth(builtRanged.xMin, builtRanged.xMax), 46);
    svgRangedBody = renderChart(builtRanged.bodyOption, minInnerWidth(builtRanged.xMin, builtRanged.xMax), 900);
  } finally {
    console.warn = origWarn;
  }
  check('时间轴渲染时 echarts 无任何告警（漏注册的系列会被静默跳过）',
    ecWarnings.filter((w) => /echarts/i.test(w)), []);

  /* 圆角矩形/圆形在 zrender 里用 <path> / <circle> 画，所以不能只数 <rect> */
  const shapes = (svg) => count(svg, /<(?:path|rect|circle|image)[\s>]/g);
  const texts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)</g)].map((m) => m[1]);
  const pathXs = (svg) => [...svg.matchAll(/<path d="M([\d.]+)[ ,]/g)].map((m) => Number(m[1]));

  check('时间轴：图表宽度 ≈ 天数（1 天 1px）', W > 2700 && W < 2900, true);
  check('时间轴 SVG SSR：产出了 SVG（刻度条 + 主体）',
    svgAxis.startsWith('<svg') && svgBody.startsWith('<svg'), true);
  check('时间轴 SVG SSR：主体画出了横条 + 标记', shapes(svgBody) >= 92 * 2, true);
  check('时间轴 SVG SSR：标记是圆形（简洁模式 = 色圆 + 首字）', count(svgBody, /<circle/g) >= 900, true);
  check('时间轴 SVG SSR：简洁模式标的是干员名首字（不是全名）',
    texts(svgBody).includes('艾') && !svgBody.includes('艾雅法拉'), true);
  check('时间轴 SVG SSR：左侧不再画纵轴名字（名字在 DOM 列里）',
    !svgBody.includes('推进之王'), true);
  check('时间轴 SVG SSR：三类大类颜色都出现',
    ['#FFD524', '#0098DC', '#8b5cf6'].every((c) => svgBody.includes(c)), true);

  /* 需求 4：刻度落在每个月的 1 号，格式 YYYY-MM，且每个标签位置都有竖线 */
  const axisLabels = texts(svgAxis).filter((t) => /^\d{4}-\d{2}$/.test(t));
  check('时间轴 SVG SSR：顶部刻度条每个标签都是 YYYY-MM',
    axisLabels.length > 0 && axisLabels.every((t) => /^\d{4}-\d{2}$/.test(t)), true);
  check('时间轴 SVG SSR：顶部刻度覆盖每个月（首 = 数据起点月）',
    axisLabels[0], monthLabel(built6.xMin));
  check('时间轴 SVG SSR：月刻度数量 = 跨度月数 + 1',
    axisLabels.length, built6.monthCount + 1);
  check('时间轴 SVG SSR：顶部刻度条每月一条竖线（自绘 line）',
    count(svgAxis, /<(?:path|line)[\s>]/g) >= built6.monthCount, true);

  /* 需求 2：设了时间范围后，横条在横轴起点被截断（不能画到左边去） */
  check('时间轴 SVG SSR：限定范围后图表明显变窄（月数减少）',
    builtRanged.monthCount < built6.monthCount / 2, true);
  check('时间轴 SVG SSR：限定范围后月标签跟着变（从 2024-01 开始）',
    texts(svgRangedAxis).filter((t) => /^\d{4}-\d{2}$/.test(t))[0], '2024-01');
  const limitedMinX = Math.min(...pathXs(svgRangedBody));
  check('时间轴 SVG SSR：横条在横轴起点被截断（没有图形越过绘图区左边界）',
    limitedMinX >= 11, true);

  /* 最小宽度口径：**1 天 = 1px**（用户指定） */
  check('时间轴最小宽度随跨度变化（范围越窄越窄）',
    minInnerWidth(builtRanged.xMin, builtRanged.xMax) < minInnerWidth(built6.xMin, built6.xMax), true);
  check('时间轴最小宽度 ≈ 全范围天数（2740 天 → 约 2860px）', W > 2700 && W < 2900, true);

  /* 标记配色：两种模式同一套（浅底圆 + 大类色圆环），进店点是**右上角**的绿色 */
  check('时间轴 SVG SSR：简洁模式标记是「浅底圆 + 大类色圆环」',
    svgBody.includes('#fff8d9') && svgBody.includes('#FFD524'), true);
  check('时间轴 SVG SSR：首字用大类的深色墨（不是白字）',
    ['#7a5c00', '#00628f', '#5b21b6'].some((c) => svgBody.includes(c)), true);
  check('时间轴 SVG SSR：进店点是绿色（全站统一的商店兑换色）',
    svgBody.includes('#15803d'), true);
  /* ⚠️ 进店绿点与中坚甄选菱形都画在标记的**左上角**（同位）—— 依据是两者互斥
     （进店标记只出现在 double / classic 上，clafes 从来没有；verify-data 有断言）。
     原来两者都在右侧，图片模式下头像占满圆环、两个点紧贴右边缘，容易看混。 */
  check('时间轴 SVG SSR：进店点画在标记左上角（图片模式同样有）',
    svgImg.includes('#15803d'), true);
  /* 菱形是 polygon 手拼的（zrender 没有 diamond 类型）—— 这里确认它真的画出来了：
     polygon 会以描边色 = 中坚实色、填充白色出现 */
  const diamondSvg = svgBody.match(/<(polygon|path)[^>]*stroke="#0098DC"[^>]*>/gi) || [];
  check('时间轴 SVG SSR：中坚甄选是菱形（polygon 描边 = 中坚实色）',
    diamondSvg.length > 0, true);
  /* 间隔文案：**只写数字**（不带「天」，用户 2026-10-02 定的）。
     ⚠️ 刻度标签是 `2026-01` 这种带横杠的，所以「纯数字的 text」只会来自间隔文案。 */
  const gapTexts = texts(svgBody).filter((t) => /^\d+$/.test(t));
  check('时间轴 SVG SSR：两次 UP 之间写出了间隔天数（纯数字，数百条）',
    gapTexts.length > 100, true);
  check('时间轴 SVG SSR：间隔文案数量不超过候选条数',
    gapTexts.length <= built6.bodyOption.series[2].data.length, true);

  /* 切五星 / 图片模式 */
  check('时间轴 SVG SSR：切五星后仍有图形', shapes(svgFive) >= 112 * 2, true);
  check('时间轴 SVG SSR：图片模式出现 <image>（圆形头像）', count(svgImg, /<image/g) > 0, true);
  /* 素材是**方形**半身像，圆形是靠 group 的 clipPath 裁出来的 ——
     少了它标记就会变成方块（SSR 里能直接看到 <clipPath>）。 */
  check('时间轴 SVG SSR：图片模式有 <clipPath>（方形素材被裁成圆）',
    /<clipPath/.test(svgImg), true);

  /* ---------------- 资源仓库（数据与头像不在主仓库）---------------- */
  const RES = path.resolve(ROOT, '..', 'akGachaResource');
  const avDir = path.join(RES, 'avatars');
  const avCount = fs.existsSync(avDir)
    ? fs.readdirSync(avDir).filter((f) => f.endsWith('.png')).length : -1;
  check('资源仓库 ../akGachaResource 存在，且头像齐全（230 张）', avCount, 230);
  /* banner-categories.json 已删除，内容并入 constants.js 的 BANNER_CATEGORIES */
  check('资源仓库里有数据 JSON（3 个）',
    ['operators.json', 'banners_sc.json', 'metadata.json']
      .every((f) => fs.existsSync(path.join(RES, 'data', f))), true);
  check('资源仓库里已无 banner-categories.json（已并入 constants.js）',
    fs.existsSync(path.join(RES, 'data', 'banner-categories.json')), false);
  /* public/{data,avatars} 只是开发用的目录联接，并且是 .gitignore 的 ——
     它可能不存在（默认走 CDN 时用不到），所以这里只断言「站点里没有数据副本」，
     不再要求联接一定在。 */
  const pubData = path.join(ROOT, 'public', 'data');
  check('站点主仓库里没有数据副本（public/data 要么不存在、要么是目录联接）',
    !fs.existsSync(pubData) || fs.lstatSync(pubData).isSymbolicLink(), true);
  check('构建产物里不含数据 / 头像（dist 应只有 index.html 与 assets）',
    !fs.existsSync(path.join(ROOT, 'dist')) || !fs.existsSync(path.join(ROOT, 'dist', 'data')), true);

  const resSrc = fs.readFileSync(path.join(ROOT, 'src/lib/resource.js'), 'utf8');
  check('资源模块：指向 Yjun233/akGachaResource', /Yjun233\/akGachaResource/.test(resSrc), true);
  check('资源模块：头像版本可用 commit sha 固定（AVATARS_SHA）',
    /AVATARS_SHA/.test(resSrc), true);
  /* ⚠️ 标签必须跟着 resource.js 的真实行为走：**dev 默认读本地**
     （public/{data,avatars} 是指向 ../akGachaResource 的目录联接），
     `VITE_RESOURCE=cdn` 才让 dev 走 CDN（看线上数据）；**build 一律走 CDN**。 */
  check('资源模块：dev 默认读本地、可用 VITE_RESOURCE=cdn 切 CDN、build 走 CDN',
    /env\.VITE_RESOURCE === 'local'/.test(resSrc)
    && /env\.DEV && env\.VITE_RESOURCE !== 'cdn'/.test(resSrc)
    && /jsdelivr\.net/.test(resSrc), true);
  /* ⚠️ 实测：fastly 端点对本仓库的 PNG 恒 301 跳回 raw（国内裂图），JSON 却正常。
     所以必须用 cdn.jsdelivr.net —— 这条断言防止有人"顺手"改回 fastly。 */
  check('资源模块：CDN 主机是 cdn.jsdelivr.net（不是会 301 的 fastly）',
    /CDN_HOST = 'https:\/\/cdn\.jsdelivr\.net'/.test(resSrc), true);
  check('资源模块：头像固定到 commit sha（40 位十六进制）',
    /AVATARS_SHA = '[0-9a-f]{40}'/.test(resSrc), true);

  const avSrc = fs.readFileSync(path.join(ROOT, 'src/lib/avatars.js'), 'utf8');
  check('头像：已启用真实素材（USE_REAL_AVATARS = true）',
    /USE_REAL_AVATARS = true/.test(avSrc), true);
  const opTagSrc = fs.readFileSync(path.join(ROOT, 'src/components/OpTag.vue'), 'utf8');
  /* 卡池数据里的 upOperators 没有 charId → 直接用它会静默退化成占位图
     （表现为「卡池列表是方块、统计页却是真头像」） */
  check('卡池列表 OpTag：用干员名回查 store 取 charId',
    /site\.operators\[props\.op\.name\]/.test(opTagSrc), true);
  const shopSrc = fs.readFileSync(path.join(ROOT, 'src/views/ShopIntervalView.vue'), 'utf8');
  /* echarts 的 symbol:'image://…' 只是贴图、**不能裁剪**，所以图片模式改用手绘 + clipPath */
  check('进店间隔：图片模式用 custom 手绘 + clipPath 裁圆（不是 symbol:image://）',
    /type: 'custom'/.test(shopSrc) && /clipPath/.test(shopSrc)
    && !/symbol: `image:\/\//.test(shopSrc), true);

  const viteCfg = fs.readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
  check('vite：构建时不复制 public（dist 里不该有本地数据副本）',
    /publicDir: command === 'serve'/.test(viteCfg), true);
  check('vite：dev server 显式绑定 127.0.0.1（默认只监听 IPv6 的 [::1]）',
    /host: '127\.0\.0\.1'/.test(viteCfg), true);

  /* ---------------- 站点图标 ----------------
     放在 src/assets（由 Vite 打包并自动加 base），不能放 public/ ——
     构建时 publicDir 是关掉的（见上面那条断言）。 */
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('index.html 引用了 favicon 三件套（png / ico / apple-touch-icon）',
    /rel="icon"[^>]*favicon\.png/.test(indexHtml)
    && /rel="icon"[^>]*favicon\.ico/.test(indexHtml)
    && /rel="apple-touch-icon"[^>]*apple-touch-icon\.png/.test(indexHtml), true);
  check('图标文件确实存在（src/assets）',
    ['favicon.ico', 'favicon.png', 'apple-touch-icon.png']
      .every((f) => fs.existsSync(path.join(ROOT, 'src', 'assets', f))), true);

  /* ---------------- 统计表冻结前两列 ---------------- */
  const statSrc = fs.readFileSync(path.join(ROOT, 'src/components/StatTable.vue'), 'utf8');
  check('统计表：前两列定宽（sticky 的 left 偏移必须等于第 1 列宽度）',
    /<colgroup>/.test(statSrc) && count(statSrc, /<col style="width: \d+px"/g) === 2, true);
  check('统计表：冻结「实装时间」「干员」两列（CSS sticky + 第 2 列 left=100px）',
    /stat-tbl th:nth-child\(-n\+2\)[\s\S]{0,80}position:sticky/.test(cssAll)
    && /stat-tbl td:nth-child\(2\)[\s\S]{0,120}left:100px/.test(cssAll), true);
  check('统计表：冻结列用 background:inherit 保证不透明（依赖 tbody tr 有背景色）',
    /stat-tbl tbody tr\{background:#fff\}/.test(cssAll), true);
  /* ⚠️ 冻结列表头的 z-index 必须**高于**分组表头，否则 DOM 靠后的「出率提升」会盖住「干员」。
     而全局 `table.grid.floating thead tr:first-child th`（特异性 0,3,4）会压过
     只写到 `.stat-tbl` 的规则 —— 所以选择器必须带上 .floating 与 tr。 */
  check('统计表：冻结列表头 z-index 高于分组表头（选择器要压过 .floating 那条）',
    /table\.grid\.stat-tbl\.floating thead tr:first-child th:nth-child\(-n\+2\)\{z-index:8\}/.test(cssAll), true);
  /* 排序按钮要填满容器：否则 .seg 的框比按钮总宽大出一截，hover/选中只覆盖按钮 */
  check('纵轴排序：按钮填满分段容器（不留不参变色的空白）',
    /\.seg\.mini\{flex:0 0 auto\}/.test(cssAll)
    && /\.seg\.mini button\{[^}]*width:60px/.test(cssAll), true);

  /* ---------------- 国际服：切服务器后各页面要能正常渲染 ----------------
     期望值一律从 metadata 派生（卡池数会随数据更新变）。 */
  const EN = banners.store.meta.servers.find((x) => x.id === 'en');
  check('国际服：metadata 里已启用（available）', EN?.available, true);
  if (EN?.available) {
    const enHome = await renderRoute('/', (s) => s.setServer('en'));
    check('国际服：当前服务器切到 en', enHome.store.server, 'en');
    check('国际服：卡池行数 = metadata.en.bannerCount',
      count(enHome.html.slice(enHome.html.indexOf('<tbody>'), enHome.html.indexOf('</tbody>')), /<tr>/g),
      EN.bannerCount);
    /* ⚠️ 国际服卡池的 `name` 现在也是**国服中文名**（英文名挪到 `enName`、本站暂不展示），
       所以这里不能再断言「渲染出英文卡池名」。 */
    check('国际服：卡池名已是国服中文名（name === scName）',
      enHome.store.banners.every((b) => b.name === b.scName), true);
    check('国际服：卡池列表渲染出卡池名',
      enHome.store.banners.slice(0, 8).every((b) => enHome.html.includes(b.name)), true);
    check('国际服：英文名仍在数据里（enName 非空的都是纯 ASCII）',
      enHome.store.banners.filter((b) => b.enName).every((b) => /^[\x20-\x7e]+$/.test(b.enName)), true);

    const enStats = await renderRoute('/operators', (s) => s.setServer('en'));
    check('国际服：统计页四张表', count(enStats.html, /class="grid floating stat-tbl"/g), 4);
    check('国际服：统计页可见卡池数 = 开始日不晚于当天的卡池数',
      new RegExp(`可见卡池 ${visibleOf(enStats.store)} 个`).test(enStats.html), true);

    const enUp = await renderRoute('/up-history', (s) => s.setServer('en'));
    check('国际服：UP 历史页有画布容器', count(enUp.html, /class="tl-scroll"/g), 1);

    const enShop = await renderRoute('/shop-interval', (s) => s.setServer('en'));
    check('国际服：首次进店间隔页两个刻度条 + 两个滚动区',
      count(enShop.html, /ybar-l/g) + count(enShop.html, /chart-scroll/g), 4);
  }

  /* ---------------- 左栏：三个服务器各自的「数据更新日」（纯展示） ----------------
     国服 = generatedAt、国际服 = enGeneratedAt、繁中服 = tcGeneratedAt（= 本地表格修改日）。
     参考日期**不再**取这几个日期，它一律是打开页面的当天。 */
  const UPD = {
    sc: META.generatedAt || '—',
    en: META.enGeneratedAt || '—',
    tc: META.tcGeneratedAt || '—',
  };
  check('左栏：国服数据更新日 = metadata.generatedAt',
    bh.includes(`国服数据更新 <b>${UPD.sc}</b>`), true);
  check('左栏：国际服数据更新日 = metadata.enGeneratedAt',
    bh.includes(`国际服数据更新 <b>${UPD.en}</b>`), true);
  check('左栏：繁中服数据更新日 = metadata.tcGeneratedAt',
    bh.includes(`繁中服数据更新 <b>${UPD.tc}</b>`), true);

  /* ---------------- 繁中服：切服务器后各页面要能正常渲染 ----------------
     数据来自本地人工表格（fetch-data-tc.mjs），期望值同样全部从 metadata 派生。 */
  const TC = banners.store.meta.servers.find((x) => x.id === 'tc');
  check('繁中服：metadata 里已启用（available）', TC?.available, true);
  if (TC?.available) {
    const tcHome = await renderRoute('/', (s) => s.setServer('tc'));
    const tcNames = tcHome.store.banners.map((b) => b.name);
    check('繁中服：当前服务器切到 tc', tcHome.store.server, 'tc');
    check('繁中服：卡池行数 = metadata.tc.bannerCount',
      count(tcHome.html.slice(tcHome.html.indexOf('<tbody>'), tcHome.html.indexOf('</tbody>')), /<tr>/g),
      TC.bannerCount);
    check('繁中服：序号类卡池名（常驻标准寻访 / 常驻中坚寻访 / 中坚甄选 / 联合行动…）',
      tcNames.some((n) => /^常驻标准寻访\d+$/.test(n))
      && tcNames.some((n) => /^常驻中坚寻访\d+$/.test(n))
      && tcNames.some((n) => /^中坚甄选\d+$/.test(n))
      && tcNames.some((n) => /^联合行动\d+$/.test(n)), true);
    check('繁中服：限定 / 单六 的池名取自国服（「复刻」也带过来）',
      tcNames.some((n) => /复刻|返场/.test(n)), true);
    check('繁中服：左栏署名是「本地卡池记录表」且不带外链',
      tcHome.html.includes('本地卡池记录表') && !/本地卡池记录表<\/a>/.test(tcHome.html), true);

    const tcStats = await renderRoute('/operators', (s) => s.setServer('tc'));
    check('繁中服：统计页四张表', count(tcStats.html, /class="grid floating stat-tbl"/g), 4);
    /* 繁中服表格里有 2 个「已公布但还没开始」的池子（最新到 10-22），
       所以可见卡池数会比 bannerCount 小 —— 按当天过滤后比。 */
    check('繁中服：统计页可见卡池数 = 开始日不晚于当天的卡池数',
      new RegExp(`可见卡池 ${visibleOf(tcStats.store)} 个`).test(tcStats.html), true);

    const tcUp = await renderRoute('/up-history', (s) => s.setServer('tc'));
    check('繁中服：UP 历史页有画布容器', count(tcUp.html, /class="tl-scroll"/g), 1);

    const tcShop = await renderRoute('/shop-interval', (s) => s.setServer('tc'));
    check('繁中服：首次进店间隔页两个刻度条 + 两个滚动区',
      count(tcShop.html, /ybar-l/g) + count(tcShop.html, /chart-scroll/g), 4);
  }
} finally {
  await vite.close();
}

/* ---------- 输出 ---------- */
let bad = 0;
for (const r of results) {
  if (r.expected === null || r.expected === undefined) { console.log(`· ${r.label}: ${r.actual}`); continue; }
  if (!r.ok) bad += 1;
  console.log(`${r.ok ? '✓' : '✗'} ${r.label}: ${r.actual}${r.ok ? '' : ` （期望 ${r.expected}）`}`);
}
console.log(bad ? `\n✗ 渲染核对有 ${bad} 项未通过` : `\n✓ 渲染核对全部通过（${results.length} 项）`);
process.exit(bad ? 1 : 0);

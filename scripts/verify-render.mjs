/**
 * Vue 渲染核对：用 Vite 的 SSR 加载 + Vue 服务端渲染把**五个页面**（卡池列表 / 出率提升记录 /
 * 首次UP间隔·图表版 / 首次UP间隔·表格版 / UP 历史一览）真正渲染出来，
 * 再检查结构 / 数据是否与原型一致。
 *
 * 为什么不用无头浏览器：本机 Chrome / Edge 的无头模式起不来（见 akGachaDocs/site/开发文档.md 的
 * 「为什么用 SSR 而不是无头浏览器核对」），而 SSR 渲染同样会执行组件、store、数据层，
 * 足以验证「页面没有走样」。
 *
 * 用法：node scripts/verify-render.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
/* 纯函数工具可以直接 import（无 import.meta.env / .vue 依赖），不必绕 vite */
import { shiftDays, shiftYears, localToday } from '../src/lib/date.js';
/* 配色常量（纯模块，可直接 import）—— 断言的期望值直接引用它，避免抄错色值；
   同理排序标签也从 `UP_SORT_ROWS` 取，别写死文案 */
import { CAT_COLOR, SHOP, UP_SORT_ROWS } from '../src/lib/constants.js';
/* 干员列的**自适应字号**（纯函数模块，可直接 import）—— 断言要用它的常量与算法 */
import {
  OP_NAME_COL_W, OP_NAME_PAD, OP_NAME_MAX_FS, OP_NAME_MIN_FS, opNameWidth, opNameFontSize,
} from '../src/lib/opNameFit.js';
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
  /* ⚠️ 必须**连查询串一起去掉**：数据文件现在挂着缓存版本号 `?v=…`（见 src/lib/resource.js），
     不剥掉的话下面拼出来的文件路径会带上 `?v=`，`existsSync` 一律落空 → 整站降级成「不可用」。 */
  const m = s.match(/(data|avatars)\/([^?#]+)/);
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
/** 某个 `<input>` 的 value 属性 —— 日期框「初始有没有填上默认值」只能这样验 */
const dateVal = (html, id) => {
  const tag = (new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html) || [''])[0];
  return (tag.match(/value="([^"]*)"/) || [])[1] || '';
};

/**
 * 取「包含某段文本的那个 `<button>`」的 class 值，用于断言导航项高亮。
 *
 * ⚠️ 为什么不能直接写 `class="navitem active"`：**Vue SSR 渲染 class 时
 * 「动态类在前、静态类在后」** —— `class="navitem"` + `:class="{active:…}"` 出来的是
 * `class="active navitem"`，直接照 HTML 源码里的属性顺序写就会匹配不上（踩过一次）。
 * 所以这里把 class 值取出来按**词**判，与顺序无关。
 */
const btnClass = (html, text) => {
  const re = new RegExp(`<button[^>]*class="([^"]*)"[^>]*>((?:(?!</button>)[\\s\\S])*?)${text}`);
  const m = re.exec(html);
  return m ? m[1] : '';
};
/** class 值里是否**同时**含这些类名（按词比，不看顺序） */
const clsHas = (cls, ...names) => {
  const list = cls.split(/\s+/);
  return names.every((n) => list.includes(n));
};

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
        { path: '/first-up', name: 'firstUp', component: (await vite.ssrLoadModule('/src/views/FirstUpView.vue')).default },
        { path: '/first-up/table', name: 'firstUpTable', component: (await vite.ssrLoadModule('/src/views/FirstUpTableView.vue')).default },
        { path: '/up-history', name: 'upHistory', component: (await vite.ssrLoadModule('/src/views/UpHistoryView.vue')).default },
        /* 与 src/router/index.js 保持一致：老路径的前端跳转（核对脚本也要能走这条） */
        { path: '/shop-interval', redirect: '/first-up' },
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
  /* ⚠️ 「常驻中坚寻访 + 中坚甄选」现在放在**单独一个文件**里（`banners_cla_<server>.json`，
     来自官方解包数据），由站点侧 `loadData.js` 合并 —— 所以「卡池列表行数」的期望值
     = `metadata.bannerCount`（各脚本抓到的条数，**不含中坚**）+ 该文件里的中坚条数。 */
  const claCount = (srv) => {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data', `banners_cla_${srv}.json`), 'utf8'));
      return Object.keys(j.banners || {}).length;
    } catch {
      return 0;
    }
  };
  const BANNER_N = META.servers.find((x) => x.id === 'sc').bannerCount + claCount('sc');
  /* 干员总数从 metadata 派生（**不写死** —— 会随新干员入库增长；头像数应与它一致） */
  const OP_N = META.operatorCount;
  const SNAP = META.generatedAt;
  /* 参考日期的初始值 = 打开页面的**真实当天**（2026-10-01 口径调整；以前取数据快照日 SNAP）。
     三个服务器的「数据更新日」只用于左栏展示，不再参与计算。 */
  const TODAY = localToday();
  /* 「可见卡池」= 开始日不晚于当天的卡池数。**统计页**的参考日期是当天，所以已公布、
     但还没到开始日的卡池（繁中服就有，国服将来也可能有）不进统计表 —— 别拿 bannerCount 直接比。
     ⚠️ 卡池列表**不**受这条影响：它的结束日期默认取数据最晚结束日（2026-10-04 只把 UP 历史 /
     首次UP间隔改成「今天」），所以列表照常列出预告池，行数仍等于 bannerCount。 */
  const visibleOf = (store) => store.banners.filter((b) => b.startDate <= TODAY).length;

  check('数据层加载成功', banners.store.error, '');
  check('卡池总数 = metadata.bannerCount', banners.store.banners.length, BANNER_N);
  check('干员总数', banners.store.operatorCount, OP_N);
  check('默认服务器', banners.store.server, 'sc');
  check('参考日期初始值 = 打开页面的当天', banners.store.refDate, TODAY);

  check('卡池列表页渲染出卡片/表格', count(bh, /class="grid floating"/g) >= 1, true);
  check('卡池数据行数 = 卡池总数',
    count(bh.slice(bh.indexOf('<tbody>'), bh.indexOf('</tbody>')), /<tr[\s>]/g), BANNER_N);
  check('表头：出率提升（6★）', count(bh, /出率提升（6★）/g), 1);
  check('表头：出率提升（5★）', count(bh, /出率提升（5★）/g), 1);
  /* ⚠️ 别再用 `includes('width:1225px')` —— `min-width:1225px` 里也含这个子串，
     断言会一直「通过」，哪怕表格早就不这么排版了。这里按实际写法分别匹配。 */
  check('卡池表：铺满可用宽度 + 1225px 兜底下限',
    /width:100%;min-width:1225px/.test(bh.replace(/\s+/g, '')), true);
  check('「进行中」胶囊', count(bh, /pill-live/g) >= 1, true);
  /* 标记的**字**是「店」（2026-10-19 用户要求由「兑」改来）—— 这里钉字面量，
     因为这是个纯文案改动，光数 `mk-shop` 的个数是抓不到「改了但没生效」的。 */
  check('商店兑换标记「店」（2026-10-19 由「兑」改来）',
    count(bh, /mk-shop[^>]*>店</g) >= 1 && !/mk-shop[^>]*>兑</.test(bh), true);
  check('限定标记「限」', count(bh, /mk-lim/g) >= 1, true);
  check('结果提示（命中 N / M）',
    new RegExp(`命中 ${BANNER_N} / ${BANNER_N} 个卡池`).test(bh), true);
  /* 日期范围框**初始就有值**：值为空时浏览器只画「年/月/日」，看不出可用范围。
     默认 = 本服卡池的完整跨度，它与「不限」等价 → 所以上面那条命中数仍是全部卡池。
     ⚠️ 2026-10-04：结束日期默认 = 「今天」只改了 UP 历史 / 首次UP间隔，卡池列表仍取数据上界。 */
  check('卡池列表右栏：开始 / 结束日期框初始填上本服完整跨度（结束日期 ≠ 今天口径）',
    dateVal(bh, 'f-from') === banners.store.fullBannerRange.from
    && dateVal(bh, 'f-to') === banners.store.fullBannerRange.to
    && !!dateVal(bh, 'f-from'), true);
  check(`左栏元信息：干员 ${OP_N} 位`, new RegExp(`干员 <b>${OP_N}<\\/b> 位`).test(bh), true);
  check('左栏元信息：卡池数', new RegExp(`卡池 <b>${BANNER_N}</b> 个`).test(bh), true);

  /* ---------------- 卡池列表：点名称复制这个卡池的信息（2026-10-19 加） ----------------
     格式 = **多行「字段：值」**（与表格那七列一一对应），干员名后带「（限）/（店）」标记。
     ⚠️ 这里**真跑** `bannerText()` 钉文案；点击后的剪贴板行为测不了（SSR 没有 navigator /
        document），所以那部分只能读源码钉接线（与「复制按钮」那组同样的取舍）。 */
  {
    const { bannerText } = await vite.ssrLoadModule('/src/lib/bannerCopy.js');
    const j = (s) => JSON.stringify(s);
    const sample = {
      id: 'x', scName: '测试卡池', type: 'limcel', startDate: '2026-10-01', endDate: '2026-10-15',
      upOperators: [
        { scCharName: '甲', rarity: 6, isLimited: true, isShop: true },
        { scCharName: '乙', rarity: 6 },
        { scCharName: '丙', rarity: 5, isShop: true },
      ],
    };
    check('点名称复制：多行「字段：值」，字段与表格七列一一对应',
      j(bannerText(sample, { limcel: '限定寻访' })), j([
        '卡池名称：测试卡池', '类型：限定寻访·庆典', '大类：限定寻访',
        '开始日期：2026-10-01', '结束日期：2026-10-15',
        '出率提升 6★：甲（限·店）、乙', '出率提升 5★：丙（店）',
      ].join('\n')));
    check('点名称复制：某星级 UP 为空 → 该行给「—」（与表格的空列一致）',
      /出率提升 5★：—$/m.test(bannerText(
        { scName: '甲', type: 'classic', startDate: '2026-01-01', endDate: '2026-01-14' },
        { classic: '中坚寻访' },
      )), true);
    check('点名称复制：缺字段也不炸（空对象照样输出七行）',
      bannerText(null).split('\n').length, 7);
  }
  check('卡池列表：每个卡池名称都是一个可点击的按钮（宽屏表格）',
    count(bh, /class="bn-name"/g), BANNER_N);
  check('卡池列表：名称按钮带「点击复制」提示，且默认不渲染「已复制」',
    /title="点击复制这个卡池的信息"/.test(bh) && count(bh, /class="copy-tip/g), 0);
  /* 窄屏卡片视图**真跑**一次：切 `useLayout().isCard`，渲完**立刻还原**——
     后面那些断言全按宽屏表格写，忘了还原会连环变红。 */
  {
    const { useLayout } = await vite.ssrLoadModule('/src/composables/useLayout.js');
    useLayout().isCard.value = true;
    const cards = await renderRoute('/');
    useLayout().isCard.value = false;
    check('卡池列表（窄屏卡片）：名称同样可点击复制（与表格共用同一套交互）',
      count(cards.html, /class="bcard-name bn-name"/g) === BANNER_N
      && count(cards.html, /class="grid floating"/g) === 0, true);
  }
  /* 接线（读源码）：两个视图都走同一个 composable，剪贴板走带兜底的 copyText */
  {
    const btSrc = fs.readFileSync(path.join(ROOT, 'src/components/BannerTable.vue'), 'utf8');
    const bcSrc = fs.readFileSync(path.join(ROOT, 'src/components/BannerCards.vue'), 'utf8');
    const ubcSrc = fs.readFileSync(path.join(ROOT, 'src/composables/useBannerCopy.js'), 'utf8');
    check('点名称复制：两个视图都接到 useBannerCopy（不是各写一套状态机）',
      /useBannerCopy\(\)/.test(btSrc) && /useBannerCopy\(\)/.test(bcSrc)
      && /copyBanner\(b, site\.categories\)/.test(btSrc)
      && /copyBanner\(b, site\.categories\)/.test(bcSrc), true);
    check('点名称复制：写剪贴板走 copyText（带 execCommand 兜底，局域网 http 也能用）',
      /import \{ copyText \} from '\.\.\/lib\/clipboard\.js'/.test(ubcSrc)
      && /copyText\(bannerText\(banner, categories\)\)/.test(ubcSrc), true);
    check('点名称复制：提示 1.6 秒后自动消失，卸载时清定时器',
      /const TIP_MS = 1600/.test(ubcSrc) && /onBeforeUnmount\(\(\) => clearTimeout\(timer\)\)/.test(ubcSrc), true);
    check('点名称复制：按钮与提示都有配套样式（不是裸按钮 / 裸文字）',
      /\.bn-name\{/.test(cssAll) && /\.bn-name:hover\{/.test(cssAll)
      && /\.copy-tip\{/.test(cssAll) && /\.copy-tip\.ok\{/.test(cssAll)
      && /\.copy-tip\.fail\{/.test(cssAll), true);
  }

  /* ---------------- 卡池列表：UP 干员**多选**（名字 / 全拼 / 首字母搜索） ----------------
     分两层守：① 右栏控件结构（搜索框 + 已选 chip）；② 选中后确实按「精确名 OR」筛。
     候选列表本身依赖输入框里的字（SSR 里打不了字），它的匹配 / 排序 / 去重在 verify-data 里测。 */
  const opPool = [...new Set(banners.store.banners.flatMap((b) => b.upOperators.map((o) => o.scCharName)))];
  const opA = opPool[0];
  const opB = opPool[1];

  const opSel = await renderRoute('/', (s) => s.toggleBannerOp(opA));
  check('卡池列表右栏：UP 干员改成搜索式多选（搜索框 + 已选 chips）',
    /id="f-op"/.test(opSel.html)
    && count(opSel.html, /class="opchips"/g) === 1
    && count(opSel.html, /class="opchip"/g) === 1, true);
  check('卡池列表右栏：搜索框提示写明支持拼音 / 首字母',
    /名字 \/ 全拼 \/ 首字母/.test(opSel.html), true);
  check('卡池列表：选中一位干员 = 该干员 UP 过的卡池数',
    opSel.store.bannerRows.length,
    opSel.store.banners.filter((b) => b.upOperators.some((o) => o.scCharName === opA)).length);

  const opTwo = await renderRoute('/', (s) => { s.toggleBannerOp(opA); s.toggleBannerOp(opB); });
  check('卡池列表：多选两位 = 命中任意一位的卡池（OR 并集）',
    opTwo.store.bannerRows.length,
    opTwo.store.banners.filter((b) => b.upOperators.some((o) => o.scCharName === opA || o.scCharName === opB)).length);
  check('卡池列表：多选两位后右栏有两个可移除的 chip',
    count(opTwo.html, /class="opchip"/g) === 2, true);

  /* 再点一次同一个干员 = 取消（chip 上那个 × 走的就是这个动作），回到全部卡池 */
  const opOff = await renderRoute('/', (s) => { s.toggleBannerOp(opA); s.toggleBannerOp(opA); });
  check('卡池列表：再点一次同一个干员即取消（chip 消失、回到全部）',
    opOff.store.bannerRows.length === BANNER_N && !/class="opchip"/.test(opOff.html), true);

  /* 样式契约：chips 与候选列表都要有配套样式，否则是裸按钮 */
  check('卡池列表：UP 干员 chips / 候选列表有配套样式',
    /\.opchip\{/.test(cssAll) && /\.opsug\{/.test(cssAll) && /\.opsug-item\{/.test(cssAll), true);


  /* ---------------- 统计页 ---------------- */
  const stats = await renderRoute('/operators');
  const sh = stats.html;
  /* 分节切片：断言要落到「那张表」里数，**不能在全页 HTML 上数列名** ——
     右栏那几个复选框的文案里就带「中坚次数 / 总次数 / 标准次数」这几个词。
     取 `id="s-x-y"` 到下一个分节为止（最后一个分节取到结尾；右栏在正文之前渲染，不会混进来）。 */
  const sectionHtml = (html, anchor, next) => {
    const a = html.indexOf(`id="${anchor}"`);
    return html.slice(a, next ? html.indexOf(`id="${next}"`) : html.length);
  };
  const mid6Section = sectionHtml(sh, 's-6-mid', 's-5-std');
  const mid5Section = sectionHtml(sh, 's-5-mid');

  check('统计页：四张表', count(sh, /class="grid floating stat-tbl"/g), 4);
  check('统计页：两个并排容器', count(sh, /class="pair"/g), 2);
  check('统计页：四个分节标题', count(sh, /class="sec-title[ "]/g), 4);
  check('统计页：锚点 id 齐全',
    ['s-6-std', 's-6-mid', 's-5-std', 's-5-mid'].every((id) => sh.includes(`id="${id}"`)), true);
  check('统计页：中坚表有「中坚次数」列（2 表 × 出率提升/商店兑换）',
    count(mid6Section, /中坚次数/g) + count(mid5Section, /中坚次数/g), 4);

  /* ---------------- 全站配色（大类三色 / 商店兑换绿色） ----------------
     一套颜色要同时落在 卡池列表徽章、统计页表与标题、UP 历史标记 上，
     所以断言分两层：常量正确 + 各处确实引用了它 + CSS 里的落地色值。 */
  check('配色常量：大类三色', JSON.stringify(CAT_COLOR),
    JSON.stringify({ 标准寻访: '#FFD524', 中坚寻访: '#0098DC', 限定寻访: '#8b5cf6' }));
  check('配色常量：商店兑换 = 绿色', SHOP.color, '#15803d');
  check('卡池列表：大类徽章按三色上色（c-std / c-mid / c-lim）',
    ['c-std', 'c-mid', 'c-lim'].every((c) => bh.includes(c)), true);
  check('卡池列表：「店」标记走全站绿色变量',
    /\.mk-shop\{background:var\(--shop-600\)\}/.test(cssAll)
    && /--shop-600:#15803d/.test(cssAll), true);
  check('统计页：分节标题按大类着色（标准 = 黄 / 中坚 = 蓝）',
    count(sh, /class="sec-title c-std"/g) === 2 && count(sh, /class="sec-title c-mid"/g) === 2, true);
  /* 「复制」按钮（2026-10-11）：四张表各一个，挂在**表格标题行**（`.sec-title`）里。
     ⚠️ 复制内容在 HTML 里看不到（点击时才算）→ 另见文件末尾「剪贴板」那一组的行为断言。 */
  check('统计页：每张表都有一个「复制」按钮（4 张表 = 4 个）',
    count(sh, /class="copy-btn"/g), 4);
  check('统计页：复制按钮挂在**标题行**里（不是表格上方的工具条）',
    count(sh, /class="sec-title[^"]*"[^>]*>[\s\S]{0,90}?<button class="copy-btn"/g) === 4
    && count(sh, /class="tbl-tools"/g) === 0, true);
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

  /* 每张表的行数：与原型一致（2026-10-10 起 45 / 48 / 45 / 68 ——
     当天快照新增 克莱门莎(6★) / 德·托莱多(5★)，两张标准表各 +1 行） */
  const tableRows = (html, anchor) => {
    const start = html.indexOf(`id="${anchor}"`);
    const t = html.indexOf('<tbody>', start);
    const e = html.indexOf('</tbody>', t);
    return count(html.slice(t, e), /<tr[\s>]/g);
  };
  const sizes = ['s-6-std', 's-6-mid', 's-5-std', 's-5-mid'].map((a) => tableRows(sh, a));
  check('统计页：四张表行数 45 / 48 / 45 / 68', sizes.join(','), '45,48,45,68');
  check('统计页总行数 = 参与统计干员数',
    sizes.reduce((a, b) => a + b, 0), 206);

  /* 抽样：与原型逐格核对过的干员应出现在统计页 */
  check('统计页：包含「推进之王」', sh.includes('推进之王'), true);
  check('统计页：结果提示含参考日期，且等于当天', new RegExp(`参考日期 ${TODAY}`).test(sh), true);
  /* 「可见卡池」= 开始日不晚于参考日期的卡池数（visibleOf 定义见上，与卡池列表同一口径）。 */
  check('统计页：可见卡池数 = 开始日不晚于当天的卡池数',
    new RegExp(`可见卡池 ${visibleOf(banners.store)} 个`).test(sh), true);
  /* 参与统计的干员数只在新干员入库时才会变（不像卡池数每周都动），保留字面量当黄金值。
     2026-10-10：204 → 206（快照新增 克莱门莎 / 德·托莱多）。 */
  check('统计页：参与统计干员 206 位', /参与统计干员 206 位/.test(sh), true);

  /* ---------------- 出率提升记录：右栏「高亮干员」（2026-10-16 用户加） ----------------
     纯视觉标记：命中的行加**浅黄底**（`.hl`），**不筛行、不改次数、不进复制内容**。
     这里**真跑**一次带高亮的渲染 —— 直接改 store 的 `statHighlightOps` 再 renderToString。
     高亮状态**不持久化**（刷新即清）、**切服不重置**（干员名三服通用），与「甄选计入」
     「只看中坚」两个统计开关同处理。 */
  check('高亮干员：默认不选 → store 里是空数组', JSON.stringify(stats.store.statHighlightOps), '[]');
  check('高亮干员：右栏有这个控件（label + OpPicker 都渲染出来了）',
    sh.includes('高亮干员') && count(sh, /class="oppick"/g) === 1, true);

  let hlPicked = [];
  const hlRendered = await renderRoute('/operators', (s) => {
    /* ⚠️ 从 statRows 里现取名字，别写死 —— 表里的干员会随数据变 */
    const names = s.statRows.map((r) => r.name);
    hlPicked = [names[0], names[Math.floor(names.length / 2)]];
    s.statHighlightOps = hlPicked;
  });
  const hlHtml = hlRendered.html;
  /** 取某张表 tbody 里带指定 class 的行数 */
  const rowsWithClass = (html, anchor, cls) => {
    const start = html.indexOf(`id="${anchor}"`);
    const t = html.indexOf('<tbody>', start);
    const e = html.indexOf('</tbody>', t);
    return count(html.slice(t, e), new RegExp(`<tr class="${cls}"`, 'g'));
  };
  const hlPerTable = ['s-6-std', 's-6-mid', 's-5-std', 's-5-mid']
    .map((a) => rowsWithClass(hlHtml, a, 'hl'));
  check('高亮干员：选中的两位各命中一行（四张表合计 2 行）',
    hlPerTable.reduce((a, b) => a + b, 0), 2);
  check('高亮干员：命中的正是选中的那两位',
    hlPicked.every((n) => new RegExp(`<tr class="hl">[\\s\\S]{0,260}?>${n}</b>`).test(hlHtml)), true);
  check('高亮干员：**不筛行** —— 四张表行数仍是 45 / 48 / 45 / 68',
    ['s-6-std', 's-6-mid', 's-5-std', 's-5-mid'].map((a) => tableRows(hlHtml, a)).join(','),
    '45,48,45,68');

  /* ⚠️ 底色是加在 **`<tr>`** 上的：前两列是 sticky 冻结列、走 `background:inherit`，
     所以只要给行设底色，冻结列会自动跟上 —— 这两条 CSS 约定缺一不可。 */
  check('高亮干员：浅黄底加在行上，hover 时再深一档（不与 warn 黄字 / 商店绿混）',
    /table\.grid\.stat-tbl tbody tr\.hl\{background:#fff3c4\}/.test(cssAll)
    && /table\.grid\.stat-tbl tbody tr\.hl:hover\{background:#ffedaa\}/.test(cssAll), true);
  /* ⚠️ **顺序敏感**：`.hl` 与 `tr:hover` 特异性同为 (0,3,3)，只能靠先后取胜；
     `tr:hover` 写在后面会把它盖掉 —— 表现为「鼠标划过时高亮突然消失」。 */
  check('高亮干员：.hl 规则排在 tr:hover **之后**',
    cssAll.indexOf('tbody tr.hl{') > cssAll.indexOf('tbody tr:hover{')
    && cssAll.indexOf('tbody tr:hover{') > 0, true);
  check('高亮干员：冻结的前两列走 background:inherit（行底色会自动跟上）',
    /tbody td:nth-child\(-n\+2\)\{z-index:2;background:inherit\}/.test(cssAll), true);

  /* 接线：右栏复用 OpPicker；候选池只给「当前统计口径下真的会出现在表里」的干员
     （不在池里的选了也永远高亮不到） */
  const storeSrc = fs.readFileSync(path.join(ROOT, 'src/stores/site.js'), 'utf8');
  const fdSrc = fs.readFileSync(path.join(ROOT, 'src/components/FilterDrawer.vue'), 'utf8');
  check('高亮干员：右栏用 OpPicker 多选，并接到 store 的 setStatHighlightOps',
    /<OpPicker[\s\S]{0,220}?setStatHighlightOps/.test(fdSrc), true);
  check('高亮干员：候选池取自统计表的行（选了必然能高亮到）',
    /hlPool = computed\(\(\) => site\.statRows\.map\(\(r\) => r\.name\)\)/.test(fdSrc), true);
  check('高亮干员：store 有初值（空数组）+ setStatHighlightOps',
    /statHighlightOps: \[\]/.test(storeSrc) && /setStatHighlightOps\(list\) \{/.test(storeSrc), true);
  /* 切服不重置（与两个统计开关同处理）—— 截 setServer 函数体那一小段来查 */
  const setServerAt = storeSrc.indexOf('setServer(id)');
  const setServerBody = storeSrc.slice(setServerAt, setServerAt + 1000);
  check('高亮干员：切服**不重置**（setServer 里没动它）',
    setServerBody.length > 200 && !setServerBody.includes('statHighlightOps'), true);
  check('高亮干员：不进复制内容（tableCopy 不读高亮状态）',
    !/highlight/i.test(fs.readFileSync(path.join(ROOT, 'src/lib/tableCopy.js'), 'utf8')), true);

  /* ---------------- 出率提升记录：右栏「中坚寻访不看标准次数」（2026-10-16 用户加） ----------------
     勾上后**中坚寻访表**藏掉「总次数 / 标准次数」两列（每组由 5 列收成 3 列），只留「中坚次数」；
     标准寻访表**不受影响**（它那一列叫「次数」，本来就没有「标准次数」的概念）。
     与「高亮干员」同理：**真跑**一次渲染来钉结构，而不是只读源码。
     ⚠️ 断言**不能在全页 HTML 上直接数「标准次数」** —— 右栏那个复选框的**文案**里就带这四个字，
        必须按分节切片（`sectionHtml`，见上面统计页开头）落到具体那张表里数。 */
  const firstRowCells = (html) => {
    const t = html.indexOf('<tbody>');
    return count(html.slice(t, html.indexOf('</tr>', t)), /<td[\s>]/g);
  };

  /* 默认（开关关）：中坚表每组 5 列、标准表每组 3 列 —— 全部分节切片数，别在全页上数 */
  check('不看标准次数：默认关 → 中坚表照常带「总次数 / 标准次数」（每组各一个）',
    count(mid6Section, /总次数/g) === 2 && count(mid6Section, /标准次数/g) === 2
    && count(mid5Section, /总次数/g) === 2, true);
  check('不看标准次数：默认关 → 中坚表每组组头 colspan=5、数据行 12 个 td',
    count(mid6Section, /class="group[^"]*"[^>]*colspan="5"/g) === 2
    && firstRowCells(mid6Section) === 12, true);
  check('不看标准次数：右栏有这个复选框，并接到 store 的 setStatMidNoStd',
    /中坚寻访不看标准次数/.test(fdSrc) && /setStatMidNoStd\(\$event\.target\.checked\)/.test(fdSrc), true);

  const noStdR = await renderRoute('/operators', (s) => { s.statMidNoStd = true; });
  const nh = noStdR.html;
  const std6 = sectionHtml(nh, 's-6-std', 's-6-mid');
  const mid6 = sectionHtml(nh, 's-6-mid', 's-5-std');
  const mid5 = sectionHtml(nh, 's-5-mid');
  check('不看标准次数：两张中坚表里不再有「总次数 / 标准次数」',
    !/总次数/.test(mid6) && !/标准次数/.test(mid6)
    && !/总次数/.test(mid5) && !/标准次数/.test(mid5), true);
  check('不看标准次数：中坚表仍保留「中坚次数」列（每组一个 → 每表 2 处）',
    count(mid6, /中坚次数/g) === 2 && count(mid5, /中坚次数/g) === 2, true);
  check('不看标准次数：中坚表两个组头的 colspan 由 5 收到 3',
    count(mid6, /class="group[^"]*"[^>]*colspan="3"/g), 2);
  check('不看标准次数：中坚表数据行由 12 个 td 收到 8 个（2 + 3 + 3）',
    firstRowCells(mid6), 8);
  check('不看标准次数：标准寻访表完全不受影响（仍是每组 3 列 + 列头「次数」）',
    count(std6, /class="group[^"]*"[^>]*colspan="3"/g) === 2
    && !/总次数/.test(std6) && count(std6, />次数<span class="arw">/g) === 2, true);
  check('不看标准次数：**不筛行** —— 四张表行数仍是 45 / 48 / 45 / 68',
    ['s-6-std', 's-6-mid', 's-5-std', 's-5-mid'].map((a) => tableRows(nh, a)).join(','),
    '45,48,45,68');
  /* ⚠️ 防复发：Vue SSR 会把**模板里的 HTML 注释原样输出** —— 只要有人再把
     「总次数 / 标准次数」写进模板注释，分节切片里就会多出字面量、上面几条断言当场变红。
     这条把「注释泄漏」本身也钉住（2026-10-16 真栽过：注释把列数断言搅乱）。 */
  check('不看标准次数：渲染出的 HTML 里没有夹带「总次数 / 标准次数」的模板注释',
    !/<!--[^>]*(?:总次数|标准次数)/.test(nh), true);

  /* 接线（读源码）：store 的开关 + 组件里的三个 computed + 复制跟着收 */
  const svSrc = fs.readFileSync(path.join(ROOT, 'src/views/StatsView.vue'), 'utf8');
  check('不看标准次数：store 有初值（默认关）+ setStatMidNoStd',
    /statMidNoStd: false/.test(storeSrc) && /setStatMidNoStd\(on\) \{/.test(storeSrc), true);
  check('不看标准次数：**切服不重置**（setServer 里没动它）',
    setServerBody.length > 200 && !setServerBody.includes('statMidNoStd'), true);
  check('不看标准次数：组件里 colspan / 单元格都走那几个 computed（不是各写各的）',
    /const noStd = computed\(\(\) => site\.statMidNoStd\)/.test(fs.readFileSync(path.join(ROOT, 'src/components/StatTable.vue'), 'utf8'))
    && /:colspan="groupCols"/.test(fs.readFileSync(path.join(ROOT, 'src/components/StatTable.vue'), 'utf8')), true);
  check('不看标准次数：复制**跟着屏幕收**（StatsView 把 `noStd` 传给中坚表）',
    /statCopyRows\(g\['6-mid'\], \{ split: true, refDate, midOnly, noStd \}\)/.test(svSrc)
    && /const noStd = site\.statMidNoStd/.test(svSrc), true);

  /* 复制口径真跑一遍：勾上后中坚表只留「中坚次数」，且取的是 upMid / shopMid 那一列
     （故意让 upStd 有 2 条、upMid 只有 1 条，取值写错就会露馅） */
  {
    const { statCopyRows: cp } = await vite.ssrLoadModule('/src/lib/tableCopy.js');
    const ban = (a, b) => ({ startDate: a, endDate: b });
    const row = {
      name: '甲', releaseDate: '2020-01-01',
      upAll: [ban('2026-09-01', '2026-09-15')],
      upMid: [ban('2026-09-01', '2026-09-15')],
      upStd: [ban('2026-06-01', '2026-06-10'), ban('2026-07-01', '2026-07-10')],
      shopAll: [ban('2026-10-01', '2026-10-20')],
      shopMid: [ban('2026-10-01', '2026-10-20')],
      shopStd: [ban('2026-05-01', '2026-05-10')],
    };
    const rr = cp([row], { split: true, refDate: '2026-10-11', noStd: true });
    check('不看标准次数：复制的中坚表头只剩「中坚次数」（12 列 → 8 列）',
      JSON.stringify(rr[0]), JSON.stringify(['实装时间', '干员',
        '出率提升 结束时间', '出率提升 距今天数', '出率提升 中坚次数',
        '商店兑换 结束时间', '商店兑换 距今天数', '商店兑换 中坚次数']));
    check('不看标准次数：复制的中坚数据行取的是"中坚"那一列的次数',
      JSON.stringify(rr[1]), JSON.stringify(['2020-01-01', '甲', '2026-09-15', 27, 1, '2026-10-20', '进行中', 1]));
  }

  /* 顶部定位按钮（统计页才有）—— 文案与 StatsView 的分节标题保持一致 */
  check('顶栏定位按钮 六星干员·标准寻访', /六星干员·标准寻访/.test(sh), true);

  /* 首页不应出现统计表；统计页不应出现卡池表 */
  check('首页没有统计表', count(bh, /stat-tbl/g), 0);
  check('统计页没有卡池表（无 1225px 兜底下限）',
    /min-width:1225px/.test(bh) && !/min-width:1225px/.test(sh), true);

  /* ---------------- 首次UP间隔 ---------------- */
  const fup = await renderRoute('/first-up');
  const ph = fup.html;

  /* 页面内不再重复渲染 h2 大标题，标题只在顶栏出现一次（2026-09-30 去重） */
  check('首次UP间隔页：页面内不再重复标题（顶栏那份负责）',
    !/<h2>/.test(ph) && /首次UP间隔/.test(ph), true);
  check('首次UP间隔页：卡片头统计（六星 N 位 · 五星 N 位）',
    /六星 \d+ 位 · 五星 \d+ 位/.test(ph), true);
  check('首次UP间隔页：两个分节', count(ph, /class="grp-sep"/g), 2);
  check('首次UP间隔页：六星 / 五星分节标题（默认统计模式 = 首次进店）',
    ph.includes('六星干员 · 首次进店间隔') && ph.includes('五星干员 · 首次进店间隔'), true);
  /* ⚠️ 命中数与日期上下限都**会随数据更新变**（新增进店记录就变），不能写死 ——
     期望值一律从 store 的 firstUp 派生（它算的就是同一份数据）。 */
  const FS = fup.store.firstUp;
  check('首次UP间隔页：命中数 = firstUp 的六星 / 五星行数',
    ph.includes(`六星 ${FS.six.length} 位 · 五星 ${FS.five.length} 位`), true);
  /* ⚠️ 结束日期输入的 `max` 取「首次日期上界」与「今天」里较晚的那个（2026-10-04）：
     结束日期默认值就是今天，上限再压着数据上界的话原生选择器够不到自己默认填的值。 */
  check('首次UP间隔页：日期输入带上下限（开始 = firstUp.bounds.min，结束 = max(bounds.max, 今天)）',
    ph.includes(`min="${FS.bounds.min}"`)
    && ph.includes(`max="${Math.max(TODAY, FS.bounds.max || TODAY)}"`), true);
  check('首次UP间隔页：两个图表容器', count(ph, /class="echart"/g), 2);
  check('首次UP间隔页：图表外层可横向滚动', count(ph, /class="chart-scroll"/g), 2);
  check('首次UP间隔页：SSR 下不初始化 echarts（无 canvas）', count(ph, /<canvas/g), 0);
  /* 页内说明块已移除，横轴 / 纵轴的口径改由卡片头一行带过 */
  check('首次UP间隔页：卡片头写明横轴 / 纵轴口径',
    /横轴(按实装日期|按首次进店日期|按首次轮换日期)/.test(ph)
    && /纵轴(距实装日|距上个首次进店|距上个首次轮换)/.test(ph), true);
  check('首次UP间隔页：两侧固定刻度条（六星 + 五星各左右一条）',
    count(ph, /class="ybar ybar-l"/g) === 2 && count(ph, /class="ybar ybar-r"/g) === 2, true);
  check('首次UP间隔页：刻度条带单位标注', count(ph, /class="unit"/g), 4);
  const tickVals = [...ph.matchAll(/class="tk"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
  check('首次UP间隔页：刻度存在且都是 14 的倍数',
    tickVals.length > 0 && tickVals.every((v) => v % 14 === 0), true);
  check('首次UP间隔页：刻度从 0 起', tickVals.includes(0), true);
  check('首次UP间隔页：右栏「近 N 年」输入框', ph.includes('id="fup-years"'), true);
  check('首次UP间隔页：快速填入标题', ph.includes('快速填入日期范围'), true);
  /* 快捷预设（2026-10-04 加）：「近 N 年」下面两枚，默认口径那枚置灰 */
  check('首次UP间隔页：两枚快捷预设（最早~今天 / 最早~最晚）',
    count(ph, />最早 ~ (今天|最晚)<\/button>/g), 2);
  check('首次UP间隔页：默认口径（最早 ~ 今天）那枚置灰、「最早 ~ 最晚」可点',
    /<button[^>]*disabled[^>]*>最早 ~ 今天<\/button>/.test(ph)
    && !/<button[^>]*disabled[^>]*>最早 ~ 最晚<\/button>/.test(ph), true);
  check('首次UP间隔页：三个「确认」按钮（近 N 年 / 起始日 / 结束日）',
    count(ph, />确认<\/button>/g), 3);
  check('首次UP间隔页：未修改时不描红', !/dirty/.test(ph), true);

  const rangedFup = await renderRoute('/first-up', (s) => s.setFirstUpRange('2024-01-01', '2026-01-01'));
  check('已应用的日期范围会同步进输入框',
    rangedFup.html.includes('2024-01-01') && rangedFup.html.includes('2026-01-01'), true);

  /* 筛选范围变化 → 纵轴范围与刻度跟着变（用户明确要求） */
  const ticksOf = (html) => [...html.matchAll(/class="tk"[^>]*>(-?\d+)</g)].map((m) => Number(m[1]));
  const wideTicks = ticksOf(ph);
  const narrowTicks = ticksOf(rangedFup.html);
  check('筛选范围变化后纵轴刻度随之变化',
    JSON.stringify(wideTicks) !== JSON.stringify(narrowTicks), true);
  check('刻度仍以 14 天为基准（或跨度小时降到 7）',
    wideTicks.every((v) => v % 7 === 0) && narrowTicks.every((v) => v % 7 === 0), true);

  const y3 = await renderRoute('/first-up', (s) => s.applyFirstUpYears(3));
  /* 「近 N 年」默认从**当前结束日期**（此处 = 今天）往前推，所以期望值按 store 的 today 算 */
  check('近 3 年：区间 = 今天往前 3 年', y3.store.firstUpRange.from, shiftYears(y3.store.today, -3));
  check('近 3 年：结束端为今天', y3.store.firstUpRange.to, y3.store.today);

  /* ⚠️ 2026-10-04：「近 N 年」改为从**右栏当前的结束日期**倒推（以前固定以今天为上界）。
     结束日期被调过之后，「近 N 年」就该以那个时点收尾 —— 这两条守住新口径。 */
  const yBase = await renderRoute('/first-up', (s) => {
    s.setFirstUpRange('2019-01-01', '2026-01-01');
    s.applyFirstUpYears(2);
  });
  check('近 N 年：从当前结束日期倒推（不再固定用今天）',
    `${yBase.store.firstUpRange.from}~${yBase.store.firstUpRange.to}`, '2024-01-01~2026-01-01');

  /* 右栏两枚快捷预设（最早~今天 / 最早~最晚，2026-10-04 加） */
  const fupPresetFull = await renderRoute('/first-up', (s) => s.setFirstUpRangePreset('full'));
  check('首次UP间隔：「最早 ~ 最晚」= 数据里最晚的首次日期',
    `${fupPresetFull.store.firstUpRange.from}~${fupPresetFull.store.firstUpRange.to}`,
    `${FS.bounds.min}~${FS.bounds.max}`);
  const fupPresetToday = await renderRoute('/first-up', (s) => s.setFirstUpRangePreset('today'));
  check('首次UP间隔：「最早 ~ 今天」= 默认口径',
    `${fupPresetToday.store.firstUpRange.from}~${fupPresetToday.store.firstUpRange.to}`,
    `${FS.bounds.min}~${TODAY}`);

  /* 纵轴起点贴合数据：筛到近 2 年后，能在近两年进店的干员都等了很多年 */
  const sinceFup = await renderRoute('/first-up', (s) => {
    s.setFirstUpMetric('sinceRelease');
    s.setFirstUpRange('2024-09-29', '2026-09-29');
  });
  const sinceTicks = ticksOf(sinceFup.html);
  check('纵轴=距实装 + 近 2 年：起点贴合数据（不再从 0 起）', Math.min(...sinceTicks) > 0, true);
  /* 每条刻度条内部应当是等差（条与条之间起点不同，所以按条分别看） */
  const tickGroups = [...sinceFup.html.matchAll(/class="ybar ybar-[lr]"[^>]*>([\s\S]*?)<\/div>/g)]
    .map((m) => [...m[1].matchAll(/class="tk"[^>]*>(-?\d+)</g)].map((x) => Number(x[1])));
  check('纵轴=距实装 + 近 2 年：四条刻度条各自等差',
    tickGroups.length === 4 && tickGroups.every((g) => g.length >= 3
      && g.every((v, i) => i === 0 || v - g[i - 1] === g[1] - g[0])), true);
  check('纵轴=距实装 + 近 2 年：刻度里不再出现 0 刻度',
    count(sinceFup.html, /class="tk"[^>]*>0</g), 0);
  check('首次UP间隔页：顶栏标题已切换', /首次UP间隔/.test(ph) && !/出率提升记录<\/span>/.test(ph.slice(0, ph.indexOf('<main'))), true);

  /* 右栏随页面切换：各页面自己的筛选面板（左栏导航共四个**顶级**项，卡池列表页不显示进店那块）。
     「首次UP间隔」下面还挂了一个**二级菜单**（图表版 / 表格版）—— 同一份数据的两种呈现。 */
  const NAV_TOP = ['卡池列表', '出率提升记录', '首次UP间隔', 'UP 历史一览'];
  const NAV_SUB = ['图表版', '表格版'];
  check('左栏导航：四个顶级项',
    NAV_TOP.every((t) => ph.includes(t)), true);
  check('左栏导航：「首次UP间隔」下有二级菜单（图表版 / 表格版）',
    NAV_SUB.every((t) => ph.includes(t))
    && count(ph, /navsubitem/g) === 2 && count(ph, /class="navsub"/g) === 1, true);
  /* 二级菜单的样式契约：缩进 + 左侧引导线（父子层级要看得出来），子项有自己的高亮态 */
  check('左栏二级菜单：缩进 + 左侧引导线 + 子项高亮态',
    /\.navsub\{[^}]*border-left/.test(cssAll) && /\.navsubitem\.active\{/.test(cssAll), true);
  check('首次UP间隔页：右栏标题为日期范围', /首次进店日期范围/.test(ph), true);
  check('首次UP间隔页：右栏两个日期输入',
    ph.includes('id="fup-from"') && ph.includes('id="fup-to"'), true);
  check('首次UP间隔页：两个日期框初始填上默认范围（结束日期 = 今天）',
    dateVal(ph, 'fup-from') === fup.store.fullFirstUpRange.from
    && dateVal(ph, 'fup-to') === fup.store.fullFirstUpRange.to
    && !!dateVal(ph, 'fup-to'), true);
  check('首次UP间隔页：结束日期默认值 = 真实今天',
    fup.store.fullFirstUpRange.to === TODAY && fup.store.firstUpRange.to === TODAY, true);
  /* 「全部」按钮走 useRangeDraft 的 reset（客户端点击，SSR 点不到）→ 读源码把它钉住：
     必须回到调用方给的默认范围，而不是清成空框 */
  {
    const filterDrawerSrc = fs.readFileSync(path.join(ROOT, 'src/components/FilterDrawer.vue'), 'utf8');
    const rangeDraftSrc = fs.readFileSync(path.join(ROOT, 'src/composables/useRangeDraft.js'), 'utf8');
    check('日期范围「全部」回到默认范围（不是清成空框）',
      /\(\) => site\.fullFirstUpRange/.test(filterDrawerSrc)
      && /\(\) => site\.fullUpRange/.test(filterDrawerSrc)
      && /const d = defaultRange \? defaultRange\(\) : null;/.test(rangeDraftSrc), true);
  }
  /* 重置类动作同样要回到默认范围（store 侧可验） */
  const fupReset = await renderRoute('/first-up', (s) => {
    s.setFirstUpRange('2024-01-01', '2025-01-01');
    s.resetFirstUpRange();
  });
  check('首次UP间隔：「全部」后回到默认范围（结束日期 = 今天，日期框不回空）',
    fupReset.store.firstUpRange.from === fupReset.store.fullFirstUpRange.from
    && fupReset.store.firstUpRange.to === fupReset.store.fullFirstUpRange.to
    && fupReset.store.firstUpRange.to === TODAY, true);
  check('首次UP间隔页：右栏命中提示（= firstUp 六星 / 五星行数）',
    new RegExp(`命中 六星 ${FS.six.length} 位 / 五星 ${FS.five.length} 位`).test(ph), true);
  check('首次UP间隔页：不显示卡池筛选表单', !ph.includes('id="f-type"'), true);
  check('统计页右栏不再显示进店筛选', !sh.includes('id="fup-from"'), true);

  /* ---------------- 口径切换（右栏，仅首次UP间隔页） ---------------- */
  check('首次UP间隔页：右栏有横轴口径按钮',
    ph.includes('按首次进店日期') && ph.includes('按实装日期'), true);
  check('首次UP间隔页：右栏有纵轴口径按钮',
    ph.includes('距上个首次进店') && ph.includes('距实装日期'), true);
  check('统计页右栏没有口径切换', !sh.includes('距上个首次进店'), true);

  const relFup = await renderRoute('/first-up', (s) => {
    s.setFirstUpAxis('release');
    s.setFirstUpMetric('sinceRelease');
  });
  check('口径切换：头信息跟随', /横轴按实装日期/.test(relFup.html) && /纵轴距实装日/.test(relFup.html), true);
  check('口径切换：卡片头切到「纵轴距实装日」', /纵轴距实装日/.test(relFup.html), true);
  check('口径切换：按钮高亮跟随状态', count(relFup.html, /class="on"/g) >= 2, true);

  /* ---------------- 统计模式切换（首次进店 / 首次轮换，2026-10-02 加） ----------------
     两种模式共用同一套横轴 / 纵轴口径，只是「首次日期」换了来源；
     口径见 akGachaDocs/site/工作指令.md 5.7 与 src/lib/firstUp.js 文件头。 */
  check('首次UP间隔页：右栏有统计模式切换（首次进店 / 首次轮换）',
    ph.includes('统计模式') && ph.includes('>首次进店</button>') && ph.includes('>首次轮换</button>'), true);
  check('首次UP间隔页：默认统计模式 = 首次进店', fup.store.firstUpMode, 'shop');
  check('首次UP间隔页：mode / axis / metric 都回传给数据层',
    `${fup.store.firstUp.mode}/${fup.store.firstUp.axis}/${fup.store.firstUp.metric}`, 'shop/first/gap');

  const rotFup = await renderRoute('/first-up', (s) => s.setFirstUpMode('rotation'));
  check('统计模式=首次轮换：卡片头横轴 / 纵轴换词',
    /横轴按首次轮换日期/.test(rotFup.html) && /纵轴距上个首次轮换/.test(rotFup.html), true);
  check('统计模式=首次轮换：分节标题跟随模式',
    rotFup.html.includes('六星干员 · 首次轮换间隔')
    && rotFup.html.includes('五星干员 · 首次轮换间隔'), true);
  check('统计模式=首次轮换：右栏标题跟随模式', /首次轮换日期范围/.test(rotFup.html), true);
  check('统计模式=首次轮换：命中数 = 轮换口径的六星 / 五星行数',
    rotFup.html.includes(`六星 ${rotFup.store.firstUp.six.length} 位`)
    && rotFup.html.includes(`五星 ${rotFup.store.firstUp.five.length} 位`), true);
  /* 轮换口径比进店宽（进店 ⊆ 轮换，见 verify-data 的不变量断言） */
  check('统计模式=首次轮换：覆盖的干员不少于进店口径',
    rotFup.store.firstUp.rows.length >= fup.store.firstUp.rows.length, true);
  check('统计模式=首次轮换：日期输入上下限跟着模式变',
    rotFup.html.includes(`min="${rotFup.store.firstUp.bounds.min}"`)
    && rotFup.html.includes(`max="${Math.max(TODAY, rotFup.store.firstUp.bounds.max || TODAY)}"`), true);
  /* 浮窗多一行「所在卡池」（该次「首次」发生在哪个卡池；用户 2026-10-03 加）。
     ⚠️ tooltip 的 formatter 由 echarts **在客户端**调用，SSR 出的 HTML 里不含它，
     所以只能查组件源码把这句话钉住（改坏了会红）。数据字段的「同源」由 verify-data 守。
     ⚠️ 两种统计模式**共用同一个 formatter** → 进店模式也会显示这一行
     （都是「那次首次所在的卡池」，两种模式下都成立）。 */
  const fupSrc = fs.readFileSync(path.join(ROOT, 'src/views/FirstUpView.vue'), 'utf8');
  check('首次UP间隔页：浮窗里多一行「所在卡池」（取该次首次所在的那个卡池）',
    /所在卡池：\$\{r\.firstBanner/.test(fupSrc), true);
  check('首次UP间隔页：浮窗的「所在卡池」放在「首次日期」之后（同一场卡池的两条信息相邻）',
    /`\$\{firstLabel\.value\}：\$\{r\.firstDate\}`,[\s\S]{0,200}?`所在卡池：/.test(fupSrc), true);

  /* ---------------- 图表浮窗：挂到全屏固定图层 + 手机竖屏放进「可用带」+ 互斥 ----------------
     （用户 2026-10-03 提：手机竖屏下浮窗经常被遮挡；随后要求「上方不压横轴」「统一放图表标题
      高度」「点一处另一处要消失」）
     浮窗是 echarts 在客户端建的 DOM，SSR 出的 HTML 里什么都没有 → 只能查源码把关键
     契约钉住。这里刻意**不写死像素**（TIP_GAP / z-index 都可能调），只断言「结构」：
     挂载点、坐标口径、可用带（band）的 flip/bottom 判据、互斥、以及两个图表页各自的带子。 */
  const ttSrc = fs.readFileSync(path.join(ROOT, 'src/lib/chartTooltip.js'), 'utf8');
  const chartCmp = fs.readFileSync(path.join(ROOT, 'src/components/EChart.vue'), 'utf8');
  const tlSrc = fs.readFileSync(path.join(ROOT, 'src/lib/upTimeline.js'), 'utf8');

  check('浮窗：挂载点是 position:fixed 的全屏图层（图层坐标系 = 视口坐标系）',
    /position:fixed;inset:0/.test(ttSrc), true);
  check('浮窗：图层 z-index 压过固定顶栏（顶栏 70）与抽屉（75）',
    Number((ttSrc.match(/LAYER_Z\s*=\s*(\d+)/) || [])[1]) > 75, true);
  check('浮窗：补丁关掉 confine（它夹的是「图表范围」，而图表比屏幕宽 → 等于放任浮窗出屏）',
    /confine:\s*false/.test(ttSrc), true);
  check('浮窗：只有贴边模式才接管 position，否则交回 echarts 默认的「贴光标」',
    /if \(isPin\(\)\) return pinAt\(/.test(ttSrc)
    && /return typeof base === 'function' \? base\(point, params, el, rect, size\) : base/.test(ttSrc), true);
  /* 贴边「可用带」（band）：视图给一条「不能压」的竖直区间，浮窗落进去 */
  check('浮窗贴边：`flip` 模式点在屏幕下半 → 贴带子上沿；在上半 → 贴带子下沿',
    /screenY > vh \/ 2 \? lo : maxY/.test(ttSrc), true);
  check('浮窗贴边：`bottom` 模式恒定贴带子下沿（首次UP间隔用：统一落在图表标题那一带）',
    /band\.mode === 'bottom'\) y = maxY/.test(ttSrc), true);
  check('浮窗贴边：带子上下沿缺项时用「顶栏下方 / 屏幕下方」兜底',
    /Number\.isFinite\(band\.top\) \? band\.top : topbarHeight\(\) \+ TIP_GAP/.test(ttSrc)
    && /Number\.isFinite\(band\.bottom\) \? band\.bottom : vh - TIP_GAP/.test(ttSrc), true);
  check('浮窗贴边：把 y 夹回带子内（带子比浮窗矮时以上沿为准，别顶出屏幕）',
    /y = clamp\(y, minY, maxY\)/.test(ttSrc), true);
  check('浮窗贴边：横向以点位居中并夹在屏幕内（图表比屏幕宽，不夹就会被推出屏幕）',
    /clamp\(hostRect\.left \+ px - tw \/ 2, TIP_GAP, Math\.max\(TIP_GAP, vw - tw - TIP_GAP\)\)/.test(ttSrc), true);
  check('浮窗贴边：返回的是**图表内**坐标（要减掉图表容器的 rect，echarts 再换算到图层）',
    /return \[x - hostRect\.left, y - hostRect\.top\]/.test(ttSrc), true);
  check('浮窗：窄屏把浮窗收一档（否则塞不进「图表标题那一带」，见 NARROW_CSS）',
    /const NARROW_CSS/.test(ttSrc) && /\(pinned \? NARROW_CSS : ''\)/.test(ttSrc), true);
  check('浮窗：图层挂 body（免得将来有祖先带 transform，又把 fixed 抓回去被 overflow 裁）',
    /document\.body\.appendChild\(layer\)/.test(ttSrc), true);
  check('浮窗：EChart.vue 首次、每次 setOption、断点变化都重打补丁（共 3 处）',
    count(chartCmp, /setOption\(patchOption\(/g), 3);
  check('浮窗：贴边与否读的是响应式断点、可用带透传视图（传函数，转屏后立刻跟着变）',
    /isPin: \(\) => isNarrow\.value/.test(chartCmp)
    && /band: props\.tipBand/.test(chartCmp), true);
  check('浮窗：EChart.vue 卸载时把图层摘掉',
    /disposeTooltipLayer\(el\.value\)/.test(chartCmp), true);
  check('浮窗：滚动时把浮窗收起来（固定图层不会跟着滚，不收就与已滚走的那根条脱节）',
    /dispatchAction\(\{ type: 'hideTip' \}\)/.test(chartCmp)
    && count(chartCmp, /addEventListener\('scroll', onAnyScroll, true\)/g) === 1
    && count(chartCmp, /removeEventListener\('scroll', onAnyScroll, true\)/g) === 1, true);
  check('浮窗互斥：某图的浮窗一显示就把别的图收起来（手机上点完六星再点五星不留两个）',
    /chart\.on\('showTip'/.test(ttSrc)
    && /c\.dispatchAction\(\{ type: 'hideTip' \}\)/.test(ttSrc), true);
  check('浮窗：EChart.vue 注册 / 注销图表（互斥名单跟着组件生命周期走）',
    /\bregisterChart\(chart\)/.test(chartCmp) && /\bunregisterChart\(chart\)/.test(chartCmp), true);
  check('浮窗：两个图表页的 tooltip 都不再自带 confine（统一交给补丁）',
    !/confine:\s*true/.test(fupSrc) && !/confine:\s*true/.test(tlSrc), true);

  /* 两个图表页各自的「可用带」契约 */
  const upViewSrc = fs.readFileSync(path.join(ROOT, 'src/views/UpHistoryView.vue'), 'utf8');
  check('UP历史页：浮窗带子上沿 = sticky 横轴刻度条（.tl-head）下沿（上方不压横轴）',
    /querySelector\('\.tl-head'\)/.test(upViewSrc)
    && /top: headBottom \+ TIP_GAP/.test(upViewSrc), true);
  check('UP历史页：浮窗带子下沿 = 滚动区下沿（下方不出滚动区）',
    /bottom: r\.bottom - TIP_GAP/.test(upViewSrc), true);
  check('UP历史页：浮窗带子传给图表',
    /<EChart[^>]*:tip-band="tipBand"/.test(upViewSrc), true);
  check('首次UP间隔页：浮窗带子下沿 = 绘图区顶（图表标题那一带），模式 bottom',
    /host\.getBoundingClientRect\(\)\.top \+ GRID\.top/.test(fupSrc)
    && /mode: 'bottom'/.test(fupSrc), true);
  check('首次UP间隔页：两张图（六星 / 五星）都带上浮窗带子',
    count(fupSrc, /:tip-band="tipBand"/g), 2);

  /* 切换模式**不动**已设的时间范围（用户指定）；范围按新的「首次日期」重新筛 */
  const rotKeep = await renderRoute('/first-up', (s) => {
    s.setFirstUpRange('2024-01-01', '2026-01-01');
    s.setFirstUpMode('rotation');
  });
  check('统计模式切换：已设的时间范围原样保留',
    `${rotKeep.store.firstUpRange.from}~${rotKeep.store.firstUpRange.to}`, '2024-01-01~2026-01-01');
  check('统计模式切换：区间按新的「首次轮换日」重新筛',
    rotKeep.store.firstUp.rows.every((r) => r.firstDate >= '2024-01-01' && r.firstDate <= '2026-01-01'), true);
  check('统计模式切换：右栏命中文案用「轮换」的词', /有轮换记录/.test(rotKeep.html), true);

  /* 老路径（页面还叫「首次进店间隔」时的 `/shop-interval`）保留一条前端跳转 ——
     线上被分享 / 收藏过的旧链接不该直接落到首页（catch-all 的 redirect 会让人以为"打开就回首页"）。 */
  const legacyFup = await renderRoute('/shop-interval');
  check('老路径 /shop-interval 会跳到首次UP间隔页（而不是落到首页）',
    /首次UP间隔/.test(legacyFup.html)
    && /六星干员 · 首次进店间隔/.test(legacyFup.html), true);

  /* ---------------- 首次UP间隔 · **表格版**（/first-up/table，左栏二级菜单） ----------------
     与图表版**同一份数据**（`site.firstUp`）、同一套右栏筛选，只是换成表格呈现。
     断言只守「结构契约」（分节 / 列头 / 行数 / 首位空间隔 / 无 canvas），
     不写死会随数据更新的数字 —— 行数一律从 store 派生。 */
  const ft = await renderRoute('/first-up/table');
  const ftHtml = ft.html;
  const ftStore = ft.store.firstUp;
  const ftRows = ftStore.six.length + ftStore.five.length;

  check('表格版：顶栏标题区分出版本（· 表格版）', /首次UP间隔 · 表格版/.test(ftHtml), true);
  check('图表版：顶栏标题也带版本名（· 图表版）', /首次UP间隔 · 图表版/.test(ph), true);
  check('表格版：左栏「表格版」子项高亮',
    clsHas(btnClass(ftHtml, '表格版'), 'navsubitem', 'active'), true);
  check('图表版：左栏「图表版」子项高亮',
    clsHas(btnClass(ph, '图表版'), 'navsubitem', 'active'), true);
  check('表格版：父项「首次UP间隔」在子页面仍高亮',
    clsHas(btnClass(ftHtml, '首次UP间隔'), 'navitem', 'active'), true);

  check('表格版：两个分节（与图表版一一对应）', count(ftHtml, /class="grp-sep"/g), 2);
  /* 「复制」按钮（2026-10-11）：两个分节各一个，挂在**分节标题行**（`.grp-sep`）里 */
  check('表格版：两个分节各一个「复制」按钮', count(ftHtml, /class="copy-btn"/g), 2);
  check('表格版：复制按钮挂在**分节标题行**里（不是表格上方的工具条）',
    count(ftHtml, /class="grp-sep"[\s\S]{0,140}?<button class="copy-btn"/g) === 2
    && count(ftHtml, /class="tbl-tools"/g) === 0, true);
  check('表格版：分节标题与图表版同款',
    /六星干员 · 首次进店间隔/.test(ftHtml) && /五星干员 · 首次进店间隔/.test(ftHtml), true);
  /* ⚠️ 六星 / 五星放进 .pair 后，分节标题成了 `.pair-col` 的第一个子元素，
     会被 `.grp-sep:first-child{border-top:none}`（为单列布局写的）抹掉上边线 ——
     必须用更高特异性补回来，否则两列标题会「贴」在卡片头上。 */
  check('表格版：六星 / 五星放进 .pair（宽够并排、不够自动竖排）+ 标题上边线补回',
    count(ftHtml, /class="pair"/g) === 1
    && count(ftHtml, /class="pair-col"/g) === 2
    && /\.pair\s*>\s*\.pair-col\s*>\s*\.grp-sep\{[^}]*border-top:2px solid/.test(cssAll), true);
  /* 两列顺序必须还是先六星后五星（.pair 只是并排，不改顺序） */
  check('表格版：并排顺序仍是六星在左、五星在右',
    ftHtml.indexOf('六星干员 · 首次进店间隔') < ftHtml.indexOf('五星干员 · 首次进店间隔'), true);
  check('表格版：两张表（六星 / 五星各一张）且不初始化 echarts（无 canvas）',
    count(ftHtml, /class="grid floating fup-tbl"/g) === 2 && count(ftHtml, /<canvas/g) === 0, true);
  check('表格版：七列（干员 / 实装日 / 首次X日 / 所在卡池 / 距上行 / 距实装 / 累计数）',
    count((/<thead>[\s\S]*?<\/thead>/.exec(ftHtml) || [''])[0], /<th\b/g), 7);
  /* 列头文案：**只有「首次X日」**跟统计模式换词；「距上行」「累计数」是用户
     2026-10-03 特意改短的固定文案，别按右栏那套长文案去改它们 */
  check('表格版：列头文案（除「首次X日」外都是固定短文案）',
    ['实装日', '首次进店日', '所在卡池', '距上行', '距实装', '累计数']
      .every((t) => ftHtml.includes(t)), true);
  check('表格版：行数 = 六星 + 五星位数（数据层派生，不写死）',
    count(ftHtml, /<td class="opcell">/g), ftRows);
  check('表格版：每个分节的第一行「距上行」是 —（组内首位没有前序）',
    count(ftHtml, /class="dash"/g) >= 2, true);
  check('表格版：卡片头写明行序口径与高亮列（措辞与图表版同一套）',
    /行序按首次进店日期/.test(ftHtml) && /高亮列距上个首次进店/.test(ftHtml), true);
  check('表格版：当前纵轴口径那一列加底色（默认纵轴 = gap，即「距上行」列）',
    count(ftHtml, /metric-on/g) > 3, true);
  check('表格版：右栏复用图表版那一套筛选（统计模式 / 横轴 / 纵轴 / 日期范围）',
    ftHtml.includes('id="fup-from"') && ftHtml.includes('id="fup-to"')
    && ftHtml.includes('按实装日期') && ftHtml.includes('距实装日期'), true);
  /* 表格样式契约：自己一套 .fup-tbl（内容自适应 + inset 竖线 + sticky 表头），别去蹭 .stat-tbl
     —— 那套是**两行表头**、定宽与 sticky 选择器都限定 `tr:first-child`，混用会互相误伤。
     （2026-10-16 起两边**都有**冻结前两列，但仍是各自一套规则。） */
  check('表格版：表格样式走 .fup-tbl（自适应列宽 + inset 竖线 + sticky 表头）',
    /table\.grid\.fup-tbl\{[^}]*table-layout:auto/.test(cssAll)
    && /table\.grid\.fup-tbl thead th\{[^}]*box-shadow/.test(cssAll), true);
  /* ⚠️ 高亮列的选择器必须写到 tbody 一级 —— 写浅了会被偶数行底色压过（隔一行断一次） */
  check('表格版：高亮列选择器写到 tbody 一级（否则偶数行底色会把它压过）',
    /table\.grid\.fup-tbl tbody td\.metric-on\{/.test(cssAll), true);

  /* 行序跟随右栏「横轴」口径 —— 与图表版同一个开关，换成表格后改的是**行顺序** */
  const ftRel = await renderRoute('/first-up/table', (s) => s.setFirstUpAxis('release'));
  check('表格版：卡片头行序跟随「横轴」口径',
    /行序按实装日期/.test(ftRel.html), true);
  /* ⚠️ 干员名那个 `<b>` 现在带 `style="font-size:…"`（自适应字号，见 lib/opNameFit.js）
     → 正则要**容忍属性**，别写死 `<b>名字</b>`（2026-10-16 因此红过一次）。 */
  check('表格版：行序确实重排了（首行干员 = 数据层按实装排序后的第一个）',
    new RegExp(`<td class="opcell">\\s*<b(?:\\s[^>]*)?>${ftRel.store.firstUp.six[0].name}</b>`)
      .test(ftRel.html), true);

  /* 统计模式切换：「首次X日」与分节标题跟着换词；「距上行 / 累计数」不跟
     （卡片头那一行仍走 lib 的 metricShort，出现「距上个首次轮换」是正常的，别一起断言） */
  const ftRot = await renderRoute('/first-up/table', (s) => s.setFirstUpMode('rotation'));
  check('表格版：切成「首次轮换」后「首次X日」与分节标题换词、固定列头不变',
    /首次轮换日/.test(ftRot.html)
    && /六星干员 · 首次轮换间隔/.test(ftRot.html)
    && /距上行/.test(ftRot.html) && /累计数/.test(ftRot.html)
    && !/累计轮换次数/.test(ftRot.html), true);

  /* 图片模式：干员列换成**长方形蒙版头像** —— 与「出率提升记录」同款，共用 `.avt-img` 那套
     几何（用户 2026-10-03 指定；此前是 26px 的圆形头像）。
     ⚠️ 2026-10-09 起 `<img>` 由 `<AvatarImg>` 渲染，class 变成 `avt-rect avt-real`
     （真实素材那层带 `avt-real`）—— 所以按**类名 token** 匹配，别再写 `class="avt-rect"` 整串。 */
  const ftImg = await renderRoute('/first-up/table', (s) => s.setAvatarMode('image'));
  check('表格版：图片模式下行内出现头像图片',
    count(ftImg.html, /class="avt-rect[ "]/g), ftRows);
  check('表格版：图片模式下不再渲染干员名（<b> 标签）',
    count(ftImg.html, /<td class="opcell">\s*<b>/g), 0);
  /* ⚠️ 干员格必须是**定位元素**（图片模式的 img 绝对定位以它为参照），否则头像会脱位、
     干员列会塌到只剩表头宽度。2026-10-16 起这条由「冻结前两列」的 `position:sticky` 满足
     （sticky 同样是定位元素），原先那行 `td.opcell{position:relative}` 已随之删掉。 */
  check('表格版图片模式：干员格是定位包含块（img 绝对定位的参照）',
    /fup-tbl tbody td:nth-child\(-n\+2\)\{position:sticky/.test(cssAll), true);
  /* 干员列**定宽 84px**（内边距 12px + 内容区 72px ≈ 5.5 个汉字）。
     ⚠️ **2026-10-16 由 103px 收到 84px** —— 103px 是按「7 个汉字」定的（为最长名留位），
     而超字数的名字现在改由**自适应字号**处理（`lib/opNameFit.js`：13 → 11 → 10px），
     不再靠列宽去兜。宽度真源 = `OP_NAME_COL_W`，main.css 与 `<colgroup>` 都要跟它一致。
     width / min / max **三处必须一致**（真源 = main.css 的 .opcell）。 */
  const opColCss = (cssAll.match(/fup-tbl \.opcell\{[\s\S]*?\}/) || [''])[0].replace(/\s+/g, '');
  const opColW = Number((opColCss.match(/[;{]width:(\d+(?:\.\d+)?)px/) || [])[1]);
  check('表格版：干员列定宽 84px（内边距 + 内容区），width/min/max 三处一致',
    opColW === OP_NAME_COL_W
    && opColCss.includes(`width:${opColW}px`)
    && opColCss.includes(`min-width:${opColW}px`)
    && opColCss.includes(`max-width:${opColW}px`), true);
  /* 干员列的定宽按**类名**选择：认列名比认列位置稳，也不会被 DOM 顺序变动带偏 */
  const fupTableSrc = fs.readFileSync(path.join(ROOT, 'src/views/FirstUpTableView.vue'), 'utf8');
  check('表格版：干员列的 th / td 都挂 opcell（按类名定位，不靠 :first-child）',
    /<th class="opcell">干员<\/th>/.test(fupTableSrc)
    && /<td class="opcell">/.test(fupTableSrc), true);
  /* 表头**一律居中**（用户 2026-10-03）：列头不跟着数据格的对齐走，
     所以规则必须写到 `thead th` 才压得过全局的 `th.num{text-align:right}`；
     「所在卡池」的表头也不再挂 tl（它的数据格仍是左对齐）。 */
  check('表格版：表头一律居中（数字列只让数据格右对齐）',
    /fup-tbl thead th\{text-align:center\}/.test(cssAll)
    && !/<th class="tl">/.test(fupTableSrc), true);

  /* ---------------- 干员展示模式（简洁 / 图片） ---------------- */
  check('左栏底部有干员展示切换', ph.includes('简洁模式') && ph.includes('图片模式'), true);
  check('「干员展示」排在「服务器」上面',
    ph.indexOf('干员展示') > 0 && ph.indexOf('干员展示') < ph.indexOf('>服务器<'), true);
  check('默认简洁模式：卡池列表仍是名字标签',
    count(bh, /class="tag r/g) > 0 && !/class="av[ "]/.test(bh), true);

  const imgBanners = await renderRoute('/', (s) => s.setAvatarMode('image'));
  /* ⚠️ 头像 `<img>`（`<AvatarImg>` 渲染）的 class 现在是 `av avt-real` —— 按类名 token 匹配 */
  check('图片模式：卡池列表换成头像', count(imgBanners.html, /class="av[ "]/g) > 400, true);
  check('图片模式：头像带「限」「店」角标（两个标记走同一条路径，字也跟着换）',
    count(imgBanners.html, /class="corners"/g) > 0
    && count(imgBanners.html, /mk-shop[^>]*>店</g) >= 1, true);
  check('图片模式：不再渲染名字标签', count(imgBanners.html, /class="tag r/g), 0);
  /* 头像是真的素材了（不是内联占位图 —— 占位图只在素材缺失时兜底）。
     ⚠️ 来源随环境变：**dev 走本地**（`/avatars/...`，方便直接看本地新素材），
     构建产物才固定指向 jsDelivr 上某个 sha。所以这里只断言「是 avatars/ 下的真素材」，
     主机名由针对 resource.js 源码的断言守住。 */
  check('图片模式：头像用真实素材（不是内联占位图）',
    /src="(?:https:\/\/cdn\.jsdelivr\.net\/gh\/Yjun233\/akGachaResource@[0-9a-f]{40}\/|\/)avatars\/char_[A-Za-z0-9_]+\.png"/.test(imgBanners.html)
    && !/src="data:image\/svg\+xml/.test(imgBanners.html), true);

  const imgStats = await renderRoute('/operators', (s) => s.setAvatarMode('image'));
  /* 统计页用**长方形蒙版**（.avt-rect，宽是高 2 倍），与卡池列表的方形头像 .av 区分开。
     ⚠️ 类名 token 匹配（真图那层 class = `avt-rect avt-real`）。 */
  check('图片模式：统计表每人一个长方形蒙版头像', count(imgStats.html, /class="avt-rect[ "]/g), 206);
  check('图片模式：统计表不再渲染干员名', !/<b>推进之王<\/b>/.test(imgStats.html), true);
  check('图片模式：统计表仍保留次数数字', /class="num"/.test(imgStats.html), true);
  /* ⚠️ 行高一致性靠 `img-mode` 那句钩子 + `.avt-rect` 的绝对定位：
     没有它，干员格失去行流内容 → 行高从 37.8px 掉到 29.8px（实测），与简洁模式对不上。 */
  check('图片模式：统计表带 img-mode 钩子（补回干员格的行框高度）',
    /<table class="img-mode grid floating stat-tbl">/.test(imgStats.html), true);

  /* ---------------- 图片模式：加载中 / 加载失败 → 干员名首字占位（2026-10-09） ----------------
     用户要求：「加载中或加载失败的图片能否用干员名字首字占位」。
     做法 = `<AvatarImg>` 在外层 `.avt-img` 里叠两层：真图 `.avt-real`（上）+ 首字占位
     `.avt-fallback`（下）。占位图就是 `placeholderAvatar()` 的**内联 SVG**（浅蓝底 + 深蓝首字）。
     ⚠️ SSR 里没有 `Image`（`CAN_LOAD=false`），`avatarReady` 一律恒 true
       → 渲染出来的是**真素材**（上面那条 `src="…/avatars/char_*.png"` 断言守着），
         占位层只作为**背景层**存在（加载中露出来、加载完被真图盖住、失败时真图撤掉）。
         所以这里断言的是「两层结构 + 占位层是 data URI SVG」，**不是**「渲染成了占位图」。 */
  check('图片模式：头像由 <AvatarImg> 渲染（外层 .avt-img 叠真图 + 占位两层）',
    /<span class="avt-img">/.test(imgStats.html)
    && /class="avt-rect avt-real"/.test(imgStats.html), true);
  check('图片模式：每张头像都垫了一层首字占位（`.avt-fallback`，与真图同数）',
    count(imgStats.html, /class="avt-fallback"/g), 206);
  check('图片模式：占位层是内联 SVG 首字占位图（data:image/svg+xml，不发网络请求）',
    /class="avt-fallback"[^>]*background-image:url\(&quot;data:image\/svg\+xml,/.test(imgStats.html), true);
  /* 卡池列表（.av 方头像）同样要有占位层 —— 三处 DOM 共用同一个组件 */
  check('图片模式：卡池列表的头像也有首字占位层',
    count(imgBanners.html, /class="avt-fallback"/g) > 400, true);

  const avLibSrc = fs.readFileSync(path.join(ROOT, 'src/lib/avatars.js'), 'utf8');
  check('头像模块：预加载 + 就绪判断 + 加载完成订阅都在（canvas 两处要用）',
    /export function preloadAvatar/.test(avLibSrc)
    && /export function avatarReady/.test(avLibSrc)
    && /export function onAvatarLoad/.test(avLibSrc), true);
  /* ⚠️ SSR / 无 Image 环境必须「当真图已就绪」，否则整图退化成首字、`<image>` 断言全红 */
  check('头像模块：无 Image 环境（SSR）一律当真图已就绪（否则 SSR 会画成首字）',
    /const CAN_LOAD = typeof Image !== 'undefined'/.test(avLibSrc)
    && /if \(!CAN_LOAD\) return true/.test(avLibSrc), true);
  /* canvas 两处（UP 历史 / 首次UP折线）在头像没就绪时画首字，就绪后靠 avatarTick 重绘 */
  const upLibSrc2 = fs.readFileSync(path.join(ROOT, 'src/lib/upTimeline.js'), 'utf8');
  const fupSrc2 = fs.readFileSync(path.join(ROOT, 'src/views/FirstUpView.vue'), 'utf8');
  const upViewSrc2 = fs.readFileSync(path.join(ROOT, 'src/views/UpHistoryView.vue'), 'utf8');
  check('UP 历史：头像未就绪时画首字占位（isImage && avatarReady 分支）',
    /isImage && avatarReady\(op\)/.test(upLibSrc2) && /else if \(isImage\)/.test(upLibSrc2), true);
  check('首次UP折线：头像未就绪时画圆底首字占位（!readyOf 分支）',
    /if \(!readyOf\(row\.name\)\)/.test(fupSrc2), true);
  check('canvas 两处：头像加载完成会触发重绘（订阅 onAvatarLoad → avatarTick）',
    /onAvatarLoad\(\(\) => \{ avatarTick\.value \+= 1; \}\)/.test(upViewSrc2)
    && /onAvatarLoad\(\(\) => \{ avatarTick\.value \+= 1; \}\)/.test(fupSrc2), true);

  const imgFup = await renderRoute('/first-up', (s) => s.setAvatarMode('image'));
  /* 页内说明块已移除；图片模式的关键行为（点用头像）在数据层与 upTimeline 断言里守 */
  check('图片模式：折线页仍正常渲染两个分节', count(imgFup.html, /class="grp-sep"/g), 2);
  check('图片模式：折线页仍渲染两侧刻度条', count(imgFup.html, /class="ybar ybar-l"/g), 2);

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

  /* --- 时间重合标记（2026-10-04 起）：皮肤上架窗口 ∩ 卡池窗口；密录 / 模组推出日 ∈ 卡池窗口
         → 头像**左下角**赭三角（**实心 = 有皮肤**、**空心 = 只有密录·模组**）。
     图表内容是 canvas 自绘，SSR 产物里看不到 → 只能读源码钉住契约（参考手册 ⑫ 的老办法）。 */
  const uhLibSrc = fs.readFileSync(path.join(ROOT, 'src/lib/upHistory.js'), 'utf8');
  const loadSrc = fs.readFileSync(path.join(ROOT, 'src/lib/loadData.js'), 'utf8');
  const siteSrc = fs.readFileSync(path.join(ROOT, 'src/stores/site.js'), 'utf8');

  check('时间重合：loadData **按服**加载 skins / memoirs / modules（都是可选，缺则降级）',
    /getJSONOptional\(`skins_\$\{s\.id\}\.json`\)/.test(loadSrc)
    && /getJSONOptional\(`memoirs_\$\{s\.id\}\.json`\)/.test(loadSrc)
    && /getJSONOptional\(`modules_\$\{s\.id\}\.json`\)/.test(loadSrc), true);
  check('时间重合：loadData 按干员名索引（skins 存整套、密录模组只留日期）',
    /function indexExtras\(/.test(loadSrc)
    && /skins\[s\.scCharName\]/.test(loadSrc)
    && /memoirs\[m\.scCharName\]/.test(loadSrc)
    && /modules\[m\.scCharName\]/.test(loadSrc), true);
  check('时间重合：store 把三个数据源（当前服的那份）都传进 computeUpHistory',
    /const ex = this\.extras;/.test(siteSrc)
    && /skinsByOperator: ex\.skins,/.test(siteSrc)
    && /memoirsByOperator: ex\.memoirs,/.test(siteSrc)
    && /modulesByOperator: ex\.modules,/.test(siteSrc), true);

  /* --- 数据缓存的版本号（2026-10-10）---
     jsDelivr 对数据文件回 `max-age=604800`（7 天），而 CI 的 purge 够不到浏览器里的那份，
     于是可能「数据更新日是今天、卡池内容还是几天前」——自设卡池因此没被正式卡池顶掉。
     治法：除 metadata 外所有数据 URL 挂 `?v=<六个更新日>`，metadata 用 `no-store` 单独抢取。
     resource.js 那一半的断言在下面「资源模块」那组里（同一个文件只读一次）。 */
  check('数据缓存：metadata 用 `cache: \'no-store\'` **绕开缓存**抢取（版本号的来源不能是缓存）',
    /getJSON\('metadata\.json', \{ fresh: true \}\)/.test(loadSrc)
    && /cache: 'no-store'/.test(loadSrc), true);
  check('数据缓存：取 metadata → 写版本号 → 再取其余（顺序不能反）',
    /setDataVersion\(versionOf\(meta\)\)/.test(loadSrc)
    && loadSrc.indexOf('setDataVersion(versionOf(meta))') < loadSrc.indexOf("getJSON('operators.json')"),
    true);
  check('数据缓存：版本号含**三服 + 中坚三份共六个**日期（只取国服会漏掉国际服/繁中服/中坚的更新）',
    /meta\?\.generatedAt, meta\?\.enGeneratedAt, meta\?\.tcGeneratedAt/.test(loadSrc)
    && /cla\.sc\?\.generatedAt, cla\.en\?\.generatedAt, cla\.tc\?\.generatedAt/.test(loadSrc), true);
  /* 判定口径：皮肤是**区间 ∩ 区间**（闭区间求交）；密录 / 模组是**点 ∈ 区间** */
  check('时间重合：皮肤用闭区间求交',
    /aStart <= bEnd && bStart <= aEnd/.test(uhLibSrc), true);
  check('时间重合：密录 / 模组用「推出日落在卡池窗口内」',
    /const dateInSpan = \(d, start, end\) => !!d && !!start && !!end && start <= d && d <= end;/.test(uhLibSrc)
    && /anyDateInBanner\(/.test(uhLibSrc), true);
  /* ⚠️ 2026-10-06 起三服都有 extras（国服皮肤来自 PRTS，其余来自官方解包）——
     `extrasOk` 那层按服门控**已删**，现在是「调用方按服取好再传进来」。
     ⚠️ 2026-10-08 起「实装那次」不标三角 —— 三个布尔都带 `!isRelease &&` 前缀。 */
  check('时间重合：mark 上带三个布尔（直接用传进来的那三份数据判）',
    /skinRelated: !isRelease && skinOverlapsBanner\(/.test(uhLibSrc)
    && /memoirRelated: !isRelease && anyDateInBanner\(/.test(uhLibSrc)
    && /moduleRelated: !isRelease && anyDateInBanner\(/.test(uhLibSrc)
    && !/extrasOk/.test(uhLibSrc), true);
  /* 「实装那次」的判据：卡池开始日 == 该干员实装日（**严格相等**，不是「首条标记」）。
     见 upHistory.js —— 用日期相等是为了不误伤开服那批（首条 UP ≠ 实装日）。 */
  check('实装那次：判据是「标记日 == 实装日」（严格相等，非 marks[0]）',
    /relDateOf\(operatorByName\[op\.scCharName\]\) === b\.startDate/.test(uhLibSrc), true);
  /* 绘制：polygon 手拼三点（zrender 无 triangle 类型）；底边半宽 = R·cos30° 是等边三角的特征 */
  check('时间重合：画成等边三角形（底边半宽 = R·cos30°）',
    /mark\.skinRelated \|\| mark\.memoirRelated \|\| mark\.moduleRelated/.test(tlSrc)
    && /R \* 0\.866/.test(tlSrc), true);
  check('时间重合：三角落在标记圆**左下角**（cy + d / 2）',
    /const ty = cy \+ d \/ 2 - TL\.dotInset;/.test(tlSrc), true);
  /* ⚠️ **三态**（用户 2026-10-05 定稿）：
     · 只有皮肤 → 实心赭（填充赭 + **白**描边）
     · 有密录 / 模组 → **描边也变赭**
     · 只有密录 / 模组（无皮肤）→ **空心赭**（白填充 + 赭描边） */
  check('时间重合：填充 = 有皮肤 ? 赭 : 白',
    /fill: mark\.skinRelated \? TL\.triColor : TL\.triEmpty/.test(tlSrc), true);
  check('时间重合：描边 = 有密录 / 模组 ? 赭 : 白',
    /stroke: mark\.memoirRelated \|\| mark\.moduleRelated \? TL\.triColor : TL\.triEmpty/.test(tlSrc), true);
  check('时间重合：三角描边很细（lineWidth 0.5）', /lineWidth: 0\.5/.test(tlSrc), true);
  check('时间重合：三角色 #8D2E00（且 ≠ 标准池圆环色 #FFD524）',
    /triColor: '#8D2E00'/.test(tlSrc) && !/triColor: '#FFD524'/.test(tlSrc), true);
  /* ⚠️ 2026-10-06 起**不再按服门控** —— 三服都有 extras，store 按当前服取那三份文件（见上一条）。 */
  check('时间重合：lib 里已删掉按服门控（不再有 extrasOk）',
    !/extrasOk/.test(uhLibSrc), true);
  check('时间重合：tooltip 分别提示「同期有皮肤上架」与「同期有密录 / 模组上线」',
    /同期有皮肤上架/.test(tlSrc) && /同期有\$\{extraUp\.join/.test(tlSrc), true);

  /* ---------------- 鼠标拖拽平移（两个图表页共用 useDragPan） ----------------
     需求（2026-10-02）：图表可以按住鼠标拖拽移动视图；⚠️ **手机端的滑动不能被影响**。
     实现见 src/composables/useDragPan.js —— 要害是「只认鼠标」，触摸 / 触控笔一律不接管。
     所以这里特意守一条：**全站 CSS 不许出现 `touch-action`**（写了就会把原生滑动掐掉）。 */
  const dragSrc = fs.readFileSync(path.join(ROOT, 'src/composables/useDragPan.js'), 'utf8');
  const dragShopSrc = fs.readFileSync(path.join(ROOT, 'src/views/FirstUpView.vue'), 'utf8');
  check('拖拽：两个图表页的滚动容器都绑了 pointer 事件（UP 历史 4 个 / 进店间隔 8 个）',
    (upSrc.match(/@pointer(down|move|up|cancel)/g) || []).length === 4
    && (dragShopSrc.match(/@pointer(down|move|up|cancel)/g) || []).length === 8, true);
  check('拖拽：拖拽中切 grabbing 光标（两个容器都带 .dragging）',
    /:class="\{ dragging \}"/.test(upSrc)
    && (dragShopSrc.match(/:class="\{ dragging \}"/g) || []).length === 2
    && /\.tl-scroll\.dragging\{cursor:grabbing/.test(cssAll)
    && /\.chart-scroll\.dragging\{cursor:grabbing/.test(cssAll), true);
  check('拖拽：两个容器默认是 grab 光标',
    /\.tl-scroll\{[\s\S]*?cursor:grab/.test(cssAll)
    && /\.chart-scroll\{[\s\S]*?cursor:grab/.test(cssAll), true);
  /* ⚠️ 只在**行首**找属性声明 —— 上面两条 CSS 的注释里也提到过 `touch-action:none`
     （那是「别加」的提醒），用宽松正则会把它当成真写了属性。 */
  check('拖拽：全站 CSS 没有真的写 touch-action（否则手机端滑动会被掐掉）',
    !/^[ \t]*touch-action\s*:/m.test(cssAll), true);
  check('拖拽：源码里显式判 pointerType（只认鼠标）',
    /pointerType !== 'mouse'/.test(dragSrc), true);

  /* shouldStartDrag 是纯函数，直接喂假事件断言 —— 「触摸不接管」是硬约束 */
  const { shouldStartDrag } = await vite.ssrLoadModule('/src/composables/useDragPan.js');
  /* 假容器：左上角落在视口 (100, 50)，可视区 1000×400 */
  const dragNode = {
    clientWidth: 1000,
    clientHeight: 400,
    getBoundingClientRect: () => ({ left: 100, top: 50 }),
  };
  const dragEv = (o) => ({ pointerType: 'mouse', button: 0, clientX: 110, clientY: 60, ...o });
  check('拖拽判定：鼠标左键在内容区 → 接管', shouldStartDrag(dragEv(), dragNode), true);
  check('拖拽判定：触摸 → 不接管（交给原生滑动）',
    shouldStartDrag(dragEv({ pointerType: 'touch' }), dragNode), false);
  check('拖拽判定：触控笔 → 不接管',
    shouldStartDrag(dragEv({ pointerType: 'pen' }), dragNode), false);
  check('拖拽判定：中键 / 右键 → 不接管',
    shouldStartDrag(dragEv({ button: 1 }), dragNode), false);
  check('拖拽判定：按在横向滚动条上 → 不接管',
    shouldStartDrag(dragEv({ clientY: 455 }), dragNode), false);
  check('拖拽判定：按在纵向滚动条上 → 不接管',
    shouldStartDrag(dragEv({ clientX: 1105 }), dragNode), false);
  /* ⚠️ 给「滚动条判断错用 offsetX/offsetY」那个 bug 上的锁：真实场景里事件目标常是内层
     canvas（offsetY 能到两千多，远超容器高度），当时就是因此**永远拖不动**。 */
  check('拖拽判定：点在图表主体上（事件目标很大、offset 远超容器）也要接管',
    shouldStartDrag(dragEv({ offsetX: 480, offsetY: 2600 }), dragNode), true);
  /* 横向滚动条要一直停在最右：① 切服务器 / 切星级后重新贴右；
     ② 时间轴宽度变化时（动筛选会让它变窄 / 变宽）若本来就贴着右端就继续保持。
     ⚠️ 2026-10-09 起那个 watcher 体里多了 `preloadVisible()`（图片模式要预加载头像），
     所以不再写成 `, scrollToRight)` 的简写 —— 断言改成「watch 了这两个键 + 调了 scrollToRight」。 */
  check('UP 历史页：横向滚动条会重新贴到最右（切服 / 切星级 + 宽度变化）',
    /watch\(\(\) => \[site\.server, site\.upRarity\][\s\S]{0,80}?scrollToRight\(\)/.test(upSrc)
    && /new ResizeObserver/.test(upSrc) && /pinned/.test(upSrc), true);
  check('UP 历史页：名字列每人一行（93 行）', count(uh, /class="tl-name"/g), 93);
  /* 页内说明块已移除（2026-09-30 精简），版权与来源声明统一放在左栏底部 */
  check('左栏底部：数据来源 + 版权声明',
    /卡池信息来源/.test(uh) && /版权属于鹰角网络/.test(uh), true);
  /* 页脚两个外链图标（2026-10-11 加）：GitHub → 站点仓库、小电视 → b 站空间。
     断言 href / target / rel 与「是内联 SVG（不引图标库）」。 */
  check('左栏底部：两个外链图标（GitHub 站点仓库 + b 站小电视）',
    count(uh, /class="dlk"/g), 2);
  check('左栏底部：GitHub 图标指向站点仓库、新窗口打开、带 noreferrer',
    /<a class="dlk" href="https:\/\/github\.com\/Yjun233\/akGachaData" target="_blank" rel="noreferrer"/.test(uh), true);
  check('左栏底部：小电视图标指向 b 站空间',
    /<a class="dlk" href="https:\/\/space\.bilibili\.com\/5555217" target="_blank" rel="noreferrer"/.test(uh), true);
  check('左栏底部：两个图标都是**内联 SVG**（不引图标库 / 图标字体）',
    count(uh, /class="dlk"[^>]*>\s*<svg viewBox="0 0 24 24"/g), 2);

  check('UP 历史页：左栏导航四个顶级项 + 首次UP间隔的二级菜单都在',
    NAV_TOP.every((t) => uh.includes(t)) && NAV_SUB.every((t) => uh.includes(t)), true);
  check('UP 历史页：右栏标题', /时间范围与筛选/.test(uh), true);
  check('UP 历史页：星级切换按钮（六星 93 / 五星 113）',
    /六星（93）/.test(uh) && /五星（113）/.test(uh), true);
  check('UP 历史页：时间范围三件套（近 N 年 + 两个日期 + 三个确认）',
    uh.includes('id="up-years"') && uh.includes('id="up-from"') && uh.includes('id="up-to"')
    && count(uh, />确认<\/button>/g) === 3, true);
  check('UP 历史页：两个日期框初始填上默认范围（结束日期 = 今天）',
    dateVal(uh, 'up-from') === up.store.fullUpRange.from
    && dateVal(uh, 'up-to') === up.store.fullUpRange.to
    && !!dateVal(uh, 'up-from'), true);
  check('UP 历史页：结束日期默认值 = 真实今天（时间轴不伸到未来）',
    up.store.fullUpRange.to === TODAY && up.store.upRange.to === TODAY, true);
  const upReset = await renderRoute('/up-history', (s) => {
    s.setUpRange('2024-01-01', '2025-01-01');
    s.resetUpRange();
  });
  check('UP 历史：「全部重置」后回到默认范围（结束日期 = 今天，日期框不回空）',
    upReset.store.upRange.from === upReset.store.fullUpRange.from
    && upReset.store.upRange.to === upReset.store.fullUpRange.to
    && upReset.store.upRange.to === TODAY, true);
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
  /* ⚠️ 2026-10-04：「近 N 年」改为从**右栏当前的结束日期**倒推（以前固定以今天为上界）——
     先把结束日期调到某个时点，「近 2 年」就该以那个时点收尾。 */
  {
    const s = up.store;
    s.setUpRange('2020-01-01', '2026-02-01');
    s.applyUpYears(2);
    check('UP 历史：「近 N 年」从当前结束日期倒推',
      `${s.upRange.from}~${s.upRange.to}`, '2024-02-01~2026-02-01');
  }
  /* 右栏两枚快捷预设（最早~今天 / 最早~最晚，2026-10-04 加）：store 侧口径 + 置灰状态 */
  const upPresetFull = await renderRoute('/up-history', (s) => s.setUpRangePreset('full'));
  check('UP 历史：「最早 ~ 最晚」= 本服卡池最晚结束日',
    `${upPresetFull.store.upRange.from}~${upPresetFull.store.upRange.to}`,
    `${up.store.bannerBounds.min}~${up.store.bannerBounds.max}`);
  check('UP 历史页：两枚快捷预设，默认口径那枚置灰',
    count(upPresetFull.html, />最早 ~ (今天|最晚)<\/button>/g) === 2
    && /<button[^>]*disabled[^>]*>最早 ~ 最晚<\/button>/.test(upPresetFull.html)
    && !/<button[^>]*disabled[^>]*>最早 ~ 今天<\/button>/.test(upPresetFull.html), true);
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
  /* 取某类按钮的**开标签**（判置灰用）。
     ⚠️ class 按**词**匹配：选中的按钮渲染成 `class="on ttype"`（Vue SSR 动态类在前），
     写成 `class="ttype` 会漏掉所有已选中的按钮。
     ⚠️ 只能看开标签：大类按钮里嵌着 `<i>` / `<span>`，用 `<button…>文案</button>` 那种写法
     一个都匹配不上。 */
  const btnAttrs = (html, cls) => [...html.matchAll(/<button([^>]*)>/g)]
    .map((m) => m[1])
    .filter((a) => new RegExp(`class="[^"]*\\b${cls}\\b`).test(a));
  const isOff = (a) => /\bdisabled\b/.test(a);
  /* 类型按钮的文案是纯文本 → 可以连文案一起取出来（判「哪几类还能点」用得上） */
  const typeBtns = (html) => [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)]
    .filter((m) => /class="[^"]*\bttype\b/.test(m[1]))
    .map((m) => ({ off: isOff(m[1]), label: m[2] }));
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

  /* 「只看进店」与卡池类型**正交、可叠加**（2026-10-03 改；以前是「勾了就禁用 + 清空」）：
     进店记录只落在常驻标准 / 常驻中坚这两类池里 → 这两类保持可选，不可能有进店记录的类型置灰；
     已选的类型被保留（只剪掉那些置灰的，留着它们等于画空图）。 */
  const upShop = await renderRoute('/up-history', (s) => {
    s.setUpTypes(['double', 'classic']);
    s.setUpShopOnly(true);
  });
  check('只看进店：已选类型被保留（这两类本来就有进店记录）',
    upShop.store.upTypes.join(','), 'double,classic');
  const shopTypeBtns = typeBtns(upShop.html);
  const shopTypeOn = shopTypeBtns.filter((b) => !b.off).map((b) => b.label);
  check('只看进店：只有「有进店记录」的两类还能点，其余置灰',
    shopTypeBtns.length === 11 && shopTypeOn.length === 2
    && shopTypeOn.includes('常驻标准寻访') && shopTypeOn.includes('常驻中坚寻访'), true);
  check('只看进店：整个大类都没进店记录时大类按钮也禁用（只有限定寻访那一个）',
    btnAttrs(upShop.html, 'tcat').filter(isOff).length, 1);
  check('只看进店：标签同时报出两个条件',
    /只看进店 · 已选 2 种/.test(upShop.html), true);
  check('只看进店：命中数变为 六星 N 位（N = upHistory 六星行数）',
    new RegExp(`六星 ${upShop.store.upHistory.six.length} 位`).test(upShop.html), true);

  /* 叠加起来真的生效：只勾进店 + 只留「常驻标准寻访」→ 每个标记必须同时满足两个条件 */
  const upShopStd = await renderRoute('/up-history', (s) => {
    s.setUpShopOnly(true);
    s.setUpTypes(['double']);
  });
  check('只看进店 + 只选常驻标准：每个标记都同时满足 isShop 与 type === double',
    upShopStd.store.upHistory.all.length > 0
    && upShopStd.store.upHistory.all.every((r) => r.marks.every((m) => m.isShop && m.type === 'double')),
    true);
  check('只看进店 + 只选常驻标准：行数不多于只勾进店',
    upShopStd.store.upHistory.all.length <= upShop.store.upHistory.all.length, true);

  const upTypes = await renderRoute('/up-history', (s) => {
    s.setUpShopOnly(true);
    s.setUpShopOnly(false);
    s.setUpTypes(['double', 'classic']);
  });
  check('取消只看进店后类型按钮全部恢复可用',
    btnAttrs(upTypes.html, 'ttype').every((a) => !isOff(a)), true);

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
  check('切到五星：卡片头统计（五星 113 位 · …）', /五星 113 位 ·/.test(plain(upFive.html)), true);
  check('切到五星：五星行数 113', upFive.store.upHistory.five.length, 113);
  check('切到五星：仍有两个图表容器', count(upFive.html, /class="echart"/g), 2);

  /* ---------------- 时间轴「真的能画出来」吗 ----------------
     SSR 渲染页面时 echarts 不会初始化，DOM 断言看不出「图是空的」这类问题
     （曾因为 custom 系列的 data 没带 x 值，整个图画不出来）。
     所以这里直接拿 option 跑一次 echarts 的 **SVG SSR**，检查产出的图形。 */
  const { buildUpTimeline, minInnerWidth, monthLabel, TL } = await vite.ssrLoadModule('/src/lib/upTimeline.js');
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
  /* ---------------- 选中标记的「黑色外发光」+ 首字层级 ----------------
     需求（用户 2026-10-03）：UP 历史一览里被选中（悬停 / 点了弹浮窗）的那个标记，
     背后要有**黑色外发光**；并且**简洁模式下首字不能消失**。

     ⚠️ 这两件事都栽在 zrender 的 **hover layer 分流**上，所以断言要守住两个不变量：
       · 元素太多时（本图 4500 个 displayable > echarts 默认 `hoverLayerThreshold: 3000`）
         zrender 会另开一张画布画 emphasis 元素 → 元素自身 `style` 不变、发光被搬到别的画布，
         还会**盖住首字**。所以必须把阈值设成 Infinity（单画布 = 按 children 顺序画）。
       · 发光只能是**环**（`fill:'none'`），不能是实心圆 —— 实心黑圆在图片模式会把半透明
         头像压黑（没有浅色圆底挡着）。 */
  check('时间轴：关掉 zrender 的 hover layer（否则发光被搬到另一张画布、还会盖住首字）',
    built6.bodyOption.hoverLayerThreshold, Infinity);

  /* 直接调 renderItem，检查手绘出来的 children 结构（SSR 渲染不到未选中的发光：
     它平时 `opacity:0`，zrender 的 shouldBePainted 会直接跳过不画） */
  const markSeries = built6.bodyOption.series[1];
  check('时间轴：标记系列是 custom（手绘 children）', markSeries.type, 'custom');
  const fakeApi = (cx, cy) => ({ value: (i) => [0, i], coord: () => [cx, cy] });
  const fakeParams = { coordSys: { x: 0, width: 4000 } };
  const item0 = markSeries.renderItem({ ...fakeParams, dataIndex: 0 }, fakeApi(100, 50));
  check('时间轴：标记是一个 group（外面再套状态就无效了）', item0.type, 'group');
  const first = item0.children[0];
  check('时间轴：标记**第一个**子元素就是外发光（在最底下 → 只在背后晕开）',
    first.type, 'circle');
  check('时间轴：外发光画成环而不是实心圆（实心黑圆会把图片模式的半透明头像压黑）',
    first.style.fill, 'none');
  check('时间轴：外发光用纯黑描边', first.style.stroke, '#000');
  check('时间轴：外发光有模糊半径（否则只是硬边黑箍，不是「发光」）',
    first.style.shadowBlur > 0, true);
  check('时间轴：外发光平时完全透明（未选中看不见）', first.style.opacity, 0);
  check('时间轴：外发光只在 emphasis 状态亮起来（这就是「被选中」的唯一反馈）',
    first.emphasis.style.opacity > 0, true);
  check('时间轴：外发光在 emphasis 里把 stroke / fill 写死（否则会被 echarts 提亮改色）',
    first.emphasis.style.stroke === '#000' && first.emphasis.style.fill === 'none', true);
  /* 环的内缘落在标记圆周上 → 环不会压到里面的头像 / 首字，只往外晕 */
  check('时间轴：外发光环的内缘正好贴在标记圆周上（不往里吃掉头像 / 首字）',
    first.shape.r - first.style.lineWidth / 2, TL.mark / 2);
  /* 首字必须是**最后一个**画的：外发光、大类色圆环、进店点 / 中坚甄选菱形都在它前面，
     所以谁都盖不住它（用户报的「简洁模式字消失」就是这么修掉的）。 */
  const last = item0.children[item0.children.length - 1];
  check('时间轴：简洁模式的首字是**最后**一个子元素（保证不被任何标记盖住）',
    last.type === 'text' && typeof last.style.text === 'string' && last.style.text.length === 1, true);
  check('时间轴：首字之外没有别的 text（name 只在 DOM 列里）',
    item0.children.filter((c) => c.type === 'text').length, 1);
  const itemImg = builtImg.bodyOption.series[1]
    .renderItem({ ...fakeParams, dataIndex: 0 }, fakeApi(100, 50));
  check('时间轴：图片模式也有外发光（同样在最底下）',
    itemImg.children[0].style.fill === 'none' && itemImg.children[0].style.shadowBlur > 0, true);
  check('时间轴：图片模式没有首字 text（里面是头像图片）',
    itemImg.children.filter((c) => c.type === 'text').length, 0);

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
  check(`资源仓库 ../akGachaResource 存在，且头像齐全（${OP_N} 张）`, avCount, OP_N);
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
  /* 数据 URL 的缓存版本号（原因见上面那组「数据缓存」断言） */
  check('资源模块：有版本号的存取口（模块级 dataVersion + setDataVersion）',
    /let dataVersion = ''/.test(resSrc) && /export function setDataVersion\(/.test(resSrc), true);
  check('资源模块：dataUrl 在版本号非空时追加 `?v=`（版本一变 URL 就变 → 绕开浏览器 7 天缓存）',
    /\?v=\$\{dataVersion\}/.test(resSrc), true);
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
  /* ⚠️ 2026-10-12 起卡池的 `upOperators` **自带 charId**（以前没有）；
     但 OpTag 仍用干员名回查 store 的完整对象（补 rarity 等），名字走 `lib/opFields.js`
     的 `opName()` —— 两种形状（scName / scCharName）都能取到。 */
  check('卡池列表 OpTag：用干员名回查 store 的完整干员对象（名字经 opName 归一）',
    /import \{ opName \} from '\.\.\/lib\/opFields\.js'/.test(opTagSrc)
    && /site\.operators\[name\.value\]/.test(opTagSrc), true);
  const fupViewSrc = fs.readFileSync(path.join(ROOT, 'src/views/FirstUpView.vue'), 'utf8');
  /* echarts 的 symbol:'image://…' 只是贴图、**不能裁剪**，所以图片模式改用手绘 + clipPath */
  check('进店间隔：图片模式用 custom 手绘 + clipPath 裁圆（不是 symbol:image://）',
    /type: 'custom'/.test(fupViewSrc) && /clipPath/.test(fupViewSrc)
    && !/symbol: `image:\/\//.test(fupViewSrc), true);

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

  /* ---------------- 统计表冻结前两列 ----------------
     冻结列的宽度有**三处**必须一致，少改一处就会错位：
     ① StatTable.vue 的 `<colgroup>`（定宽的真源）、② main.css 里 th/td:nth-child(n) 的
     width/min/max、③ 第 2 列的 `left`（必须恒等于第 1 列宽度）。所以这里从
     colgroup 抽出数值，再拿去和 CSS 对账，而不是各自硬编码。 */
  const statSrc = fs.readFileSync(path.join(ROOT, 'src/components/StatTable.vue'), 'utf8');
  const colWidths = Array.from(statSrc.matchAll(/<col style="width: (\d+)px"/g)).map((m) => Number(m[1]));
  const [colDate, colName] = colWidths;
  const cssNum = (re) => { const m = cssAll.match(re); return m ? Number(m[1]) : null; };
  const cssDateW = cssNum(/stat-tbl tbody td:nth-child\(1\)\{[\s\S]{0,60}?width:(\d+)px/);
  const cssNameW = cssNum(/stat-tbl tbody td:nth-child\(2\)\{[\s\S]{0,60}?width:(\d+)px/);
  const cssLeft = cssNum(/stat-tbl tbody td:nth-child\(2\)[\s\S]{0,140}?left:(\d+)px/);
  check('统计表：前两列定宽（sticky 的 left 偏移必须等于第 1 列宽度）',
    /<colgroup>/.test(statSrc) && colWidths.length === 2, true);
  check('统计表：冻结列宽度三处一致（colgroup / CSS 定宽 / 第 2 列 left 偏移）',
    [colDate, colName, cssDateW, cssNameW, cssLeft].every((v) => typeof v === 'number' && v > 0)
    && colDate === cssDateW && colName === cssNameW && cssLeft === colDate, true);
  /* 列宽的设计常量（不随数据变）：
     · 干员列 = **84px**（内边距 12px + 内容区 72px ≈ 5.5 个汉字）。
       ⚠️ **2026-10-16 由 103px 收到 84px** —— 103px 是按「7 个汉字」定的（为最长名
       `凯尔希·思衡托` 留位），但实测 2 字的名字占了 123/232 位；现在超字数的名字改用
       **自适应字号**（`lib/opNameFit.js`：13 → 11 → 10px），不再靠列宽兜；
     · 实装时间列 = 10 位日期 66px + 12px + **6px 余量** = **84px**。
       ⚠️ **2026-10-16 由 78px 加到 84px**：78px 是「零余量」（内容区恰好 66px），
       Windows 上够、手机字体下（PingFang / Roboto 的数字与连字符更宽）日期会溢出 1~3px，
       被右边 sticky 的「干员」列（`background:inherit`，不透明）盖住 ——
       这正是用户报的「实装时间显示不全」。加 6px（≈9%）余量后跨平台稳妥。 */
  check('统计表：干员列 84px、实装时间列 84px（真源 = OP_NAME_COL_W），都含余量',
    colName === OP_NAME_COL_W && colDate === 84, true);
  check('统计表：冻结「实装时间」「干员」两列（CSS sticky + 第 2 列 left 跟着第 1 列走）',
    /stat-tbl thead tr:first-child th:nth-child\(-n\+2\),[\s\S]{0,80}tbody td:nth-child\(-n\+2\)\{position:sticky\}/.test(cssAll)
    && cssLeft === colDate, true);
  /* ⚠️ 坑（2026-10-03）：统计表是**两行表头**，第二行的第 1、2 个 th 是「出率提升」组的
     「结束时间 / 距今天数」。定宽 / sticky 选择器若只写 `th:nth-child(1)` 而不限定
     `tr:first-child`，这两列会被误钉成前两列的宽度 → 同一张表里「出率提升」与
     「商店兑换」的同名子列宽度就不一样（曾出现 100/116 vs 78/74）。
     排查手法：量 `getBoundingClientRect().width`，**与前两列的钉死宽度撞号**就是它。 */
  check('统计表：前两列定宽只作用于表头第一行（不误伤第二行的子表头）',
    !/stat-tbl (?:th|td):nth-child\(/.test(cssAll)
    && /stat-tbl thead tr:first-child th:nth-child\(1\),[\s\S]{0,80}tbody td:nth-child\(1\)\{/.test(cssAll), true);
  check('统计表：冻结列用 background:inherit 保证不透明（依赖 tbody tr 有背景色）',
    /stat-tbl tbody tr\{background:#fff\}/.test(cssAll), true);

  /* ---------------- 首次UP间隔 · 表格版：冻结前两列（2026-10-16 用户要求） ----------------
     与统计表同一套手法、同样的「三处一致」约束：FirstUpTableView.vue 的 `<colgroup>` 是真源，
     main.css 的 width/min/max 与第 2 列 `left` 跟着它走。 */
  const fupCols = Array.from(fupTableSrc.matchAll(/<col style="width: (\d+)px"/g))
    .map((m) => Number(m[1]));
  const fupDateW = cssNum(/fup-tbl tbody td:nth-child\(1\)\{[\s\S]{0,70}?width:(\d+)px/);
  const fupLeft = cssNum(/fup-tbl tbody td:nth-child\(2\)\{[\s\S]{0,40}?left:(\d+)px/);
  check('表格版：前两列冻结（colgroup 定宽 + sticky + 第 2 列 left 跟着第 1 列走）',
    fupCols.length === 2 && fupCols[0] === 84 && fupCols[1] === OP_NAME_COL_W
    && fupDateW === fupCols[0] && fupLeft === fupCols[0]
    && /fup-tbl tbody td:nth-child\(-n\+2\)\{position:sticky;z-index:2;background:inherit\}/
      .test(cssAll), true);
  /* ⚠️ 表头那两格的 z-index 必须**显式**抬到 8，且选择器写到 `.floating` + `tr:first-child`：
     全局 `table.grid.floating thead tr:first-child th{z-index:6}` 的特异性是 (0,3,4)，
     只写 `thead th:nth-child(-n+2)`（(0,3,3)）会被它压过 → 横滚时「干员」表头被后面的
     表头列盖住、当场消失。统计表栽过同一个坑。 */
  check('表格版：表头冻结列 z-index 显式抬到 8（压过表头其余列）',
    /fup-tbl\.floating thead tr:first-child th:nth-child\(-n\+2\)\{z-index:8\}/.test(cssAll), true);
  /* 日期列与统计表同一个值 —— 两表并排看时列宽对齐，也让「零余量溢出」的坑不会在这边复发 */
  check('表格版：日期列定宽与统计表一致（84px，含余量）', fupCols[0] === colDate, true);

  /* ---------------- 干员名的自适应字号（2026-10-16 用户要求） ----------------
     干员列收窄（103 → 84px）后，**超字数的名字降字号塞进去**，而不是截断 / 撑换行 /
     溢出到邻列。口径与算法收口在 `lib/opNameFit.js`（纯函数）→ 这里直接真跑它。 */
  check('干员名宽度：半角字符按半格算（`Mon3tr` 不该被当成 6 个汉字那么宽）',
    [opNameWidth('Mon3tr'), opNameWidth('凯尔希·思衡托'), opNameWidth('陈'), opNameWidth('')],
    [3, 6.5, 1, 0]);
  check('干员名字号：常见长度保持常规字号，超长才逐档降，且不低于下限',
    [opNameFontSize('陈'), opNameFontSize('德·托莱多'), opNameFontSize('凯尔希·思衡托')],
    [OP_NAME_MAX_FS, OP_NAME_MAX_FS, OP_NAME_MIN_FS]);
  /* ⚠️⚠️ 核心保证：拿**全部真实干员名**验算「一个都不会溢出内容区」——
     溢出的小尾巴会被右边相邻列的不透明背景盖住，等于用户看到的「名字显示不全」
     （2026-10-16 的「实装时间」列就是这么出事的，所以这条必须守死）。 */
  const allOpNames = Object.values(stats.store.operators).map((o) => o.scName).filter(Boolean);
  const nameUsable = OP_NAME_COL_W - OP_NAME_PAD;
  const nameOverflow = allOpNames
    .filter((n) => opNameWidth(n) * opNameFontSize(n) > nameUsable);
  check(`干员名字号：全部 ${allOpNames.length} 位真实干员名都装得下（不会溢出到邻列）`,
    nameOverflow.length, 0);
  check('干员名自适应字号：两个表格页都走 opNameStyle（不是写死字号）',
    /:style="opNameStyle\(r\.name\)"/.test(statSrc)
    && /:style="opNameStyle\(r\.name\)"/.test(fupTableSrc), true);
  /* ⚠️⚠️ 冻结列走 `background:inherit`，**前提是 `<tr>` 自己有背景色** ——
     全局只给了 `tbody tr:nth-child(even)`，奇数行没有 → inherit 拿到 transparent →
     横滚时后面的内容透出来叠在冻结列上（**奇数行重叠、偶数行完好**，辨识度很高）。
     统计表早有这两条，2026-10-16 给表格版加冻结列时漏抄，用户当场报了「文本重叠」。 */
  check('表格版：tbody tr 有显式背景色（冻结列 inherit 不透明的前提，否则奇数行重叠）',
    /fup-tbl tbody tr\{background:#fff\}/.test(cssAll)
    && /fup-tbl tbody tr:nth-child\(even\)\{background:#fcfdff\}/.test(cssAll), true);
  /* ---------------- 图片模式：长方形蒙版头像（用户 2026-10-03 指定） ----------------
     ⚠️ 这条规则**统计页与首次UP间隔 · 表格版共用**（选择器两段）。2026-10-09 起几何从
     `img.avt-rect` 挪到了外层 `.avt-img`（头像改由 `<AvatarImg>` 渲染：外层定位 + 里面
     真图 `.avt-real` / 首字占位层 `.avt-fallback` 两层重合），所以正则改成取 `.avt-img{`。
     五条硬约束都在 CSS 里守着，改坏了会立刻红：
     ① 宽 = 高 × 2（具体像素是用户手调的，别写死 → 只守比例契约）；
     ② **四边渐隐**：两层 `mask-image`（左右一层 + 上下二层）靠 `mask-composite: intersect`
        取交集，让头像**自身的 alpha** 在四条边渐入 → 硬边消失，且与行底色无关
        （行有白 / #fcfdff / #f7fbff 三种底，所以不能叠同色遮罩）；
     ③ `object-fit:cover` → 96×96 方形素材**不拉伸**（按 2:1 裁上下；现在写在内层 img 上）；
     ④ **绝对定位** → 头像不参与行高计算（统计页行高由干员格的占位行框决定；表格版由数字列决定）；
     ⑤ 统计页配套的 `img-mode` 那句给干员格补回 1lh 的行框高度（否则行高会掉 8px）。 */
  const rectCss = (cssAll.match(/\.avt-img,\s*table[\s\S]*?\}/) || [''])[0].replace(/\s+/g, '');
  /* ⚠️ 尺寸是用户手调的（2026-10-03 由 52×26 改到 68×34），所以**不写死像素**，
     只断言「宽 = 高 × 2」这条比例契约 —— 以后他再调尺寸也不会被误判成回归。 */
  const rectW = Number((rectCss.match(/[;{]width:(\d+(?:\.\d+)?)px/) || [])[1]);
  const rectH = Number((rectCss.match(/[;{]height:(\d+(?:\.\d+)?)px/) || [])[1]);
  check('统计页图片模式：长方形蒙版 = 宽是高 2 倍（当前 68 × 34）',
    Number.isFinite(rectW) && rectH > 0 && rectW === rectH * 2, true);
  /* 蒙版：四边渐隐 = 左右 + 上下两层 linear-gradient 取交集。
     ⚠️ 同样**不写死像素**（用户连续微调过 5px → 左右 10px / 上下 2px）——只守结构契约：
     两层、方向分别是 `to right` / `to bottom`、四个停点是 `transparent 0 → #000 A → #000 calc(100% - A) → transparent 100%`
     （**两端偏移必须对称**）、且 `-webkit-` 值必须与标准值逐字符一致。
     mask 默认按 alpha 通道取用，`#000` 只是「不透明」的写法。 */
  const maskStd = (rectCss.match(/[^-]mask-image:([^;]+)/) || [])[1] || '';
  const maskWebkit = (rectCss.match(/-webkit-mask-image:([^;]+)/) || [])[1] || '';
  const grads = maskStd.match(/linear-gradient\([^()]*(?:\([^()]*\)[^()]*)*\)/g) || [];
  const parseGrad = (g) => { const [dir, ...stops] = g.slice('linear-gradient('.length, -1).split(','); return { dir, stops }; };
  /* 渐变里只允许出现「四停点、两端 transparent、不透明段左右对称」这一种形状，返回单侧偏移 */
  const fadeOffset = (g) => {
    if (!g || g.stops.length !== 4) return null;
    const [a, b, c, d] = g.stops;
    const m1 = b.match(/^#000(\d+(?:\.\d+)?)px$/);
    const m2 = c.match(/^#000calc\(100%-(\d+(?:\.\d+)?)px\)$/);
    return (a === 'transparent0' && d === 'transparent100%' && m1 && m2 && m1[1] === m2[1])
      ? Number(m1[1]) : null;
  };
  const gx = grads[0] ? parseGrad(grads[0]) : null;
  const gy = grads[1] ? parseGrad(grads[1]) : null;
  check('统计页图片模式：头像四边渐隐（左右 + 上下两层渐变，两端透明且偏移左右对称）',
    grads.length === 2 && gx && gy && gx.dir === 'toright' && gy.dir === 'tobottom'
    && fadeOffset(gx) > 0 && fadeOffset(gy) > 0, true);
  check('统计页图片模式：两层渐变用 mask-composite 取交集（兼容写法 source-in）+ 两前缀蒙版同值',
    maskStd !== '' && maskStd === maskWebkit
    && /mask-composite:intersect/.test(rectCss)
    && /-webkit-mask-composite:source-in/.test(rectCss), true);
  const rectImgCss = (cssAll.match(/\.avt-img img\{[\s\S]*?\}/) || [''])[0].replace(/\s+/g, '');
  check('统计页图片模式：头像不被拉伸（object-fit:cover）+ 绝对定位（不影响行高）',
    /object-fit:cover/.test(rectImgCss) && /position:absolute/.test(rectCss), true);
  check('统计页图片模式：行高由「两表统一」的 height:35px 钉死（占位行框已随行高统一删除）',
    /stat-tbl tbody td,\s*table\.grid\.fup-tbl tbody td\{\s*padding-top:0;padding-bottom:0;height:35px;\s*\}/.test(cssAll), true);
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
    check('国际服：卡池行数 = metadata.en.bannerCount + 中坚条数',
      count(enHome.html.slice(enHome.html.indexOf('<tbody>'), enHome.html.indexOf('</tbody>')), /<tr[\s>]/g),
      EN.bannerCount + claCount('en'));
    /* ⚠️ 国际服卡池的 `name` 现在也是**国服中文名**（英文名挪到 `enName`、本站暂不展示），
       所以这里不能再断言「渲染出英文卡池名」。 */
    check('国际服：卡池名已是国服中文名（只有 scName，`name` 已删）',
      enHome.store.banners.every((b) => !!b.scName && !('name' in b)), true);
    check('国际服：卡池列表渲染出卡池名',
      enHome.store.banners.slice(0, 8).every((b) => enHome.html.includes(b.scName)), true);
    check('国际服：英文名仍在数据里（enName 非空的都是纯 ASCII）',
      enHome.store.banners.filter((b) => b.enName).every((b) => /^[\x20-\x7e]+$/.test(b.enName)), true);

    const enStats = await renderRoute('/operators', (s) => s.setServer('en'));
    check('国际服：统计页四张表', count(enStats.html, /class="grid floating stat-tbl"/g), 4);
    check('国际服：统计页可见卡池数 = 开始日不晚于当天的卡池数',
      new RegExp(`可见卡池 ${visibleOf(enStats.store)} 个`).test(enStats.html), true);

    const enUp = await renderRoute('/up-history', (s) => s.setServer('en'));
    check('国际服：UP 历史页有画布容器', count(enUp.html, /class="tl-scroll"/g), 1);

    const enFup = await renderRoute('/first-up', (s) => s.setServer('en'));
    check('国际服：首次UP间隔页两个刻度条 + 两个滚动区',
      count(enFup.html, /ybar-l/g) + count(enFup.html, /chart-scroll/g), 4);
  }

  /* ---------------- 左栏：**只显示当前服务器**的「数据更新日」（纯展示） ----------------
     用户 2026-10-06 定：不再三服全列 —— 只列**当前服**那一行，中坚**单起一行**
     （它来源不同、口径不同：卡池来自 PRTS / wiki.gg / 金山，中坚来自官方解包）。
     国服 = generatedAt、国际服 = enGeneratedAt、繁中服 = tcGeneratedAt。
     ⚠️ 参考日期**不取**这几个日期，它一律是打开页面的当天。 */
  const UPD = {
    sc: META.generatedAt || '—',
    en: META.enGeneratedAt || '—',
    tc: META.tcGeneratedAt || '—',
  };
  const CLAD = {
    sc: banners.store.meta.cla?.sc?.generatedAt || '—',
    en: banners.store.meta.cla?.en?.generatedAt || '—',
    tc: banners.store.meta.cla?.tc?.generatedAt || '—',
  };
  /* 这一页是**默认服（国服）**的渲染结果 */
  check('左栏：只显示当前服的「数据更新日」= metadata.generatedAt',
    bh.includes(`国服数据更新 <b>${UPD.sc}</b>`), true);
  check('左栏：中坚**单起一行**（不再缩在括号里）',
    bh.includes(`中坚数据更新 <b>${CLAD.sc}</b>`) && !/（中坚 <b>/.test(bh), true);
  check('左栏：不再列出**其它服**的更新日',
    !bh.includes('国际服数据更新') && !bh.includes('繁中服数据更新'), true);
  /* 切服后这两行要跟着换（否则「只显示当前服」就退化成了「只显示国服」） */
  const enLeft = await renderRoute('/', (s) => s.setServer('en'));
  check('左栏：切到国际服后，那两行跟着变成国际服的',
    enLeft.html.includes(`国际服数据更新 <b>${UPD.en}</b>`)
    && enLeft.html.includes(`中坚数据更新 <b>${CLAD.en}</b>`)
    && !enLeft.html.includes('国服数据更新'), true);

  /* ---------------- 繁中服：切服务器后各页面要能正常渲染 ----------------
     数据来自本地人工表格（fetch-data-tc.mjs），期望值同样全部从 metadata 派生。 */
  const TC = banners.store.meta.servers.find((x) => x.id === 'tc');
  check('繁中服：metadata 里已启用（available）', TC?.available, true);
  if (TC?.available) {
    const tcHome = await renderRoute('/', (s) => s.setServer('tc'));
    const tcNames = tcHome.store.banners.map((b) => b.scName);
    check('繁中服：当前服务器切到 tc', tcHome.store.server, 'tc');
    /* ⚠️ 繁中服有 2 个「已公布但还没开始」的池子（最新到 10-22）—— 卡池列表的结束日期默认取
       数据上界，所以它们照常显示、行数 = bannerCount；只有**统计页**按参考日期过滤。 */
    check('繁中服：卡池行数 = metadata.tc.bannerCount + 中坚条数',
      count(tcHome.html.slice(tcHome.html.indexOf('<tbody>'), tcHome.html.indexOf('</tbody>')), /<tr[\s>]/g),
      TC.bannerCount + claCount('tc'));
    check('繁中服：序号类卡池名（常驻标准寻访 / 常驻中坚寻访 / 中坚甄选 / 联合行动…）',
      tcNames.some((n) => /^常驻标准寻访\d+$/.test(n))
      && tcNames.some((n) => /^常驻中坚寻访\d+$/.test(n))
      && tcNames.some((n) => /^中坚甄选\d+$/.test(n))
      && tcNames.some((n) => /^联合行动\d+$/.test(n)), true);
    check('繁中服：限定 / 单六 的池名取自国服（「复刻」也带过来）',
      tcNames.some((n) => /复刻|返场/.test(n)), true);
    check('繁中服：左栏署名是「自建卡池记录表」且不带外链',
      tcHome.html.includes('自建卡池记录表') && !/自建卡池记录表<\/a>/.test(tcHome.html), true);

    const tcStats = await renderRoute('/operators', (s) => s.setServer('tc'));
    check('繁中服：统计页四张表', count(tcStats.html, /class="grid floating stat-tbl"/g), 4);
    /* 繁中服表格里有 2 个「已公布但还没开始」的池子（最新到 10-22），
       所以可见卡池数会比 bannerCount 小 —— 按当天过滤后比。 */
    check('繁中服：统计页可见卡池数 = 开始日不晚于当天的卡池数',
      new RegExp(`可见卡池 ${visibleOf(tcStats.store)} 个`).test(tcStats.html), true);

    const tcUp = await renderRoute('/up-history', (s) => s.setServer('tc'));
    check('繁中服：UP 历史页有画布容器', count(tcUp.html, /class="tl-scroll"/g), 1);

    const tcFup = await renderRoute('/first-up', (s) => s.setServer('tc'));
    check('繁中服：首次UP间隔页两个刻度条 + 两个滚动区',
      count(tcFup.html, /ybar-l/g) + count(tcFup.html, /chart-scroll/g), 4);
  }

  /* ---------------- 自定义卡池弹窗（单独 SSR 一遍） ----------------
     弹窗在页面里由 `v-if` 控制、**默认不渲染**（而且自设数据在浏览器本地、测试环境恒为空），
     所以上面五个页面的核对覆盖不到它。这里把它单独渲染出来：既验证模板本身能跑，
     也验证「已生效 / 已忽略」两段的划分（`myActiveEntries` 只含去重后活下来的那些）。 */
  {
    const { default: Dialog } = await vite.ssrLoadModule('/src/components/CustomBannerDialog.vue');
    const app = createSSRApp(Dialog);
    const pinia = createPinia();
    app.use(pinia);
    const store = useSiteStore(pinia);
    await store.load();
    /* ⚠️ 夹具用 **v2 结构**（2026-10-12 起）：卡池名是 `scName`、干员列表是对象数组 */
    const alive = {
      uid: 1, server: 'sc', scName: '', type: 'double',
      startDate: '2099-01-07', star6: [{ scCharName: '甲' }, { scCharName: '乙' }],
      star5: [{ scCharName: '丙' }], shop: [],
    };
    const eaten = {
      uid: 2, server: 'sc', scName: '被吃掉的', type: 'single',
      startDate: '2099-02-01', star6: [{ scCharName: '丁' }], star5: [], shop: [],
    };
    /* 直接按形状塞进去（不必真去写本地存储）—— 这三个字段正是 loadData / _syncCustom 的产物 */
    store.customEntries = [alive, eaten];
    store.customByServer = {
      sc: [{
        id: '2099-01-07_double_custom_0001', scName: '自定义_常驻标准寻访0107', type: 'double',
        startDate: '2099-01-07', endDate: '2099-01-21', upOperators: [], custom: true,
      }],
    };
    store.customActiveUids = { sc: [1] };
    store.customDropped = [
      { entry: eaten, banner: {}, hit: { id: 'w', scName: '某个已公布的池' }, gap: 2, server: 'sc' },
    ];
    /* 加载时**已被自动删除**的那段也要能渲出来（说一声「为什么不见了」） */
    store.customAutoRemoved = [
      { entry: { ...eaten, uid: 3 }, banner: {}, hit: { id: 'w2', scName: '已被公布的那个池' }, gap: 5, server: 'sc' },
    ];
    const html = await renderToString(app);

    check('自定义卡池弹窗：六个表单字段都在（**没有结束日期**，它是派生值）',
      ['寻访名字', '寻访类型', '开始时间', '六星', '五星', '进店'].every((k) => html.includes(k)),
      true);
    check('自定义卡池弹窗：三个干员多选（六星 / 五星 / 进店）都在',
      count(html, /class="oppick"/g), 3);
    check('自定义卡池弹窗：结束日期**没有输入框**，只在开始时间下写一行小字',
      count(html, /readonly/g) === 0 && /结束时间将设为/.test(html),
      true);
    check('自定义卡池弹窗：不带服务器选择（跟随当前浏览的服）',
      html.includes('归属服务器跟随当前浏览的服'), true);
    check('自定义卡池弹窗：「已生效」只数去重后活下来的（1 个）',
      html.includes('已生效（1 个）'), true);
    check('自定义卡池弹窗：「已忽略」写明撞上了谁 + 差几天',
      html.includes('已忽略') && html.includes('某个已公布的池') && html.includes('相差 2 天'), true);
    check('自定义卡池弹窗：「已自动删除」单列一段（告知「为什么不见了」）+ 提示下次会自动清理',
      html.includes('已自动删除（1 条') && html.includes('已被公布的那个池')
      && html.includes('下次打开页面会自动删除'), true);
    check('自定义卡池弹窗：底部是「编辑 JSON…」**按钮**（编辑框另开窗，不在主窗里）',
      count(html, /class="cbd-json/g) === 0
      && count(html, /type="file"/g) === 0
      && html.includes('编辑 JSON…'), true);
    check('自定义卡池弹窗：没开子窗时不渲染它（`showJson` 默认 false）',
      !/cbd-mask-top/.test(html), true);

    /* JSON 编辑框背后的 `replaceCustom` —— 顺手验语义：**整体覆盖**（不是追加），
       非法的逐条跳过而不是整批失败。⚠️ 放在最后：它会改 store，而 `html` 已经是快照。 */
    check('JSON 编辑框：坏 JSON → 不应用、报错（不抛）',
      store.replaceCustom('{oops').ok, false);
    const jsonRes = store.replaceCustom(JSON.stringify({
      version: 1,
      banners: [
        /* 合法：`double` 的**进店硬校验**是「恰好 1 六星 + 1 五星」→ 两边都得对上 */
        {
          server: 'sc', name: '', type: 'double', startDate: '2099-03-01',
          star6: ['玛恩纳'], star5: ['德克萨斯'], shop: ['玛恩纳', '德克萨斯'],
        },
        /* 非法：限定池不在白名单 6 个里 → 跳过这条，但不影响上一条 */
        {
          server: 'sc', name: '', type: 'limcel', startDate: '2099-03-01',
          star6: ['陈'], star5: [], shop: [],
        },
      ],
    }));
    check('JSON 编辑框：合法的应用、非法的跳过（覆盖而非追加）',
      jsonRes.ok && jsonRes.count === 1 && jsonRes.skipped.length === 1, true);
    check('JSON 编辑框：应用后 uid 重编为 1 起（免得框里带的 uid 撞车）',
      store.customEntries.length === 1 && store.customEntries[0].uid === 1, true);
    /* 说明里那两个「标 / 中」示例本身就在 HTML 里（弹窗的表单初始为空、候选要输入才出，
       所以**chip / 候选上的标记在这里渲不出来** → 见下面单独渲染 OpPicker 的那一段）。 */
    check('自定义卡池弹窗：说明里画出了「标 / 中」两个标记示例',
      count(html, /class="optag/g), 2);
  }

  /* ---------------- JSON 编辑**子窗**（也是单独 SSR 一遍） ----------------
     它在主弹窗里由 `showJson` 控制、默认不渲染，上面的核对覆盖不到。
     用户 2026-10-06 定：编辑框**别挤在主弹窗里**，点了按钮再弹一个窗。 */
  {
    const { default: JsonDlg } = await vite.ssrLoadModule('/src/components/CustomJsonDialog.vue');
    const app = createSSRApp(JsonDlg);
    const pinia = createPinia();
    app.use(pinia);
    const st = useSiteStore(pinia);
    await st.load();
    const html = await renderToString(app);

    check('JSON 子窗：大编辑框在、三个按钮（应用 / 放弃修改 / 关闭）都在',
      count(html, /class="cbd-json cbd-json-big"/g) === 1
      && html.includes('应用') && html.includes('放弃修改') && html.includes('关闭'), true);
    check('JSON 子窗：编辑框里预填了当前自设（`serialize` 的 `{ version, exportedAt, banners }`）',
      html.includes('version') && html.includes('exportedAt') && html.includes('banners'), true);
    check('JSON 子窗：叠在主弹窗**之上**（`.cbd-mask-top`，z-index 70 > 主弹窗 60）',
      /class="cbd-mask cbd-mask-top"/.test(html), true);
    check('JSON 子窗：讲清了「应用」是**整体覆盖**（不是追加）',
      /整体覆盖/.test(html), true);
  }

  /* ---------------- 干员多选的「标 / 中」标记 ----------------
     用户 2026-10-06 定：名字**前面**标一个字，表示该干员**此刻**属标准还是中坚寻访。
     弹窗那遍渲不出 chip（表单初始为空）→ 这里把 OpPicker 单独渲一遍，钉死
     「标记在名字**前面**」+「中 / 标 用不同类名」这两件事。 */
  {
    const { default: OpPicker } = await vite.ssrLoadModule('/src/components/OpPicker.vue');
    const app = createSSRApp(OpPicker, {
      modelValue: ['陈', '玛恩纳'],
      pool: ['陈', '玛恩纳'],
      tagOf: (n) => (n === '陈' ? '中' : '标'),
    });
    const html = await renderToString(app);
    check('干员多选：标记画在名字**前面**（不是后面）',
      /<em class="optag mid">中<\/em>陈/.test(html)
      && /<em class="optag std">标<\/em>玛恩纳/.test(html), true);
    check('干员多选：输入框外面包了 `.opbox`（浮层的定位基准）',
      count(html, /class="opbox"/g), 1);

    /* 候选列表必须是**浮层**（不占流）—— 否则打字时它会撑高容器、选完又缩回去，
       整个弹窗 / 抽屉跟着跳（2026-10-06 用户要求改掉）。
       ⚠️ SSR 渲不出（`q` 为空时 `v-if` 为假）→ 只能读 CSS 源码钉住这条契约。 */
    check('干员多选：候选列表是**绝对定位浮层**，且下方放不下时能向上弹',
      /\.opbox > \.opsug\{[^}]*position:absolute/.test(cssAll)
      && /\.opbox > \.opsug\.up\{[^}]*bottom:calc\(100% \+ 4px\)/.test(cssAll), true);
    check('干员多选：弹窗与右栏筛选**两处**都改成了浮层',
      /class="opbox"/.test(fs.readFileSync(path.join(ROOT, 'src/components/OpPicker.vue'), 'utf8'))
      && /ref="opBoxEl" class="opbox"/.test(fs.readFileSync(path.join(ROOT, 'src/components/FilterDrawer.vue'), 'utf8')),
      true);
  }

  /* ---------------- 表格「复制」按钮：剪贴板格式（2026-10-11） ----------------
     用户要求：出率提升记录 + 首次UP间隔·表格版的**每个表格**加一个「复制」按钮，
     复制后可在 Excel 里粘贴为表格 → 走 TSV（单元格 Tab 分隔、行 CRLF）。
     按钮**个数**在上面按页面数过了；这里把**格式**真跑一遍钉死。
     ⚠️ 复制的数据是从视图数据算的（不读 DOM）—— 那种「读源码钉契约」的部分在下面几行。 */
  {
    const { toTSV } = await vite.ssrLoadModule('/src/lib/clipboard.js');
    const j = (s) => JSON.stringify(s);   // 直接打印原文会被 tab / CRLF 搅乱，转义后好看
    check('复制：行用 CRLF、单元格之间一个 Tab（Excel「粘贴为表格」就是这个格式）',
      j(toTSV([['a', 'b'], [1, 2]])), j('a\tb\r\n1\t2'));
    check('复制：单元格里的 Tab / 换行会被压成空格（否则粘出来整张表错位）',
      j(toTSV([['a\tb', 'c\nd']])), j('a b\tc d'));
    check('复制：null / undefined → 空串（不会变成字面的 "null"）',
      j(toTSV([[null, undefined, '—']])), j('\t\t—'));
    check('复制：空表 / 空行不抛异常', j(toTSV([])) + j(toTSV([[]])), j('') + j(''));

    const statSrc = fs.readFileSync(path.join(ROOT, 'src/views/StatsView.vue'), 'utf8');
    const fupTblSrc = fs.readFileSync(path.join(ROOT, 'src/views/FirstUpTableView.vue'), 'utf8');
    check('复制：按钮与数据同在视图层（标题行由视图渲染，数据也在视图算好）',
      /import \{ statCopyRows \} from '\.\.\/lib\/tableCopy\.js'/.test(statSrc)
      && /import \{ firstUpCopyRows \} from '\.\.\/lib\/tableCopy\.js'/.test(fupTblSrc), true);

    /* 拼表口径（`lib/tableCopy.js`）：**真跑一遍**，把表头与「显示口径」钉死 */
    const { statCopyRows, firstUpCopyRows } = await vite.ssrLoadModule('/src/lib/tableCopy.js');
    const REF = '2026-10-11';
    const ban = (startDate, endDate) => ({ startDate, endDate });
    const mid = {
      name: '甲', releaseDate: '2020-01-01',
      upAll: [ban('2026-09-01', '2026-09-15')],   // 已结束 → 天数 = 27
      upMid: [ban('2026-09-01', '2026-09-15')], upStd: [],
      shopAll: [ban('2026-10-01', '2026-10-20')], // 进行中 → 「进行中」
      shopMid: [ban('2026-10-01', '2026-10-20')], shopStd: [],
    };
    const midRows = statCopyRows([mid], { split: true, refDate: REF });
    check('复制：统计表（中坚）表头 = 两层表头并成一行（组名 + 列名）',
      j(midRows[0]), j(['实装时间', '干员',
        '出率提升 结束时间', '出率提升 距今天数', '出率提升 总次数', '出率提升 中坚次数', '出率提升 标准次数',
        '商店兑换 结束时间', '商店兑换 距今天数', '商店兑换 总次数', '商店兑换 中坚次数', '商店兑换 标准次数']));
    check('复制：统计表数据行照**显示口径**（已结束 → 天数；进行中 → 「进行中」）',
      j(midRows[1]), j(['2020-01-01', '甲', '2026-09-15', 27, 1, 1, 0, '2026-10-20', '进行中', 1, 1, 0]));
    check('复制：标准表只有 8 列（次数不拆成总/中坚/标准）',
      statCopyRows([mid], { refDate: REF })[0].length, 8);
    const blank = { name: '乙', releaseDate: null, upAll: [], upMid: [], upStd: [], shopAll: [], shopMid: [], shopStd: [] };
    check('复制：没有任何记录 → 实装时间 / 结束时间 / 天数都给 —、次数给 0',
      j(statCopyRows([blank], { refDate: REF })[1]), j(['—', '乙', '—', '—', 0, '—', '—', 0]));

    const fRows = firstUpCopyRows([{
      name: '丙', releaseDate: '2019-04-30', firstDate: '2019-04-30',
      firstBanner: '常驻标准寻访1', gap: null, sinceRelease: 0, count: 9,
    }], { word: '进店' });
    check('复制：表格版表头跟着统计模式换词，组内第一位 → 距上行 = —',
      j(fRows[0]) + '|' + j(fRows[1]), j(['实装日', '干员', '首次进店日', '所在卡池', '距上行', '距实装', '累计数'])
      + '|' + j(['2019-04-30', '丙', '2019-04-30', '常驻标准寻访1', '—', 0, 9]));
    check('复制：切换统计模式后表头跟着变（首次轮换日）',
      firstUpCopyRows([], { word: '轮换' })[0][2], '首次轮换日');
  }

  /* ---------------- 「中坚寻访只看中坚」（2026-10-14） ----------------
     用户要求：加一个选项，勾选后**中坚干员**只显示「中坚寻访里的上次 up 和进店」；
     若从未在中坚 UP 过，则从**迁入中坚寻访**那天起算距今天数。
     拍板的三条：结束时间显示 `—`、中坚 = 大类（含甄选、仍受另一个开关控制）、**次数列不变**。
     ⚠️ 这里**真跑** `viewEndInfo()` 钉行为；组件 / store 的接线只能读源码。
     天数用实测真值（老鲤：全口径 2026-01-29 → 259 天；迁入 2026-03-26 → 203 天）。 */
  {
    const j = (v) => JSON.stringify(v);
    const { viewEndInfo, statMetric } = await vite.ssrLoadModule('/src/lib/stats.js');
    const ban = (startDate, endDate) => ({ startDate, endDate });
    const REF = '2026-10-14';
    /* 典型：迁入中坚后**一次都没轮过** —— upAll 里只剩他还在标准寻访时的老记录 */
    const never = {
      everMid: true, classicDate: '2026-03-26',
      upAll: [ban('2026-01-15', '2026-01-29')], upMid: [], upStd: [ban('2026-01-15', '2026-01-29')],
      shopAll: [ban('2026-01-15', '2026-01-29')], shopMid: [], shopStd: [ban('2026-01-15', '2026-01-29')],
    };
    check('只看中坚：开关**关**时与以前一字不差（走 upAll）',
      j([viewEndInfo(never, 'up', REF, false).end, viewEndInfo(never, 'up', REF, false).days,
        viewEndInfo(never, 'up', REF, false).fromClassic]),
      j(['2026-01-29', 259, false]));
    check('只看中坚：开关**开** + 从未在中坚 UP → 结束时间 `—`、天数自**迁入中坚寻访**起算',
      j([viewEndInfo(never, 'up', REF, true).end, viewEndInfo(never, 'up', REF, true).days,
        viewEndInfo(never, 'up', REF, true).fromClassic]),
      j([null, 203, true]));
    check('只看中坚：商店兑换同一套口径（也自迁入日起算）',
      j([viewEndInfo(never, 'shop', REF, true).end, viewEndInfo(never, 'shop', REF, true).days]),
      j([null, 203]));
    /* 有中坚记录时：改看 upMid / shopMid（与「中坚次数」列同一个口径） */
    const hasMid = { ...never, upMid: [ban('2026-09-01', '2026-09-15')], shopMid: [] };
    check('只看中坚：有中坚记录 → 改按**中坚记录**算（不再是 upAll 的老日期）',
      j([viewEndInfo(hasMid, 'up', REF, true).end, viewEndInfo(hasMid, 'up', REF, true).days,
        viewEndInfo(hasMid, 'up', REF, true).fromClassic]),
      j(['2026-09-15', 30, false]));
    check('只看中坚：进店列各自独立（有中坚 UP、但没在中坚进过店 → 仍自迁入日起算）',
      j([viewEndInfo(hasMid, 'shop', REF, true).end, viewEndInfo(hasMid, 'shop', REF, true).days]),
      j([null, 203]));
    check('只看中坚：进行中的中坚池照常显示「进行中」（不是天数）',
      viewEndInfo({ ...never, upMid: [ban('2026-10-01', '2026-10-20')] }, 'up', REF, true).live, true);
    /* 非中坚干员 / 缺迁入日 / 迁入日在参考日之后 —— 三种边界 */
    check('只看中坚：**非中坚干员**不受影响（仍走 upAll）',
      j([viewEndInfo({ ...never, everMid: false }, 'up', REF, true).days,
        viewEndInfo({ ...never, everMid: false }, 'up', REF, true).fromClassic]),
      j([259, false]));
    check('只看中坚：缺「迁入中坚寻访」日 → 给无数据（显示 —），不做无基准的猜测',
      viewEndInfo({ ...never, classicDate: null }, 'up', REF, true).days, null);
    check('只看中坚：迁入日**晚于参考日期**（回看到迁入之前）→ 两者都显示 —',
      j([viewEndInfo({ ...never, classicDate: '2027-01-01' }, 'up', REF, true).days,
        viewEndInfo({ ...never, classicDate: '2027-01-01' }, 'up', REF, true).fromClassic]),
      j([null, false]));
    /* 排序必须与显示同口径，否则「按距今天数排」会和屏幕上的数字对不上 */
    check('只看中坚：排序跟着切口径（upDays 259 → 203、upEnd 有值 → 空值排最后）',
      j([statMetric(never, 'upDays', REF, true), statMetric(never, 'upEnd', REF, true),
        statMetric(never, 'upDays', REF, false)]),
      j([203, '0000', 259]));

    /* ---- 接线（读源码）---- */
    const statsLib = fs.readFileSync(path.join(ROOT, 'src/lib/stats.js'), 'utf8');
    const statTblSrc = fs.readFileSync(path.join(ROOT, 'src/components/StatTable.vue'), 'utf8');
    const storeSrc = fs.readFileSync(path.join(ROOT, 'src/stores/site.js'), 'utf8');
    const drawerSrc = fs.readFileSync(path.join(ROOT, 'src/components/FilterDrawer.vue'), 'utf8');
    const copySrc = fs.readFileSync(path.join(ROOT, 'src/lib/tableCopy.js'), 'utf8');
    const statsViewSrc = fs.readFileSync(path.join(ROOT, 'src/views/StatsView.vue'), 'utf8');
    check('只看中坚：computeStats 收 `classicDateOf` 并把迁入日挂到行上（`classicDate`）',
      /classicDateOf = \(\) => null/.test(statsLib) && /classicDate: classicDateOf\(op\)/.test(statsLib), true);
    check('只看中坚：表格用 `viewEndInfo`（不是裸 `endInfo`）算那两组列',
      /import \{ viewEndInfo \} from '\.\.\/lib\/stats\.js'/.test(statTblSrc)
      && !/import \{ endInfo \}/.test(statTblSrc)
      && /viewEndInfo\(r, 'up', refDate\.value, midOnly\.value\)/.test(statTblSrc), true);
    check('只看中坚：从未轮过的那些行挂了 tooltip（说清楚天数是自迁入日算的）',
      /fromClassic \? fromClassicTitle\(r\) : null/.test(statTblSrc)
      && /自迁入中坚寻访（\$\{r\.classicDate\}）起算/.test(statTblSrc), true);
    check('只看中坚：store 有 `statMidOnly` 开关 + `setStatMidOnly`，并把迁入日传给 computeStats',
      /statMidOnly: false/.test(storeSrc) && /setStatMidOnly\(on\)/.test(storeSrc)
      && /classicDateOf: this\.classicDateOf/.test(storeSrc), true);
    check('只看中坚：**排序**也吃到 `statMidOnly`（否则排序与显示会对不上）',
      /s\.statSort\[`\$\{rarity\}-\$\{everMid \? 'mid' : 'std'\}`\],\n\s+refDate,\n\s+s\.statMidOnly,/.test(storeSrc), true);
    check('只看中坚：右栏有那个复选框（挨着「中坚甄选计入出率提升」）',
      /中坚寻访只看中坚/.test(drawerSrc) && /site\.setStatMidOnly\(\$event\.target\.checked\)/.test(drawerSrc), true);
    check('只看中坚：**复制**出来的也用同一口径（tableCopy 走 viewEndInfo + 收 midOnly）',
      /viewEndInfo\(r, 'up', refDate, midOnly\)/.test(copySrc) && /midOnly = false/.test(copySrc)
      && /statCopyRows\(g\['6-mid'\], \{ split: true, refDate, midOnly, noStd \}\)/.test(statsViewSrc), true);
    check('只看中坚：**次数列不跟着变**（模板里仍读 upAll / upMid / upStd 三个长度）',
      /\{\{ r\.upAll\.length \}\}/.test(statTblSrc) && /\{\{ r\.upMid\.length \}\}/.test(statTblSrc), true);
  }

  /* ---------------- 自定义卡池：**加载时自动删除**被覆盖的自设 ----------------
     用户 2026-10-06 定：撞上已公布卡池的自设要**自动删掉**（别一直堆在「已忽略」里）。
     做法：给一个假的 `localStorage`，塞两条 —— 一条**必然撞车**（照抄某个真实已公布池的
     六星集合、把开始日挪 3 天）、一条不撞 —— 然后跑一次 `loadSiteData()`，
     看存储里是不是只剩不撞的那条、删掉的那条有没有出现在 `customAutoRemoved` 里。
     ⚠️ 这段会临时替换 `globalThis.localStorage`，所以**必须放在最后**（用完立刻还原）。 */
  {
    const { loadSiteData } = await vite.ssrLoadModule('/src/lib/loadData.js');
    const real = banners.store.publishedBanners.find(
      (b) => b.type === 'double' && b.upOperators?.some((o) => o.rarity === 6)
    );
    /* 照抄真实池的六星 / 五星 / 进店 —— 去重只比「六星集合相等 + 开始日相差 ≤15 天」，
       而**进店数量是硬校验**（`double` 必须恰好 1 六星 + 1 五星），所以三个都得对上 */
    const names = (r) => real.upOperators.filter((o) => o.rarity === r).map((o) => o.scCharName);
    const covered = {
      uid: 901, server: 'sc', name: '', type: 'double',
      startDate: shiftDays(real.startDate, 3),
      star6: names(6), star5: names(5),
      shop: real.upOperators.filter((o) => o.isShop).map((o) => o.scCharName),
    };
    const alive = {
      uid: 902, server: 'sc', name: '', type: 'double', startDate: '2099-05-01',
      star6: ['玛恩纳'], star5: ['德克萨斯'], shop: ['玛恩纳', '德克萨斯'],
    };
    const fake = {
      map: new Map(),
      getItem(k) { return this.map.has(k) ? this.map.get(k) : null; },
      setItem(k, v) { this.map.set(k, String(v)); },
      removeItem(k) { this.map.delete(k); },
    };
    const KEY = 'akgacha:custom-banners';
    const prevLS = globalThis.localStorage;
    globalThis.localStorage = fake;
    fake.setItem(KEY, JSON.stringify({ version: 1, banners: [covered, alive] }));
    const data = await loadSiteData();
    globalThis.localStorage = prevLS;

    check('自设卡池：加载时**自动删除**被正式公布覆盖的那条',
      data.customAutoRemoved.length === 1 && data.customAutoRemoved[0].entry.uid === 901, true);
    check('自设卡池：没被覆盖的那条留着（不是一刀切清空）',
      data.customEntries.length === 1 && data.customEntries[0].uid === 902, true);
    check('自设卡池：删除**写回了本地存储**（不是只在内存里剔除）',
      JSON.parse(fake.getItem(KEY)).banners.length === 1, true);
    check('自设卡池：返回时不再带 `customDropped`（加载时该删的都删了，那段只留给「刚添加就撞」）',
      data.customDropped === undefined, true);
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

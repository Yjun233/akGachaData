/**
 * 运行时加载静态 JSON（卡池 / 干员数据）。
 *
 * 数据的**真身在独立资源仓库** `../akGachaResource/data`（远程 github.com/Yjun233/akGachaResource），
 * 本仓库里没有副本。**dev 默认读本地**（`public/data`，指向资源仓库的目录联接）；
 * `VITE_RESOURCE=cdn` 才让 dev 走 CDN；**build 一律走 CDN**。切换逻辑见 `resource.js`。
 *   metadata.json          站点元信息 + 服务器列表
 *   operators.json         干员表（各服共用，靠 *ReleaseDate 区分实装日）
 *   skins_<server>.json    干员时装（**可选**）—— 国服来自 PRTS（含**复刻窗口**），
 *                          en / tw 来自官方解包（只有首发日，窗口 = 首发日 + 14 天）
 *   memoirs_<server>.json  干员密录（**可选**，三服都来自官方解包）
 *   modules_<server>.json  干员模组（**可选**，三服都来自官方解包）
 *   卡池类型 → 大类：见 `constants.js` 的 `BANNER_CATEGORIES`（不再用 JSON 数据文件）
 *   banners_<server>.json  各服卡池表（**不含中坚**）
 *   banners_cla_<server>.json  中坚系列（常驻中坚寻访 + 中坚甄选，**可选**）
 *                              —— 来自官方解包数据，单独一个文件，加载后合并进上面那份
 *   metadata.cla              中坚系列的元信息（按服 `{ generatedAt, count }`），左栏展示用
 *
 * 另外还读**浏览器本地自设**的自定义卡池（`lib/customBanners.js`，不是 JSON 文件）——
 * 与 **已公布的全量卡池**去重后按服拆好交给 store；「进不进统计/图表」由 store 的全局开关决定。
 * 口径见 `akGachaDocs/site/自定义卡池功能预研.md`。
 *
 * 卡池文件按服务器拆开：metadata.servers 里 available:true 的服务器才会被加载，
 * 缺文件时自动降级（标记不可用）而不是整站失败 —— **新增服务器时**产出
 * banners_<id>.json 并把 available 改成 true 即可，前端无需改动。
 */
import { dataUrl } from './resource.js';
import { BANNER_CATEGORIES } from './constants.js';
import { dedupe, loadEntries, saveEntries } from './customBanners.js';

async function getJSON(name) {
  const res = await fetch(dataUrl(name));
  if (!res.ok) throw new Error(`${name} 加载失败（HTTP ${res.status}）`);
  return res.json();
}

/** 尝试加载某服务器的卡池文件，失败返回 null */
async function getJSONOptional(name) {
  try {
    return await getJSON(name);
  } catch (err) {
    console.warn('[data]', err.message);
    return null;
  }
}

/**
 * 数据文件有**两种形态**，这里统一解一层，两种都能吃：
 *   - **裸数据**：`operators.json` / `banners_<server>.json` —— 顶层直接就是数据
 *   - **带元信息的包装**：`{ generatedAt, source, <key> }` —— extras 三个与中坚文件是这种
 * 之所以允许两种并存、而不是统一成一种：这几个裸数据的文件是**站点启动必读**，而站点
 * build 走 CDN、与数据仓库**分开部署** —— 改结构就得强制「站点先上线兼容版、再推数据」
 * 的发布顺序，风险不划算。详见 `akGachaDocs/resource/资源仓库说明.md`。
 */
function unwrap(json, key) {
  return json && typeof json === 'object' && json[key] !== undefined ? json[key] : json;
}

export async function loadSiteData() {
  /* ⚠️ 大类映射 `BANNER_CATEGORIES` 已从 `banner-categories.json` 移入 `constants.js`
     （各服共用、不随数据更新），这里不再额外发一个请求。 */
  const [meta, rawOperators] = await Promise.all([
    getJSON('metadata.json'),
    getJSON('operators.json'),
  ]);

  /* operators.json 以 charId 为键（如 char_4179_monstr），
     前端一律按干员名索引（卡池数据里的 upOperators 只有 name）。 */
  const operators = {};
  for (const op of Object.values(unwrap(rawOperators, 'operators') || {})) operators[op.name] = op;

  /* 皮肤 / 密录 / 模组（下称 extras）**按服分文件**（`skins_<srv>.json` 等），每份都**可选** ——
     线上 CDN 还没产出时不能整站失败，缺了只是 UP 历史页不显示对应标记。
     这里把一份文件索引成「按干员名查」的三张表：
       · `skins`            → 该干员的时装数组（判定要用它 `onShelf[]` 里那些窗口）
       · `memoirs`/`modules` → 该干员的**推出日期数组**（判定只要日期）
     密录一位可能有多批（`batches[].date`），模组一位可能有好几个（每条一个 `date`）。 */
  function indexExtras(rawSkins, rawMemoirs, rawModules) {
    const skins = {};
    for (const s of unwrap(rawSkins, 'skins') || []) {
      if (s?.char) (skins[s.char] ||= []).push(s);
    }
    const memoirs = {};
    for (const m of unwrap(rawMemoirs, 'memoirs') || []) {
      if (!m?.char) continue;
      const dates = (m.batches || []).map((b) => b.date).filter(Boolean);
      if (dates.length) (memoirs[m.char] ||= []).push(...dates);
    }
    const modules = {};
    for (const m of unwrap(rawModules, 'modules') || []) {
      if (m?.char && m.date) (modules[m.char] ||= []).push(m.date);
    }
    return { skins, memoirs, modules };
  }

  const declared = meta.servers || [];
  const bannersByServer = {};
  const servers = [];
  /** 每服的 extras 索引（皮肤 / 密录 / 模组）—— UP 历史页的三角标记用 */
  const extrasByServer = {};
  /** 中坚文件自带的元信息（仅作 `metadata.cla` 的兜底，见下） */
  const claFromFile = {};

  for (const s of declared) {
    if (!s.available) {
      servers.push({ ...s });
      continue;
    }
    let banners = await getJSONOptional(`banners_${s.id}.json`);
    if (!banners) {
      // 声明可用但文件缺失：降级为不可用，避免前端拿到空数据
      servers.push({ ...s, available: false, missing: true });
      continue;
    }
    banners = unwrap(banners, 'banners');
    /* 「常驻中坚寻访 + 中坚甄选」在**单独一个文件**里 —— 它们来自**官方解包数据**
       （`akGachaDocs/resource/官方解包数据（ArknightsGamedata）预研.md`），不再由
       PRTS / wiki.gg / 金山 那几个脚本产出（那三个源在这两块上会漏写 / 记错进店位）。
       ⚠️ 卡池 id 用的是同一套规则，所以**直接合并**即可；万一同 id 撞上，**以中坚文件为准**。
       ⚠️ 同样**缺失不报错**（线上 CDN 上还没有这个文件时不能整站失败）。 */
    const mid = await getJSONOptional(`banners_cla_${s.id}.json`);
    const midBanners = unwrap(mid, 'banners');
    if (midBanners) Object.assign(banners, midBanners);
    claFromFile[s.id] = {
      generatedAt: mid?.generatedAt ?? null,
      count: midBanners ? Object.keys(midBanners).length : null,
    };
    bannersByServer[s.id] = banners;
    /* extras 也**按服**读（`skins_en.json` / `memoirs_tc.json` …），三份都可选。 */
    const [rawSkins, rawMemoirs, rawModules] = await Promise.all([
      getJSONOptional(`skins_${s.id}.json`),
      getJSONOptional(`memoirs_${s.id}.json`),
      getJSONOptional(`modules_${s.id}.json`),
    ]);
    extrasByServer[s.id] = indexExtras(rawSkins, rawMemoirs, rawModules);
    servers.push({ ...s, available: true });
  }

  const available = servers.filter((s) => s.available);
  const defaultServer = available.some((s) => s.id === meta.defaultServer)
    ? meta.defaultServer
    : (available[0]?.id ?? meta.defaultServer);

  /* 中坚系列的元信息（左栏「中坚数据更新」展示用）：
     `metadata.cla` 是**权威镜像**（数据仓库产出时写进去的，见 `fetch-gamedata.mjs`）；
     万一线上 metadata 还是旧的、没有这个键，就退回用中坚文件自带的日期 ——
     少一个数字总比整块 `—` 好。 */
  const cla = { ...(meta.cla || {}) };
  for (const [id, v] of Object.entries(claFromFile)) {
    if (!cla[id]?.generatedAt) cla[id] = v;
  }

  /* ---- 自定义卡池（浏览器本地自设，**可选**）----
     ⚠️ 去重必须在**中坚合并之后**：中坚 2026-10-06 起在单独文件里，而本功能的白名单里
        恰好有 `classic` / `clafes` 两类 —— 只比主表的话，自设的中坚池**永远撞不上**
        已公布的中坚池，去重会静默失效（见预研 §3.2）。
     ⚠️ 撞上就**丢自定义**（优先级 `wiki > 自定义`）。

     ⚠️⚠️ **加载时会把撞车的自设从存储里真正删掉**（用户 2026-10-06 定：希望自动删除）——
        因为「撞上」意味着这个池子已经被**正式公布**，自设已经没有存在意义，留着只会堆在
        「已忽略」里当垃圾。删掉的记进 `customAutoRemoved`，弹窗里会提示一声。
        ⚠️ **只在加载时删**（= 新数据刚到），**不在用户刚添加时删** —— 用户点保存后
        得先看见「已忽略，撞了哪个池」，立刻静默删掉会让人以为没保存成功（见 store 的
        `_syncCustom`，那里只算不删）。
     ⚠️ 自设**不并进 `bannersByServer`** —— 「进不进统计 / 图表」由 store 的全局开关决定，
        这里只按服整理好交给 store 去拼。 */
  const stored = loadEntries();
  const customByServer = {};
  /** 每服**真正生效**的那些自设的 `uid`（去重后被吃掉的**不在**里面）—— 弹窗的「已生效」列表用 */
  const customActiveUids = {};
  /** 本次加载**自动删除**掉的自设（原始输入 + 撞上了谁 + 差几天），弹窗里提示用 */
  const customAutoRemoved = [];
  const covered = new Set();
  for (const s of available) {
    const mine = stored.filter((e) => e.server === s.id);
    const { kept, dropped } = dedupe(mine, toBannerList(bannersByServer[s.id]));
    customByServer[s.id] = kept.map((x) => x.banner);
    customActiveUids[s.id] = kept.map((x) => x.entry.uid);
    for (const d of dropped) {
      covered.add(d.entry.uid);
      customAutoRemoved.push({ ...d, server: s.id });
    }
  }
  const customEntries = stored.filter((e) => !covered.has(e.uid));
  if (customEntries.length !== stored.length) {
    saveEntries(customEntries);
    console.info(
      `[data] 已自动删除 ${stored.length - customEntries.length} 条自设卡池（对应卡池已被正式公布）`
    );
  }

  return {
    meta: { ...meta, servers, defaultServer, cla },
    operators,
    categories: BANNER_CATEGORIES,
    bannersByServer,
    extrasByServer,
    customEntries,
    customByServer,
    customActiveUids,
    customAutoRemoved,
  };
}

/** { id: 卡池 } → 带 id 的数组 */
export const toBannerList = (map) =>
  Object.keys(map || {}).map((id) => ({ id, ...map[id] }));

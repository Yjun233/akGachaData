/**
 * 运行时加载静态 JSON（卡池 / 干员数据）。
 *
 * 数据的**真身在独立资源仓库** `../akGachaResource/data`（远程 github.com/Yjun233/akGachaResource），
 * 本仓库里没有副本。**dev 默认读本地**（`public/data`，指向资源仓库的目录联接）；
 * `VITE_RESOURCE=cdn` 才让 dev 走 CDN；**build 一律走 CDN**。切换逻辑见 `resource.js`。
 *   metadata.json          站点元信息 + 服务器列表
 *   operators.json         干员表（各服共用，靠 *ReleaseDate 区分实装日）
 *   skins.json             干员时装（只做国服；**可选** —— 缺文件时 UP 历史页不显示相应标记）
 *   memoirs.json           干员密录（只做国服；**可选**）
 *   modules.json           干员模组（只做国服；**可选**）
 *   卡池类型 → 大类：见 `constants.js` 的 `BANNER_CATEGORIES`（不再用 JSON 数据文件）
 *   banners_<server>.json  各服卡池表（**不含中坚**）
 *   banners_cla_<server>.json  中坚系列（常驻中坚寻访 + 中坚甄选，**可选**）
 *                              —— 来自官方解包数据，单独一个文件，加载后合并进上面那份
 *   metadata.cla              中坚系列的元信息（按服 `{ generatedAt, count }`），左栏展示用
 *
 * 卡池文件按服务器拆开：metadata.servers 里 available:true 的服务器才会被加载，
 * 缺文件时自动降级（标记不可用）而不是整站失败 —— **新增服务器时**产出
 * banners_<id>.json 并把 available 改成 true 即可，前端无需改动。
 */
import { dataUrl } from './resource.js';
import { BANNER_CATEGORIES } from './constants.js';

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
  const [meta, rawOperators, rawSkins, rawMemoirs, rawModules] = await Promise.all([
    getJSON('metadata.json'),
    getJSON('operators.json'),
    /* 皮肤 / 密录 / 模组都是**可选**的（2026-10-04 才产出）—— 线上 CDN 上还没有时要能降级，
       不能因为缺它们整站加载失败。缺了只是 UP 历史页不显示对应的标记。 */
    getJSONOptional('skins.json'),
    getJSONOptional('memoirs.json'),
    getJSONOptional('modules.json'),
  ]);

  /* operators.json 以 charId 为键（如 char_4179_monstr），
     前端一律按干员名索引（卡池数据里的 upOperators 只有 name）。 */
  const operators = {};
  for (const op of Object.values(unwrap(rawOperators, 'operators') || {})) operators[op.name] = op;

  /* 皮肤**不分服**（文件本身不带 _sc 后缀，这三份都只做国服），按干员名索引即可。
     用途：UP 历史页判断「该期卡池的开放窗口与该干员的皮肤上架窗口是否重叠」。
     ⚠️ **只在国服判定**（非 `sc` 时不显示标记）—— 这层门控在 `lib/upHistory.js`，不在这里。 */
  const skinsByOperator = {};
  for (const s of unwrap(rawSkins, 'skins') || []) {
    if (s?.char) (skinsByOperator[s.char] ||= []).push(s);
  }

  /* 密录 / 模组同上一律按干员名索引，但**只留日期**（判定只要日期）。
     密录一位可能有多批（`batches[].date`），模组一位可能有好几个（每条一个 `date`）。 */
  const memoirsByOperator = {};
  for (const m of unwrap(rawMemoirs, 'memoirs') || []) {
    if (!m?.char) continue;
    const dates = (m.batches || []).map((b) => b.date).filter(Boolean);
    if (dates.length) (memoirsByOperator[m.char] ||= []).push(...dates);
  }
  const modulesByOperator = {};
  for (const m of unwrap(rawModules, 'modules') || []) {
    if (m?.char && m.date) (modulesByOperator[m.char] ||= []).push(m.date);
  }

  const declared = meta.servers || [];
  const bannersByServer = {};
  const servers = [];
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

  return {
    meta: { ...meta, servers, defaultServer, cla },
    operators,
    categories: BANNER_CATEGORIES,
    bannersByServer,
    skinsByOperator,
    memoirsByOperator,
    modulesByOperator,
  };
}

/** { id: 卡池 } → 带 id 的数组 */
export const toBannerList = (map) =>
  Object.keys(map || {}).map((id) => ({ id, ...map[id] }));

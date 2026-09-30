/**
 * 运行时加载静态 JSON（卡池 / 干员数据）。
 *
 * 数据的**真身在独立资源仓库** `../akGachaResource/data`（远程 github.com/Yjun233/akGachaResource），
 * 本仓库里没有副本。默认**开发与构建都从 jsDelivr CDN 读**；`VITE_RESOURCE=local` 时
 * 才读 `public/data`（指向资源仓库的目录联接）。切换逻辑见 `resource.js`。
 *   metadata.json          站点元信息 + 服务器列表
 *   operators.json         干员表（各服共用，靠 *ReleaseDate 区分实装日）
 *   卡池类型 → 大类：见 `constants.js` 的 `BANNER_CATEGORIES`（不再用 JSON 数据文件）
 *   banners_<server>.json  各服卡池表
 *
 * 卡池文件按服务器拆开：metadata.servers 里 available:true 的服务器才会被加载，
 * 缺文件时自动降级（标记不可用）而不是整站失败 —— 未来接国际服 / 繁中服时，
 * 产出 banners_en.json 并把 available 改成 true 即可，前端无需改动。
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
  for (const op of Object.values(rawOperators)) operators[op.name] = op;

  const declared = meta.servers || [];
  const bannersByServer = {};
  const servers = [];

  for (const s of declared) {
    if (!s.available) {
      servers.push({ ...s });
      continue;
    }
    const banners = await getJSONOptional(`banners_${s.id}.json`);
    if (!banners) {
      // 声明可用但文件缺失：降级为不可用，避免前端拿到空数据
      servers.push({ ...s, available: false, missing: true });
      continue;
    }
    bannersByServer[s.id] = banners;
    servers.push({ ...s, available: true });
  }

  const available = servers.filter((s) => s.available);
  const defaultServer = available.some((s) => s.id === meta.defaultServer)
    ? meta.defaultServer
    : (available[0]?.id ?? meta.defaultServer);

  return {
    meta: { ...meta, servers, defaultServer },
    operators,
    categories: BANNER_CATEGORIES,
    bannersByServer,
  };
}

/** { id: 卡池 } → 带 id 的数组 */
export const toBannerList = (map) =>
  Object.keys(map || {}).map((id) => ({ id, ...map[id] }));

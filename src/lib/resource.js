/**
 * 站点资源（数据 JSON + 干员头像）的来源。
 *
 * 数据与头像**都不在站点主仓库里**，它们放在独立仓库：
 *   本地   ../akGachaResource            （与 akGachaData 同级目录）
 *   远程   github.com/Yjun233/akGachaResource
 * 这样爬虫只需更新一个仓库，站点和数据不会两边失同步。
 *
 * - **开发与构建都走 CDN**（保持一致，数据的「新鲜度」所见即所得）。
 *   想临时改回本地（如断网、或 CDN 还没生效）：`VITE_RESOURCE=local pnpm dev`
 *   —— 这时读的是 `public/{data,avatars}`（指向 `../akGachaResource` 的目录联接）。
 * - **构建（vite build）**：读 jsDelivr CDN。public/ 在构建时不复制进 dist。
 *
 * ⚠️ jsDelivr 的缓存很长（`@main` 最长 7 天），所以：
 *   - **头像**用 `AVATARS_SHA` 固定到某个 commit（几乎不变 → 可永久缓存）；
 *     留空则退回 `@main`。
 *   - **数据 JSON** 走 `@main`，每次爬虫推送后调 jsDelivr 的 purge 接口刷缓存：
 *     `curl https://purge.jsdelivr.net/gh/<repo>@main/data/operators.json`
 */

const REPO = 'Yjun233/akGachaResource';

/**
 * ⚠️ **必须用 `cdn.jsdelivr.net`，不要用 `fastly.jsdelivr.net`**。
 * 实测（2026-09-30）：fastly 那个端点对本仓库的 **PNG 恒返回 301**，跳回
 * raw.githubusercontent.com（国内直连不通 → 图片全裂）；而 JSON 又是正常的 200。
 * `cdn.jsdelivr.net` 与 `gcore.jsdelivr.net` 对两者都正常。
 */
const CDN_HOST = 'https://cdn.jsdelivr.net';

/**
 * 头像版本（commit sha）。固定到 sha 后 jsDelivr 会返回
 * `Cache-Control: max-age=31536000, immutable`（**一年且不可变**），比 `@main` 好得多，
 * 而且**没有冷启动问题**（`@main` 首次请求会 301 跳回 raw.githubusercontent.com，
 * 国内直连不通就会裂图）。
 *
 * 推送新头像后：取新的 commit sha 填到这里，再推一次站点即可。
 */
export const AVATARS_SHA = '0b22f39b40a829da7255280e18e87e4de9b04993';

/** jsDelivr 上的头像版本后缀 */
const avatarRef = AVATARS_SHA || 'main';

/** 唯一的回退开关：`VITE_RESOURCE=local` 时读本地目录联接（离线开发用） */
const useLocal = import.meta.env?.VITE_RESOURCE === 'local';
const localBase = import.meta.env?.BASE_URL || '/';

/** 数据 JSON 的基础地址（末尾带 /）—— 走 `@main`，更新后需 purge */
const dataBase = useLocal
  ? localBase
  : `${CDN_HOST}/gh/${REPO}@main/`;

/** 头像的基础地址（末尾带 /）—— 固定到 `AVATARS_SHA`，一年 immutable */
const avatarBase = useLocal
  ? localBase
  : `${CDN_HOST}/gh/${REPO}@${avatarRef}/`;

export const dataUrl = (name) => `${dataBase}data/${name}`;
export const avatarFileUrl = (charId) => `${avatarBase}avatars/${charId}.png`;
export const isRemoteResource = !useLocal;
export { dataBase, avatarBase, REPO };

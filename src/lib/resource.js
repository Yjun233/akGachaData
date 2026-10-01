/**
 * 站点资源（数据 JSON + 干员头像）的来源。
 *
 * 数据与头像**都不在站点主仓库里**，它们放在独立仓库：
 *   本地   ../akGachaResource            （与 akGachaData 同级目录）
 *   远程   github.com/Yjun233/akGachaResource
 * 这样爬虫只需更新一个仓库，站点和数据不会两边失同步。
 *
 * - **开发（`pnpm dev`）**：默认读**本地** `public/{data,avatars}` —— 那是两个指向
 *   `../akGachaResource` 的目录联接。这样本地改完数据（还没推送到 GitHub）就能直接看到效果。
 *   想看线上的数据时：`VITE_RESOURCE=cdn pnpm dev`。
 * - **构建（vite build）**：一律读 jsDelivr CDN（public/ 在构建时不复制进 dist，
 *   所以构建产物只能走 CDN）。`VITE_RESOURCE=local` 对 build 没有意义。
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

/**
 * 来源开关：
 *   （默认）              dev 读本地、build 走 CDN
 *   VITE_RESOURCE=cdn     dev 也走 CDN（看线上数据）
 *   VITE_RESOURCE=local   强制读本地（dev 下等价于默认；build 下无效）
 */
const env = import.meta.env || {};
const useLocal = env.VITE_RESOURCE === 'local' || (!!env.DEV && env.VITE_RESOURCE !== 'cdn');
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

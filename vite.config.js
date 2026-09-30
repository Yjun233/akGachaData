import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * 部署到 GitHub Pages 时，若站点不在域名根目录（username.github.io/<repo>/），
 * 构建时设置 VITE_BASE=/<repo>/ 即可（见 .github/workflows/deploy.yml）。
 */
export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE || '/',
  plugins: [vue()],
  /**
   * 数据与头像都在独立资源仓库 `../akGachaResource`，public/ 下只是指向它的目录联接。
   * 开发时从这里读（离线可开发）；**构建时站点走 jsDelivr CDN**，所以不需要把
   * public 复制进 dist（否则 dist 里会多出一份 4.5 MB 的本地副本）。
   */
  publicDir: command === 'serve' ? 'public' : false,
  build: {
    outDir: 'dist',
    // echarts 单独打包，避免第三方库与业务代码混在一个 chunk 里
    // （Vite 8 / rolldown 的 manualChunks 只接受函数形式）
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/echarts') || id.includes('node_modules/zrender')) {
            return 'echarts';
          }
          return null;
        },
      },
    },
  },
  /**
   * 开发服务器。
   * `pnpm dev`      → 只监听本机（localhost / 127.0.0.1）
   * `pnpm dev:lan`  → 监听所有网卡（0.0.0.0），手机连同一 Wi-Fi 可用
   *                   `http://<本机局域网 IP>:5173` 访问
   * 手机端会自动走「浮层抽屉 + 卡片视图」那一套响应式分支。
   */
  /** ⚠️ 必须显式写 127.0.0.1：Vite 8 默认只监听 IPv6 的 [::1]，
      导致 `http://127.0.0.1:5173` 连不上（curl 报 000），无头 Chrome / CDP 会失败。 */
  server: { open: false, port: 5173, host: '127.0.0.1' },
}));

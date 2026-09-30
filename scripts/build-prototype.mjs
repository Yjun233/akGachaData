#!/usr/bin/env node
/**
 * build-prototype.mjs
 * 1) 用 DOM stub 跑一遍页面脚本，得到「预渲染」结果（宽屏表格 + 窄屏卡片 + 统计表）
 * 2) 把真实数据与预渲染结果内联进 prototype/template.html
 * 3) 输出可直接双击打开的 prototype/index.html
 *
 * 预渲染的意义：即使预览环境不执行 JavaScript，页面依然有完整内容；
 * 页签切换用纯 CSS（hidden radio + :checked），同样不依赖 JS。
 */

import { existsSync } from 'node:fs';   // ⚠️ fs/promises 没有 existsSync，别混用
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPage } from './lib/dom-shim.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
/* 数据的真身在独立资源仓库 ../akGachaResource（主仓库里没有副本，
   public/ 下那两个只是开发用的目录联接，可能不存在）——直接读真身最稳。 */
const DATA_DIR = path.resolve(ROOT, '..', 'akGachaResource', 'data');
if (!existsSync(DATA_DIR)) {
  console.error(`找不到资源仓库 ${DATA_DIR}\n请先确认 ../akGachaResource 存在。`);
  process.exit(1);
}
const TEMPLATE = path.join(ROOT, 'prototype', 'template.html');
const OUT = path.join(ROOT, 'prototype', 'index.html');

const readJson = async (f) => JSON.parse(await fs.readFile(path.join(DATA_DIR, f), 'utf8'));
const [operators, meta] = await Promise.all([
  readJson('operators.json'),
  readJson('metadata.json'),
]);
/* type → 大类已移入 src/lib/constants.js（BANNER_CATEGORIES），不再读 JSON 数据文件 */
const { BANNER_CATEGORIES: categories } = await import('../src/lib/constants.js');

/* 卡池按服务器分文件：只读 metadata.servers 里 available 的服务器。
   将来接入国际服 / 繁中服时，产出 banners_en.json / banners_tc.json 并把
   metadata 里对应项改成 available:true，这里会自动把它一起打包。 */
const availableServers = (meta.servers || []).filter((s) => s.available);
const bannersByServer = {};
for (const s of availableServers) {
  bannersByServer[s.id] = await readJson(`banners_${s.id}.json`);
}
const curServer = (meta.servers || []).find((s) => s.id === meta.defaultServer) || {};

const payload = { operators, bannersByServer, categories, meta };
let template = await fs.readFile(TEMPLATE, 'utf8');

// 先塞数据，再跑脚本预渲染（脚本需要真实数据）
if (!template.includes('/*__DATA__*/')) throw new Error('template.html 中未找到 /*__DATA__*/ 占位符');
const put = (s, ph, val) => s.split(ph).join(val);
template = put(template, '/*__DATA__*/', JSON.stringify(payload));

const { result: pre } = runPage(template, { epilogue: 'return window.__prerender();' });
if (!pre || !pre.banners || !pre.stats) throw new Error('预渲染失败：__prerender() 未返回预期结果');

const serverOptions = availableServers
  .map((s) => `<option value="${s.id}"${s.id === meta.defaultServer ? ' selected' : ''}>${s.label}</option>`)
  .join('');

let html = template;
html = put(html, '<!--__BANNERS__-->', pre.banners);
html = put(html, '<!--__STATS__-->', pre.stats);
html = put(html, '<!--__SERVEROPTIONS__-->', serverOptions);
html = put(html, '<!--__REFDATE__-->', meta.generatedAt);
html = put(html, '<!--__GENDATE__-->', meta.generatedAt);
html = put(html, '<!--__OPCOUNT__-->', String(meta.operatorCount));
html = put(html, '<!--__BANNERCOUNT__-->', String(curServer.bannerCount ?? 0));

const leftovers = html.match(/<!--__[A-Z]+__-->/g);
if (leftovers) throw new Error('仍有未替换的占位符: ' + [...new Set(leftovers)].join(', '));

await fs.writeFile(OUT, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
console.log('✓ 原型已生成（含无 JS 预渲染内容）');
console.log(`  干员 ${meta.operatorCount} 位 / 卡池 ${curServer.bannerCount ?? 0} 个（服务器：${curServer.label || meta.defaultServer}）`);
console.log(`  预渲染：卡池视图 ${(pre.banners.length / 1024).toFixed(0)} KB · 统计视图 ${(pre.stats.length / 1024).toFixed(0)} KB`);
console.log(`  输出 ${path.relative(ROOT, OUT)} (${kb} KB)`);

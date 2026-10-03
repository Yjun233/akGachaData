/**
 * 数据层一致性核对：用 Vue 版数据层（src/lib）重算统计，与原型预渲染出来的
 * prototype/index.html 里的表格**逐个单元格**对比。
 *
 * 用途：迁移期间确认「口径没有在搬运过程中走样」，也作为后续改数据层的回归测试。
 * 用法：node scripts/verify-data.mjs          （先跑 pnpm build:prototype 生成原型）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeStats, endInfo, sortStatRows, daysSortValue } from '../src/lib/stats.js';
import { computeFirstUp, metricLabel } from '../src/lib/firstUp.js';
import { computeUpHistory } from '../src/lib/upHistory.js';
import {
  buildUpTimeline, monthIndexOf, monthLabel, monthStartDate, minInnerWidth, chartHeight, TL,
} from '../src/lib/upTimeline.js';
import { bannerRows, emptyFilters } from '../src/lib/banners.js';
import { diffDays, shiftYears, shiftDays, enforceRangeOrder } from '../src/lib/date.js';
import { BANNER_CATEGORIES, TYPE_LABEL } from '../src/lib/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* 数据与头像的真身在**独立资源仓库** ../akGachaResource；
   站点里的 public/data 只是指向它的目录联接（junction）。这里直接读真身，
   免得 junction 缺失时脚本报出莫名其妙的「文件不存在」。 */
const RES_DIR = path.resolve(ROOT, '..', 'akGachaResource', 'data');
if (!fs.existsSync(RES_DIR)) {
  console.error(`找不到资源仓库 ${RES_DIR}\n请先确认 ../akGachaResource 存在（数据与头像都在那里）。`);
  process.exit(1);
}
const read = (p) => JSON.parse(fs.readFileSync(path.join(RES_DIR, p), 'utf8'));

const meta = read('metadata.json');
const rawOperators = read('operators.json');
/* type → 大类已移入 src/lib/constants.js（BANNER_CATEGORIES），不再读 JSON 数据文件 */
const categories = BANNER_CATEGORIES;
const bannerMap = read('banners_sc.json');

/* 与 src/lib/loadData.js 保持一致：operators.json 以 charId 为键，前端按 name 索引 */
const operators = {};
for (const op of Object.values(rawOperators)) operators[op.name] = op;

const banners = Object.keys(bannerMap).map((id) => ({ id, ...bannerMap[id] }));
const operatorIndex = {};
for (const name of Object.keys(operators)) {
  operatorIndex[name] = { rarity: operators[name].rarity, isLimited: operators[name].isLimited };
}
const relDateOf = (op) => (op ? op.scReleaseDate || null : null);

const refDate = meta.generatedAt;
const { visible, map } = computeStats({
  banners, categories, operatorByName: operators, operatorIndex, refDate, relDateOf,
});
const rows = Object.values(map);

const results = [];
const check = (label, actual, expected) => {
  results.push({ ok: String(actual) === String(expected), label, actual, expected });
};

// ---- 站点级 ----
check('干员总数', Object.keys(operators).length, meta.operatorCount);
check('卡池总数', banners.length, meta.servers.find((s) => s.id === 'sc').bannerCount);
check('参与统计干员数', rows.length, 204);

/* ---------------- 卡池的三个名字字段（name / scName / enName） ----------------
   三服卡池的 `name` 都是**国服中文名**（`scName` 是同值的显式一列，便于跨服对齐）；
   国际服专有的英文名放在 `enName`，只有「限定寻访 / 单六寻访 / 双五寻访」三类有
   —— 它们三服的叫法不同（国服「遗愿焰火」/ 国际服 "Cremation Last Wish"）。
   带序号的池子（常驻标准寻访N / 联合行动N…）三服同名，`enName` 为 null。
   ⚠️ 这里的匹配键是**照着资源仓库 scripts/lib/banner-names.mjs 独立算了一遍**，
      当作交叉验证（lim / single 只看六星、five 看全集合）。 */
const nameGroupOf = (t) => (t === 'five' ? 'five' : t === 'single' ? 'single'
  : /^lim(cel|spr|sum)$/.test(t) ? 'lim' : null);
const nameKeyOf = (b, g) => {
  const ups = b.upOperators || [];
  const xs = g === 'five' ? ups : ups.filter((o) => o.rarity === 6);
  return [...new Set(xs.map((o) => o.name))].sort().join('|');
};
const nameFieldsOk = (b) => Boolean(b.name) && b.scName === b.name && 'enName' in b;
/** 「限定 / 单六 / 双五」里能反查到英文名的比例 —— 对不上的是「国际服还没出这个池子」
    和国服特有的「返场」池，所以用比例而不是死数字。 */
const enNameRate = (list) => {
  const g = list.filter((b) => nameGroupOf(b.type));
  return g.length ? g.filter((b) => b.enName).length / g.length : 1;
};

check('国服：卡池都有 name / scName / enName（且 name === scName）', banners.every(nameFieldsOk), true);
check('国服：带序号的池子没有英文名（enName 为 null）',
  banners.filter((b) => !nameGroupOf(b.type)).every((b) => b.enName === null), true);
check('国服：限定·单六·双五的英文名命中率 > 90%', enNameRate(banners) > 0.9, true);

/* ---------------- 国际服（banners_en.json，由资源仓库的 fetch-data-en.mjs 产出）---------------- */

const enMeta = meta.servers.find((s) => s.id === 'en') || {};
check('metadata：国际服已启用（available）', enMeta.available, true);
check('banners_en.json 已产出', fs.existsSync(path.join(RES_DIR, 'banners_en.json')), true);

if (fs.existsSync(path.join(RES_DIR, 'banners_en.json'))) {
  const enMap = read('banners_en.json');
  const enBanners = Object.entries(enMap).map(([id, b]) => ({ id, ...b }));

  check('国际服卡池数 = metadata.en.bannerCount', enBanners.length, enMeta.bannerCount);
  check('国际服卡池的开头 = metadata.en.earliestBanner',
    Object.keys(enMap).length ? enBanners.map((b) => b.startDate).sort()[0] : null, enMeta.earliestBanner);
  check('国际服 type 都在本站 11 种之内', enBanners.every((b) => b.type in TYPE_LABEL), true);
  check('国际服 ID 的类型段与 type 一致', enBanners.every((b) => b.id.includes(`_${b.type}_`)), true);
  check('国际服 UP 干员都能按中文名对上干员表',
    enBanners.every((b) => b.upOperators.every((o) => operators[o.name])), true);
  /* 「国际服还没上线的干员自动排除」这条约定的落地检查：
     凡出现在国际服卡池里的干员，都必须有 enReleaseDate（否则站点侧会算出空日期）。 */
  check('国际服卡池里的干员都有国际服实装日',
    enBanners.every((b) => b.upOperators.every((o) => operators[o.name]?.enReleaseDate)), true);
  check('国际服「双五寻访」恰好 3 个', enBanners.filter((b) => b.type === 'five').length, 3);
  check('国际服卡池按 (开始日, id) 升序', (() => {
    const ks = Object.keys(enMap);
    for (let i = 1; i < ks.length; i++) {
      const a = enMap[ks[i - 1]];
      const b = enMap[ks[i]];
      const d = a.startDate.localeCompare(b.startDate);
      if (d > 0 || (d === 0 && ks[i - 1].localeCompare(ks[i]) > 0)) return false;
    }
    return true;
  })(), true);

  /* 名字字段：国际服的 `name` 也是国服中文名，英文名挪到 `enName` */
  check('国际服：卡池都有 name / scName / enName（且 name === scName）', enBanners.every(nameFieldsOk), true);
  check('国际服：限定·单六·双五都有英文名（纯 ASCII）',
    enBanners.filter((b) => nameGroupOf(b.type)).every((b) => /^[\x20-\x7e]+$/.test(b.enName || '')), true);
  check('国际服：带序号的池子没有英文名（enName 为 null）',
    enBanners.filter((b) => !nameGroupOf(b.type)).every((b) => b.enName === null), true);
  /* ⚠️ **5 倍权值的往期限定已剔除**（wiki.gg 的 `|limited = 2`，不算 UP）：
     剔除后限定寻访只剩「2 六星 + 1 五星」这个标准构成；没剔的话会多出 2~3 个六星。 */
  const cntRarity = (b, r) => b.upOperators.filter((o) => o.rarity === r).length;
  check('国际服：限定寻访每池 2 六星 + 1 五星（5 倍权值的往期限定已剔除）',
    enBanners.filter((b) => /^lim/.test(b.type))
      .every((b) => cntRarity(b, 6) === 2 && cntRarity(b, 5) === 1), true);

  /* 各统计页面在国际服下都要能算出东西（不只是「不报错」）。
     实装日按服务器取：国际服用 enReleaseDate。 */
  const enList = Object.entries(enMap).map(([id, b]) => ({ id, ...b }));
  const enRel = (op) => (op ? op.enReleaseDate || null : null);
  const enShop = computeFirstUp({
    banners: enList, operatorByName: operators, relDateOf: enRel, from: '', to: '', axis: 'first', metric: 'gap',
  });
  check('国际服：首次进店序列（六星 / 五星）都非空', enShop.six.length > 0 && enShop.five.length > 0, true);
  const enRot = computeFirstUp({
    banners: enList, operatorByName: operators, relDateOf: enRel, mode: 'rotation',
  });
  check('国际服：首次轮换序列（六星 / 五星）都非空', enRot.six.length > 0 && enRot.five.length > 0, true);
  check('国际服：轮换口径覆盖的干员不少于进店口径',
    enRot.rows.length >= enShop.rows.length, true);

  const enUp = computeUpHistory({
    banners: enList, categories, operatorByName: operators, relDateOf: enRel, types: null, shopOnly: false, sort: 'release-asc',
  });
  check('国际服：UP 历史六星行数 > 0', enUp.six.length > 0, true);
  check('国际服：UP 历史每行都有实装日（说明没混进未上线的干员）',
    [...enUp.six, ...enUp.five].every((r) => !!r.releaseDate), true);

  const enStats = computeStats({
    banners: enList, categories, operatorByName: operators, operatorIndex,
    refDate: meta.generatedAt, relDateOf: enRel,
  });
  check('国际服：统计页有卡片池（出率提升）', Object.keys(enStats.map).length > 0, true);
}

check('干员表带 enName 字段', Object.values(rawOperators).every((o) => 'enName' in o), true);
check('干员表带 enClassicDate 字段', Object.values(rawOperators).every((o) => 'enClassicDate' in o), true);

/* ---------------- 繁中服（banners_tc.json，由资源仓库的 fetch-data-tc.mjs 从金山在线表格读出）---------------- */

const tcMeta = meta.servers.find((s) => s.id === 'tc') || {};
check('metadata：繁中服已启用（available）', tcMeta.available, true);
check('banners_tc.json 已产出', fs.existsSync(path.join(RES_DIR, 'banners_tc.json')), true);

if (fs.existsSync(path.join(RES_DIR, 'banners_tc.json'))) {
  const tcMap = read('banners_tc.json');
  const tcBanners = Object.entries(tcMap).map(([id, b]) => ({ id, ...b }));
  const ofType = (t) => tcBanners.filter((b) => b.type === t);

  check('繁中服卡池数 = metadata.tc.bannerCount', tcBanners.length, tcMeta.bannerCount);
  check('繁中服卡池的开头 = metadata.tc.earliestBanner',
    tcBanners.map((b) => b.startDate).sort()[0], tcMeta.earliestBanner);
  check('繁中服 type 都在本站 11 种之内', tcBanners.every((b) => b.type in TYPE_LABEL), true);
  check('繁中服 ID 的类型段与 type 一致', tcBanners.every((b) => b.id.includes(`_${b.type}_`)), true);
  check('繁中服 UP 干员都能按中文名对上干员表',
    tcBanners.every((b) => b.upOperators.every((o) => operators[o.name])), true);
  /* 「繁中服还没上线的干员自动排除」的落地检查：卡池里出现的干员都必须有繁中服实装日 */
  check('繁中服卡池里的干员都有繁中服实装日',
    tcBanners.every((b) => b.upOperators.every((o) => operators[o.name]?.tcReleaseDate)), true);
  check('繁中服「双五寻访」恰好 3 个（凝电之钻 / 雾漫荒林 / 流沙涡旋）', ofType('five').length, 3);
  /* 6 个联动卡池整行被跳过（J 列写「联动」），所以这些干员一个都不该出现。
     ⚠️ 别用「名字是不是纯英文」来判断 —— 国服本来就有 W 这种英文名干员。 */
  const COLLAB_OPS = ['Ash', 'Frost', 'Blitz', 'Ela', 'Iana', 'Doc', '麒麟R夜刀', '火龙S黑角',
    '玛露西尔', '莱欧斯', '齐尔查克', '丰川祥子', '三角初华', '若叶睦'];
  check('繁中服没有联动干员（6 个联动卡池整行被跳过）',
    tcBanners.every((b) => b.upOperators.every((o) => !COLLAB_OPS.includes(o.name))), true);
  check('繁中服卡池按 (开始日, id) 升序', (() => {
    const ks = Object.keys(tcMap);
    for (let i = 1; i < ks.length; i++) {
      const a = tcMap[ks[i - 1]];
      const b = tcMap[ks[i]];
      const d = a.startDate.localeCompare(b.startDate);
      if (d > 0 || (d === 0 && ks[i - 1].localeCompare(ks[i]) > 0)) return false;
    }
    return true;
  })(), true);

  /* 名字字段：繁中服与国服同名，英文名从国际服反查 */
  check('繁中服：卡池都有 name / scName / enName（且 name === scName）', tcBanners.every(nameFieldsOk), true);
  check('繁中服：带序号的池子没有英文名（enName 为 null）',
    tcBanners.filter((b) => !nameGroupOf(b.type)).every((b) => b.enName === null), true);
  check('繁中服：限定·单六·双五的英文名命中率 > 90%', enNameRate(tcBanners) > 0.9, true);

  /* 序号类：编号从 1 起、连续、且与时间顺序一致（表格没写序号，脚本按时间发号） */
  for (const t of ['double', 'classic', 'clafes', 'joint', 'stdfes', 'mainfes']) {
    const list = ofType(t).slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
    check(`繁中服 ${t} 的编号按时间从 1 连续编排`,
      list.length > 0 && list.every((b, i) => b.name === `${TYPE_LABEL[t]}${i + 1}`), true);
  }

  /* 各类池子的干员构成（表格的列结构本身就是这么定的） */
  const cnt = (b, r) => b.upOperators.filter((o) => o.rarity === r).length;
  check('繁中服常驻标准 / 中坚寻访每池 2 六星 + 3 五星',
    [...ofType('double'), ...ofType('classic')].every((b) => cnt(b, 6) === 2 && cnt(b, 5) === 3), true);
  check('繁中服中坚甄选每期 12 六星 + 24 五星',
    ofType('clafes').every((b) => cnt(b, 6) === 12 && cnt(b, 5) === 24), true);
  check('繁中服限定寻访每池 2 六星 + 1 五星',
    tcBanners.filter((b) => /^lim/.test(b.type)).every((b) => cnt(b, 6) === 2 && cnt(b, 5) === 1), true);
  check('繁中服联合行动每池 4 六星 + 6 五星',
    ofType('joint').every((b) => cnt(b, 6) === 4 && cnt(b, 5) === 6), true);
  check('繁中服前路回响每池 3 六星 + 3 五星',
    ofType('mainfes').every((b) => cnt(b, 6) === 3 && cnt(b, 5) === 3), true);
  check('繁中服定向甄选每池 6 六星 + 6 五星',
    ofType('stdfes').every((b) => cnt(b, 6) === 6 && cnt(b, 5) === 6), true);
  /* 只有常驻标准 / 中坚寻访有「进店」概念（与国服 / 国际服一致） */
  check('繁中服只有常驻标准/中坚寻访带进店标记',
    tcBanners.every((b) => ['double', 'classic'].includes(b.type) || !b.upOperators.some((o) => o.isShop)), true);

  /* 各统计页面在繁中服下都要能算出东西（实装日按服务器取 tcReleaseDate） */
  const tcRel = (op) => (op ? op.tcReleaseDate || null : null);
  const tcShop = computeFirstUp({
    banners: tcBanners, operatorByName: operators, relDateOf: tcRel, from: '', to: '', axis: 'first', metric: 'gap',
  });
  check('繁中服：首次进店序列（六星 / 五星）都非空', tcShop.six.length > 0 && tcShop.five.length > 0, true);
  const tcRot = computeFirstUp({
    banners: tcBanners, operatorByName: operators, relDateOf: tcRel, mode: 'rotation',
  });
  check('繁中服：首次轮换序列（六星 / 五星）都非空', tcRot.six.length > 0 && tcRot.five.length > 0, true);
  check('繁中服：轮换口径覆盖的干员不少于进店口径',
    tcRot.rows.length >= tcShop.rows.length, true);

  const tcUp = computeUpHistory({
    banners: tcBanners, categories, operatorByName: operators, relDateOf: tcRel, types: null, shopOnly: false, sort: 'release-asc',
  });
  check('繁中服：UP 历史六星行数 > 0', tcUp.six.length > 0, true);
  check('繁中服：UP 历史每行都有实装日（说明没混进未上线的干员）',
    [...tcUp.six, ...tcUp.five].every((r) => !!r.releaseDate), true);

  const tcStats = computeStats({
    banners: tcBanners, categories, operatorByName: operators, operatorIndex, refDate: meta.generatedAt, relDateOf: tcRel,
  });
  check('繁中服：统计页有卡片池（出率提升）', Object.keys(tcStats.map).length > 0, true);
}

check('干员表带 tcReleaseDate 字段', Object.values(rawOperators).every((o) => 'tcReleaseDate' in o), true);
check('干员表带 tcClassicDate 字段', Object.values(rawOperators).every((o) => 'tcClassicDate' in o), true);
/* 三个服务器各有自己的「数据更新日」（左栏展示用） */
check('metadata：三个服务器都有数据更新日',
  !!meta.generatedAt && !!meta.enGeneratedAt && !!meta.tcGeneratedAt, true);

// ---- 卡池类型：限定寻访已拆成 庆典 / 春节 / 夏季 ----
const typeCount = {};
for (const b of banners) typeCount[b.type] = (typeCount[b.type] || 0) + 1;
check('限定寻访·庆典（limcel）卡池数', typeCount.limcel, 13);
check('限定寻访·春节（limspr）卡池数', typeCount.limspr, 8);
check('限定寻访·夏季（limsum）卡池数', typeCount.limsum, 6);
check('不再有笼统的 limited 类型', typeCount.limited || 0, 0);
check('每个 type 都在 BANNER_CATEGORIES 里有大类',
  banners.every((b) => Boolean(categories[b.type])), true);
check('三个限定子类的大类都是「限定寻访」',
  ['limcel', 'limspr', 'limsum'].every((t) => categories[t] === '限定寻访'), true);
check('TYPE_LABEL 覆盖所有出现的 type',
  banners.every((b) => Boolean(TYPE_LABEL[b.type])), true);

// ---- 口径 ----
check('商店兑换 ⊆ 出率提升（每一行都成立）',
  rows.every((r) => r.shopAll.every((b) => r.upAll.includes(b))), true);
check('总次数 = 中坚次数 + 标准次数',
  rows.every((r) => r.upAll.length === r.upMid.length + r.upStd.length), true);
check('限定干员已排除', rows.every((r) => !r.upAll.some((b) => b.upOperators.find((o) => o.name === r.name && o.isLimited))), true);

const wz = map['推进之王'];
check('推进之王 · 出率提升次数', wz?.upAll.length, 21);
check('推进之王 · 商店兑换次数', wz?.shopAll.length, 10);

// ---- 卡池列表 ----
const all = bannerRows(banners, emptyFilters(), categories, { key: 'startDate', dir: 'desc' });
check('卡池列表默认按开始日期倒序',
  all.every((b, i) => i === 0 || all[i - 1].startDate >= b.startDate), true);
check('默认筛选命中全部卡池', all.length, banners.length);

/* ---------------- 首次UP间隔（两种统计模式：首次进店 / 首次轮换） ----------------
   口径见 src/lib/firstUp.js 文件头与 docs/工作指令.md 5.7。 */

/** 独立算一遍「首次轮换日」：只看那 4 类轮换卡池，不看进店标记 */
function expectedFirstRotation(banners_, types) {
  const m = new Map();
  for (const b of banners_) {
    if (!types.includes(b.type)) continue;
    for (const op of b.upOperators) {
      if (op.isLimited || (op.rarity || 0) < 5) continue;
      const cur = m.get(op.name);
      if (cur === undefined || b.startDate < cur) m.set(op.name, b.startDate);
    }
  }
  return m;
}
const ROT_TYPES = ['double', 'joint', 'stdfes', 'mainfes'];
const rotExpected = expectedFirstRotation(banners, ROT_TYPES);

const fupShop = computeFirstUp({ banners, operatorByName: operators, relDateOf });
const fupRot = computeFirstUp({ banners, operatorByName: operators, relDateOf, mode: 'rotation' });

check('默认统计模式 = 首次进店', fupShop.mode, 'shop');
check('有首次进店记录的干员数', fupShop.rows.length, 160);
check('其中六星 / 五星', `${fupShop.six.length}/${fupShop.five.length}`, '69/91');

check('轮换模式：mode 回传正确', fupRot.mode, 'rotation');
check('轮换模式：干员数与独立重算一致', fupRot.rows.length, rotExpected.size);
check('轮换模式：每位干员的首次轮换日与独立重算一致',
  fupRot.rows.every((r) => rotExpected.get(r.name) === r.firstDate), true);
/* ⚠️ 进店的干员必定也上过轮换（进店标记只出现在常驻标准 / 常驻中坚上，
   而常驻中坚的日期晚于该干员首次上标准）→ 两条不变量，破了就说明上游数据形态变了 */
check('不变量：有进店记录的干员都有轮换记录',
  fupShop.rows.every((r) => rotExpected.has(r.name)), true);
check('不变量：首次轮换日 ≤ 首次进店日',
  fupShop.rows.every((r) => rotExpected.get(r.name) <= r.firstDate), true);
/* ⚠️ 轮换口径**不含中坚寻访**（用户指定）。实测把 classic / clafes 加进来结果**完全一致**
   —— 中坚干员的首次标准 UP 必然更早。这条断言把「不加也对」这件事钉住 */
const rotWithMid = expectedFirstRotation(banners, [...ROT_TYPES, 'classic', 'clafes']);
check('轮换口径不含中坚寻访：加上 classic / clafes 结果完全一致',
  rotWithMid.size === rotExpected.size
  && [...rotWithMid].every(([n, d]) => rotExpected.get(n) === d), true);

/* 间隔必须在**同星级内部**比较（早期版本混排，算出了跨星级的假间隔） */
for (const [modeName, set] of [['进店', fupShop], ['轮换', fupRot]]) {
  for (const [label, list, rarity] of [['六星', set.six, 6], ['五星', set.five, 5]]) {
    check(`${modeName}·${label}：组内只含 ${rarity} 星`, list.every((r) => r.rarity === rarity), true);
    check(`${modeName}·${label}：组内按首次日期升序`,
      list.every((r, i) => i === 0 || list[i - 1].firstDate <= r.firstDate), true);
    check(`${modeName}·${label}：组内首位没有前序间隔`, list[0]?.gap === null, true);
    check(`${modeName}·${label}：其余位置 gap 均 ≥ 0`, list.slice(1).every((r) => r.gap >= 0), true);
    check(`${modeName}·${label}：每点的前一位就是同星级的前一个干员`,
      list.slice(1).every((r, i) => r.prevName === list[i].name), true);
    check(`${modeName}·${label}：间隔总和 = 末位与首位首次日期之差`,
      list.slice(1).reduce((a, r) => a + r.gap, 0),
      diffDays(list[list.length - 1].firstDate, list[0].firstDate));
  }
  check(`${modeName}：只含 5 / 6 星非限定干员`,
    set.rows.every((r) => (r.rarity === 5 || r.rarity === 6) && !operators[r.name]?.isLimited), true);
}

check('六星序列首位是最早的六星首次进店日', fupShop.six[0]?.firstDate, '2019-04-30');
check('bounds.min 取全部干员的最早进店日', fupShop.bounds.min, '2019-04-30');
check('轮换模式的 bounds 也是它自己的（另算一份，互不干扰）',
  fupRot.bounds.min >= fupShop.bounds.min, true);

/* 回归：用户报过的例子 —— 六星「夜莺」的前一位不该是五星「德克萨斯」 */
const nightingale = fupShop.six.find((r) => r.name === '夜莺');
check('夜莺的前一位是六星（不是五星德克萨斯）',
  nightingale ? fupShop.six.some((r) => r.name === nightingale.prevName) : true, true);

/* 时间范围：按首次日期筛，区间内重新算间隔 */
const ranged = computeFirstUp({
  banners, operatorByName: operators, relDateOf, from: '2024-01-01', to: '2026-12-31',
});
check('筛选后六星首条 ≥ from', ranged.six[0]?.firstDate >= '2024-01-01', true);
check('筛选后六星末条 ≤ to', ranged.six[ranged.six.length - 1]?.firstDate <= '2026-12-31', true);
check('筛选后条数少于全量', ranged.rows.length < fupShop.rows.length, true);
check('筛选后组内首位仍为 null', ranged.six[0]?.gap === null, true);
check('筛选后每点前一位仍是同星级序列中的前一个',
  ranged.six.slice(1).every((r, i) => r.prevName === ranged.six[i].name), true);
check('筛选不影响 bounds（日期输入上下限用）',
  JSON.stringify(ranged.bounds), JSON.stringify(fupShop.bounds));

/* 口径切换：横轴按实装日期 / 纵轴距实装日 */
check('默认口径：value 就是 gap', fupShop.six.every((r) => r.value === r.gap), true);
check('默认口径：轴标签 = 首次日期', fupShop.six.every((r) => r.xLabel === r.firstDate), true);
check('默认口径：axis / metric 回传正确', `${fupShop.axis}/${fupShop.metric}`, 'first/gap');
check('轮换模式默认也是 gap（与进店模式同一套横纵轴口径）',
  fupRot.six.every((r) => r.value === r.gap), true);

const byRelease = computeFirstUp({ banners, operatorByName: operators, relDateOf, axis: 'release' });
check('横轴=实装日期：组内按实装日升序',
  byRelease.six.every((r, i) => i === 0
    || (byRelease.six[i - 1].releaseDate || '9999') <= (byRelease.six[i].releaseDate || '9999')), true);
check('横轴=实装日期：轴标签改用实装日期',
  byRelease.six.every((r) => r.xLabel === (r.releaseDate || '—')), true);
check('横轴=实装日期：会出现负间隔（更晚实装却更早进店）',
  [...byRelease.six, ...byRelease.five].some((r) => typeof r.gap === 'number' && r.gap < 0), true);

const bySince = computeFirstUp({ banners, operatorByName: operators, relDateOf, metric: 'sinceRelease' });
check('纵轴=距实装：value = 首次日 − 实装日',
  bySince.six.every((r) => r.value === diffDays(r.firstDate, r.releaseDate)), true);
check('纵轴=距实装：序列首位也有值（不再是 null）', typeof bySince.six[0]?.value, 'number');
check('纵轴=距实装：最大跨度超过 800 天',
  Math.max(...bySince.six.concat(bySince.five).map((r) => r.value)) > 800, true);

/* 纵轴标签随模式换词（卡片头 / 文档都引它） */
check('纵轴标签·进店模式', metricLabel('shop', 'gap'), '距同星级上一个首次进店（天）');
check('纵轴标签·轮换模式', metricLabel('rotation', 'gap'), '距同星级上一个首次轮换（天）');
check('纵轴标签·距实装日与模式无关',
  metricLabel('shop', 'sinceRelease') === metricLabel('rotation', 'sinceRelease'), true);

/* 日期工具：近 N 年用（shiftYears） */
check('shiftYears：2026-09-29 往前 3 年', shiftYears('2026-09-29', -3), '2023-09-29');
check('shiftYears：闰日 2024-02-29 往前 1 年退到 2-28', shiftYears('2024-02-29', -1), '2023-02-28');
check('shiftYears：1 月 31 日不受月长影响', shiftYears('2026-01-31', 1), '2027-01-31');
check('shiftYears：往前 1 年再往后 1 年回到原值', shiftYears(shiftYears('2026-09-29', -5), 5), '2026-09-29');

/* 日期区间约束：冲突时强制修正另一端（用户要求，不再报错） */
check('shiftDays：跨月', shiftDays('2024-02-28', 2), '2024-03-01');
check('区间不冲突时原样返回',
  JSON.stringify(enforceRangeOrder('2024-01-01', '2026-01-01', 'from')),
  JSON.stringify({ from: '2024-01-01', to: '2026-01-01', pushed: null }));
check('确认起始端时，结束端被推到 +1 天',
  JSON.stringify(enforceRangeOrder('2026-01-01', '2025-01-01', 'from')),
  JSON.stringify({ from: '2026-01-01', to: '2026-01-02', pushed: 'to' }));
check('确认结束端时，起始端被推到 −1 天',
  JSON.stringify(enforceRangeOrder('2026-01-01', '2025-01-01', 'to')),
  JSON.stringify({ from: '2024-12-31', to: '2025-01-01', pushed: 'from' }));
check('两端同一天也视为冲突',
  enforceRangeOrder('2025-06-01', '2025-06-01', 'from').pushed, 'to');
check('缺一端时不修正',
  enforceRangeOrder('2026-01-01', '', 'from').pushed, null);
check('修正后必然满足 开始 < 结束',
  (() => {
    const r = enforceRangeOrder('2026-01-01', '2025-01-01', 'from');
    return r.from < r.to;
  })(), true);

/* ---------------- UP 历史一览 ---------------- */
const upAll = computeUpHistory({ banners, categories, operatorByName: operators, relDateOf });
check('UP 历史：六星 / 五星干员数', `${upAll.six.length}/${upAll.five.length}`, '92/112');
check('UP 历史：已排除限定干员（合计 = 全部 5/6 星 − 26 位限定）', upAll.all.length, 204);
check('UP 历史：不含任何限定干员',
  upAll.all.every((r) => !operators[r.name]?.isLimited), true);
/* 标记总数改成**独立算一遍**：把每个卡池里 5/6★ 且非限定的 UP 干员数加起来。
   （原来写死 2495，一更新数据就红；独立算法还能顺带核对 computeUpHistory 没漏没重。） */
const expectedMarks = banners.reduce((n, b) => n
  + b.upOperators.filter((o) => !o.isLimited && (o.rarity || 0) >= 5).length, 0);
check('UP 历史：标记总数 = 各卡池 UP 干员数之和',
  upAll.all.reduce((a, r) => a + r.count, 0), expectedMarks);
check('UP 历史：每位干员的标记按日期升序',
  upAll.all.every((r) => r.marks.every((m, i) => i === 0 || r.marks[i - 1].date <= m.date)), true);
check('UP 历史：lastDate = 最后一个标记的日期',
  upAll.all.every((r) => r.lastDate === r.marks[r.marks.length - 1].date), true);
check('UP 历史：count = 标记数', upAll.all.every((r) => r.count === r.marks.length), true);
check('UP 历史：默认按实装日升序',
  upAll.all.every((r, i) => i === 0
    || (upAll.all[i - 1].releaseDate || '9999') <= (r.releaseDate || '9999')), true);
check('UP 历史：条形起点（实装日）都有值', upAll.all.every((r) => !!r.releaseDate), true);

const upShop = computeUpHistory({
  banners, categories, operatorByName: operators, relDateOf, shopOnly: true,
});
check('UP 历史：只看进店时全部标记都是进店',
  upShop.all.every((r) => r.marks.every((m) => m.isShop)), true);
/* ⚠️ 下面两条原来写死 160 / 536 —— 数据一更新（新增卡池）就红。
   改成**独立算一遍**：直接扫原始卡池数据，数出「非限定、5★ 及以上、isShop」的干员与记录数，
   既与数据无关，也顺带核对 computeUpHistory 的进店筛选没漏没重。 */
const shopOps = new Set();
let shopMarks = 0;
for (const b of banners) {
  for (const o of b.upOperators) {
    if (!o.isShop || o.isLimited || (o.rarity || 0) < 5) continue;
    shopOps.add(o.name);
    shopMarks += 1;
  }
}
check('UP 历史：只看进店的干员数 = 有进店记录的干员数', upShop.all.length, shopOps.size);
check('UP 历史：只看进店的标记数 = 各卡池进店干员数之和',
  upShop.all.reduce((a, r) => a + r.count, 0), shopMarks);

const upStd = computeUpHistory({
  banners, categories, operatorByName: operators, relDateOf, types: ['double'],
});
check('UP 历史：按类型筛选后只含该类型',
  upStd.all.every((r) => r.marks.every((m) => m.type === 'double')), true);
check('UP 历史：只选 double 的干员 / 标记数',
  `${upStd.all.length}/${upStd.all.reduce((a, r) => a + r.count, 0)}`, '187/970');

const upSort = computeUpHistory({
  banners, categories, operatorByName: operators, relDateOf, sort: 'lastUp-desc',
});
check('UP 历史：最近 UP 降序',
  upSort.all.every((r, i) => i === 0 || upSort.all[i - 1].lastDate >= r.lastDate), true);
check('UP 历史：没有标记的干员不占行（只看进店时排除了未进店的）',
  upShop.all.every((r) => r.marks.length > 0), true);

/* ---------------- UP 历史：右栏「隐藏在结束日期已属中坚的干员」 ----------------
   判据 = 当前服务器「进入中坚寻访」的日期 ≤ 判据时点（右栏结束日期，未设则按今天）。
   ⚠️ 关键在**判据时点用什么**：设得越晚，被判成「已属中坚」的干员越多。
   这里用两个时点对比，既验功能也验「时点取自 range.to」这件事。 */
const CLASSIC_FIELD = { sc: 'classicDate', en: 'enClassicDate', tc: 'tcClassicDate' };
const classicDateOf = (op) => (op ? op[CLASSIC_FIELD.sc] || null : null);
const upAllNoCut = computeUpHistory({
  banners, categories, operatorByName: operators, relDateOf, classicDateOf, hideMid: true,
});
const upCutEarly = computeUpHistory({
  banners, categories, operatorByName: operators, relDateOf, classicDateOf, hideMid: true, today: '2024-01-01',
});
const upCutLate = computeUpHistory({
  banners, categories, operatorByName: operators, relDateOf, classicDateOf, hideMid: true, today: '2026-10-01',
});
check('UP 历史：不勾选时不受「已属中坚」影响',
  upAllNoCut.all.length, upAll.all.length);
check('UP 历史：勾选后行数变少', upCutEarly.all.length < upAll.all.length, true);
check('UP 历史：判据时点越晚，被隐藏的越多',
  upCutLate.all.length < upCutEarly.all.length, true);
check('UP 历史：勾选后留下的干员，判据时点都还没进中坚',
  upCutLate.all.every((r) => {
    const mid = classicDateOf(operators[r.name]);
    return !mid || mid > '2026-10-01';
  }), true);
/* range.to 优先于 today —— 这是用户确认的口径（判据时点取右栏的结束日期）。
   ⚠️ 不能拿总数比：`range` 本身还会过滤「范围内没有标记的干员」。
   直接看**留下来的行**：判据时点若真取了 range.to，就不可能留下 classicDate ≤ range.to 的干员。 */
const upCutByRange = computeUpHistory({
  banners, categories, operatorByName: operators, relDateOf, classicDateOf, hideMid: true,
  today: '2026-10-01', range: { from: '', to: '2024-01-01' },
});
check('UP 历史：判据时点取右栏结束日期（优先于今天）',
  upCutByRange.all.length > 0 && upCutByRange.all.every((r) => {
    const mid = classicDateOf(operators[r.name]);
    return !mid || mid > '2024-01-01';
  }), true);

/* ---------------- 卡池列表：寻访筛选改成多选（空 = 全部） ---------------- */
const fEmpty = emptyFilters();
check('卡池筛选：空条件 = 全部卡池', bannerRows(banners, fEmpty, categories, { key: 'startDate', dir: 'desc' }).length, banners.length);
check('卡池筛选：多选两个类型 = 两类卡池之和',
  bannerRows(banners, { ...fEmpty, types: ['double', 'classic'] }, categories, { key: 'startDate', dir: 'desc' }).length,
  banners.filter((b) => b.type === 'double' || b.type === 'classic').length);
check('卡池筛选：只选一个类型时行数 = 该类型卡池数',
  bannerRows(banners, { ...fEmpty, types: ['limcel'] }, categories, { key: 'startDate', dir: 'desc' }).length,
  banners.filter((b) => b.type === 'limcel').length);

/* ---------------- 数据不变量：进店标记只出现在「常驻标准 / 常驻中坚」上 ----------------
   UP 历史里「进店绿点」与「中坚甄选菱形」画在**同一个位置**（左上角），依据就是两者互斥
   —— `clafes` 池永远不带进店标记。哪天上游给中坚甄选也加上进店位，两个标记就会叠在一起；
   这条断言会立刻红，提醒重新安排位置（而不是等用户看图才发现）。 */
for (const [file, label] of [
  ['banners_sc.json', '国服'], ['banners_en.json', '国际服'], ['banners_tc.json', '繁中服'],
]) {
  if (!fs.existsSync(path.join(RES_DIR, file))) continue;
  const map = read(file);
  const shopTypes = new Set();
  let clafesShop = 0;
  for (const b of Object.values(map)) {
    const hasShop = b.upOperators.some((o) => o.isShop);
    if (hasShop) shopTypes.add(b.type);
    if (hasShop && b.type === 'clafes') clafesShop += 1;
  }
  check(`${label}：带进店标记的卡池类型只有 double / classic`,
    [...shopTypes].sort().join(','), 'classic,double');
  check(`${label}：中坚甄选池不带进店标记（两个标记同位的依据）`, clafesShop, 0);
}

/* ---------------- 卡池结束日期当日 = 已关闭 + 距今天数整体 +1 ----------------
   挑一个真实卡池，拿它的 endDate 当参考日期：结束日当天必须**不算进行中**，
   且**看到的是「1 天」**（2026-10-02 口径：把结束日当作第 1 天数）。 */
const sampleBanner = banners.find((b) => b.startDate < b.endDate);
check('结束日口径：卡池开始日当天算进行中',
  endInfo([sampleBanner], sampleBanner.startDate).live, true);
check('结束日口径：结束日**前一天**仍算进行中',
  endInfo([sampleBanner], shiftDays(sampleBanner.endDate, -1)).live, true);
check('结束日口径：结束日当天算已关闭',
  endInfo([sampleBanner], sampleBanner.endDate).live, false);
check('距今天数：结束日当天 = 1（整体 +1，用户指定的例子）',
  endInfo([sampleBanner], sampleBanner.endDate).days, 1);
check('距今天数：结束日次日 = 2',
  endInfo([sampleBanner], shiftDays(sampleBanner.endDate, 1)).days, 2);
check('距今天数：结束日 10 天后 = 11',
  endInfo([sampleBanner], shiftDays(sampleBanner.endDate, 10)).days, 11);
check('距今天数：进行中时为 null（界面显示「进行中」，不是 1）',
  endInfo([sampleBanner], sampleBanner.startDate).days, null);

/* 排序值：「进行中」与「结束日当天（1 天）」必须能分开（否则两类行并列混在一起）。
   进行中 = 0、无数据 = -1、真实天数从 1 起（结束日当天就是 1）。 */
check('排序值：进行中 = 0', daysSortValue({ live: true, days: null }), 0);
check('排序值：无数据 = -1', daysSortValue({ live: false, days: null }), -1);
check('排序值：结束日当天 = 1', daysSortValue({ live: false, days: 1 }), 1);
check('排序值：无数据 < 进行中 < 结束日当天（升序时特殊值排在最前）',
  daysSortValue({ live: false, days: null }) < daysSortValue({ live: true, days: null })
  && daysSortValue({ live: true, days: null }) < daysSortValue({ live: false, days: 1 }), true);

/* ---------------- UP 历史时间轴的坐标口径（月序号 value 轴） ---------------- */
check('月序号：1970-01-01 = 0', monthIndexOf('1970-01-01'), 0);
check('月序号：2026-01-01', monthIndexOf('2026-01-01'), 672);
check('月序号：相邻两个月相差 1', monthIndexOf('2026-02-01') - monthIndexOf('2026-01-01'), 1);
check('月序号：月内按天线性分摊（1-10 在 1-01 与 2-01 之间）',
  monthIndexOf('2026-01-10') > 672 && monthIndexOf('2026-01-10') < 673, true);
check('月标签格式：2026-01', monthLabel(672), '2026-01');
check('月标签格式：跨年 2026-12 → 2027-01', `${monthLabel(683)}/${monthLabel(684)}`, '2026-12/2027-01');
check('月标签格式：个位月份补零', monthLabel(591), '2019-04');

const tlFull = buildUpTimeline({ rows: upAll.six, operatorByName: operators });
check('时间轴：起点对齐到月初（整数月序号）', Number.isInteger(tlFull.xMin), true);
check('时间轴：起点就是最早的实装月（2019-04）', monthLabel(tlFull.xMin), '2019-04');
check('时间轴：跨度覆盖全部数据（≥ 89 个月）', tlFull.monthCount >= 89, true);
check('时间轴：范围外的标记被剔除（不超过全部标记数）',
  tlFull.markCount <= upAll.six.reduce((a, r) => a + r.count, 0), true);
/* 这里没传 showGaps → 走 buildUpTimeline 自己的默认值（开）。**页面上的默认是「不勾」**
   由右栏的勾选框决定（store 的 upShowGaps，初值 false），两者不是一回事，别混。 */
check('时间轴：有横条、标记、间隔文案三个 custom 系列（不传 showGaps 时默认为开）',
  tlFull.bodyOption.series.length === 3
  && tlFull.bodyOption.series.every((s) => s.type === 'custom'), true);
/* 右栏的「显示两次 UP 的间隔天数」勾选框：关掉就只剩横条 + 标记两个系列 */
const tlNoGap = buildUpTimeline({ rows: upAll.six, showGaps: false, operatorByName: operators });
check('时间轴：关掉间隔文案后只剩两个系列', tlNoGap.bodyOption.series.length, 2);
check('时间轴：横轴刻度间隔 = 1 个月（每月 1 号）',
  tlFull.axisOption.xAxis.interval === 1 && tlFull.bodyOption.xAxis.interval === 1, true);
/* 刻度条不再用 echarts 的坐标轴，改成 custom 自绘（见 upTimeline 的注释：
   给 axisLabel 设 rotate 会让 echarts 把绘图区往里缩 13px，导致与表体对不齐）。
   所以这里断言「自绘的刻度数据 = 每月一个」而不是 axisLabel.formatter。 */
check('时间轴：刻度条自绘每个月一个刻度（91 个月）',
  tlFull.axisOption.series[0].data.length, tlFull.monthCount + 1);
/* ⚠️ 不能用 `xAxis.show:false` —— 那会把 splitLine 一起关掉（表体就一条竖线都没有了）。
   必须逐项隐藏 axisLine/axisTick/axisLabel，并显式控制 splitLine。 */
check('时间轴：刻度条不画 echarts 自己的轴与线（全部逐项关闭）',
  tlFull.axisOption.xAxis.axisLine.show === false
  && tlFull.axisOption.xAxis.axisTick.show === false
  && tlFull.axisOption.xAxis.axisLabel.show === false
  && tlFull.axisOption.xAxis.splitLine.show === false, true);
check('时间轴：表体保留每月一条竖线（splitLine 开着、轴向三件套关着）',
  tlFull.bodyOption.xAxis.splitLine.show === true
  && tlFull.bodyOption.xAxis.axisLine.show === false
  && tlFull.bodyOption.xAxis.axisTick.show === false
  && tlFull.bodyOption.xAxis.axisLabel.show === false, true);
check('时间轴：刻度条与表体的竖线颜色一致（接起来看不出断口）',
  tlFull.axisOption.xAxis.splitLine.show === false
  && tlFull.bodyOption.xAxis.splitLine.lineStyle.color === TL.lineColor, true);
check('时间轴：标签旋转角度为正值（负值会让文字往右下压住竖线）',
  TL.labelRotate > 0, true);
check('时间轴：刻度数据就是月序号（首 = xMin）',
  tlFull.axisOption.series[0].data[0], tlFull.xMin);
check('时间轴：纵轴不再画名字（由左侧固定列显示）',
  tlFull.bodyOption.yAxis.axisLabel.show, false);
check('时间轴：主体高度 = 行数 × 行高 + 留白',
  chartHeight(upAll.six), upAll.six.length * TL.rowH + TL.gridTop + TL.gridBottom);

const tlRange = buildUpTimeline({
  rows: upAll.six, xRange: { from: '2024-01-01', to: '2026-09-30' }, operatorByName: operators,
});
check('时间轴：设时间范围后从 2024-01 起', monthLabel(tlRange.xMin), '2024-01');
check('时间轴：设时间范围后月数明显变少', tlRange.monthCount < tlFull.monthCount / 2, true);
check('时间轴：设时间范围后标记也被裁掉（只留范围内的）',
  tlRange.markCount < tlFull.markCount, true);
check('最小宽度：随跨度缩放（范围越窄越窄）',
  minInnerWidth(tlRange.xMin, tlRange.xMax) < minInnerWidth(tlFull.xMin, tlFull.xMax), true);
/* 口径是「1 天 = 1px」（用户指定，不管标签会不会重叠） */
check('最小宽度 = 名字列 + 天数×1px + 左右内缩',
  minInnerWidth(tlFull.xMin, tlFull.xMax),
  TL.nameW + TL.padLeft + TL.padRight
    + diffDays(monthStartDate(tlFull.xMax), monthStartDate(tlFull.xMin)) * TL.dayPx);
check('最小宽度口径：1 天 1px', TL.dayPx, 1);
check('最小宽度 ≈ 全范围天数（2019-04-01 → 2026-10-01，2740 天左右）',
  minInnerWidth(tlFull.xMin, tlFull.xMax) > 2700
  && minInnerWidth(tlFull.xMin, tlFull.xMax) < 2900, true);
check('横轴标签斜排（与首次UP间隔一致的 60°，自绘时用 TL.labelRotate）',
  TL.labelRotate, 60);
/* 刻度条与表体必须共用同一份 grid 与同一套 scale —— 这是「竖线对齐」的根据 */
check('刻度条与表体的 grid 左右内缩一致',
  `${tlFull.axisOption.grid.left}/${tlFull.axisOption.grid.right}`
  === `${tlFull.bodyOption.grid.left}/${tlFull.bodyOption.grid.right}`, true);
check('刻度条与表体的 x 轴范围一致',
  `${tlFull.axisOption.xAxis.min}-${tlFull.axisOption.xAxis.max}`
  === `${tlFull.bodyOption.xAxis.min}-${tlFull.bodyOption.xAxis.max}`, true);

/* ---------------- 与原型逐格对比 ---------------- */
const protoPath = path.join(ROOT, 'prototype/index.html');
const hasProto = fs.existsSync(protoPath);
const protoHtml = hasProto ? fs.readFileSync(protoPath, 'utf8') : '';

const stripTags = (s) => s.replace(/<[^>]+>/g, '').trim();

/** 取某个分节标题之后第一张表的 tbody，返回每行的单元格文本数组 */
function parseStatTable(html, anchorId) {
  const start = html.indexOf(`id="${anchorId}"`);
  if (start < 0) return null;
  const t = html.indexOf('<tbody>', start);
  const e = html.indexOf('</tbody>', t);
  if (t < 0 || e < 0) return null;
  return html
    .slice(t + '<tbody>'.length, e)
    .split('<tr>')
    .slice(1)
    .map((tr) => [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1])));
}

/** 我这边同一格里应该显示的文本 */
const myEnd = (info) => info.end || '—';
const myDays = (info) => (info.live ? '进行中' : info.days === null ? '—' : String(info.days));

const TABLES = [
  { anchor: 's-6-std', rarity: 6, mid: false, split: false },
  { anchor: 's-6-mid', rarity: 6, mid: true, split: true },
  { anchor: 's-5-std', rarity: 5, mid: false, split: false },
  { anchor: 's-5-mid', rarity: 5, mid: true, split: true },
];

let cellDiff = 0;
let cellTotal = 0;
const diffs = [];

if (hasProto) {
  for (const t of TABLES) {
    const parsed = parseStatTable(protoHtml, t.anchor);
    const list = sortStatRows(
      rows.filter((r) => r.rarity === t.rarity && r.everMid === t.mid), null, refDate,
    );
    check(`表 ${t.anchor} 行数与原型一致`, list.length, parsed ? parsed.length : -1);

    const byName = Object.fromEntries(list.map((r) => [r.name, r]));
    for (const cells of parsed || []) {
      const name = cells[1];
      const r = byName[name];
      if (!r) { diffs.push(`${t.anchor} 原型多出干员「${name}」`); cellDiff += 1; continue; }
      const up = endInfo(r.upAll, refDate);
      const shop = endInfo(r.shopAll, refDate);
      const expected = [
        r.releaseDate || '—',
        name,
        myEnd(up), myDays(up), String(r.upAll.length),
        ...(t.split ? [String(r.upMid.length), String(r.upStd.length)] : []),
        myEnd(shop), myDays(shop), String(r.shopAll.length),
        ...(t.split ? [String(r.shopMid.length), String(r.shopStd.length)] : []),
      ];
      cells.forEach((v, i) => {
        cellTotal += 1;
        if (v !== expected[i]) {
          cellDiff += 1;
          if (diffs.length < 12) diffs.push(`${t.anchor} ${name} 第${i}格: 原型「${v}」≠ 计算「${expected[i]}」`);
        }
      });
    }
  }
  check('与原型逐格对比（差异数）', cellDiff, 0);
} else {
  console.log('（未找到 prototype/index.html，跳过逐格对比；先运行 pnpm build:prototype）');
}

// ---- 输出 ----
let bad = 0;
for (const r of results) {
  if (r.expected === null) { console.log(`· ${r.label}: ${r.actual}`); continue; }
  if (!r.ok) bad += 1;
  console.log(`${r.ok ? '✓' : '✗'} ${r.label}: ${r.actual}${r.ok ? '' : ` （期望 ${r.expected}）`}`);
}
if (diffs.length) {
  console.log('\n差异明细：');
  for (const d of diffs) console.log('  - ' + d);
}
console.log(
  hasProto
    ? `\n逐格核对：${cellTotal - cellDiff}/${cellTotal} 格一致`
    : '',
);
console.log(bad ? `\n✗ 有 ${bad} 项不一致` : '\n✓ 数据层核对通过');
process.exit(bad ? 1 : 0);

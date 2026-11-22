<script setup>
/**
 * 出率提升记录表（两行表头）。
 *
 * - 标准寻访表（split=false）：每组 3 列 → 结束时间 / 距今天数 / 次数
 * - 中坚寻访表（split=true） ：每组 5 列 → 结束时间 / 距今天数 / 总次数 / 中坚次数 / 标准次数
 *   ⚠️ 右栏「合并中坚寻访三个次数」勾上时（`merge`，2026-11-22 用户加）：三个次数并成**一列**，
 *     值写成 `总/中坚/标准`（如 `8/1/9`，中坚蓝 `#0098DC`、标准黄 `#a97400`），
 *     表头叫「次数」、排序 key 挂 `upMid` / `shopMid`（= **以中坚次数为准**）；
 *     `merge` / `groupCols` / `totalCols` 三个 computed 一起管列数，别只改一处。
 *     ⚠️ 原先那个「中坚寻访不看标准次数」开关（`statMidNoStd`）已于同日**删除**，别复活。
 *     ⚠️ 标准寻访表**不受影响** —— 它那一列叫「次数」、本来就没有「标准次数」的概念。
 *     ⚠️ 藏列会改 colspan（组头 + 空行）与单元格个数，`verify-render` 有断言盯着。
 * - 列宽按内容自适应（table-layout:auto），列间竖线与 sticky 表头对齐由全局 CSS 处理
 * - 距今天数着色：≥180 天标黄、≥365 天标红；卡池进行中显示「进行中」
 * - 右栏「高亮干员」命中的行加**浅黄底**（`.hl`），「置灰干员」命中的行盖**灰罩**（`.mute`）——
 *   两者都是纯视觉标记、不筛行，且**互斥**（同一个干员不会既高亮又置灰）；
 *   前两列是 sticky 冻结列、走 `background:inherit`，所以只需给 `<tr>` 设底色即可跟着高亮
 * - ⚠️ 「结束时间 / 距今天数」两组列走 `lib/stats.js` 的 **`viewEndInfo()`**（不是直接用 `endInfo`）——
 *   右栏「中坚寻访只看中坚」勾上时，中坚干员改按**中坚记录**算；
 *   从未在中坚 UP 过的，结束时间显示 `—`、天数自**迁入中坚寻访**那天起算（鼠标悬停有说明）。
 */
import { computed, ref } from 'vue';
import { WARN_DAYS, DANGER_DAYS } from '../lib/constants.js';
import { viewEndInfo } from '../lib/stats.js';
/* 干员名的**自适应字号** —— 列宽收窄后，超字数的名字降字号塞进去（口径见 lib/opNameFit.js）。
   ⚠️ 别把这段说明写成 HTML 注释塞进 `<td>` 里：Vue SSR 会**原样输出**注释，于是
     「`<td class="opcell">` 紧跟 `<b>`」这类相邻匹配就断了（2026-10-16 真踩过）。 */
import { opNameStyle } from '../lib/opNameFit.js';
import AvatarImg from './AvatarImg.vue';
import { useSiteStore } from '../stores/site.js';

const props = defineProps({
  tableId: { type: String, required: true },
  rows: { type: Array, required: true },
  split: { type: Boolean, default: false }, // true = 中坚寻访表（多「中坚/标准次数」两列）
});

const site = useSiteStore();

/** 图片模式：干员列显示头像；统计页用**长方形蒙版**（宽是高的 2 倍），见 main.css 的 .avt-rect */
const isImage = computed(() => site.avatarMode === 'image');
/** 头像按 charId 取 —— 表格行上只有名字，用名字回查完整干员对象（取不到就用 `{ name }` 退化） */
const opOf = (name) => site.operators[name] || { scName: name };

const refDate = computed(() => site.refDate || site.today);
const sort = computed(() => site.statSort[props.tableId]);
/** 右栏「中坚寻访只看中坚」—— 只对中坚干员生效，见 lib/stats.js 的 viewEndInfo() */
const midOnly = computed(() => site.statMidOnly);

/**
 * 右栏「合并中坚寻访三个次数」（2026-11-22 用户加，**取代**同日删掉的「不看标准次数」）——
 * 只对中坚表（`split`）生效：
 * 把「总次数 / 中坚次数 / 标准次数」三列收成**一列「次数」**，值写成 `总/中坚/标准`（如 `8/1/9`），
 * 中坚那一段标蓝、标准那一段标黄；排序挂的中坚 key（`upMid` / `shopMid`），即**以中坚次数为准**。
 * ⚠️ 说明写在这里、别写进 `<template>`：SSR 会把模板注释原样输出，断言会多数一串字。
 */
const merge = computed(() => props.split && site.statMidMergeCounts);
/** 每组实际显示的列数：标准表恒为 3；中坚表默认 5，勾了「合并」收成 3（驱动组头 colspan） */
const groupCols = computed(() => (props.split && !merge.value ? 5 : 3));
/** 整行「暂无数据」要跨的列数 = 2（实装时间 / 干员）+ 两组 */
const totalCols = computed(() => 2 + groupCols.value * 2);

/** 右栏「高亮干员」—— 用 Set 查，避免每行都扫一遍数组（四张表合计几百行） */
const hlOps = computed(() => new Set(site.statHighlightOps));
/** 右栏「置灰干员」（2026-11-17 用户加）—— 同一套查法，行上盖灰罩（`.mute`，见 main.css）。
 *  ⚠️ 与 `hlOps` **互斥**（store 的 setter 保证同一名字不会同时在两边），所以两个类不会同时命中 */
const hideOps = computed(() => new Set(site.statHideOps));
/**
 * 右栏「编辑模式」开着时，**点一行**循环它的状态：普通 → 置灰 → 高亮 → 普通
 * （2026-11-21 用户加，规则收在 store 的 `cycleStatOp`）。
 * ⚠️ 只有这一处绑 `@click`：表的其余交互都在 `<th>`（排序）上，不冲突。
 */
const editMode = computed(() => site.statEditMode);
const onRowClick = (name) => {
  if (editMode.value) site.cycleStatOp(name);
};

/** 预计算每行的「最后一次出率提升 / 商店兑换」信息，避免模板里反复遍历 */
const viewRows = computed(() =>
  props.rows.map((r) => ({
    ...r,
    up: viewEndInfo(r, 'up', refDate.value, midOnly.value),
    shop: viewEndInfo(r, 'shop', refDate.value, midOnly.value),
  })),
);

/** 「只看中坚」+ 从未在中坚 UP 过 → 天数是自迁入日算的，给个 tooltip 说清楚 */
const fromClassicTitle = (r) => `从未在中坚寻访 UP 过；距今天数自迁入中坚寻访（${r.classicDate}）起算`;

/**
 * 结束时间的**悬停气泡**（2026-11-22 用户加）：显示这一格对应的卡池 —— 卡池名 + 时间范围。
 *
 * 数据来自 `viewEndInfo(...).banner`（= `endInfo` 里那个「最晚结束」的卡池对象本身），
 * 所以气泡里的「结束时间」必然与格子里的日期一致；`fromClassic`（自迁入日起算、没有卡池）
 * 时 `banner` 为 null → 不弹气泡，仍走原来的 `title`。
 *
 * ⚠️ 气泡用 `position:fixed`：表格外层 `.tbl-scroll` 是 `overflow:auto`，
 *    绝对定位的气泡会被**裁掉**（与图表浮窗同一个坑）。
 * ⚠️ 靠近视口顶部时翻到格子**下方**（`down`），否则会被顶栏挡住 / 跑到屏幕外。
 */
const tip = ref(null);
const showTip = (e, b) => {
  if (!b || !b.scName) return;
  const r = e.currentTarget.getBoundingClientRect();
  tip.value = { name: b.scName, from: b.startDate, to: b.endDate, x: r.left + r.width / 2, y: r.top };
};
const hideTip = () => { tip.value = null; };
const tipPos = computed(() => {
  const t = tip.value;
  if (!t) return null;
  const below = t.y < 96;
  return {
    cls: below ? 'endtip down' : 'endtip',
    style: { left: `${t.x}px`, top: `${below ? t.y + 28 : t.y - 8}px` },
  };
});

const sortClass = (key) =>
  sort.value && sort.value.key === key ? `sort-${sort.value.dir}` : '';

const onSort = (key) => site.toggleStatSort(props.tableId, key);
</script>

<template>
  <div class="tbl-scroll plain" :id="`tbl-${tableId}`" :class="{ 'edit-mode': editMode }">
    <!-- img-mode：图片模式的样式钩子（长方形蒙版头像 + 干员格的占位行框，见 main.css） -->
    <table class="grid floating stat-tbl" :class="{ 'img-mode': isImage }">
      <!-- 只给前两列定宽：它们要 sticky 冻结，第 2 列的 left 偏移必须等于第 1 列的实际宽度，
           不能让它随内容变。
           84px = 日期（`2026-10-01`，13px 常规字重 66px）+ 左右内边距 12px **+ 6px 余量**，
             ⚠️ 2026-10-16 由 78px 加到 84px —— 78px 内容区恰好 66px、**零余量**，Windows 上够，
                但手机字体（PingFang / Roboto）的数字与连字符更宽 → 溢出后被旁边 sticky 的
                「干员」列盖住，表现就是「实装时间显示不全」。详见 main.css 那段。
           84px = 干员列。⚠️ 2026-10-16 由 103px（按「7 个汉字」）收到 84px ——
             实测 2 字的名字占 123/232 位，为最长名（`凯尔希·思衡托`，等效 6.5 字）让所有名字
             一起变宽不划算；现在**按常见长度定宽 + 超字数的名字降字号**（13 → 11 → 10px），
             口径与算法收口在 `lib/opNameFit.js`（纯函数、SSR 可测），模板上走 `opNameStyle()`。
           ⚠️ 改动这两个值要**同时**改 main.css 里对应的 width/min/max 与第 2 列的 left，
              以及 `lib/opNameFit.js` 的 `OP_NAME_COL_W`。 -->
      <colgroup>
        <col style="width: 84px" />
        <col style="width: 84px" />
      </colgroup>
      <thead>
        <tr>
          <th
            rowspan="2" class="num" data-sort="releaseDate"
            :class="sortClass('releaseDate')" @click="onSort('releaseDate')"
          >实装时间<span class="arw">▲</span></th>
          <th
            rowspan="2" data-sort="name"
            :class="sortClass('name')" @click="onSort('name')"
          >干员<span class="arw">▲</span></th>
          <th class="group" :colspan="groupCols">出率提升</th>
          <th class="group grp-shop" :colspan="groupCols">商店兑换</th>
        </tr>
        <tr>
          <th class="num" data-sort="upEnd" :class="sortClass('upEnd')" @click="onSort('upEnd')">
            结束时间<span class="arw">▲</span>
          </th>
          <th class="num" data-sort="upDays" :class="sortClass('upDays')" @click="onSort('upDays')">
            距今天数<span class="arw">▲</span>
          </th>
          <th
            v-if="merge" class="num" data-sort="upMid"
            :class="sortClass('upMid')" @click="onSort('upMid')"
          >次数<span class="arw">▲</span></th>
          <template v-else>
            <th
              class="num" data-sort="upTotal"
              :class="sortClass('upTotal')" @click="onSort('upTotal')"
            >{{ split ? '总次数' : '次数' }}<span class="arw">▲</span></th>
            <template v-if="split">
              <th class="num" data-sort="upMid" :class="sortClass('upMid')" @click="onSort('upMid')">
                中坚次数<span class="arw">▲</span>
              </th>
              <th
                class="num" data-sort="upStd"
                :class="sortClass('upStd')" @click="onSort('upStd')"
              >标准次数<span class="arw">▲</span></th>
            </template>
          </template>
          <th class="num shopcol" data-sort="shopEnd" :class="sortClass('shopEnd')" @click="onSort('shopEnd')">
            结束时间<span class="arw">▲</span>
          </th>
          <th class="num shopcol" data-sort="shopDays" :class="sortClass('shopDays')" @click="onSort('shopDays')">
            距今天数<span class="arw">▲</span>
          </th>
          <th
            v-if="merge" class="num shopcol" data-sort="shopMid"
            :class="sortClass('shopMid')" @click="onSort('shopMid')"
          >次数<span class="arw">▲</span></th>
          <template v-else>
            <th
              class="num shopcol" data-sort="shopTotal"
              :class="sortClass('shopTotal')" @click="onSort('shopTotal')"
            >{{ split ? '总次数' : '次数' }}<span class="arw">▲</span></th>
            <template v-if="split">
              <th class="num shopcol" data-sort="shopMid" :class="sortClass('shopMid')" @click="onSort('shopMid')">
                中坚次数<span class="arw">▲</span>
              </th>
              <th
                class="num shopcol" data-sort="shopStd"
                :class="sortClass('shopStd')" @click="onSort('shopStd')"
              >标准次数<span class="arw">▲</span></th>
            </template>
          </template>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!viewRows.length">
          <td :colspan="totalCols"><div class="empty">暂无数据</div></td>
        </tr>
        <tr
          v-for="r in viewRows" :key="r.name"
          :class="{ hl: hlOps.has(r.name), mute: hideOps.has(r.name) }"
          @click="onRowClick(r.name)"
        >
          <td class="num">
            <span v-if="!r.releaseDate" class="dash">—</span><template v-else>{{ r.releaseDate }}</template>
          </td>
          <td class="wrapcell">
            <AvatarImg v-if="isImage" :op="opOf(r.name)" shape="square" img-class="avt-rect" />
            <b v-else :style="opNameStyle(r.name)">{{ r.name }}</b>
          </td>
          <!-- 出率提升 -->
          <td
            class="num endcell" :title="r.up.fromClassic ? fromClassicTitle(r) : null"
            @mouseenter="showTip($event, r.up.banner)" @mouseleave="hideTip"
          >
            <span v-if="!r.up.end" class="dash">—</span><template v-else>{{ r.up.end }}</template>
          </td>
          <td class="num" :title="r.up.fromClassic ? fromClassicTitle(r) : null">
            <span v-if="r.up.live" class="pill-live">进行中</span>
            <span v-else-if="r.up.days === null" class="dash">—</span>
            <span v-else-if="r.up.days >= DANGER_DAYS" class="hot">{{ r.up.days }}</span>
            <span v-else-if="r.up.days >= WARN_DAYS" class="warn">{{ r.up.days }}</span>
            <template v-else>{{ r.up.days }}</template>
          </td>
          <template v-if="merge">
            <td class="num cnt-merge"><span class="cnt-box"><span class="cnt-all">{{ r.upAll.length }}</span><span class="cnt-sep">/</span><span class="cnt-mid">{{ r.upMid.length }}</span><span class="cnt-sep">/</span><span class="cnt-std">{{ r.upStd.length }}</span></span></td>
          </template>
          <template v-else>
            <td class="num">{{ r.upAll.length }}</td>
            <template v-if="split">
              <td class="num">{{ r.upMid.length }}</td>
              <td class="num">{{ r.upStd.length }}</td>
            </template>
          </template>
          <!-- 商店兑换 -->
          <td
            class="num endcell" :title="r.shop.fromClassic ? fromClassicTitle(r) : null"
            @mouseenter="showTip($event, r.shop.banner)" @mouseleave="hideTip"
          >
            <span v-if="!r.shop.end" class="dash">—</span><template v-else>{{ r.shop.end }}</template>
          </td>
          <td class="num" :title="r.shop.fromClassic ? fromClassicTitle(r) : null">
            <span v-if="r.shop.live" class="pill-live">进行中</span>
            <span v-else-if="r.shop.days === null" class="dash">—</span>
            <span v-else-if="r.shop.days >= DANGER_DAYS" class="hot">{{ r.shop.days }}</span>
            <span v-else-if="r.shop.days >= WARN_DAYS" class="warn">{{ r.shop.days }}</span>
            <template v-else>{{ r.shop.days }}</template>
          </td>
          <template v-if="merge">
            <td class="num cnt-merge"><span class="cnt-box"><span class="cnt-all">{{ r.shopAll.length }}</span><span class="cnt-sep">/</span><span class="cnt-mid">{{ r.shopMid.length }}</span><span class="cnt-sep">/</span><span class="cnt-std">{{ r.shopStd.length }}</span></span></td>
          </template>
          <template v-else>
            <td class="num">{{ r.shopAll.length }}</td>
            <template v-if="split">
              <td class="num">{{ r.shopMid.length }}</td>
              <td class="num">{{ r.shopStd.length }}</td>
            </template>
          </template>
        </tr>
      </tbody>
    </table>
    <div v-if="tipPos" :class="tipPos.cls" :style="tipPos.style">
      <b class="endtip-name">{{ tip.name }}</b>
      <span class="endtip-range">{{ tip.from }} ~ {{ tip.to }}</span>
    </div>
  </div>
</template>

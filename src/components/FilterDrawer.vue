<script setup>
/**
 * 右抽屉：只装当前页面用得到的筛选。
 *  - 卡池列表页   → 筛选表单（类型 / 大类 / 开始日期范围 / UP 干员名）
 *  - 统计页       → 参考日期
 *  - 首次进店间隔 → 口径切换 + 首次进店日期范围
 *  - UP 历史一览  → 时间范围（横轴）+ 纵轴排序 + 卡池类型多选 + 只看进店
 *
 * 两条「时间范围」共用同一套「草稿 + 确认」逻辑，见 composables/useRangeDraft.js。
 */
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  TYPE_LABEL, TYPE_ORDER, CAT_ORDER, CAT_COLOR, CAT_INK, TYPES_BY_CATEGORY, UP_SORT_ROWS,
} from '../lib/constants.js';
import { useSiteStore } from '../stores/site.js';
import { useLayout } from '../composables/useLayout.js';
import { useRangeDraft } from '../composables/useRangeDraft.js';

const site = useSiteStore();
const route = useRoute();
const { filterShow, toggleFilter } = useLayout();

const isBanners = computed(() => route.name === 'banners');
const isStats = computed(() => route.name === 'stats');
const isShop = computed(() => route.name === 'shopInterval');
const isUp = computed(() => route.name === 'upHistory');

const filterTitle = computed(() => {
  if (isStats.value) return '参考日期';
  if (isShop.value) return '首次进店日期范围';
  if (isUp.value) return '时间范围与筛选';
  return '数据筛选';
});

/** 有进店记录的日期边界（首末进店日），用作日期输入的上下限 */
const shopBounds = computed(() => site.firstShop.bounds);

const bannerResult = computed(
  () => `命中 ${site.bannerRows.length} / ${site.banners.length} 个卡池`,
);

const statResult = computed(() => {
  const { visible, map } = site.statData;
  return `参考日期 ${site.refDate} · 可见卡池 ${visible.length} 个 · 参与统计干员 ${Object.keys(map).length} 位`;
});

const shopResult = computed(() => {
  const { six, five, rows } = site.firstShop;
  return `命中 六星 ${six.length} 位 / 五星 ${five.length} 位（共 ${rows.length} 位有进店记录）`;
});

const upResult = computed(() => {
  const { six, five } = site.upHistory;
  const marks = [...six, ...five].reduce((a, r) => a + r.count, 0);
  return `六星 ${six.length} 位 / 五星 ${five.length} 位 · 共 ${marks} 个 UP 标记`;
});

/* ---------------- 两条「时间范围」共用的草稿+确认逻辑 ---------------- */
const {
  draftFrom: shopFrom, draftTo: shopTo, yearsInput: shopYears, error: shopError,
  fromDirty: shopFromDirty, toDirty: shopToDirty,
  confirmFrom: confirmShopFrom, confirmTo: confirmShopTo,
  confirmYears: confirmShopYears, reset: resetShop,
} = useRangeDraft(
  () => site.shopRange,
  (f, t) => site.setShopRange(f, t),
  (n) => site.applyShopYears(n),
);

const {
  draftFrom: upFrom, draftTo: upTo, yearsInput: upYears, error: upError,
  fromDirty: upFromDirty, toDirty: upToDirty,
  confirmFrom: confirmUpFrom, confirmTo: confirmUpTo,
  confirmYears: confirmUpYears, reset: resetUpRange,
} = useRangeDraft(
  () => site.upRange,
  (f, t) => site.setUpRange(f, t),
  (n) => site.applyUpYears(n),
);

/* ---------------- UP 历史：卡池类型（**直接可点的两级按钮组**） ----------------
   不再用下拉菜单：点类型按钮即刻筛选（变蓝），点大类按钮把该大类下的类型全选 / 全不选。 */
const typesOf = (cat) => site.typesByCategory[cat] || [];
const allOn = (cat) => {
  const list = typesOf(cat);
  return list.length > 0 && list.every((t) => site.upTypes.includes(t));
};
const someOn = (cat) => typesOf(cat).some((t) => site.upTypes.includes(t));

/** 右栏顶部的一行摘要（按钮组本身已经很直观，这里只给个计数） */
const upTypesLabel = computed(() => {
  if (site.upShopOnly) return '只看进店（类型筛选已禁用）';
  if (!site.upTypes.length) return '全部类型';
  return `已选 ${site.upTypes.length} 种`;
});

function resetUp() {
  resetUpRange();
  site.setUpSort('release-asc');
  site.setUpTypes([]);
  site.setUpShopOnly(false);
  site.setUpShowAll(false);
}
</script>

<template>
  <aside class="drawer drawer-right" :class="{ show: filterShow }">
    <div class="drawer-hd">
      <span class="h">{{ filterTitle }}</span>
      <button class="drawer-close" type="button" title="收起" @click="toggleFilter">✕</button>
    </div>

    <!-- 卡池列表的筛选（竖排） -->
    <div v-if="isBanners" class="drawer-bd pane pane-banners">
      <div class="fgroup">
        <label for="f-type">寻访类型</label>
        <select id="f-type" v-model="site.filters.type">
          <option value="">全部类型</option>
          <option v-for="t in TYPE_ORDER" :key="t" :value="t">{{ TYPE_LABEL[t] }}</option>
        </select>
      </div>
      <div class="fgroup">
        <label for="f-cat">寻访大类</label>
        <select id="f-cat" v-model="site.filters.cat">
          <option value="">全部大类</option>
          <option v-for="c in CAT_ORDER" :key="c" :value="c">{{ c }}</option>
        </select>
      </div>
      <div class="fgroup">
        <label for="f-from">开始日期 ≥</label>
        <input id="f-from" v-model="site.filters.from" type="date" />
      </div>
      <div class="fgroup">
        <label for="f-to">开始日期 ≤</label>
        <input id="f-to" v-model="site.filters.to" type="date" />
      </div>
      <div class="fgroup">
        <label for="f-op">UP 干员名</label>
        <input id="f-op" v-model="site.filters.op" type="text" placeholder="如：银灰" />
      </div>
      <button class="btn" type="button" @click="site.resetFilters()">重置筛选</button>
      <div class="fresult">{{ bannerResult }}</div>
    </div>

    <!-- 出率提升记录：参考日期只作用于本页 -->
    <div v-else-if="isStats" class="drawer-bd pane pane-stats">
      <div class="fgroup">
        <label for="refDate">参考日期</label>
        <input
          id="refDate" type="date" :value="site.refDate"
          @change="site.setRefDate($event.target.value)"
        />
      </div>
      <div class="btn-row">
        <button class="btn" type="button" @click="site.setRefDate(site.today)">今天</button>
      </div>
      <div class="fhint">
        仅统计 <code>卡池开启日期 ≤ 参考日期</code> 的卡池，用于回看任意历史时点的出率提升记录。
        不影响「卡池列表」页。
      </div>
      <div class="fresult">{{ statResult }}</div>
    </div>

    <!-- 首次进店间隔：口径切换 + 按首次进店日期筛选 -->
    <div v-else-if="isShop" class="drawer-bd pane pane-shop">
      <div class="fgroup">
        <label>横轴（顺序与轴标签日期）</label>
        <div class="seg">
          <button
            type="button" :class="{ on: site.shopAxis === 'firstShop' }"
            @click="site.setShopAxis('firstShop')"
          >按首次进店日期</button>
          <button
            type="button" :class="{ on: site.shopAxis === 'release' }"
            @click="site.setShopAxis('release')"
          >按实装日期</button>
        </div>
      </div>
      <div class="fgroup">
        <label>纵轴</label>
        <div class="seg">
          <button
            type="button" :class="{ on: site.shopMetric === 'gap' }"
            @click="site.setShopMetric('gap')"
          >距上个首次进店</button>
          <button
            type="button" :class="{ on: site.shopMetric === 'sinceRelease' }"
            @click="site.setShopMetric('sinceRelease')"
          >距实装日期</button>
        </div>
      </div>
      <div class="fgroup">
        <label>快速填入日期范围</label>
        <div class="quick-row">
          <span class="q-txt">近</span>
          <input
            id="shop-years" v-model="shopYears" type="number" min="1" step="1"
            inputmode="numeric" title="输入正整数年数" @keyup.enter="confirmShopYears"
          />
          <span class="q-txt">年</span>
          <button class="btn sm" type="button" @click="confirmShopYears">确认</button>
        </div>
      </div>
      <div class="fgroup">
        <label for="shop-from">开始日期</label>
        <div class="date-row">
          <input
            id="shop-from" v-model="shopFrom" type="date" :class="{ dirty: shopFromDirty }"
            :min="shopBounds.min" :max="shopBounds.max" @keyup.enter="confirmShopFrom"
          />
          <button class="btn sm" type="button" @click="confirmShopFrom">确认</button>
        </div>
      </div>
      <div class="fgroup">
        <label for="shop-to">结束日期</label>
        <div class="date-row">
          <input
            id="shop-to" v-model="shopTo" type="date" :class="{ dirty: shopToDirty }"
            :min="shopBounds.min" :max="shopBounds.max" @keyup.enter="confirmShopTo"
          />
          <button class="btn sm" type="button" @click="confirmShopTo">确认</button>
        </div>
      </div>

      <p v-if="shopError" class="ferr">{{ shopError }}</p>

      <div class="btn-row">
        <button class="btn" type="button" @click="resetShop">全部</button>
      </div>
      <div class="fhint">
        只保留<b>首次进店日</b>落在区间内的干员（可用范围
        <code>{{ shopBounds.min }} ~ {{ shopBounds.max }}</code>），区间内按<b>同星级</b>重新计算相邻间隔，
        纵轴起点与刻度会跟着数据变。日期框<b>描红</b>表示改动还没确认；
        两端冲突时以刚确认的一端为准，自动把另一端挪到相隔 1 天。不影响其他页面。
      </div>
      <div class="fresult">{{ shopResult }}</div>
    </div>

    <!-- UP 历史一览 -->
    <div v-else class="drawer-bd pane pane-up">
      <div class="fgroup">
        <label>切换星级</label>
        <div class="seg">
          <button
            type="button" :class="{ on: site.upRarity === 6 }"
            @click="site.setUpRarity(6)"
          >六星（{{ site.upHistory.six.length }}）</button>
          <button
            type="button" :class="{ on: site.upRarity === 5 }"
            @click="site.setUpRarity(5)"
          >五星（{{ site.upHistory.five.length }}）</button>
        </div>
      </div>

      <div class="fgroup">
        <label>快速填入日期范围</label>
        <div class="quick-row">
          <span class="q-txt">近</span>
          <input
            id="up-years" v-model="upYears" type="number" min="1" step="1"
            inputmode="numeric" title="输入正整数年数" @keyup.enter="confirmUpYears"
          />
          <span class="q-txt">年</span>
          <button class="btn sm" type="button" @click="confirmUpYears">确认</button>
        </div>
      </div>
      <div class="fgroup">
        <label for="up-from">开始日期</label>
        <div class="date-row">
          <input
            id="up-from" v-model="upFrom" type="date" :class="{ dirty: upFromDirty }"
            @keyup.enter="confirmUpFrom"
          />
          <button class="btn sm" type="button" @click="confirmUpFrom">确认</button>
        </div>
      </div>
      <div class="fgroup">
        <label for="up-to">结束日期</label>
        <div class="date-row">
          <input
            id="up-to" v-model="upTo" type="date" :class="{ dirty: upToDirty }"
            @keyup.enter="confirmUpTo"
          />
          <button class="btn sm" type="button" @click="confirmUpTo">确认</button>
        </div>
      </div>

      <p v-if="upError" class="ferr">{{ upError }}</p>

      <label class="chk">
        <input
          type="checkbox" :checked="site.upShowAll"
          @change="site.setUpShowAll($event.target.checked)"
        />
        <span>显示范围内未 UP 干员</span>
      </label>

      <div class="fgroup">
        <label>纵轴排序</label>
        <div class="sortrows">
          <div v-for="r in UP_SORT_ROWS" :key="r.label" class="sortrow">
            <span class="sortlabel">{{ r.label }}</span>
            <div class="seg mini">
              <button
                type="button" :class="{ on: site.upSort === r.asc }"
                @click="site.setUpSort(r.asc)"
              >升序</button>
              <button
                type="button" :class="{ on: site.upSort === r.desc }"
                @click="site.setUpSort(r.desc)"
              >降序</button>
            </div>
          </div>
        </div>
      </div>

      <div class="fgroup">
        <label>卡池类型<span class="fcount">{{ upTypesLabel }}</span></label>

        <!-- 两级按钮组：大类按钮 = 该大类全选 / 全不选，类型按钮 = 单独切换（点了立刻生效） -->
        <div class="typebtns" :class="{ disabled: site.upShopOnly }">
          <!-- 大类按钮：点击 = 该大类全选 / 取消全选。
               选中态用大类实色底，字色取 CAT_INK（黄底要深字，白字看不清）。 -->
          <div v-for="g in TYPES_BY_CATEGORY" :key="g.cat" class="tgroup">
            <button
              class="tcat" type="button" :disabled="site.upShopOnly"
              :class="{ on: allOn(g.cat), half: someOn(g.cat) && !allOn(g.cat) }"
              :style="allOn(g.cat)
                ? { background: CAT_COLOR[g.cat], color: CAT_INK[g.cat] }
                : null"
              :title="`${g.cat}：点击${allOn(g.cat) ? '取消全选' : '全选'}`"
              @click="site.toggleUpCategory(typesOf(g.cat))"
            >
              <i class="dot" :style="{ background: CAT_COLOR[g.cat] }" />
              <span>{{ g.cat }}</span>
              <span class="tcat-act">{{ allOn(g.cat) ? '取消' : '全选' }}</span>
            </button>

            <div class="trow">
              <button
                v-for="t in g.types" :key="t" class="ttype" type="button"
                :disabled="site.upShopOnly"
                :class="{ on: site.upTypes.includes(t) }"
                @click="site.toggleUpType(t)"
              >{{ TYPE_LABEL[t] }}</button>
            </div>
          </div>

          <div class="tfoot">
            <button
              class="btn" type="button" :disabled="site.upShopOnly || !site.upTypes.length"
              @click="site.setUpTypes([])"
            >清空</button>
          </div>
        </div>
      </div>

      <label class="chk">
        <input
          type="checkbox" :checked="site.upShopOnly"
          @change="site.setUpShopOnly($event.target.checked)"
        />
        <span>只看进店<small>勾选后禁用并清空卡池类型筛选</small></span>
      </label>

      <div class="btn-row">
        <button class="btn" type="button" @click="resetUp">全部重置</button>
      </div>
      <div class="fresult">{{ upResult }}</div>
    </div>
  </aside>
</template>

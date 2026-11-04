<script setup>
/**
 * 跨服卡池对比 · 「出率提升」列的弹窗（2026-11-04 用户加）。
 *
 * 点表格最后一列的「查看」→ 三栏并列，把这**同一期**在三服的 UP 干员摊开：
 * 每栏 = 服名 + 该服开始日期 + 6★ / 5★ 两段；干员名后带「限」「店」标记（与卡池列表同款）。
 *
 * ⚠️ **刻意不 import store、不用 `OpTag`**：
 *   ① `OpTag` 读 `site.avatarMode`，图片模式下名字会被头像取代 —— 三栏并排比名字时根本没法看；
 *   ② 不依赖 pinia，才能在 `verify-render` 里裸 SSR（`createSSRApp(Dialog, { row })`）。
 *   标记的样式是全局的 `.tag.r6/.r5` + `.mk.mk-lim/.mk.mk-shop`，照抄四行就够。
 *
 * 层级：复用 `.cbd-mask`（z-index **80** > 抽屉 75 > 顶栏 70），不需要新的层级。
 *
 * ⭐ **「差异对比」标记**（用户 2026-11-04 追加）：标题下一组按钮 `国际服 / 繁中服`，
 * 选中后把**国服 vs 那一服**的名单差异干员画上深蓝下划线（`lib` 的 `upDiffNames()` 算对称差集）。
 * - **再次点击同一枚 = 关掉标记**；两枚**互斥**（点另一枚就切过去，不会两个同时亮）。
 * - 只标**参与对比的两栏**（国服 + 那一服）—— 第三栏跟这次对比无关，标上会更乱。
 * - 那一服没有这一期时，国服全体都算差异（对方一份都没有），语义上没错。
 */
import { computed, ref } from 'vue';
import {
  CROSS_DIFF_SERVERS, CROSS_SERVER_LABELS, CROSS_SERVERS, upDiffNames,
} from '../lib/crossServer.js';

const props = defineProps({
  /** `lib/crossServer.js` 的 CrossRow */
  row: { type: Object, required: true },
  /** 初始就选中哪一服的差异对比（`en` / `tc` / `null`）。**主要给核对脚本用** —— 默认不选 */
  initialDiff: { type: String, default: null },
});
const emit = defineEmits(['close']);

const upOf = (s, rarity) => (props.row.banners?.[s]?.upOperators || [])
  .filter((o) => (o?.rarity || 0) === rarity);
const startOf = (s) => props.row[s + 'Start'] || '—';
/** 该行有数据的服 —— 没数据的栏也要画出来（写「该服没有这一期卡池」），否则三栏对不齐 */
const cols = computed(() => CROSS_SERVERS);

/** 当前选中的对比服（`null` = 不标）。⚠️ 单选 —— 两枚按钮互斥就是这个单值带来的 */
const diffServer = ref(CROSS_DIFF_SERVERS.includes(props.initialDiff) ? props.initialDiff : null);
/** 再次点击同一枚 = 关掉；点另一枚 = 直接切（互斥） */
function toggleDiff(s) {
  diffServer.value = diffServer.value === s ? null : s;
}
/** 差异干员名（`null` = 没开对比）。只算一次，模板里按栏过滤 */
const diffSet = computed(() => (diffServer.value ? upDiffNames(props.row, diffServer.value) : null));
/** 这个干员在这一栏要不要画下划线 —— 只标「国服」与「当前对比的那一服」两栏 */
function isDiff(s, name) {
  if (!diffSet.value) return false;
  if (s !== 'sc' && s !== diffServer.value) return false;
  return diffSet.value.has(name);
}
</script>

<template>
  <div class="cbd-mask" @click.self="emit('close')">
    <div class="cbd-box xup-box" role="dialog" aria-label="三服出率提升">
      <div class="cbd-hd">
        <span class="h">{{ row.name }} · 出率提升</span>
        <button class="drawer-close" type="button" title="关闭" @click="emit('close')">✕</button>
      </div>

      <p class="cbd-tip">
        三服并列。<b>限</b> = 限定干员、<b>店</b> = 商店兑换；「—」= 该服没有这一期，或这一期没有该星级。
      </p>

      <div class="xup-diffbar">
        <span class="xup-difflabel">差异对比</span>
        <div class="seg" role="group" aria-label="差异对比">
          <button
            v-for="s in CROSS_DIFF_SERVERS" :key="s" type="button"
            :class="{ on: diffServer === s }" :aria-pressed="diffServer === s"
            :title="diffServer === s ? '再点一次关闭标记' : `标出与${CROSS_SERVER_LABELS[s]}的名单差异`"
            @click="toggleDiff(s)"
          >{{ CROSS_SERVER_LABELS[s] }}</button>
        </div>
        <span v-if="diffServer" class="xup-diffhint">
          深蓝下划线 = 与{{ CROSS_SERVER_LABELS[diffServer] }}不一致的干员 · 共 {{ diffSet.size }} 位
        </span>
      </div>

      <div class="xup-cols">
        <section v-for="s in cols" :key="s" class="xup-col" :data-srv="s">
          <h4>
            {{ CROSS_SERVER_LABELS[s] }}
            <span class="xup-date">{{ startOf(s) }}</span>
          </h4>
          <template v-if="row.banners[s]">
            <div class="xup-sub">6★</div>
            <div class="xup-ops">
              <span
                v-for="o in upOf(s, 6)" :key="o.scCharName" class="tag r6"
                :class="{ 'is-diff': isDiff(s, o.scCharName) }"
              >
                <i v-if="o.isLimited" class="mk mk-lim" title="限定干员">限</i>
                <i v-if="o.isShop" class="mk mk-shop" title="商店兑换">店</i>{{ o.scCharName }}
              </span>
              <span v-if="!upOf(s, 6).length" class="dash">—</span>
            </div>
            <div class="xup-sub">5★</div>
            <div class="xup-ops">
              <span
                v-for="o in upOf(s, 5)" :key="o.scCharName" class="tag r5"
                :class="{ 'is-diff': isDiff(s, o.scCharName) }"
              >
                <i v-if="o.isLimited" class="mk mk-lim" title="限定干员">限</i>
                <i v-if="o.isShop" class="mk mk-shop" title="商店兑换">店</i>{{ o.scCharName }}
              </span>
              <span v-if="!upOf(s, 5).length" class="dash">—</span>
            </div>
          </template>
          <p v-else class="xup-none">该服没有这一期卡池</p>
        </section>
      </div>
    </div>
  </div>
</template>

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
 */
import { computed } from 'vue';
import { CROSS_SERVER_LABELS, CROSS_SERVERS } from '../lib/crossServer.js';

const props = defineProps({
  /** `lib/crossServer.js` 的 CrossRow */
  row: { type: Object, required: true },
});
const emit = defineEmits(['close']);

const upOf = (s, rarity) => (props.row.banners?.[s]?.upOperators || [])
  .filter((o) => (o?.rarity || 0) === rarity);
const startOf = (s) => props.row[s + 'Start'] || '—';
/** 该行有数据的服 —— 没数据的栏也要画出来（写「该服没有这一期卡池」），否则三栏对不齐 */
const cols = computed(() => CROSS_SERVERS);
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

      <div class="xup-cols">
        <section v-for="s in cols" :key="s" class="xup-col" :data-srv="s">
          <h4>
            {{ CROSS_SERVER_LABELS[s] }}
            <span class="xup-date">{{ startOf(s) }}</span>
          </h4>
          <template v-if="row.banners[s]">
            <div class="xup-sub">6★</div>
            <div class="xup-ops">
              <span v-for="o in upOf(s, 6)" :key="o.scCharName" class="tag r6">
                <i v-if="o.isLimited" class="mk mk-lim" title="限定干员">限</i>
                <i v-if="o.isShop" class="mk mk-shop" title="商店兑换">店</i>{{ o.scCharName }}
              </span>
              <span v-if="!upOf(s, 6).length" class="dash">—</span>
            </div>
            <div class="xup-sub">5★</div>
            <div class="xup-ops">
              <span v-for="o in upOf(s, 5)" :key="o.scCharName" class="tag r5">
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

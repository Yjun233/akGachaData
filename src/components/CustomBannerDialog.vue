<script setup>
/**
 * 自定义卡池：**添加 / 编辑弹窗**（左栏底部那块「＋ 添加自定义卡池…」打开它）。
 *
 * 说明：
 * - **不含服务器字段** —— 跟随当前浏览的服务器（用户 2026-10-04 定），这里只把当前服显示出来。
 * - 列表只列**当前真正生效的**自设；被去重吃掉的**单列一段**提醒
 *   （否则用户会以为没保存成功）。三段的口径见 `akGachaDocs/site/自定义卡池功能预研.md` §3.3。
 * - 校验与保存在 store 里（`validateCustom` / `addCustom` / `updateCustom`），
 *   本组件只负责把结果显示出来 —— 保证弹窗与导入走的是**同一套**规则。
 * - 导出是**唯一**的备份手段（数据只在这台浏览器的本地存储里）。
 */
import { computed, reactive, ref, watch } from 'vue';
import { useSiteStore } from '../stores/site.js';
import { TYPE_LABEL } from '../lib/constants.js';
import { CUSTOM_TYPES, endDateOf, midTag, splitList } from '../lib/customBanners.js';
import { localToday } from '../lib/date.js';
import OpPicker from './OpPicker.vue';
import CustomJsonDialog from './CustomJsonDialog.vue';

const emit = defineEmits(['close']);
const site = useSiteStore();

/* **打开弹窗那一刻的现实今天** —— 既是「开始时间」的默认值，也是下面 `tagOf` 的判据时点
   （用户 2026-10-06 定：标 / 中按**现实时间**算，不跟右栏那个可改的参考日期走）。 */
const today = localToday();
const blank = () => ({
  name: '',
  /* 默认「常驻标准寻访 + 今天」——最常见的自设场景，用户按需改。
     ⚠️ **没有 `endDate`**：结束日由开始日派生（用户 2026-10-06 定，见 lib 的 `endDateOf`） */
  type: 'double',
  startDate: today,
  star6: [],
  star5: [],
  shop: [],
});

const form = reactive(blank());
const editingUid = ref(null);

const serverLabel = computed(() => site.serverMeta.label || site.server);
/* ⚠️ 「已生效」用 `myActiveEntries`（**去重后活下来的**），不是 `myCustomEntries`（全部原始输入）——
   否则被去重吃掉的条目会同时出现在「已生效」和「已忽略」两段里。 */
const myList = computed(() => site.myActiveEntries);
const dropped = computed(() => site.myDroppedCustom);

/** 实时校验（与「保存」用的是同一套规则） */
const preview = computed(() => site.validateCustom({ ...form }));

/* 三个候选池：六星 / 五星取该星级的**全部**干员；**进店只给「已选的六星 + 五星」**
   —— 用户 2026-10-06 定：进店只能是前两者里选过的人。 */
const sixPool = computed(() => Object.keys(site.operators).filter((n) => site.operators[n].rarity === 6));
const fivePool = computed(() => Object.keys(site.operators).filter((n) => site.operators[n].rarity === 5));
const shopPool = computed(() => [...form.star6, ...form.star5]);

/** 名字 → 「标 / 中」—— 该干员在**当前现实时间**属标准还是中坚寻访（`lib/customBanners.js`）。
    ⚠️ 判据 = 本服「进入中坚寻访」的日期（`classicDate` / `en*` / `tc*`）≤ 今天，
      与右栏「隐藏已属中坚的干员」同一口径，只是判据时点换成现实今天。
    ⚠️ **只作提醒，不限制你选谁**（用户 2026-10-06 定：不强制与寻访类型相符）。 */
function tagOf(name) {
  const op = site.operators[name];
  return op ? midTag(site.classicDateOf(op), today) : '';
}

/* 从六星 / 五星里移除某人时，进店里那个也要跟着掉 —— 否则会留下「进店的人不在上面两组里」 */
watch(shopPool, (pool) => {
  const ok = new Set(pool);
  if (form.shop.some((n) => !ok.has(n))) form.shop = form.shop.filter((n) => ok.has(n));
});

/** 结束日期 —— 由开始日推导，**只作为一行小字展示**（表单里没有它的输入框）；
    用户 2026-10-06 定：不设结束日期，恒为开始日 + 14 天（`endDateOf`） */
const endPreview = computed(() => endDateOf(form.startDate) || '—');

/** 名字预览（让用户看到「留空会自动叫什么叫」） */
const namePreview = computed(() => {
  if (form.name.trim()) return '';
  return form.type === 'single' && form.star6.length
    ? `将自动命名为「自定义_${form.star6[0]}池」`
    : `将自动命名为「自定义_${TYPE_LABEL[form.type] || form.type}${String(form.startDate).slice(5, 10).replace('-', '')}」`;
});

function reset() {
  Object.assign(form, blank());
  editingUid.value = null;
}

function save() {
  if (!preview.value.ok) return;
  const entry = { ...form, server: site.server };
  if (editingUid.value == null) site.addCustom(entry);
  else site.updateCustom(editingUid.value, entry);
  reset();
}

function edit(entry) {
  editingUid.value = entry.uid;
  Object.assign(form, {
    name: entry.name || '',
    type: entry.type,
    startDate: entry.startDate,
    /* ⚠️ 2026-10-06 之前的自设里这三个是**顿号分隔的文本** → `splitList` 两种形态都吃 */
    star6: splitList(entry.star6),
    star5: splitList(entry.star5),
    shop: splitList(entry.shop),
  });
}

function remove(uid) {
  /* SSR / 无 confirm 的环境直接删（这个弹窗只在客户端渲染，正常走不到那支） */
  if (typeof confirm === 'function' && !confirm('删除这条自定义卡池？')) return;
  site.removeCustom(uid);
  if (editingUid.value === uid) reset();
}

/* ---------------- JSON 编辑（**另开一个窗**，2026-10-06） ----------------
   这里只留一个按钮 —— 编辑框本身在 `CustomJsonDialog.vue` 里。
   用户要的是「别把大编辑框挤在主弹窗里」，所以拆成子窗（`showJson` 控制显隐）。 */
const showJson = ref(false);
</script>

<template>
  <div class="cbd-mask" @click.self="emit('close')">
    <div class="cbd-box" role="dialog" aria-label="自定义卡池">
      <div class="cbd-hd">
        <span class="h">自定义卡池</span>
        <button class="drawer-close" type="button" title="关闭" @click="emit('close')">✕</button>
      </div>

      <p class="cbd-tip">
        数据只存在<b>你这台浏览器</b>里（清缓存会丢，记得用下面的「编辑 JSON…」整段复制走备份）。
        归属服务器跟随当前浏览的服：<b>{{ serverLabel }}</b>。
        与已公布卡池「<b>六星一致</b>且<b>开始日相差 15 天内</b>」的会被自动忽略。
        <br />
        名字前的标记（按<b>此刻</b>算）：<em class="optag std">标</em> = 属<b>标准</b>寻访、
        <em class="optag mid">中</em> = 已属<b>中坚</b>寻访 —— <b>只是提醒</b>，不限制你选谁。
      </p>

      <div class="cbd-form">
        <label>寻访名字<input v-model="form.name" type="text" placeholder="留空则自动生成" /></label>
        <label>
          寻访类型
          <select v-model="form.type">
            <option v-for="t in CUSTOM_TYPES" :key="t" :value="t">{{ TYPE_LABEL[t] }}</option>
          </select>
        </label>
        <label>
          开始时间
          <input v-model="form.startDate" type="date" />
          <span class="cbd-endnote">结束时间将设为 <b>{{ endPreview }}</b></span>
        </label>
        <label class="cbd-wide">
          六星<span class="cbd-sub">共 {{ sixPool.length }} 位候选</span>
          <OpPicker
            v-model="form.star6" :pool="sixPool" :tag-of="tagOf"
            placeholder="搜索六星：名字 / 全拼 / 首字母"
          />
        </label>
        <label class="cbd-wide">
          五星<span class="cbd-sub">共 {{ fivePool.length }} 位候选</span>
          <OpPicker
            v-model="form.star5" :pool="fivePool" :tag-of="tagOf"
            placeholder="搜索五星（复刻单六可留空）"
          />
        </label>
        <label class="cbd-wide">
          进店<span class="cbd-sub">只能从上面已选的干员里挑</span>
          <OpPicker
            v-model="form.shop" :pool="shopPool" :tag-of="tagOf" placeholder="搜索已选的六星 / 五星"
            empty-hint="请先在上面两组里选人"
          />
        </label>
      </div>

      <p v-if="namePreview" class="cbd-hint">{{ namePreview }}</p>

      <div v-if="preview.errors.length || preview.warnings.length" class="cbd-msgs">
        <ul v-if="preview.warnings.length" class="cbd-msg warn">
          <li v-for="w in preview.warnings" :key="w">{{ w }}</li>
        </ul>
        <ul v-if="preview.errors.length" class="cbd-msg err">
          <li v-for="e in preview.errors" :key="e">{{ e }}</li>
        </ul>
      </div>

      <div class="btn-row">
        <button class="btn primary" type="button" :disabled="!preview.ok" @click="save">
          {{ editingUid == null ? '保存' : '保存修改' }}
        </button>
        <button v-if="editingUid != null" class="btn" type="button" @click="reset">取消编辑</button>
      </div>

      <div class="cbd-subhd">已生效（{{ myList.length }} 个）</div>
      <p v-if="!myList.length" class="cbd-hint">还没有添加过。</p>
      <ul v-else class="cbd-list">
        <li v-for="e in myList" :key="e.uid" :class="{ editing: e.uid === editingUid }">
          <span class="d">{{ e.startDate }} ~ {{ e.endDate }}</span>
          <span class="n">{{ e.name || '(自动命名)' }}</span>
          <span class="t">{{ TYPE_LABEL[e.type] }}</span>
          <button class="cbd-mini" type="button" @click="edit(e)">编辑</button>
          <button class="cbd-mini" type="button" @click="remove(e.uid)">删除</button>
        </li>
      </ul>

      <div v-if="dropped.length" class="cbd-dropped">
        <div class="cbd-subhd">已忽略（与已公布卡池重复，不会生效）</div>
        <div v-for="d in dropped" :key="d.entry.uid" class="row">
          <span>{{ d.entry.startDate }} {{ d.entry.name || '(自动命名)' }}
            —— 与「{{ d.hit.name }}」重复（开始日相差 {{ d.gap }} 天）</span>
          <button class="cbd-mini" type="button" @click="remove(d.entry.uid)">删除</button>
        </div>
      </div>

      <div class="cbd-subhd">JSON 编辑（全部服务器）</div>
      <div class="cbd-iorow">
        <button class="btn" type="button" @click="showJson = true">编辑 JSON…</button>
        <span class="cbd-hint">看 / 改全部自设、整段复制走备份 —— <b>会另开一个窗</b></span>
      </div>
    </div>

    <!-- JSON 编辑**子窗**（盖在主弹窗上面，见组件里的说明） -->
    <CustomJsonDialog v-if="showJson" @close="showJson = false" />
  </div>
</template>

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
import {
  CUSTOM_TYPES, RERUN_KINDS, buildName, computeCanRerun, distributeOps, endDateOf,
  entryToForm, formToEntry, hasShop, mergeOps, midTag,
} from '../lib/customBanners.js';
import { localToday } from '../lib/date.js';
import OpPicker from './OpPicker.vue';
import CustomJsonDialog from './CustomJsonDialog.vue';

const emit = defineEmits(['close']);
const site = useSiteStore();

/* **打开弹窗那一刻的现实今天** —— 既是「开始时间」的默认值，也是下面 `tagOf` 的判据时点
   （用户 2026-10-06 定：标 / 中按**现实时间**算，不跟右栏那个可改的参考日期走）。 */
const today = localToday();
const blank = () => ({
  scName: '',
  /* 默认「常驻标准寻访 + 今天」——最常见的自设场景，用户按需改。
     ⚠️ **没有 `endDate`**：结束日由开始日派生（用户 2026-10-06 定，见 lib 的 `endDateOf`）；
        存进存储时才会写成具体日期（v3 与 DB 同构）。 */
  type: 'double',
  startDate: today,
  /* 「卡池开启类型」（= DB 的 `rerunKind`，用户 2026-10-19 加）——**只有单六寻访才用得到**，
     默认「首发」；`canRerun` 由它自动推导（单六 + 首发），不单独给输入框。 */
  rerunKind: RERUN_KINDS[0],
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
/** 加载时**已被自动删除**的自设（撞上已公布的池 → 从存储删掉了，这里只作告知） */
const autoRemoved = computed(() => site.myAutoRemovedCustom);

/** 实时校验（与「保存」用的是同一套规则）。
 *  ⚠️ 校验的入参是**要存进存储的 v3 条目**（不是表单）—— 先过 `formToEntry()`，
 *     这样「进店星级」「结束时间」这些只有在条目里才齐全的东西才能真校验。 */
const preview = computed(() => site.validateCustom(toEntry(form)));

/** 表单 → v3 条目（`scName` 补前缀、`endDate` 派生、`rerunKind` / `canRerun` 自动填） */
function toEntry(f) {
  return formToEntry({ ...f, server: site.server }, site.charIdOf);
}

/* 三个候选池：六星 / 五星取该星级的**全部**干员；**进店只给「已选的六星 + 五星」**
   —— 用户 2026-10-06 定：进店只能是前两者里选过的人。

   ⚠️ 「进店」只有两种常驻寻访用得上（`double` / `classic`）—— 其余四类实测三服进店恒为 0。
      **2026-10-24 先做成隐藏，当天改成「灰掉、不可编辑」**（用户：`进店还是不再隐藏，而是改成灰掉不可编辑`）：
      框始终占位、位置不跳，用户也看得出「这里本来有个框、只是这类卡池用不上」。
      判据用 lib 的 `hasShop()`（与硬校验同源），**别在模板里手写类型列表**。
      切到「没有进店」的类型时清空 `form.shop`（下面有 watch），`formToEntry()` 再兜一层，双重保险。 */
const sixPool = computed(() => Object.keys(site.operators).filter((n) => site.operators[n].rarity === 6));
const fivePool = computed(() => Object.keys(site.operators).filter((n) => site.operators[n].rarity === 5));
const shopPool = computed(() => [...form.star6, ...form.star5]);

/** 名字 → 「标 / 中」—— 该干员在**当前现实时间**属标准还是中坚寻访（`lib/customBanners.js`）。
    ⚠️ 判据 = 本服「进入中坚寻访」的日期（`scClassicDate` / `en*` / `tc*`）≤ 今天，
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

/* ⚠️ 切到「没有进店」的类型（其余四类）时**清空已选的进店**：那个框会灰掉、不可编辑，
   残留的 chip 就成了「看得见、删不掉」，而 `formToEntry()` 又会把它丢掉 —— 留着只会让人困惑。 */
watch(() => form.type, (t) => {
  if (!hasShop(t) && form.shop.length) form.shop = [];
});

/* ---------------- 批量粘贴（2026-10-24） ----------------
   粘一整串名字（`老鲤/艾丽妮/凯尔希` 或 `林 / 赤刃明霄陈`）→ 按星级自动分到六星 / 五星两栏。
   口径（用户 2026-10-24 当场拍板，当晚又改了一条）：
     · **追加**而不是替换 —— 他的原话：「因为五星和六星需要分开粘贴」：先粘六星、再粘五星，
       两次都得留住（追加时按名字去重，重复的只提示不重复加）；
     · 名字与分隔符的处理全在 `lib` 的 `distributeOps()` / `splitList()`（`/ ／ | ｜ 、 , ; 空白` 都算分隔符）；
     · 认不出的**跳过**并列出来（不整条否决）；
     · 追加不动进店 —— 原有的人都还在，进店指向的名字仍然有效（`watch(shopPool)` 照旧兜底）。 */
const pasteText = ref('');
/** 填入结果提示：`kind` = ok（全加上了）/ warn（有重复或未识别）/ err（一个都没认出） */
const pasteMsg = ref(null);

function applyPaste() {
  const txt = pasteText.value.trim();
  if (!txt) return;
  const { six, five, unknown } = distributeOps(txt, (n) => site.operators[n]?.rarity ?? null);
  if (!six.length && !five.length) {
    pasteMsg.value = {
      kind: 'err',
      text: `没认出任何干员${unknown.length ? `：${unknown.join('、')}` : ''}`,
    };
    return;
  }
  const prevSix = form.star6.length;
  const prevFive = form.star5.length;
  form.star6 = mergeOps(form.star6, six);
  form.star5 = mergeOps(form.star5, five);
  const addSix = form.star6.length - prevSix;
  const addFive = form.star5.length - prevFive;
  const added = addSix + addFive;
  const dup = six.length + five.length - added;
  /* ⚠️ `dup` 只在**有新增**时才写进尾巴；一个都没新增时正文已经说了「本来就在列表里」，
     再缀一句「N 位已选过」会变成「这 1 位本来就在列表里；1 位已选过」（真踩过）。 */
  const dupTail = (added && dup) ? `；${dup} 位已选过` : '';
  const unknownTail = unknown.length ? `；未识别：${unknown.join('、')}` : '';
  pasteMsg.value = {
    kind: (dup || unknown.length) ? 'warn' : 'ok',
    text: added
      ? `已追加 ${added} 位（六星 +${addSix} / 五星 +${addFive}）${dupTail}${unknownTail}`
      : `这 ${dup} 位本来就在列表里，没有新增${unknownTail}`,
  };
  pasteText.value = '';
}

/** 清空某一栏（`star6` / `star5`）—— 由那两行**搜索框右侧**的「清空」按钮调
    （与「填入」同款 `.btn`、常驻、空时置灰，见 `.cbd-oprow`）。
    进店不用单独处理：`watch(shopPool)` 会把指向已移除干员的进店自动剪掉。 */
function clearOps(field) {
  form[field] = [];
  pasteMsg.value = null;   // 上一条「已追加 N 位」已经跟现在的列表对不上了，别继续挂着
}

/** 结束日期 —— 由开始日推导，**只作为一行小字展示**（表单里没有它的输入框）；
    用户 2026-10-06 定：不设结束日期，恒为开始日 + 14 天（`endDateOf`） */
const endPreview = computed(() => endDateOf(form.startDate) || '—');

/** 「会不会复刻」的预览 —— 单六 + 首发 才 true；只展示，不给输入框（用户 2026-10-19 定） */
const canRerunPreview = computed(() => computeCanRerun(form.type, form.rerunKind));

/* ---------------- 模板里那个「卡池开启类型」下拉（2026-10-19） ----------------
   它就是 DB 的 `rerunKind`，**只有单六寻访才有这个概念** —— DB 里 85 个带它的池全是单六，
   所以模板上挂了 `v-if="form.type === 'single'"`，别的类型连键都不写进条目。
   `canRerun` **不给输入框**：单六 + 首发 才为 true，自动推导（见 lib 的 `computeCanRerun`），
   界面上只在旁边显示一行「canRerun 自动为 true/false」。

   ⚠️ 这段说明**只能放这儿** —— 写进 `<template>` 当 HTML 注释的话，Vue SSR 会**原样输出**，
      `verify-render` 里「默认（double）时不该出现『卡池开启类型』」那条断言会当场红
      （2026-10-19 又踩了一次，同 `OpTag` / `StatTable` 那两回）。 */

/** 名字预览（让用户看到「留空会自动叫什么叫」） */
const namePreview = computed(() => {
  if (form.scName.trim()) return '';
  return `将自动命名为「${buildName({ ...form, six: form.star6 })}」`;
});

function reset() {
  Object.assign(form, blank());
  editingUid.value = null;
  pasteText.value = '';
  pasteMsg.value = null;
}

/**
 * 表单 → v3 条目，然后交给 store 校验/写盘。
 * ⚠️ 条目形状与 `banners_<server>.json` 的卡池对象同构（多 `server` / `uid`），见 lib 文件头。
 */
function save() {
  if (!preview.value.ok) return;
  const entry = toEntry(form);
  if (editingUid.value == null) site.addCustom(entry);
  else site.updateCustom(editingUid.value, entry);
  reset();
}

/** 条目 → 表单（`scName` 会剥掉 `自定义_` 前缀、`upOperators` 拆回三个名字数组） */
function edit(entry) {
  editingUid.value = entry.uid;
  Object.assign(form, blank(), entryToForm(entry));
  pasteText.value = '';      // 编辑另一条时，上一轮的粘贴提示不该继续挂着
  pasteMsg.value = null;
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

      <div class="cbd-form" :class="{ top4: form.type === 'single' }">
        <label>寻访名字<input v-model="form.scName" type="text" placeholder="留空则自动生成" /></label>
        <label>
          寻访类型
          <select v-model="form.type">
            <option v-for="t in CUSTOM_TYPES" :key="t" :value="t">{{ TYPE_LABEL[t] }}</option>
          </select>
        </label>
        <label v-if="form.type === 'single'">
          卡池开启类型
          <select v-model="form.rerunKind">
            <option v-for="k in RERUN_KINDS" :key="k" :value="k">{{ k }}</option>
          </select>
          <span class="cbd-endnote">canRerun 自动为 <b>{{ canRerunPreview }}</b></span>
        </label>
        <label>
          开始时间
          <input v-model="form.startDate" type="date" />
          <span class="cbd-endnote">结束时间将设为 <b>{{ endPreview }}</b></span>
        </label>
        <label class="cbd-wide">
          批量粘贴<span class="cbd-sub">用 <b>/</b> 、逗号或空格分隔；按星级<b>追加</b>到下面两栏</span>
          <div class="cbd-paste">
            <input
              v-model="pasteText" type="text" autocomplete="off"
              placeholder="例如 老鲤/艾丽妮/凯尔希/水月，或 林 / 赤刃明霄陈 / 可露希尔"
              @keyup.enter="applyPaste"
            />
            <button class="btn" type="button" :disabled="!pasteText.trim()" @click="applyPaste">填入</button>
          </div>
          <span v-if="pasteMsg" class="cbd-paste-msg" :class="pasteMsg.kind">{{ pasteMsg.text }}</span>
        </label>
        <label class="cbd-wide">
          <span class="cbd-lhd">六星<span class="cbd-sub">共 {{ sixPool.length }} 位候选</span></span>
          <div class="cbd-oprow">
            <OpPicker
              v-model="form.star6" :pool="sixPool" :tag-of="tagOf"
              placeholder="搜索六星：名字 / 全拼 / 首字母"
            />
            <button
              class="btn" type="button" :disabled="!form.star6.length"
              :title="`清空已选的 ${form.star6.length} 位六星`" @click="clearOps('star6')"
            >清空</button>
          </div>
        </label>
        <label class="cbd-wide">
          <span class="cbd-lhd">五星<span class="cbd-sub">共 {{ fivePool.length }} 位候选</span></span>
          <div class="cbd-oprow">
            <OpPicker
              v-model="form.star5" :pool="fivePool" :tag-of="tagOf"
              placeholder="搜索五星（复刻单六可留空）"
            />
            <button
              class="btn" type="button" :disabled="!form.star5.length"
              :title="`清空已选的 ${form.star5.length} 位五星`" @click="clearOps('star5')"
            >清空</button>
          </div>
        </label>
        <label class="cbd-wide">
          进店<span class="cbd-sub">{{ hasShop(form.type) ? '只能从上面已选的干员里挑' : '这类卡池没有进店，此处不可编辑' }}</span>
          <OpPicker
            v-model="form.shop" :pool="shopPool" :tag-of="tagOf" :disabled="!hasShop(form.type)"
            :placeholder="hasShop(form.type) ? '搜索已选的六星 / 五星' : '这类卡池没有进店'"
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
          <span class="n">{{ e.scName || '(自动命名)' }}</span>
          <span class="t">{{ TYPE_LABEL[e.type] }}<template v-if="e.rerunKind">·{{ e.rerunKind }}</template></span>
          <button class="cbd-mini" type="button" @click="edit(e)">编辑</button>
          <button class="cbd-mini" type="button" @click="remove(e.uid)">删除</button>
        </li>
      </ul>

      <div v-if="dropped.length" class="cbd-dropped">
        <div class="cbd-subhd">已忽略（与已公布卡池重复，不会生效 —— 下次打开页面会自动删除）</div>
        <div v-for="d in dropped" :key="d.entry.uid" class="row">
          <span>{{ d.entry.startDate }} {{ d.entry.scName || '(自动命名)' }}
            —— 与「{{ d.hit.scName }}」重复（开始日相差 {{ d.gap }} 天）</span>
          <button class="cbd-mini" type="button" @click="remove(d.entry.uid)">删除</button>
        </div>
      </div>

      <!-- 加载时**已经**被自动删掉的那些：说一声「为什么不见了」，否则用户会以为自设丢了 -->
      <div v-if="autoRemoved.length" class="cbd-dropped cbd-auto-removed">
        <div class="cbd-subhd">已自动删除（{{ autoRemoved.length }} 条 · 对应卡池已被正式公布）</div>
        <div v-for="d in autoRemoved" :key="d.entry.uid" class="row">
          <span>{{ d.entry.startDate }} {{ d.entry.scName || '(自动命名)' }}
            —— 与「{{ d.hit.scName }}」重复（开始日相差 {{ d.gap }} 天）</span>
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

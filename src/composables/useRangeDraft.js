/**
 * 日期范围输入的「草稿 + 确认」逻辑。
 *
 * 首次UP间隔页与 UP 历史页各有一套时间范围，行为完全一致，所以抽出来：
 * - 输入先落草稿，**点对应的「确认」才写进 store**（未确认时输入框描红）
 * - 两端冲突时用**强制修正**（`enforceRangeOrder`）：以刚确认的一端为准，
 *   把另一端挪到相隔 1 天
 * - 「近 N 年」确认后清空输入框
 * - 「全部」= 回到调用方给的**默认范围**（`defaultRange`）。⚠️ 默认是「完整跨度」而
 *   不是空串 —— `type="date"` 在值为空时浏览器只画「年/月/日」，看不出可用范围。
 *
 * @param {() => {from: string, to: string}} getRange 读当前已应用的范围
 * @param {(from: string|null, to: string|null) => void} apply 写回；传 null 表示不动那一端，传 '' 表示清空
 * @param {(n: number) => unknown} applyYears 近 N 年
 * @param {() => {from: string, to: string}} [defaultRange] 「全部」要回到的范围（不给就退回空串）
 */
import { computed, ref, watch } from 'vue';
import { enforceRangeOrder } from '../lib/date.js';

export function useRangeDraft(getRange, apply, applyYears, defaultRange = null) {
  const draftFrom = ref('');
  const draftTo = ref('');
  const yearsInput = ref('');
  const error = ref('');

  /* store 侧变化（近 N 年 / 全部 / 切服务器）时把草稿同步回来 */
  watch(
    [() => getRange().from, () => getRange().to],
    ([f, t]) => {
      draftFrom.value = f;
      draftTo.value = t;
    },
    { immediate: true },
  );

  const fromDirty = computed(() => draftFrom.value !== getRange().from);
  const toDirty = computed(() => draftTo.value !== getRange().to);

  function confirmFrom() {
    const r = enforceRangeOrder(draftFrom.value, draftTo.value, 'from');
    draftFrom.value = r.from;
    draftTo.value = r.to;
    error.value = '';
    apply(r.from, r.pushed ? r.to : null);
  }

  function confirmTo() {
    const r = enforceRangeOrder(draftFrom.value, draftTo.value, 'to');
    draftFrom.value = r.from;
    draftTo.value = r.to;
    error.value = '';
    apply(r.pushed ? r.from : null, r.to);
  }

  function confirmYears() {
    const raw = String(yearsInput.value ?? '').trim();
    const n = Number(raw);
    if (!raw || !Number.isInteger(n) || n <= 0) {
      error.value = '请输入正整数（年数）';
      return;
    }
    error.value = '';
    applyYears(n);
    /* ⚠️ 2026-10-04：「近 N 年」改为**从当前结束日期**往前推（store 的 applyXxxYears），
       所以结束日期被调得比数据下界还早时，算出来的两端可能是反的 —— 与手输一样强制修正
       （以刚算出的结束日期为准，把开始挪到它前一天）。 */
    const cur = getRange();
    const r = enforceRangeOrder(cur.from, cur.to, 'to');
    if (r.pushed) apply(r.from, null);
    yearsInput.value = ''; // 确认后清空
  }

  /** 「全部」：回到默认范围（通常 = 完整跨度），而不是清成空框 */
  function reset() {
    error.value = '';
    yearsInput.value = '';
    const d = defaultRange ? defaultRange() : null;
    apply(d?.from ?? '', d?.to ?? '');
  }

  return {
    draftFrom, draftTo, yearsInput, error, fromDirty, toDirty,
    confirmFrom, confirmTo, confirmYears, reset,
  };
}

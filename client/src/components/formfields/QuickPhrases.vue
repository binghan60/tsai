<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Plus } from '@lucide/vue';
import { useQuickPhrases } from '../../composables/useQuickPhrases';
import { useRecordForm } from './context';
import { useToast } from '../../composables/useToast';

// 掛在文字類欄位底下的快速輸入。常用語一律綁欄位，新增的入口就在這裡 ——
// 剛打完一句好句子的當下，才是想把它存起來的時機。
//
// 排版上有兩條硬規則：
// 1. 這一列的高度固定。理學檢查一次十幾列，每列長高的幅度只要不一致，整份表單就是歪的。
// 2. 任何東西都不准溢出欄位寬度。常用語存多了會排不下，多出來的靠「全部」視窗點選，
//    絕不讓它往右長到看不見也點不到的地方。
const props = defineProps({
  itemKey: { type: String, required: true },
  modelValue: { type: [String, null], default: '' },
  // 欄位標籤，用在 aria-label 與「全部」視窗的標題上。
  label: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);

// 表單設計的畫布也用同一組版式元件渲染，但那裡是在看結構，不是在填表。
const { preview } = useRecordForm();
const { phrasesFor, addPhrase, requestRemove, markUsed, openPicker } = useQuickPhrases();
const toast = useToast();

// 直接排在欄位下的數量。再多就擠成一堆讀不出字的省略號，剩下的交給「全部」視窗。
const INLINE_LIMIT = 3;

// 「存成常用語」要等使用者停手才浮現。還沒有常用語的欄位整列是不佔位的，
// 一打字就冒出來會把底下的內容整個往下推 —— 理學檢查十幾列都這樣，打字時版面一直跳。
const SAVE_HINT_DELAY = 900;

const saving = ref(false);
const list = computed(() => phrasesFor(props.itemKey));
const inline = computed(() => list.value.slice(0, INLINE_LIMIT));
const hasMore = computed(() => list.value.length > INLINE_LIMIT);
const current = computed(() => String(props.modelValue ?? '').trim());

// current 的延後版本，只用來決定「存成常用語」要不要出現。
const settled = ref('');
let settleTimer = null;
watch(current, (value, previous) => {
  clearTimeout(settleTimer);
  // 清空欄位時立刻收起來 —— 需要延後的只有「出現」，消失越快越好。
  if (!value) { settled.value = ''; return; }
  // 第一次（載入既有草稿）直接顯示，那時候版面本來就還在組。
  if (previous === undefined) { settled.value = value; return; }
  settleTimer = setTimeout(() => { settled.value = value; }, SAVE_HINT_DELAY);
}, { immediate: true });
onBeforeUnmount(() => clearTimeout(settleTimer));

const canSave = computed(() => Boolean(settled.value) && !list.value.some((entry) => entry.text === settled.value));
// 沒有常用語、也沒有可存的內容時整個不佔位 —— 剛裝好的空表單不該多出幾十條空列。
const visible = computed(() => Boolean(list.value.length) || Boolean(settled.value));

// 接在現有文字後面。已經有結尾標點就不再補一個 —— 但半形標點後面要空一格，
// 直接黏起來會變成「Mild tartar.recheck in 3m」。
const FULLWIDTH_END = /[，。、；：！？]$/;
const HALFWIDTH_END = /[,.;:!?]$/;
function joined(base, text) {
  if (!base) return text;
  if (FULLWIDTH_END.test(base)) return `${base}${text}`;
  if (HALFWIDTH_END.test(base)) return `${base} ${text}`;
  return `${base}，${text}`;
}

function insert(phrase) {
  emit('update:modelValue', joined(current.value, phrase.text));
  markUsed(phrase);
}

function openAll() {
  openPicker({ itemKey: props.itemKey, label: props.label, onPick: insert });
}

// 存的是欄位當下的內容，不是延後過的 settled —— 按鈕浮現後又補了幾個字，
// 使用者想存的是補完的那一版。
async function save() {
  if (!current.value || saving.value) return;
  saving.value = true;
  try {
    await addPhrase(current.value, props.itemKey);
    toast.success('已存成這個欄位的常用語');
  } catch (err) {
    toast.error('常用語儲存失敗，請稍後再試');
  } finally {
    saving.value = false;
  }
}

const actionClass = 'inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-belle-600 disabled:opacity-50   dark:hover:text-brand-400';
</script>

<template>
  <!-- overflow-hidden 是最後一道保險：不管裡面塞了什麼，都不會超出欄位寬度 -->
  <div
    v-if="!preview && visible"
    class="mt-1.5 flex h-8 items-center gap-1.5 overflow-hidden"
    role="group"
    :aria-label="label ? `${label}的常用語` : '常用語'"
  >
    <button v-if="canSave" type="button" :class="actionClass" :disabled="saving" @click="save">
      <Plus class="h-3.5 w-3.5 shrink-0" stroke-width="1.75" />
      存成常用語
    </button>

    <!-- 每個 chip 都可壓縮（min-w-0 + truncate），排不下時是變窄，不是擠出去 -->
    <button
      v-for="phrase in inline"
      :key="phrase._id"
      type="button"
      class="h-8 min-w-0 truncate rounded-full border border-border bg-white px-2.5 text-xs text-foreground transition-colors hover:border-belle-400 hover:text-belle-700 dark:hover:border-brand-500 dark:hover:text-brand-300"
      :title="phrase.text"
      @click="insert(phrase)"
    >{{ phrase.text }}</button>

    <button
      v-if="hasMore"
      type="button"
      :class="actionClass"
      :title="`看全部 ${list.length} 句常用語`"
      @click="openAll"
    >全部 {{ list.length }}</button>
    <button v-else-if="list.length" type="button" :class="actionClass" title="管理這個欄位的常用語" @click="openAll">管理</button>
  </div>
</template>

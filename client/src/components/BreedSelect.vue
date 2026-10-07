<script setup>
import { computed, nextTick, ref, useAttrs, watch } from 'vue';
import { Check, ChevronDown } from '@lucide/vue';
import { ComboboxAnchor, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxItemIndicator, ComboboxPortal, ComboboxRoot, ComboboxTrigger } from 'reka-ui';
import { cn } from '@/lib/utils';
import { CAT_BREED_FALLBACKS, filterCatBreeds, findCatBreed } from '../../../shared/catBreeds.js';

// 品種：只能從 shared/catBreeds.js 的清單選（IDEXX 主機支援的那幾種），不能自由輸入。
// v-model 的值是 IDEXX 的英文名稱（資料庫存的就是它），畫面上一律顯示中文名稱。
// 下拉選單＋打字篩選：點開是整份清單，打字只留符合的（中文名稱、俗稱「英短」「加菲」、英文名稱都找得到）；
// 打的字不在清單上、又沒選任何一項就離開，欄位會回到原本選的那一種。把字全部刪掉＝清空。
// 新增貓咪、貓咪詳情、初診表審核、公開初診頁共用。
// appearance：app＝後台（跟 ui/input、ui/select 同一套外觀）；intake＝公開初診頁（--intake-* token、16px、44px 高）。
// id、aria-*、class 等屬性會落在輸入框上，外面的 <label for> 才接得到。
defineOptions({ inheritAttrs: false });
const props = defineProps({
  modelValue: { type: String, default: '' },
  appearance: { type: String, default: 'app' },
  placeholder: { type: String, default: '選擇，或打字篩選' },
});
const emit = defineEmits(['update:modelValue']);
const attrs = useAttrs();
const inputAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});

const open = ref(false);
// 輸入框裡的字：平常是選中品種的中文名稱，使用者打字時是關鍵字（由 ComboboxInput 管，關閉時自動還原）。
const text = ref('');
const intake = computed(() => props.appearance === 'intake');
const selectedBreed = computed(() => findCatBreed(props.modelValue));
const selected = computed(() => selectedBreed.value?.idexx ?? '');
const selectedLabel = computed(() => selectedBreed.value?.label ?? '');
const displayValue = (value) => findCatBreed(value)?.label ?? '';
// 清單以外的舊資料（狗的品種、`Chinchilla`、自由輸入的「虎斑」），清單表達不了；原文照樣留著、顯示在下面，選了新的才取代。
const legacyText = computed(() => (props.modelValue && !selectedBreed.value ? props.modelValue : ''));

// 輸入框顯示的就是選中的那一種時不算關鍵字——剛點開要看到整份清單，不是只剩自己那一項。
const keyword = computed(() => {
  const value = text.value.trim();
  return value && value !== selectedLabel.value ? value : '';
});
const matches = computed(() => filterCatBreeds(keyword.value));
// 找不到（飼主常把花色當品種打：「虎斑」「三花」）時不留一片空白，直接給兩個退路。
const options = computed(() => (matches.value.length ? matches.value : CAT_BREED_FALLBACKS.map(findCatBreed)));

function pick(value) {
  emit('update:modelValue', value ?? '');
}

// 把字全部刪掉＝清空這一欄。舊資料的原文不在輸入框裡，不會被這個動作清掉。
function onInput(event) {
  if (!event.isComposing && event.target.value === '' && selected.value) emit('update:modelValue', '');
}

// 點開時把原本的字全選：接著打字是「重新找」，不是接在「米克斯」後面變成找不到。
// 打字打開的不選（輸入框裡已經是關鍵字，全選會讓下一個字把它蓋掉）。
const input = ref(null);
watch(open, async (value) => {
  if (!value || text.value !== selectedLabel.value) return;
  await nextTick();
  input.value?.$el?.select?.();
});
</script>

<template>
  <div :class="intake ? 'breed-select-intake' : 'min-w-0 space-y-1'">
    <ComboboxRoot v-model:open="open" :model-value="selected" ignore-filter open-on-click @update:model-value="pick">
      <ComboboxAnchor class="relative block">
        <ComboboxInput
          ref="input"
          v-model="text"
          v-bind="inputAttrs"
          :display-value="displayValue"
          data-slot="breed-select-input"
          :placeholder="placeholder"
          :class="intake ? ['breed-select-intake-input', attrs.class] : cn(
            // 跟 ui/input 同一套外觀，右邊多留箭頭的位置。
            'border-input bg-field text-foreground focus-visible:border-primary focus-visible:ring-focus-ring aria-invalid:ring-destructive/15 aria-invalid:border-destructive h-10 w-full min-w-0 rounded-lg border py-1 pr-9 pl-3 text-base outline-none transition-[border-color,box-shadow] placeholder:text-subtle-foreground focus-visible:ring-3 aria-invalid:ring-3',
            attrs.class,
          )"
          @input="onInput"
        />
        <ComboboxTrigger
          aria-label="展開品種清單"
          :class="intake ? 'breed-select-intake-trigger' : 'absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-lg text-muted-foreground'"
        >
          <ChevronDown class="size-4" :stroke-width="1.75" aria-hidden="true" />
        </ComboboxTrigger>
      </ComboboxAnchor>
      <ComboboxPortal>
        <ComboboxContent
          position="popper"
          side="bottom"
          align="start"
          :side-offset="4"
          :class="intake
            ? 'breed-select-intake-content'
            : 'bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 cn-menu-translucent z-50 max-h-[min(22rem,var(--reka-combobox-content-available-height))] w-(--reka-combobox-trigger-width) min-w-64 origin-(--reka-combobox-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xl border border-border p-1 shadow-menu duration-100'"
        >
          <p v-if="!matches.length" :class="intake ? 'breed-select-intake-empty' : 'shrink-0 px-3 pt-2 pb-1 text-sm text-muted-foreground'">清單上沒有這個品種，不確定可以選：</p>
          <ComboboxItem
            v-for="breed in options"
            :key="breed.idexx"
            :value="breed.idexx"
            :class="intake
              ? 'breed-select-intake-item'
              : 'relative flex min-h-10 w-full shrink-0 cursor-default items-baseline gap-2 rounded-md py-2 pr-9 pl-3 text-base outline-hidden select-none data-highlighted:bg-hover data-[state=checked]:font-semibold data-[state=checked]:text-accent-foreground'"
          >
            <span class="shrink-0 whitespace-nowrap">{{ breed.label }}</span>
            <!-- 英文是送到 IDEXX 主機的名稱：院內對照用，飼主不需要看。放不下時截斷英文，中文名稱不折行。 -->
            <span v-if="!intake" class="min-w-0 truncate text-sm font-normal text-subtle-foreground">{{ breed.idexx }}</span>
            <ComboboxItemIndicator :class="intake ? 'breed-select-intake-check' : 'absolute inset-y-0 right-2 flex items-center'">
              <Check class="size-4.5" :stroke-width="2" aria-hidden="true" />
            </ComboboxItemIndicator>
          </ComboboxItem>
        </ComboboxContent>
      </ComboboxPortal>
    </ComboboxRoot>
    <p v-if="legacyText" :class="intake ? 'breed-select-intake-legacy' : 'text-sm text-muted-foreground'">原本填寫：{{ legacyText }}</p>
  </div>
</template>

<!-- 公開初診頁的外觀。清單是傳送到 body 底下的，scoped 樣式跟不過去，所以用有前綴的一般 class。 -->
<style>
.breed-select-intake {
  min-width: 0;
  flex: 1 1 180px;
}
.breed-select-intake-input {
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--intake-dash);
  border-radius: 8px;
  padding: 8px 40px 8px 12px;
  background: var(--intake-white);
  color: var(--intake-text);
  font-family: inherit;
  /* 小於 16px 時 iOS Safari 一聚焦就放大整頁。 */
  font-size: 16px;
  outline: none;
}
.breed-select-intake-input::placeholder {
  color: var(--intake-secondary);
}
.breed-select-intake-input:focus {
  border-color: var(--intake-accent);
  box-shadow: 0 0 0 3px var(--intake-accent-surface);
}
.breed-select-intake-input[aria-invalid='true'] {
  border-color: var(--intake-red);
}
.breed-select-intake-trigger {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  width: 44px;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: var(--intake-secondary);
  cursor: pointer;
}
.breed-select-intake-content {
  z-index: 50;
  width: var(--reka-combobox-trigger-width);
  max-height: min(320px, var(--reka-combobox-content-available-height));
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--intake-dash);
  border-radius: 8px;
  padding: 4px;
  background: var(--intake-white);
  box-shadow: 0 8px 24px var(--intake-shadow);
  color: var(--intake-text);
  font-family: var(--font-sans);
  font-size: 16px;
}
.breed-select-intake-item {
  position: relative;
  display: flex;
  min-height: 44px;
  flex-shrink: 0;
  align-items: center;
  border-radius: 6px;
  padding: 8px 40px 8px 12px;
  cursor: pointer;
  user-select: none;
  outline: none;
}
.breed-select-intake-item[data-highlighted] {
  background: var(--intake-accent-surface);
}
.breed-select-intake-item[data-state='checked'] {
  color: var(--intake-accent);
  font-weight: bold;
}
.breed-select-intake-check {
  position: absolute;
  top: 0;
  right: 12px;
  bottom: 0;
  display: flex;
  align-items: center;
}
.breed-select-intake-empty {
  flex-shrink: 0;
  margin: 0;
  padding: 8px 12px 4px;
  color: var(--intake-secondary);
  font-size: 14px;
}
.breed-select-intake-legacy {
  margin: 4px 0 0;
  color: var(--intake-secondary);
  font-size: 14px;
}
</style>

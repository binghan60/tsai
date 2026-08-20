<script setup>
import { computed } from 'vue';
import FieldShell from './FieldShell.vue';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import QuickPhrases from './QuickPhrases.vue';

// 文字／多行／日期／數字／下拉／單選／複選這幾種一般欄位共用同一個元件，
// 差別只在控制項本身，標籤與必填標記由 FieldShell 統一處理。
const props = defineProps({
  item: { type: Object, required: true },
  // 複選的作答是字串陣列，其餘型別都是單一值。
  modelValue: { type: [String, Number, Array, null], default: '' },
});
const emit = defineEmits(['update:modelValue']);

const inputId = computed(() => `record-${props.item.key}`);
const value = computed({
  get: () => props.modelValue ?? '',
  set: (next) => emit('update:modelValue', next),
});
const inputType = computed(() => (props.item.type === 'date' ? 'date' : props.item.type === 'number' ? 'number' : 'text'));
// 空字串在 Select 裡是保留值（代表「沒有選取」），拿它當選項會直接拋錯 ——
// 表單設計器新增選項時會先產生一列空白，這裡要擋住。
const options = computed(() => (props.item.options ?? []).filter(Boolean));

// 常用語只掛在真正需要打字的欄位；日期、數字與選項類欄位掛了只是雜訊。
const isTextual = computed(() => props.item.type === 'text' || props.item.type === 'textarea');
const isMulti = computed(() => props.item.type === 'checkbox');
const checkedList = computed(() => (Array.isArray(props.modelValue) ? props.modelValue : []));

function isChecked(option) {
  return isMulti.value ? checkedList.value.includes(option) : props.modelValue === option;
}

function toggle(option, checked) {
  if (!isMulti.value) {
    emit('update:modelValue', option);
    return;
  }
  const next = checked
    ? [...checkedList.value, option]
    : checkedList.value.filter((entry) => entry !== option);
  // 照選項本身的順序輸出，勾選的先後不影響報告上的排列。
  emit('update:modelValue', options.value.filter((entry) => next.includes(entry)));
}
</script>

<template>
  <FieldShell :item="item" :input-id="inputId">
    <Textarea
      v-if="item.type === 'textarea'"
      :id="inputId"
      v-model="value"
      :rows="item.rows || 3"
      :placeholder="item.placeholder"
    />
    <Select v-else-if="item.type === 'select'" v-model="value">
      <SelectTrigger :id="inputId" class="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem v-for="(option, index) in options" :key="index" :value="option">{{ option }}</SelectItem>
      </SelectContent>
    </Select>
    <div
      v-else-if="item.type === 'radio' || item.type === 'checkbox'"
      class="flex flex-wrap gap-x-5 gap-y-1"
      role="group"
      :aria-labelledby="`${inputId}-label`"
    >
      <p v-if="!options.length" class="min-h-11 py-3 text-sm text-muted-foreground">尚未設定選項</p>
      <label
        v-for="(option, index) in options"
        :key="index"
        class="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground"
      >
        <input
          :id="index === 0 ? inputId : undefined"
          :name="`${inputId}-choices`"
          :type="item.type"
          class="h-4 w-4 shrink-0 accent-belle-600 dark:accent-brand-500"
          :value="option"
          :checked="isChecked(option)"
          @change="toggle(option, $event.target.checked)"
        />
        {{ option }}
      </label>
    </div>
    <Input
      v-else
      :id="inputId"
      v-model="value"
      :type="inputType"
      :min="item.min ?? undefined"
      :max="item.max ?? undefined"
      :step="item.step ?? undefined"
      :placeholder="item.placeholder"
    />
    <QuickPhrases v-if="isTextual" v-model="value" :item-key="item.key" :label="item.label" />
  </FieldShell>
</template>

<script setup>
import { ref, watch } from 'vue';
import { http } from '../api/http';
import { apiErrorMessage } from '../lib/apiError';
import { useToast } from '../composables/useToast';
import { Input } from './ui/input';

// 住院時間軸每一天標題列右邊的「體重」：離開輸入框（或按 Enter）才存，值沒變不送；
// 輸入中不被別台的重讀蓋掉。存好回傳那一天的文件（saved），由住院專區更新自己的資料。
const props = defineProps({
  hospitalizationId: { type: String, required: true },
  date: { type: String, required: true },
  weightKg: { type: Number, default: null },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['saved']);
const toast = useToast();

const text = (value) => (value === null || value === undefined ? '' : String(value));
const draft = ref(text(props.weightKg));
const focused = ref(false);
watch(() => props.weightKg, (value) => {
  if (!focused.value) draft.value = text(value);
});

async function save() {
  focused.value = false;
  const raw = draft.value.trim();
  const value = raw === '' ? null : Number(raw);
  if (value === (props.weightKg ?? null)) {
    draft.value = text(value);
    return;
  }
  if (value !== null && (!Number.isFinite(value) || value <= 0)) {
    toast.error('體重請填數字');
    draft.value = text(props.weightKg);
    return;
  }
  try {
    const { data } = await http.put(`/hospitalizations/${props.hospitalizationId}/days/${props.date}`, { weightKg: raw });
    emit('saved', data);
  } catch (err) {
    toast.error(apiErrorMessage(err, '體重儲存失敗，請重試'));
    draft.value = text(props.weightKg);
  }
}
</script>

<template>
  <label class="flex items-center gap-2 text-sm text-muted-foreground">體重
    <span class="relative flex items-center">
      <Input v-model="draft" inputmode="decimal" :disabled="disabled" :aria-label="`${date} 的體重`" class="num h-9 w-28 pr-9" @focus="focused = true" @blur="save" @keydown.enter="$event.target.blur()" />
      <span class="pointer-events-none absolute right-3 text-xs text-muted-foreground">kg</span>
    </span>
  </label>
</template>

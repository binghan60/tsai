<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { Pill, Trash2 } from '@lucide/vue';
import DrugSuggestEditor from './DrugSuggestEditor.vue';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { TimePicker } from './ui/time-picker';
import { Alert, AlertDescription } from './ui/alert';
import { emptyEntryDraft, entryDraft, hasEntryChanges, isEmptyEntry, validTime } from '../lib/hospitalization';

// 住院照護紀錄的新增／修改表單（住院專區時間軸上就地展開）。按「新增」「儲存」才送出，按取消什麼都不送——
// 不會因為點了「記一筆」就留下一筆空紀錄。送出、刪除由住院專區處理；這裡只管填寫。
// 版面依自己的寬度排（container query）：寬的時候時間、食物放置、灌食、體溫一排，用藥與其他並排；窄的時候往下疊。
const props = defineProps({
  // 修改的那一筆；新增時是 null。
  entry: { type: Object, default: null },
  defaultTime: { type: String, default: '' },
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
});
const emit = defineEmits(['submit', 'cancel', 'delete']);

const editing = computed(() => Boolean(props.entry));
const baseline = props.entry ? entryDraft(props.entry) : emptyEntryDraft(props.defaultTime);
const draft = reactive({ ...baseline });
const medicationEditor = ref(null);
const idBase = `hospital-entry-${props.entry?._id ?? 'new'}`;

// 新增：除了預設時間以外有填東西才算；修改：跟原本的不同才算（離開頁面前要不要提醒、能不能換一筆）。
const isDirty = computed(() => (editing.value ? hasEntryChanges(draft, baseline) : !isEmptyEntry(draft)));
const canSubmit = computed(() => validTime(draft.time) && !isEmptyEntry(draft) && (!editing.value || isDirty.value));
defineExpose({ isDirty });

function submit() {
  if (!canSubmit.value || props.submitting) return;
  emit('submit', { ...draft });
}

onMounted(async () => {
  await nextTick();
  document.getElementById(`${idBase}-food`)?.focus();
});
</script>

<template>
  <div class="@container flex flex-col gap-3.5 rounded-xl border-2 border-primary bg-card p-4" role="group" :aria-label="editing ? '修改照護紀錄' : '新增照護紀錄'">
    <div class="grid grid-cols-1 gap-3 @xs:grid-cols-2 @2xl:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)_8rem]">
      <div class="space-y-1.5">
        <Label :for="`${idBase}-time`" class="text-sm font-medium">時間</Label>
        <TimePicker :id="`${idBase}-time`" v-model="draft.time" :minute-step="1" aria-label="時間" />
      </div>
      <div class="space-y-1.5">
        <Label :for="`${idBase}-food`" class="text-sm font-medium">食物放置</Label>
        <Input :id="`${idBase}-food`" v-model="draft.food" maxlength="200" />
      </div>
      <div class="space-y-1.5">
        <Label :for="`${idBase}-forceFeeding`" class="text-sm font-medium">灌食</Label>
        <Input :id="`${idBase}-forceFeeding`" v-model="draft.forceFeeding" maxlength="200" />
      </div>
      <div class="space-y-1.5">
        <Label :for="`${idBase}-temperature`" class="text-sm font-medium">體溫</Label>
        <span class="relative flex items-center">
          <Input :id="`${idBase}-temperature`" v-model="draft.temperatureC" inputmode="decimal" class="num pr-10" />
          <span class="pointer-events-none absolute right-3 text-xs text-muted-foreground">°C</span>
        </span>
      </div>
    </div>
    <div class="grid gap-3 @2xl:grid-cols-2">
      <div class="space-y-1.5">
        <div class="flex h-7 items-center">
          <span :id="`${idBase}-medication-label`" class="text-sm font-medium">用藥</span>
          <Button type="button" variant="secondary" size="xs" class="ml-auto" @click="medicationEditor?.openPicker()"><Pill stroke-width="1.75" />藥櫃</Button>
        </div>
        <DrugSuggestEditor ref="medicationEditor" :id="`${idBase}-medication`" v-model="draft.medication" aria-label="用藥" :min-rows="3" />
      </div>
      <div class="space-y-1.5">
        <div class="flex h-7 items-center"><Label :for="`${idBase}-other`" class="text-sm font-medium">其他</Label></div>
        <Textarea :id="`${idBase}-other`" v-model="draft.other" maxlength="2000" class="min-h-[6.25rem]" />
      </div>
    </div>
    <Alert v-if="errorMessage" variant="destructive"><AlertDescription>{{ errorMessage }}</AlertDescription></Alert>
    <div class="flex flex-wrap items-center gap-2">
      <Button v-if="editing" type="button" variant="destructive" :disabled="submitting" @click="emit('delete')"><Trash2 stroke-width="1.75" />刪除</Button>
      <Button type="button" variant="secondary" class="ml-auto" :disabled="submitting" @click="emit('cancel')">取消</Button>
      <Button type="button" :disabled="!canSubmit || submitting" @click="submit">{{ submitting ? '儲存中…' : editing ? '儲存' : '新增' }}</Button>
    </div>
  </div>
</template>

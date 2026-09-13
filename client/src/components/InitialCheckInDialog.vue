<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ClipboardList } from '@lucide/vue';
import ModalDialog from './ModalDialog.vue';
import PetCreatePage from '../pages/PetCreatePage.vue';
import { http } from '../api/http';
import { DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Alert, AlertDescription } from './ui/alert';
import { TimePicker } from './ui/time-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import SegmentedControl from './SegmentedControl.vue';
import { clinicTimeInput } from '../lib/datetime';

const props = defineProps({ appointment: { type: Object, required: true }, late: Boolean, submitting: Boolean, errorMessage: String });
const emit = defineEmits(['submit', 'close']);
const source = ref('manual');
const selectedId = ref('');
const submissions = ref([]);
const loading = ref(true);
const loadError = ref('');
const arrivalMode = ref(props.late ? 'late' : 'on-time');
const lateAt = ref(clinicTimeInput(new Date()));
const ownerDraft = reactive({ name: props.appointment.ownerName || '', phone: props.appointment.ownerPhone || '' });
const petDraft = reactive({ name: props.appointment.petName || '', species: props.appointment.species || '貓' });

function replaceDraft(target, values = {}) { Object.keys(target).forEach(key => delete target[key]); Object.assign(target, values); }
function chooseSubmission() {
  const item = submissions.value.find(entry => entry._id === selectedId.value);
  if (!item) return;
  replaceDraft(ownerDraft, item.owner);
  replaceDraft(petDraft, item.pet);
}
async function loadSubmissions() {
  try {
    submissions.value = (await http.get('/intake-submissions')).data.items || [];
    const linked = submissions.value.find((item) => String(item.linkedAppointmentId || '') === String(props.appointment._id));
    if (linked) {
      source.value = 'submission';
      selectedId.value = linked._id;
      chooseSubmission();
    }
  }
  catch { loadError.value = '無法載入待審核初診表，請改為現場填寫。'; }
  finally { loading.value = false; }
}
function submit({ owner, pet }) {
  emit('submit', {
    ownerName: owner.name,
    ownerPhone: owner.phone,
    petName: pet.name,
    species: pet.species,
    owner,
    pet,
    intakeSubmissionId: source.value === 'submission' ? selectedId.value : undefined,
    isLate: arrivalMode.value === 'late',
    lateAt: lateAt.value,
  });
}
onMounted(loadSubmissions);
</script>

<template>
  <ModalDialog size="xl" @close="$emit('close')">
    <div class="flex items-center gap-3 border-b border-border p-5 sm:px-6">
      <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground"><ClipboardList class="h-5 w-5" /></span>
      <div><DialogTitle>初診報到與建檔</DialogTitle><DialogDescription class="mt-0.5 text-xs">飼主與寵物欄位與「新增寵物」完全相同；確認後會建檔並完成報到。</DialogDescription></div>
    </div>
    <div class="space-y-4 p-5 sm:p-6">
      <div class="rounded-xl border border-border bg-muted/30 p-3">
        <Label class="mb-2 block text-xs">資料來源</Label>
        <SegmentedControl v-model="source" :options="[{ value: 'manual', label: '現場填寫' }, { value: 'submission', label: '帶入初診表' }]" aria-label="初診資料來源" full-width />
        <div v-if="source === 'submission'" class="mt-3 space-y-2">
          <Select v-model="selectedId" :disabled="loading" @update:model-value="chooseSubmission"><SelectTrigger class="w-full"><SelectValue :placeholder="loading ? '載入中…' : '選擇待審核初診表'" /></SelectTrigger><SelectContent><SelectItem v-for="item in submissions" :key="item._id" :value="item._id">{{ item.owner.name }} · {{ item.pet.name }} · {{ item.owner.phone }}</SelectItem></SelectContent></Select>
          <p class="text-xs text-muted-foreground">帶入後仍可在下方依正式建檔欄位修正；確認報到時會一併核准並連結此掛號。</p><p v-if="loadError" class="text-xs text-destructive">{{ loadError }}</p>
        </div>
      </div>
      <PetCreatePage embedded :owner-draft="ownerDraft" :pet-draft="petDraft" :existing-owner="appointment.ownerId ? { _id: appointment.ownerId, name: appointment.ownerName, phone: appointment.ownerPhone } : null" :submitting="submitting" @submit="submit" />
      <section class="border-t border-border pt-4"><Label class="mb-2 block">報到狀態</Label><SegmentedControl v-model="arrivalMode" :options="[{ value: 'on-time', label: '準時' }, { value: 'late', label: '遲到' }]" aria-label="報到狀態" full-width /><TimePicker v-if="arrivalMode === 'late'" v-model="lateAt" class="mt-3" aria-label="實際到院時間" :minute-step="1" /></section>
      <Alert v-if="errorMessage" variant="destructive"><AlertDescription>{{ errorMessage }}</AlertDescription></Alert>
      <DialogFooter><Button type="button" variant="secondary" @click="$emit('close')">取消</Button></DialogFooter>
    </div>
  </ModalDialog>
</template>

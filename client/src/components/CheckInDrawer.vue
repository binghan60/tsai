<script setup>
import { onMounted, reactive, ref } from 'vue';
import { http } from '../api/http';
import SideDrawer from './SideDrawer.vue';
import PetCreatePage from '../pages/PetCreatePage.vue';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Alert, AlertDescription } from './ui/alert';
import { TimePicker } from './ui/time-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import SegmentedControl from './SegmentedControl.vue';
import { clinicTimeInput } from '../lib/datetime';

// 初診報到＝建立正式飼主與寵物資料再報到。欄位跟「新增寵物」頁完全相同，
// 內容太多放不進小面板，所以跟掛號一樣用看板旁的抽屜，不擋住櫃台其他工作。
// 回診報到不走這裡：資料齊全的回診在卡片上一鍵完成。
const props = defineProps({
  appointment: { type: Object, required: true },
  // 超過寬限時間時預設選「遲到」
  late: { type: Boolean, default: false },
  suggestedCheckinNumber: { type: Number, default: 1 },
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
});
const emit = defineEmits(['submit', 'close']);

const source = ref('manual');
const selectedId = ref('');
const submissions = ref([]);
const loading = ref(true);
const loadError = ref('');
const arrivalMode = ref(props.late ? 'late' : 'on-time');
const lateAt = ref(clinicTimeInput(new Date()));
const checkinNumber = ref(props.suggestedCheckinNumber);
const ownerDraft = reactive({ name: props.appointment.ownerName || '', phone: props.appointment.ownerPhone || '' });
const petDraft = reactive({ name: props.appointment.petName || '', species: props.appointment.species || '貓' });

function replaceDraft(target, values = {}) {
  Object.keys(target).forEach((key) => delete target[key]);
  Object.assign(target, values);
}
function chooseSubmission() {
  const item = submissions.value.find((entry) => entry._id === selectedId.value);
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
  } catch {
    loadError.value = '無法載入待審核初診表，請改為現場填寫。';
  } finally {
    loading.value = false;
  }
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
    ...(checkinNumber.value === props.suggestedCheckinNumber ? {} : { checkinNumber: checkinNumber.value }),
  });
}
onMounted(loadSubmissions);
</script>

<template>
  <SideDrawer :title="`初診報到：${appointment.petName}`" description="確認後會建立飼主與寵物資料，並完成報到" :close-disabled="submitting" close-label="取消報到" @close="emit('close')">
    <div class="space-y-5">
      <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <div class="space-y-1.5">
          <Label class="text-xs font-medium">到院</Label>
          <SegmentedControl v-model="arrivalMode" :options="[{ value: 'on-time', label: '準時' }, { value: 'late', label: '遲到' }]" aria-label="報到狀態" full-width />
          <TimePicker v-if="arrivalMode === 'late'" v-model="lateAt" aria-label="實際到院時間" :minute-step="1" />
        </div>
        <div class="space-y-1.5">
          <Label for="drawer-checkin-number" class="text-xs font-medium">號碼牌</Label>
          <Input id="drawer-checkin-number" v-model.number="checkinNumber" type="number" min="1" step="1" />
        </div>
      </div>

      <div class="space-y-2">
        <Label class="text-xs font-medium">資料來源</Label>
        <SegmentedControl v-model="source" :options="[{ value: 'manual', label: '現場填寫' }, { value: 'submission', label: '帶入初診表' }]" aria-label="初診資料來源" full-width />
        <template v-if="source === 'submission'">
          <Select v-model="selectedId" :disabled="loading" @update:model-value="chooseSubmission">
            <SelectTrigger class="w-full"><SelectValue :placeholder="loading ? '載入中…' : '選擇待審核初診表'" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="item in submissions" :key="item._id" :value="item._id">{{ item.owner.name }} · {{ item.pet.name }} · {{ item.owner.phone }}</SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">帶入後仍可在下方修正；確認報到時會一併核准並連結此掛號。</p>
          <p v-if="loadError" class="text-xs text-destructive">{{ loadError }}</p>
        </template>
      </div>

      <Alert v-if="errorMessage" variant="destructive"><AlertDescription>{{ errorMessage }}</AlertDescription></Alert>

      <PetCreatePage
        embedded
        :owner-draft="ownerDraft"
        :pet-draft="petDraft"
        :existing-owner="appointment.ownerId ? { _id: appointment.ownerId, name: appointment.ownerName, phone: appointment.ownerPhone } : null"
        :submitting="submitting"
        @submit="submit"
      />
    </div>
  </SideDrawer>
</template>

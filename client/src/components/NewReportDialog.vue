<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { http } from '../api/http';
import { apiErrorMessage } from '../lib/apiError';
import { clinicDateInput, shortDate, weekdayLabel } from '../lib/datetime';
import ModalDialog from './ModalDialog.vue';
import ListSkeleton from './ListSkeleton.vue';
import { DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { DatePicker } from './ui/date-picker';
import { TimePicker } from './ui/time-picker';
import { Alert, AlertDescription } from './ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

// 「新增健檢」：健檢報告一律從看診建立。列這隻貓有看診的掛號（新到舊），已有報告的直接接著填或看，
// 沒有的按「建立報告」（workflow 的 record）。要寫的那次看診不在清單上（當天忘了掛號、補建以前的健檢）
// 就「補登看診」：建立一筆已完成的看診，同時建立報告草稿。
const props = defineProps({
  petId: { type: String, required: true },
  petName: { type: String, default: '' },
});
const emit = defineEmits(['close']);
const router = useRouter();

const visits = ref([]);
const loading = ref(true);
const error = ref('');
const busyId = ref('');
const templates = ref([]);
const defaultTemplateId = ref('');

const STATUS_LABELS = { arrived: '在院', pending_checkout: '待櫃台處理', completed: '已完成' };

onMounted(async () => {
  try {
    const [visitResponse, templateResponse, settingsResponse] = await Promise.all([
      http.get('/appointments/visits', { params: { petId: props.petId } }),
      http.get('/settings/form-templates'),
      http.get('/settings/appointment-settings'),
    ]);
    visits.value = visitResponse.data.items ?? [];
    templates.value = (templateResponse.data ?? []).filter((template) => template.enabled !== false);
    defaultTemplateId.value = String(settingsResponse.data?.defaultAppointmentTemplateId ?? templates.value[0]?._id ?? '');
    backfill.value.templateId = defaultTemplateId.value;
  } catch (err) {
    error.value = apiErrorMessage(err, '讀不到這隻貓的看診，請稍後再試');
  } finally {
    loading.value = false;
  }
});

function whenLabel(visit) {
  return `${shortDate(visit.date)}（${weekdayLabel(visit.date)}）${visit.time ? ` ${visit.time}` : ''}`;
}

async function createReport(visit) {
  busyId.value = String(visit._id);
  error.value = '';
  try {
    const { data } = await http.post(`/appointments/${visit._id}/workflow/record`, {
      version: visit.__v ?? 0,
      ...(visit.templateId ? {} : { templateId: defaultTemplateId.value }),
    });
    await router.push(`/records/${data.record._id}/edit`);
    emit('close');
  } catch (err) {
    error.value = apiErrorMessage(err, '建立報告失敗，請稍後再試');
  } finally {
    busyId.value = '';
  }
}

function openReport(visit) {
  const path = visit.report.status === 'draft' ? `/records/${visit.report._id}/edit` : `/records/${visit.report._id}/preview`;
  router.push(path);
  emit('close');
}

// 補登看診
const backfilling = ref(false);
const backfill = ref({ date: clinicDateInput(), time: '', reason: '', templateId: '' });
const saving = ref(false);
const backfillError = computed(() => {
  if (!backfill.value.date) return '請選擇看診日期';
  if (backfill.value.date > clinicDateInput()) return '補登只能補今天以前的看診';
  if (!backfill.value.templateId) return '請選擇健檢表單';
  return '';
});
const attempted = ref(false);

async function submitBackfill() {
  attempted.value = true;
  if (backfillError.value) return;
  saving.value = true;
  error.value = '';
  try {
    const { data } = await http.post('/appointments/backfill', { petId: props.petId, ...backfill.value });
    await router.push(`/records/${data.record._id}/edit`);
    emit('close');
  } catch (err) {
    error.value = apiErrorMessage(err, '補登失敗，請稍後再試');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ModalDialog size="lg" :title="backfilling ? `補登看診：${petName}` : `新增健檢：${petName}`" @close="emit('close')">
    <template v-if="!backfilling">
      <ListSkeleton v-if="loading" :rows="3" inset />
      <div v-else>
        <div v-if="visits.length" class="hidden gap-4 border-b border-border bg-sunken px-6 py-2 text-sm font-semibold text-muted-foreground sm:grid sm:grid-cols-[13.5rem_minmax(0,1fr)_6.5rem_9rem]">
          <span>看診</span><span>來院原因</span><span>看診狀態</span><span></span>
        </div>
        <ul v-if="visits.length" class="max-h-[55vh] divide-y divide-border overflow-y-auto">
          <li v-for="visit in visits" :key="visit._id" class="grid items-center gap-x-4 gap-y-1 px-6 py-3 sm:grid-cols-[13.5rem_minmax(0,1fr)_6.5rem_9rem]">
            <span class="num font-medium whitespace-nowrap">{{ whenLabel(visit) }}</span>
            <span class="min-w-0 truncate" v-tip.overflow="visit.reason">{{ visit.reason }}</span>
            <span class="text-sm" :class="visit.status === 'completed' ? 'text-muted-foreground' : 'font-semibold text-warning'">{{ STATUS_LABELS[visit.status] }}</span>
            <span class="flex sm:justify-end">
              <Button v-if="visit.report?.status === 'draft'" type="button" variant="soft" size="sm" @click="openReport(visit)">繼續填寫草稿</Button>
              <Button v-else-if="visit.report" type="button" variant="secondary" size="sm" @click="openReport(visit)">查看報告</Button>
              <Button v-else type="button" variant="soft" size="sm" :disabled="Boolean(busyId)" @click="createReport(visit)">{{ busyId === String(visit._id) ? '建立中…' : '建立報告' }}</Button>
            </span>
          </li>
        </ul>
        <p v-else class="px-6 py-8 text-center text-muted-foreground">這隻貓還沒有看診紀錄</p>
      </div>
      <div v-if="error" class="px-6 pb-2"><Alert variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert></div>
      <DialogFooter>
        <Button type="button" variant="secondary" class="mr-auto" @click="backfilling = true">補登看診</Button>
      </DialogFooter>
    </template>

    <form v-else class="flex flex-col" @submit.prevent="submitBackfill">
      <div class="grid gap-4 p-6 sm:grid-cols-2">
        <div class="space-y-1.5">
          <Label for="backfill-date">看診日期<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
          <DatePicker id="backfill-date" v-model="backfill.date" aria-label="看診日期" />
        </div>
        <div class="space-y-1.5">
          <Label for="backfill-time">時間</Label>
          <TimePicker id="backfill-time" v-model="backfill.time" placeholder="時間" aria-label="看診時間" />
        </div>
        <div class="space-y-1.5 sm:col-span-2">
          <Label for="backfill-reason">來院原因</Label>
          <Input id="backfill-reason" v-model="backfill.reason" maxlength="500" placeholder="例：年度健檢、皮膚複診" />
        </div>
        <div class="space-y-1.5 sm:col-span-2">
          <Label for="backfill-template">健檢表單<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
          <Select v-model="backfill.templateId">
            <SelectTrigger id="backfill-template" class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="template in templates" :key="template._id" :value="String(template._id)">{{ template.name }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p v-if="attempted && backfillError" class="text-sm font-medium text-destructive sm:col-span-2">{{ backfillError }}</p>
        <Alert v-if="error" variant="destructive" class="sm:col-span-2"><AlertDescription>{{ error }}</AlertDescription></Alert>
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" :disabled="saving" @click="backfilling = false">返回</Button>
        <Button type="submit" :disabled="saving">{{ saving ? '補登中…' : '補登並建立報告' }}</Button>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>

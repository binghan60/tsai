<script setup>
import { apiErrorMessage } from '../lib/apiError';
import { computed, ref, watch } from 'vue';
import { Check, Pencil, X } from '@lucide/vue';
import { http } from '../api/http';
import { useToast } from '../composables/useToast';
import { clinicDateInput, formatDateTime } from '../lib/datetime';
import { intakeSections } from '../lib/intakeDisplay';
import { DEFAULT_ESTIMATED_DURATION_MINUTES, DURATION_OVERFLOW_ERROR, appointmentSlotErrors } from '../lib/appointmentTime';
import AppointmentSlotPicker from './AppointmentSlotPicker.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import IntakeSectionEditor from './IntakeSectionEditor.vue';
import ListSkeleton from './ListSkeleton.vue';
import SurgeryField from './SurgeryField.vue';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';

// 一份飼主送出的初診表：逐欄讀過（填錯的地方可以一段一段就地修改）、排好掛號時段，再「掛號」建立正式飼主與貓咪資料，或退回。
// 右側初診面板與 /reception/intakes 共用。版面依容器寬度切一欄或兩欄，放在 460px 的面板裡也讀得下去。
const props = defineProps({
  submissionId: { type: String, required: true },
});
const emit = defineEmits(['decided']);
const toast = useToast();

const submission = ref(null);
const loading = ref(true);
const error = ref('');
const busy = ref(false);
const confirmation = ref('');
const form = ref({ date: clinicDateInput(), time: '', reason: '', internalNote: '', isSurgery: false, surgeryName: '' });
// 正在修改的那一段（pet／medical／owner）；一次只開一段，改完存檔前不能掛號或退回。
const editing = ref('');
const durationMinutes = ref(DEFAULT_ESTIMATED_DURATION_MINUTES);
// 初診表連著的那筆掛號；時段格上它自己不算佔用。
const linkedAppointmentId = ref('');
const attemptedApprove = ref(false);
let request = 0;

const sections = computed(() => intakeSections(submission.value));
// 掛號安排跟掛號視窗是同一塊（AppointmentSlotPicker＋SurgeryField），日期、時段必填，
// 規則在 lib/appointmentTime.js，後端審核時也照同一套再驗一次。
// 按下掛號時檢查，之後改欄位時重算。
const slotErrors = ref({});
function checkSlot() {
  const errors = appointmentSlotErrors({ ...form.value, durationMinutes: durationMinutes.value });
  if (form.value.isSurgery && !form.value.surgeryName.trim()) errors.surgeryName = '請填寫手術名稱';
  slotErrors.value = errors;
  return !Object.keys(errors).length;
}
watch([form, durationMinutes], () => attemptedApprove.value && checkSlot(), { deep: true });

async function load(id) {
  const token = ++request;
  loading.value = true;
  error.value = '';
  submission.value = null;
  editing.value = '';
  attemptedApprove.value = false;
  slotErrors.value = {};
  try {
    const { data } = await http.get(`/intake-submissions/${id}`);
    if (token !== request) return;
    submission.value = data;
    const appointmentId = data.linkedAppointmentId?._id || data.linkedAppointmentId;
    let appointment = typeof data.linkedAppointmentId === 'object' ? data.linkedAppointmentId : null;
    if (!appointment && appointmentId) {
      appointment = (await http.get(`/appointments/${appointmentId}`).catch(() => ({ data: null }))).data;
      if (token !== request) return;
    }
    form.value = {
      date: appointment?.date || clinicDateInput(),
      time: appointment?.time || '',
      reason: appointment?.reason || '',
      internalNote: appointment?.internalNote || '',
      isSurgery: Boolean(appointment?.isSurgery),
      surgeryName: appointment?.surgeryName || '',
    };
    durationMinutes.value = appointment?.estimatedDurationMinutes || DEFAULT_ESTIMATED_DURATION_MINUTES;
    linkedAppointmentId.value = appointmentId ? String(appointmentId) : '';
  } catch (err) {
    if (token === request) error.value = err.response?.status === 404 ? '找不到這份初診表，可能已被處理。' : '初診表載入失敗，請重試。';
  } finally {
    if (token === request) loading.value = false;
  }
}
watch(() => props.submissionId, load, { immediate: true });

function requestApprove() {
  attemptedApprove.value = true;
  if (!checkSlot()) return;
  confirmation.value = 'approve';
}

function onSectionSaved(data) {
  submission.value = data;
  editing.value = '';
  toast.success('已更新初診表內容');
}

async function decide() {
  const action = confirmation.value;
  if (!action || busy.value) return;
  busy.value = true;
  try {
    const payload = action === 'approve'
      ? { ...form.value, surgeryName: form.value.isSurgery ? form.value.surgeryName.trim() : '', estimatedDurationMinutes: Number(durationMinutes.value) }
      : {};
    const { data } = await http.post(`/intake-submissions/${props.submissionId}/${action}`, payload);
    confirmation.value = '';
    toast.success(action === 'approve' ? `已建立「${data.pet.name}」與飼主的正式資料` : '已退回這份初診表');
    emit('decided', { action, data });
  } catch (err) {
    toast.error(apiErrorMessage(err, '審核失敗，請重新整理後再試'));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="@container flex flex-col gap-5">
    <ListSkeleton v-if="loading" :rows="4" inset />
    <Alert v-else-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

    <template v-else-if="submission">
      <p class="text-sm text-subtle-foreground">送出於 <span class="num">{{ formatDateTime(submission.createdAt) }}</span></p>

      <section v-for="section in sections" :key="section.key" class="space-y-2">
        <div class="flex min-h-9 items-center justify-between gap-3">
          <h3 class="text-base font-semibold">{{ section.title }}</h3>
          <Button v-if="!editing" type="button" variant="secondary" size="sm" :aria-label="`修改${section.title}`" @click="editing = section.key"><Pencil stroke-width="1.75" />修改</Button>
        </div>
        <IntakeSectionEditor v-if="editing === section.key" :section="section.key" :submission="submission" @saved="onSectionSaved" @cancel="editing = ''" />
        <dl v-else class="grid gap-x-6 rounded-xl border border-border @lg:grid-cols-2">
          <div v-for="row in section.rows" :key="row.label" class="flex gap-3 border-b border-border px-4 py-2.5 last:border-b-0 @lg:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
            <dt class="w-20 shrink-0 text-sm text-subtle-foreground">{{ row.label }}</dt>
            <dd class="min-w-0 flex-1 wrap-anywhere" :class="[row.value ? 'text-foreground' : 'text-subtle-foreground', row.mono && row.value ? 'num' : '']">{{ row.value }}</dd>
          </div>
        </dl>
      </section>

      <section class="space-y-3">
        <div>
          <h3 class="text-base font-semibold">掛號安排</h3>
          <p class="mt-0.5 text-sm text-muted-foreground">掛號後以這個時段建立正式掛號，之後才能報到。</p>
        </div>
        <div class="space-y-4">
          <div class="space-y-1.5"><Label for="intake-reason">來院原因</Label><Input id="intake-reason" v-model="form.reason" placeholder="例：打疫苗、不舒服、初診檢查" /></div>
          <SurgeryField v-model:is-surgery="form.isSurgery" v-model:surgery-name="form.surgeryName" :error="attemptedApprove ? slotErrors.surgeryName || '' : ''" />
          <AppointmentSlotPicker
            v-model:date="form.date"
            v-model:time="form.time"
            v-model:duration="durationMinutes"
            :exclude-id="linkedAppointmentId"
            :show-errors="attemptedApprove"
          />
          <!-- 沒選時段、超出診別這兩種時段格自己會標；這裡只補其餘按下掛號才知道的錯誤。 -->
          <p v-if="attemptedApprove && slotErrors.time && form.time && slotErrors.time !== DURATION_OVERFLOW_ERROR" class="text-xs font-medium text-destructive">{{ slotErrors.time }}</p>
          <div class="space-y-1.5"><Label for="intake-note">內部備註</Label><Textarea id="intake-note" v-model="form.internalNote" rows="2" maxlength="2000" placeholder="僅院內人員可見" /></div>
        </div>
      </section>

      <div class="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        <p v-if="editing" class="mr-auto text-sm text-muted-foreground">先儲存或取消修改，才能掛號或退回</p>
        <Button variant="destructive" :disabled="busy || Boolean(editing)" @click="confirmation = 'reject'"><X stroke-width="1.75" />退回</Button>
        <Button :disabled="busy || Boolean(editing)" @click="requestApprove"><Check stroke-width="1.75" />掛號</Button>
      </div>
    </template>

    <ConfirmDialog
      v-if="confirmation && submission"
      :open="true"
      :title="confirmation === 'approve' ? '掛號？' : '退回這份初診表？'"
      :description="confirmation === 'approve' ? `會建立飼主「${submission.owner.name}」與貓咪「${submission.pet.name}」，並以選定時間建立掛號。` : `不會建立「${submission.pet.name}」的正式資料；驗證碼還沒過期的話，飼主可以用同一組重填。`"
      :loading="busy"
      :confirm-label="confirmation === 'approve' ? '掛號' : '退回'"
      :destructive="confirmation === 'reject'"
      @confirm="decide"
      @cancel="confirmation = ''"
    />
  </div>
</template>

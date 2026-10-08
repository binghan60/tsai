<script setup>
import { usePetClinicalNotes } from '../composables/usePetClinicalNotes';
import { apiErrorMessage } from '../lib/apiError.js';
import { computed, nextTick, ref, watch } from 'vue';
import PatientLink from './PatientLink.vue';
import { CalendarCheck, Check, Pencil, Undo2, X } from '@lucide/vue';
import { http } from '../api/http';
import { useAppointmentNotifier } from '../composables/useAppointmentNotifier';
import { describeVisitChanges } from '../lib/appointmentNotifications';
import { workflowState } from '../../../shared/appointmentWorkflow.js';
import { DEFAULT_ESTIMATED_DURATION_MINUTES, appointmentSlotErrors } from '../lib/appointmentTime';
import AppointmentSlotPicker from './AppointmentSlotPicker.vue';
import SurgeryField from './SurgeryField.vue';
import { Input } from './ui/input';
import ClinicalNotesPanel from './ClinicalNotesPanel.vue';
import SpecGrid from './SpecGrid.vue';
import SpecCell from './SpecCell.vue';
import CheckinNumber from './CheckinNumber.vue';
import { clinicTimeInput, weekdayLabel } from '../lib/datetime';
import LatenessBadge from './LatenessBadge.vue';
import DepositBadge from './DepositBadge.vue';
import DepositField from './DepositField.vue';
import { checkDepositDecision } from '../../../shared/deposit.js';
import SurgeryBadge from './SurgeryBadge.vue';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Alert, AlertDescription } from './ui/alert';
import RichText from './RichText.vue';
import RichTextEditor from './RichTextEditor.vue';
import { richTextToPlain } from '../../../shared/richText.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

// 櫃台處理視窗。左欄「跟飼主說」照當面講話的順序編號：請轉告飼主 → 本次簡易紀錄，下面接著歷次病歷日誌
// （飼主常會問「上次開的藥還能吃嗎」）；轉告事項最容易漏掉，所以放最上面並用警示底色。
// 右欄是約回診：大部分就診都會當場約，所以打開就看得到時段格，醫師建議就貼在時段旁邊。
// 舊版是左欄一路往下疊、時段格在最底下要捲，右欄常駐日誌，使用者覺得資訊太散、找不到重點。
// 收費與領藥櫃台直接處理，系統不計價，所以沒有「醫師交辦」這一段。
const props = defineProps({
  appointment: { type: Object, required: true },
  // 貓咪／飼主備註（patientNotesFor 的回傳）。飼主就站在櫃台前，「處置前先說明費用」這類事要先看到。
  patientNotes: { type: Array, default: () => [] },
});
const emit = defineEmits(['updated', 'close']);
const notifyChat = useAppointmentNotifier();

const busy = ref(false);
const error = ref('');
const visitNote = ref(props.appointment.visitNote || '');
const noteBaseline = ref(visitNote.value);
const noteDirty = computed(() => visitNote.value !== noteBaseline.value);
const noteConflict = computed(() => noteDirty.value && (props.appointment.visitNote || '') !== noteBaseline.value);
const noteSaved = ref(false);
const editingNote = ref(false);
const { notes, page: notePage, totalPages: noteTotalPages, loading: notesLoading, error: notesError, load: loadNotes } = usePetClinicalNotes({
  petId: () => props.appointment.petId,
  excludeAppointmentId: () => props.appointment._id,
});

// 回診安排跟掛號視窗是同一套：來院原因、手術標記、日期、預估診療時間、時段格（AppointmentSlotPicker）。
// 來院原因預設帶醫師寫的回診原因；醫師沒寫就留空，不替使用者補字。
function followUpDefaults() {
  return {
    date: props.appointment.followUpDate || '',
    time: props.appointment.followUpTime || '',
    duration: DEFAULT_ESTIMATED_DURATION_MINUTES,
    reason: props.appointment.followUpReason || props.appointment.followUpRecommendation || '',
    isSurgery: false,
    surgeryName: '',
  };
}
const followUp = ref(followUpDefaults());
const followUpAttempted = ref(false);
// 已經約好的回診也能在這裡改期（後端就地改那一筆），展開的是同一塊時段選擇。
const rescheduling = ref(false);

const state = computed(() => workflowState(props.appointment));
const booked = computed(() => Boolean(props.appointment.followUpAppointmentId));
const editingFollowUp = computed(() => !booked.value || rescheduling.value);
// 選了日期或時段就算「要約回診」；兩者都空＝飼主還沒決定，這筆留在「待安排回診」。
const followUpStarted = computed(() => editingFollowUp.value && Boolean(followUp.value.date || followUp.value.time));
// 底部那一句：按下「完成處理」之前就看得出這次會不會約回診、約在哪。只填了一半（有日期沒時段）時不說，
// 按下去會由 followUpError 擋下來。
function whenLabel(date, time) {
  return `${date.slice(5).replace('-', '/')}（${weekdayLabel(date)}）${time}`;
}
const followUpSummary = computed(() => {
  if (state.value.completed) return null;
  if (!editingFollowUp.value) return { lead: '回診已約好', when: whenLabel(props.appointment.followUpDate, props.appointment.followUpTime), tail: '' };
  const { date, time, duration } = followUp.value;
  if (date && time) return { lead: '完成後會約', when: whenLabel(date, time), tail: `回診（${duration} 分）` };
  // 「待安排回診」只算醫師寫了回診建議的（server/src/routes/dashboard.js），沒寫就不這樣講。
  const recommended = Boolean(props.appointment.followUpRecommendation || props.appointment.followUpReason);
  if (!followUpStarted.value) return { lead: recommended ? '這次不約回診，會留在「待安排回診」' : '這次不約回診', when: '', tail: '' };
  return null;
});
// 保證金（shared/deposit.js）：約回診也是約診。這隻貓達到門檻時（常常就是這次又遲到），新約的回診要先選
// 「已收」或「這次不收」；改期已經約好的回診不再問。查不到狀態時不擋，由後端把關。
const depositState = ref(null);
const depositStatus = ref('');
const depositReason = ref('');
const depositError = ref('');
watch([depositStatus, depositReason], () => { depositError.value = ''; });
const depositNeeded = computed(() => !booked.value && Boolean(depositState.value?.required));
let depositRequest = 0;
async function loadDepositState() {
  const token = ++depositRequest;
  depositState.value = null;
  depositStatus.value = '';
  depositReason.value = '';
  depositError.value = '';
  if (!props.appointment.petId) return;
  try {
    const { data } = await http.get(`/pets/${props.appointment.petId}/attendance`, { params: { limit: 1 } });
    if (token === depositRequest) depositState.value = data.deposit ?? null;
  } catch {
    // 查不到就不顯示；需要收而沒問到時，送出會被後端擋下並說明。
  }
}
const surgeryNameError = computed(() => (followUpAttempted.value && followUp.value.isSurgery && !followUp.value.surgeryName.trim() ? '請填寫手術名稱' : ''));

watch(() => props.appointment._id, () => {
  followUp.value = followUpDefaults();
  followUpAttempted.value = false;
  rescheduling.value = false;
  resetNote();
  editingNote.value = false;
  error.value = '';
  loadNotes(1);
  loadDepositState();
});

function resetNote() {
  visitNote.value = props.appointment.visitNote || '';
  noteBaseline.value = visitNote.value;
  noteSaved.value = false;
}
watch(() => props.appointment.visitNote, () => { if (!noteDirty.value) resetNote(); });

async function persistNote() {
  if (!noteDirty.value) return;
  if (noteConflict.value) throw new Error('本次簡易紀錄已由其他人修改，請先核對最新內容。');
  if (state.value.completed) throw new Error('這筆就診已結案，請先退回處理中。');
  const before = { visitNote: noteBaseline.value };
  const data = await run('clinical', { visitNote: visitNote.value });
  const changedParts = describeVisitChanges(before, { visitNote: data.visitNote });
  if (changedParts.length) notifyChat(data, 'visit_data', {
    changedParts,
    // 聊天室只顯示純文字，格式標記不送過去。
    snapshot: { fieldLabel: '本次簡易紀錄', before: richTextToPlain(before.visitNote), after: richTextToPlain(data.visitNote) },
  });
  visitNote.value = data.visitNote || '';
  noteBaseline.value = visitNote.value;
  noteSaved.value = true;
}

function startEditNote() {
  resetNote();
  editingNote.value = true;
}
function cancelEditNote() {
  resetNote();
  editingNote.value = false;
}

async function saveNote() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await persistNote();
    editingNote.value = false;
  } catch (err) {
    error.value = err.response?.data?.message || err.message || '儲存失敗，請重試';
  } finally { busy.value = false; }
}
function close() { if (!busy.value) emit('close'); }

async function run(action, values = {}, options = {}) {
  const { data } = await http.post(`/appointments/${props.appointment._id}/workflow/${action}`, { version: props.appointment.__v ?? 0, ...values });
  emit('updated', data, action, options);
  await nextTick();
  return data;
}

loadNotes();
loadDepositState();

function handleHistoricalNoteSaved({ note, content }) {
  notifyChat(props.appointment, 'visit_data', {
    changedParts: ['歷次病歷日誌'],
    snapshot: { fieldLabel: '歷次病歷日誌', before: note.content || '', after: content || '' },
  });
  loadNotes(notePage.value);
}

// 送出前跟掛號視窗同一套檢查（lib/appointmentTime.js）。
// 回傳第一個錯誤訊息，沒有錯誤回空字串。
function followUpError() {
  followUpAttempted.value = true;
  const { date, time, duration, isSurgery, surgeryName } = followUp.value;
  const errors = appointmentSlotErrors({ date, time, durationMinutes: duration });
  if (errors.date) return '請選擇回診日期';
  if (errors.time) return errors.time === '請選擇預約時段' ? '請選擇回診時段' : errors.time;
  if (isSurgery && !surgeryName.trim()) return '請填寫手術名稱';
  if (depositNeeded.value) {
    const deposit = checkDepositDecision({ status: depositStatus.value, reason: depositReason.value }, true);
    if (deposit.error) {
      depositError.value = deposit.error;
      return deposit.error;
    }
  }
  return '';
}

function followUpPayload() {
  const { date, time, duration, reason, isSurgery, surgeryName } = followUp.value;
  return {
    followUpDate: date,
    followUpTime: time,
    estimatedDurationMinutes: Number(duration),
    reason: reason.trim(),
    isSurgery,
    surgeryName: isSurgery ? surgeryName.trim() : '',
    ...(depositNeeded.value ? { deposit: { status: depositStatus.value, reason: depositReason.value.trim() } } : {}),
  };
}

async function bookFollowUp() {
  if (busy.value || !followUpStarted.value) return;
  error.value = followUpError();
  if (error.value) return;
  busy.value = true;
  try {
    await run('followup', followUpPayload());
    rescheduling.value = false;
  }
  catch (err) { error.value = apiErrorMessage(err, '回診預約失敗，請稍後重試'); }
  finally { busy.value = false; }
}

// 改期：先讀那筆回診掛號，帶入它現在的時段、診療時間、原因與手術標記。
async function startReschedule() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const { data } = await http.get(`/appointments/${props.appointment.followUpAppointmentId}`);
    if (data.status !== 'scheduled') {
      error.value = '這筆回診已經報到或被處理過，請從時間軸上的那筆掛號修改。';
      return;
    }
    followUp.value = {
      date: data.date || '',
      time: data.time || '',
      duration: data.estimatedDurationMinutes || DEFAULT_ESTIMATED_DURATION_MINUTES,
      reason: data.reason || '',
      isSurgery: Boolean(data.isSurgery),
      surgeryName: data.surgeryName || '',
    };
    followUpAttempted.value = false;
    rescheduling.value = true;
  } catch (err) {
    error.value = apiErrorMessage(err, '回診掛號載入失敗，請稍後重試');
  } finally { busy.value = false; }
}
function cancelReschedule() {
  rescheduling.value = false;
  followUpAttempted.value = false;
  error.value = '';
}

// 一顆按鈕收尾：還沒掛號的回診先掛上，再結束這次就診。分成兩顆只會讓櫃台漏按其中一顆。
// 回診只填了一半（有日期沒時段）時擋下來，不默默丟掉。
async function complete() {
  if (busy.value || editingNote.value) return;
  error.value = followUpStarted.value ? followUpError() : '';
  if (error.value) return;
  busy.value = true;
  try {
    if (followUpStarted.value) await run('followup', followUpPayload(), { silentToast: true });
    await run('complete');
    emit('close');
  } catch (err) {
    error.value = err.response?.data?.message || err.message || '操作失敗，請稍後重試';
  } finally { busy.value = false; }
}

async function approveReopen() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await run('approve-reopen');
  } catch (err) {
    error.value = apiErrorMessage(err, '操作失敗，請稍後重試');
  } finally { busy.value = false; }
}

// 櫃台自己退回處理中：按錯完成、或完成後才發現要改。視窗留著，退回後直接在這裡改。
async function reopen() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await run('reopen');
  } catch (err) {
    error.value = apiErrorMessage(err, '操作失敗，請稍後重試');
  } finally { busy.value = false; }
}
</script>

<template>
  <Dialog :open="true" @update:open="value => !value && close()">
    <DialogContent
      size="2xl"
      :show-close-button="false"
      class="h-[min(calc(100dvh-3rem),54rem)] gap-0 p-0"
      @escape-key-down="event => busy && event.preventDefault()"
      @pointer-down-outside="event => busy && event.preventDefault()"
    >
      <div class="flex h-full min-h-0 flex-col">
        <!-- 標頭一排：號碼牌｜貓咪、徽章、來院原因｜飼主與時間規格欄｜關閉。
             舊版第二排的四段進度條拿掉了：打開這個視窗時一定是「待櫃台處理」，改成規格欄裡的「交櫃台」時間。 -->
        <header class="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3 border-b border-border px-6 py-4">
          <CheckinNumber :appointment="appointment" size="lg" />
          <div class="min-w-0 flex-1 space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <DialogTitle class="text-xl leading-tight"><PatientLink :pet-id="appointment.petId">{{ appointment.petName }}</PatientLink></DialogTitle>
              <Badge v-if="appointment.visitType === 'new'" variant="status" class="bg-info-surface text-info">初診</Badge>
              <SurgeryBadge v-if="appointment.isSurgery" :name="appointment.surgeryName" />
              <LatenessBadge :minutes="appointment.latenessMinutes" />
              <DepositBadge :status="appointment.depositStatus" />
            </div>
            <div class="flex flex-wrap items-baseline gap-x-2.5">
              <span class="spec-label">來院原因</span>
              <DialogDescription class="text-base font-medium text-foreground">{{ appointment.reason }}</DialogDescription>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <SpecGrid>
              <SpecCell label="飼主"><PatientLink v-if="appointment.ownerName" :pet-id="appointment.petId" quiet>{{ appointment.ownerName }}</PatientLink></SpecCell>
              <SpecCell v-if="appointment.ownerPhone" label="電話" mono><a :href="`tel:${appointment.ownerPhone}`" class="text-primary">{{ appointment.ownerPhone }}</a></SpecCell>
              <SpecCell label="預約" mono>{{ appointment.date?.slice(5) }} {{ appointment.time || '' }}</SpecCell>
              <SpecCell v-if="appointment.handoffAt" label="交櫃台" mono>{{ clinicTimeInput(appointment.handoffAt) }}</SpecCell>
              <SpecCell v-if="appointment.deskCompletedAt" label="完成" mono>{{ clinicTimeInput(appointment.deskCompletedAt) }}</SpecCell>
            </SpecGrid>
            <Button variant="secondary" size="icon-sm" aria-label="關閉處理視窗" :disabled="busy" @click="close"><X stroke-width="1.75" /></Button>
          </div>
        </header>

        <!-- 飼主備註整條攤開、不截斷：飼主就站在櫃台前，「處置前先說明費用」要在開口前看完。 -->
        <p v-for="note in patientNotes" :key="note.key" class="shrink-0 whitespace-pre-wrap wrap-anywhere border-b border-border bg-warning-surface px-6 py-2.5 text-sm font-medium text-warning">
          <span class="mr-2 font-bold">{{ note.label }}備註</span>{{ note.text }}
        </p>
        <div v-if="error" class="shrink-0 border-b border-border px-6 py-3">
          <Alert variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
        </div>

        <!-- 左欄跟飼主說、右欄約回診，各自捲動；窄螢幕上下疊，整塊一起捲。 -->
        <div class="grid min-h-0 flex-1 overflow-y-auto overscroll-contain lg:grid-cols-[minmax(0,43fr)_minmax(0,57fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
          <div class="space-y-5 border-b border-border px-6 py-5 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:border-b-0">
            <section class="space-y-2" aria-labelledby="desk-care-heading">
              <div class="flex items-center gap-2.5">
                <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-warning text-xs font-bold text-card" aria-hidden="true">1</span>
                <h3 id="desk-care-heading" class="text-base font-semibold text-warning">請轉告飼主</h3>
              </div>
              <!-- 有內容才用警示底：空的橘框看起來像有事要講，「有橘色＝要講」就不準了（標頭下的飼主備註也是橘色）。
                   沒有內容照樣保留同一格、灰底留白，不補說明文字。 -->
              <p class="min-h-[calc(1lh+2rem)] whitespace-pre-wrap rounded-xl p-4 leading-relaxed font-medium" :class="appointment.specialCareNote?.trim() ? 'bg-warning-surface text-warning' : 'bg-sunken'">{{ appointment.specialCareNote }}</p>
            </section>

            <section class="space-y-2" aria-labelledby="desk-note-heading">
              <div class="flex items-center gap-2.5">
                <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-card" aria-hidden="true">2</span>
                <h3 id="desk-note-heading" class="text-base font-semibold">本次簡易紀錄</h3>
                <Button v-if="!editingNote && !state.completed" variant="secondary" size="sm" class="ml-auto" :disabled="busy" @click="startEditNote"><Pencil stroke-width="1.75" />編輯</Button>
              </div>
              <!-- 體重、體溫是這次看診的資料，跟紀錄放同一段、排在紀錄上面（講紀錄時常順便說「今天幾公斤」）。
                   這裡只看不改：量測是診療台的欄位。沒量就留白，格子照畫。 -->
              <!-- 左緣對齊下面紀錄框裡的文字（框是 p-4）。內距不能加在 SpecGrid 本身：它靠 overflow 裁掉第一格的分隔線。 -->
              <div class="px-4">
                <SpecGrid>
                  <SpecCell label="體重" mono><template v-if="appointment.weightKg != null">{{ appointment.weightKg }} kg</template></SpecCell>
                  <SpecCell label="體溫" mono><template v-if="appointment.temperatureC != null">{{ appointment.temperatureC }} °C</template></SpecCell>
                </SpecGrid>
              </div>
              <RichTextEditor v-if="editingNote" id="desk-visit-note" v-model="visitNote" aria-label="本次簡易紀錄" :min-rows="8" :disabled="busy || state.completed" placeholder="輸入本次看診紀錄…" />
              <RichText v-else class="min-h-[calc(1lh+2rem)] wrap-anywhere rounded-xl bg-sunken p-4 leading-relaxed" :text="appointment.visitNote || ''" />
              <Alert v-if="editingNote && noteConflict" variant="destructive">
                <AlertDescription>其他人已修改此紀錄，請先核對最新內容：</AlertDescription>
                <RichText v-if="appointment.visitNote" class="my-2 wrap-anywhere" :text="appointment.visitNote" />
                <p v-else class="my-2">（空白）</p>
                <Button variant="secondary" size="sm" :disabled="busy" @click="resetNote">採用最新內容</Button>
              </Alert>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="text-sm text-muted-foreground" role="status">{{ state.completed ? '已結案，退回處理中才能編輯' : editingNote ? '按「儲存」才會保存；取消或關閉會放棄修改' : noteSaved ? '已儲存' : '跟診療台、病歷日誌是同一份紀錄' }}</p>
                <div v-if="editingNote" class="flex gap-2">
                  <Button variant="secondary" size="sm" :disabled="busy" @click="cancelEditNote">取消</Button>
                  <Button size="sm" :disabled="busy || noteConflict || state.completed" @click="saveNote">儲存</Button>
                </div>
              </div>
            </section>

            <!-- 歷次病歷日誌直接展開在下面（使用者要求，不收進頁籤）：飼主常會問「上次開的藥還能吃嗎」。 -->
            <ClinicalNotesPanel
              :notes="notes"
              :loading="notesLoading"
              :error="notesError"
              :page="notePage"
              :total-pages="noteTotalPages"
              :pet-id="appointment.petId"
              full-record-label="完整病歷"
              @load="loadNotes"
              @saved="handleHistoricalNoteSaved"
            />
          </div>

          <section class="space-y-4 px-6 py-5 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain" aria-labelledby="desk-followup-heading">
            <div class="flex items-center gap-2.5">
              <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground" aria-hidden="true">3</span>
              <h3 id="desk-followup-heading" class="text-base font-semibold">約回診</h3>
            </div>
            <!-- 標籤跟內容同一行，標籤不另佔一行。醫師沒寫也照樣留這一格、內容空白，不補說明文字。 -->
            <p class="flex min-h-lh items-baseline gap-3 rounded-xl bg-accent px-4 py-3 text-accent-foreground">
              <span class="spec-label shrink-0 text-accent-foreground">醫師建議</span>
              <span class="min-w-0 font-medium wrap-anywhere">{{ appointment.followUpRecommendation || appointment.followUpReason }}</span>
            </p>

            <div v-if="booked" class="flex items-center gap-3 rounded-xl bg-success-surface px-4 py-3 text-success">
              <Check class="size-5" stroke-width="2" />
              <span class="font-semibold">已安排回診</span>
              <span class="num text-lg font-semibold">{{ appointment.followUpDate }} {{ appointment.followUpTime }}</span>
              <Button v-if="!rescheduling" variant="secondary" size="sm" class="ml-auto" :disabled="busy" @click="startReschedule"><Pencil stroke-width="1.75" />修改</Button>
            </div>
            <template v-if="editingFollowUp">
              <!-- 日期、診療時間、來院原因、手術一窄欄在左，時段格在右：打開就看得到時段，不用往下捲。 -->
              <AppointmentSlotPicker
                v-model:date="followUp.date"
                v-model:time="followUp.time"
                v-model:duration="followUp.duration"
                :exclude-id="String(rescheduling ? appointment.followUpAppointmentId : appointment._id)"
                :pet-id="appointment.petId ? String(appointment.petId) : ''"
                :pet-name="appointment.petName"
                :show-errors="followUpAttempted && followUpStarted"
                :required="false"
                clearable
                split
                label="回診日期"
              >
                <template #aside>
                  <div class="space-y-1.5">
                    <Label for="desk-followup-reason">來院原因</Label>
                    <Input id="desk-followup-reason" v-model="followUp.reason" placeholder="例：拆線、複診" />
                  </div>
                  <SurgeryField v-model:is-surgery="followUp.isSurgery" v-model:surgery-name="followUp.surgeryName" :error="surgeryNameError" />
                  <DepositField
                    v-if="!booked"
                    v-model:status="depositStatus"
                    v-model:reason="depositReason"
                    :state="depositState"
                    :pet-name="appointment.petName"
                    :error="depositError"
                    id-prefix="desk-deposit"
                  />
                </template>
              </AppointmentSlotPicker>
              <div v-if="rescheduling" class="flex items-center justify-end gap-2">
                <Button variant="secondary" size="sm" :disabled="busy" @click="cancelReschedule">取消</Button>
                <Button variant="soft" size="sm" :disabled="busy || !followUpStarted" @click="bookFollowUp">儲存回診變更</Button>
              </div>
              <div v-else-if="state.completed" class="flex justify-end">
                <Button variant="soft" size="sm" :disabled="busy || !followUpStarted" @click="bookFollowUp">確認回診預約</Button>
              </div>
            </template>
          </section>
        </div>

        <div v-if="state.completed && appointment.reopenRequest?.requestedAt && !appointment.reopenRequest?.approvedAt" class="mx-6 my-3 rounded-lg bg-warning-surface px-4 py-2.5 text-warning">
          <span class="font-semibold">醫師申請修改</span><template v-if="appointment.reopenRequest.reason">：{{ appointment.reopenRequest.reason }}</template>
        </div>

        <footer class="flex shrink-0 flex-wrap items-center gap-3 border-t border-border bg-sunken px-6 py-3.5">
          <p v-if="followUpSummary" class="flex flex-wrap items-center gap-x-1.5 text-muted-foreground" role="status">
            <CalendarCheck v-if="followUpSummary.when" class="mr-0.5 size-5 shrink-0 text-primary" stroke-width="1.75" />
            <span>{{ followUpSummary.lead }}</span>
            <strong v-if="followUpSummary.when" class="num font-semibold text-foreground">{{ followUpSummary.when }}</strong>
            <span v-if="followUpSummary.tail">{{ followUpSummary.tail }}</span>
          </p>
          <div class="ml-auto flex gap-2">
            <Button variant="secondary" :disabled="busy" @click="close">{{ state.completed ? '關閉' : '稍後處理' }}</Button>
            <Button v-if="state.completed && appointment.reopenRequest?.requestedAt && !appointment.reopenRequest?.approvedAt" :disabled="busy" @click="approveReopen">核准修改</Button>
            <Button v-else-if="state.completed" variant="soft" :disabled="busy" @click="reopen"><Undo2 stroke-width="1.75" />退回處理中</Button>
            <Button v-else :disabled="busy || editingNote || !state.handedOff" @click="complete"><Check stroke-width="2" />完成處理</Button>
          </div>
        </footer>
      </div>
    </DialogContent>
  </Dialog>
</template>

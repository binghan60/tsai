<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import PatientLink from './PatientLink.vue';
import { Check, Pencil, X } from '@lucide/vue';
import { http } from '../api/http';
import { useAppointmentNotifier } from '../composables/useAppointmentNotifier';
import { describeVisitChanges } from '../lib/appointmentNotifications';
import { workflowState } from '../../../shared/appointmentWorkflow.js';
import { DEFAULT_ESTIMATED_DURATION_MINUTES, appointmentSlotErrors } from '../lib/appointmentTime';
import { clinicDateInput, clinicTimeInput } from '../lib/datetime';
import AppointmentSlotPicker from './AppointmentSlotPicker.vue';
import SurgeryField from './SurgeryField.vue';
import { Input } from './ui/input';
import AppointmentMilestones from './AppointmentMilestones.vue';
import ClinicalNotesPanel from './ClinicalNotesPanel.vue';
import SpecGrid from './SpecGrid.vue';
import SpecCell from './SpecCell.vue';
import CheckinNumber from './CheckinNumber.vue';
import PatientNotes from './PatientNotes.vue';
import LatenessBadge from './LatenessBadge.vue';
import SurgeryBadge from './SurgeryBadge.vue';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Alert, AlertDescription } from './ui/alert';
import RichText from './RichText.vue';
import RichTextEditor from './RichTextEditor.vue';
import { richTextToPlain } from '../../../shared/richText.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

// 櫃台處理視窗。左欄的順序是「請轉告飼主 → 本次簡易紀錄 → 回診安排」，那就是櫃台當面對飼主講話的順序；
// 轉告事項最容易漏掉，所以放最上面並用警示底色。右欄是歷次病歷日誌——飼主常會問「上次開的藥還能吃嗎」。
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
const notes = ref([]);
const notePage = ref(1);
const noteTotalPages = ref(1);
const notesLoading = ref(false);
const notesError = ref('');
let notesRequest = 0;

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
const surgeryNameError = computed(() => (followUpAttempted.value && followUp.value.isSurgery && !followUp.value.surgeryName.trim() ? '請填寫手術名稱' : ''));

watch(() => props.appointment._id, () => {
  followUp.value = followUpDefaults();
  followUpAttempted.value = false;
  rescheduling.value = false;
  resetNote();
  editingNote.value = false;
  error.value = '';
  notePage.value = 1;
  loadNotes(1);
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
  if (state.value.completed) throw new Error('這筆就診已結案，請先完成修改申請與核准。');
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

async function loadNotes(page = 1) {
  const token = ++notesRequest;
  const petId = props.appointment.petId;
  notes.value = [];
  noteTotalPages.value = 1;
  if (!petId) return;
  notesLoading.value = true;
  notesError.value = '';
  try {
    const { data } = await http.get(`/pets/${petId}/clinical-notes`, {
      params: { page, limit: 5, excludeAppointmentId: props.appointment._id },
    });
    if (token !== notesRequest || petId !== props.appointment.petId) return;
    const totalPages = data.totalPages || 1;
    if (page > totalPages) return await loadNotes(totalPages);
    notes.value = data.items || [];
    notePage.value = page;
    noteTotalPages.value = totalPages;
  } catch {
    if (token === notesRequest) notesError.value = '病歷日誌未能載入，請重試。';
  } finally {
    if (token === notesRequest) notesLoading.value = false;
  }
}
loadNotes();

function handleHistoricalNoteSaved({ note, content }) {
  notifyChat(props.appointment, 'visit_data', {
    changedParts: ['歷次病歷日誌'],
    snapshot: { fieldLabel: '歷次病歷日誌', before: note.content || '', after: content || '' },
  });
  loadNotes(notePage.value);
}

// 送出前跟掛號視窗同一套檢查（lib/appointmentTime.js）；「已經過去的時段」看按下那一刻。
// 回傳第一個錯誤訊息，沒有錯誤回空字串。
function followUpError() {
  followUpAttempted.value = true;
  const { date, time, duration, isSurgery, surgeryName } = followUp.value;
  const errors = appointmentSlotErrors({ date, time, durationMinutes: duration, today: clinicDateInput(), nowTime: clinicTimeInput(new Date()) });
  if (errors.date) return '請選擇回診日期';
  if (errors.time) return errors.time === '請選擇預約時段' ? '請選擇回診時段' : errors.time;
  if (isSurgery && !surgeryName.trim()) return '請填寫手術名稱';
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
  catch (err) { error.value = err.response?.data?.message || '回診預約失敗，請稍後重試'; }
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
    error.value = err.response?.data?.message || '回診掛號載入失敗，請稍後重試';
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
    error.value = err.response?.data?.message || '操作失敗，請稍後重試';
  } finally { busy.value = false; }
}
</script>

<template>
  <Dialog :open="true" @update:open="value => !value && close()">
    <DialogContent
      size="xl"
      :show-close-button="false"
      class="h-[min(90vh,56rem)] gap-0 p-0"
      @escape-key-down="event => busy && event.preventDefault()"
      @pointer-down-outside="event => busy && event.preventDefault()"
    >
      <div class="flex h-full min-h-0 flex-col">
        <header class="shrink-0 space-y-3 border-b border-border px-6 pt-5 pb-4">
          <!-- 第一排：左邊是這隻貓，右邊是飼主。第二排：飼主備註與就診進度。 -->
          <div class="flex flex-wrap items-start gap-x-6 gap-y-3">
            <div class="flex min-w-0 flex-1 items-center gap-4">
              <CheckinNumber :appointment="appointment" size="lg" />
              <div class="min-w-0 space-y-1.5">
                <div class="flex flex-wrap items-center gap-2">
                  <DialogTitle class="text-xl leading-tight"><PatientLink :pet-id="appointment.petId">{{ appointment.petName }}</PatientLink></DialogTitle>
                  <Badge v-if="appointment.visitType === 'new'" variant="status" class="bg-info-surface text-info">初診</Badge>
                  <SurgeryBadge v-if="appointment.isSurgery" :name="appointment.surgeryName" />
                  <LatenessBadge :minutes="appointment.latenessMinutes" />
                </div>
                <DialogDescription>{{ appointment.reason }}</DialogDescription>
              </div>
            </div>
            <div class="flex items-start gap-2">
              <SpecGrid>
                <SpecCell label="飼主"><PatientLink v-if="appointment.ownerName" :pet-id="appointment.petId" quiet>{{ appointment.ownerName }}</PatientLink></SpecCell>
                <SpecCell v-if="appointment.ownerPhone" label="電話" mono><a :href="`tel:${appointment.ownerPhone}`" class="text-primary">{{ appointment.ownerPhone }}</a></SpecCell>
                <SpecCell label="預約" mono>{{ appointment.date?.slice(5) }} {{ appointment.time || '' }}</SpecCell>
              </SpecGrid>
              <Button variant="secondary" size="icon-sm" aria-label="關閉處理視窗" :disabled="busy" @click="close"><X stroke-width="1.75" /></Button>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
            <PatientNotes :notes="patientNotes" class="min-w-0 flex-1" />
            <AppointmentMilestones :appointment="appointment" />
          </div>
        </header>

        <div class="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div class="min-h-0 space-y-6 overflow-y-auto overscroll-contain px-6 py-5">
            <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

            <section class="space-y-2">
              <h3 class="text-base font-semibold text-warning">請轉告飼主</h3>
              <!-- 沒有內容也保留同一格、留白，不補說明文字。 -->
              <p class="min-h-[calc(1lh+2rem)] whitespace-pre-wrap rounded-xl bg-warning-surface p-4 leading-relaxed font-medium text-warning">{{ appointment.specialCareNote }}</p>
            </section>

            <section class="space-y-2">
              <div class="flex items-center justify-between gap-2">
                <h3 class="text-base font-semibold">本次簡易紀錄</h3>
                <Button v-if="!editingNote && !state.completed" variant="secondary" size="sm" :disabled="busy" @click="startEditNote"><Pencil stroke-width="1.75" />編輯</Button>
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
                <p class="text-sm text-muted-foreground" role="status">{{ state.completed ? '已結案，核准修改後才能編輯' : editingNote ? '按「儲存」才會保存；取消或關閉會放棄修改' : noteSaved ? '已儲存' : '跟診療台、病歷日誌是同一份紀錄' }}</p>
                <div v-if="editingNote" class="flex gap-2">
                  <Button variant="secondary" size="sm" :disabled="busy" @click="cancelEditNote">取消</Button>
                  <Button size="sm" :disabled="busy || noteConflict || state.completed" @click="saveNote">儲存</Button>
                </div>
              </div>
            </section>

            <section class="space-y-3">
              <div>
                <h3 class="text-base font-semibold">回診安排</h3>
                <p class="text-sm text-muted-foreground">跟掛號視窗一樣選時段與預估診療時間，確認後會建立下一筆回診掛號；已經約好的按「修改」改期，會一起改那一筆。</p>
              </div>
              <!-- 醫師沒寫也照樣留這一格、內容空白，不補說明文字。 -->
              <div class="rounded-xl bg-accent px-4 py-3">
                <p class="spec-label text-accent-foreground">醫師建議</p>
                <p class="mt-0.5 min-h-lh text-accent-foreground">{{ appointment.followUpRecommendation || appointment.followUpReason }}</p>
              </div>

              <div v-if="booked" class="flex items-center gap-3 rounded-xl bg-success-surface px-4 py-3 text-success">
                <Check class="size-5" stroke-width="2" />
                <span class="font-semibold">已安排回診</span>
                <span class="num text-lg font-semibold">{{ appointment.followUpDate }} {{ appointment.followUpTime }}</span>
                <Button v-if="!rescheduling" variant="secondary" size="sm" class="ml-auto" :disabled="busy" @click="startReschedule"><Pencil stroke-width="1.75" />修改</Button>
              </div>
              <template v-if="editingFollowUp">
                <div class="space-y-1.5">
                  <Label for="desk-followup-reason">來院原因</Label>
                  <Input id="desk-followup-reason" v-model="followUp.reason" placeholder="例：拆線、複診" />
                </div>
                <SurgeryField v-model:is-surgery="followUp.isSurgery" v-model:surgery-name="followUp.surgeryName" :error="surgeryNameError" />
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
                  label="回診日期與時段"
                />
                <div v-if="rescheduling" class="flex items-center justify-end gap-2">
                  <Button variant="secondary" size="sm" :disabled="busy" @click="cancelReschedule">取消</Button>
                  <Button variant="soft" size="sm" :disabled="busy || !followUpStarted" @click="bookFollowUp">儲存回診變更</Button>
                </div>
                <div v-else class="flex items-center gap-3">
                  <p class="text-sm text-muted-foreground">飼主還沒決定就先留空，這筆會留在「待安排回診」。</p>
                  <Button v-if="state.completed" variant="soft" size="sm" class="ml-auto" :disabled="busy || !followUpStarted" @click="bookFollowUp">確認回診預約</Button>
                </div>
              </template>
            </section>
          </div>

          <aside class="flex min-h-0 flex-col border-t border-border px-5 py-5 lg:border-t-0 lg:border-l">
            <ClinicalNotesPanel
              :notes="notes"
              :loading="notesLoading"
              :error="notesError"
              :page="notePage"
              :total-pages="noteTotalPages"
              :pet-id="appointment.petId"
              full-record-label="完整病歷"
              fill
              class="min-h-80 flex-1"
              @load="loadNotes"
              @saved="handleHistoricalNoteSaved"
            />
          </aside>
        </div>

        <div v-if="state.completed && appointment.reopenRequest?.requestedAt && !appointment.reopenRequest?.approvedAt" class="mx-6 mb-3 rounded-lg bg-warning-surface px-4 py-2.5 text-warning">
          <span class="font-semibold">醫師申請修改</span><template v-if="appointment.reopenRequest.reason">：{{ appointment.reopenRequest.reason }}</template>
        </div>

        <footer class="flex shrink-0 items-center gap-3 border-t border-border bg-sunken px-6 py-3.5">
          <p class="text-sm text-muted-foreground">系統不計價，收費與領藥由櫃台直接處理</p>
          <div class="ml-auto flex gap-2">
            <Button variant="secondary" :disabled="busy" @click="close">{{ state.completed ? '關閉' : '稍後處理' }}</Button>
            <Button v-if="state.completed && appointment.reopenRequest?.requestedAt && !appointment.reopenRequest?.approvedAt" :disabled="busy" @click="approveReopen">核准修改</Button>
            <Button v-else-if="!state.completed" size="lg" :disabled="busy || editingNote || !state.handedOff" @click="complete"><Check stroke-width="2" />完成處理</Button>
          </div>
        </footer>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { CalendarClock, Check, Pencil, X } from '@lucide/vue';
import { http } from '../api/http';
import { useAppointmentNotifier } from '../composables/useAppointmentNotifier';
import { describeVisitChanges } from '../lib/appointmentNotifications';
import { workflowState } from '../../../shared/appointmentWorkflow.js';
import { APPOINTMENT_TIME_RANGES, APPOINTMENT_TIME_MINUTE_STEP } from '../lib/appointmentTime';
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
import { DatePicker } from './ui/date-picker';
import { TimePicker } from './ui/time-picker';
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
const date = ref(props.appointment.followUpDate || '');
const time = ref(props.appointment.followUpTime || '');
const notes = ref([]);
const notePage = ref(1);
const noteTotalPages = ref(1);
const notesLoading = ref(false);
const notesError = ref('');
let notesRequest = 0;

const state = computed(() => workflowState(props.appointment));
const booked = computed(() => Boolean(props.appointment.followUpAppointmentId));
const needsFollowUp = computed(() => Boolean(props.appointment.followUpRecommendation || props.appointment.followUpReason));
const canBook = computed(() => Boolean(date.value && time.value) && !booked.value);

watch(() => props.appointment._id, () => {
  date.value = props.appointment.followUpDate || '';
  time.value = props.appointment.followUpTime || '';
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

async function bookFollowUp() {
  if (busy.value || !canBook.value) return;
  busy.value = true;
  error.value = '';
  try { await run('followup', { followUpDate: date.value, followUpTime: time.value }); }
  catch (err) { error.value = err.response?.data?.message || '回診預約失敗，請稍後重試'; }
  finally { busy.value = false; }
}

// 一顆按鈕收尾：還沒掛號的回診先掛上，再結束這次就診。分成兩顆只會讓櫃台漏按其中一顆。
async function complete() {
  if (busy.value || editingNote.value) return;
  busy.value = true;
  error.value = '';
  try {
    if (canBook.value) await run('followup', { followUpDate: date.value, followUpTime: time.value }, { silentToast: true });
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
                  <DialogTitle class="text-xl leading-tight">{{ appointment.petName }}</DialogTitle>
                  <Badge v-if="appointment.visitType === 'new'" variant="status" class="bg-info-surface text-info">初診</Badge>
                  <SurgeryBadge v-if="appointment.isSurgery" :name="appointment.surgeryName" />
                  <LatenessBadge :minutes="appointment.latenessMinutes" />
                </div>
                <DialogDescription>{{ appointment.reason || '未填來院原因' }}</DialogDescription>
              </div>
            </div>
            <div class="flex items-start gap-2">
              <SpecGrid>
                <SpecCell label="飼主">{{ appointment.ownerName || '待確認' }}</SpecCell>
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
              <p v-if="appointment.specialCareNote" class="whitespace-pre-wrap rounded-xl bg-warning-surface p-4 leading-relaxed font-medium text-warning">{{ appointment.specialCareNote }}</p>
              <p v-else class="rounded-xl bg-sunken p-4 text-subtle-foreground">醫師沒有要轉告的事。</p>
            </section>

            <section class="space-y-2">
              <div class="flex items-center justify-between gap-2">
                <h3 class="text-base font-semibold">本次簡易紀錄</h3>
                <Button v-if="!editingNote && !state.completed" variant="secondary" size="sm" :disabled="busy" @click="startEditNote"><Pencil stroke-width="1.75" />編輯</Button>
              </div>
              <RichTextEditor v-if="editingNote" id="desk-visit-note" v-model="visitNote" aria-label="本次簡易紀錄" :min-rows="8" :disabled="busy || state.completed" placeholder="輸入本次看診紀錄…" />
              <RichText v-else-if="appointment.visitNote" class="wrap-anywhere rounded-xl bg-sunken p-4 leading-relaxed" :text="appointment.visitNote" />
              <p v-else class="rounded-xl bg-sunken p-4 text-subtle-foreground">尚無本次簡易紀錄。</p>
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
                <p class="text-sm text-muted-foreground">確認後會建立下一筆回診掛號；已經有回診掛號時，改日期時間會一起改那一筆。</p>
              </div>
              <div v-if="needsFollowUp" class="rounded-xl bg-accent px-4 py-3">
                <p class="spec-label text-accent-foreground">醫師建議</p>
                <p class="mt-0.5 text-accent-foreground">{{ appointment.followUpRecommendation || appointment.followUpReason }}</p>
              </div>
              <p v-else class="flex items-center gap-2 text-muted-foreground"><CalendarClock class="size-5" stroke-width="1.75" />醫師沒有指定回診，仍可視需要直接約下一次。</p>

              <div v-if="booked" class="flex items-center gap-3 rounded-xl bg-success-surface px-4 py-3 text-success">
                <Check class="size-5" stroke-width="2" />
                <span class="font-semibold">已安排回診</span>
                <span class="num text-lg font-semibold">{{ appointment.followUpDate }} {{ appointment.followUpTime }}</span>
              </div>
              <template v-else>
                <div class="grid gap-3 sm:grid-cols-2">
                  <div class="space-y-1.5"><Label for="desk-followup-date">回診日期</Label><DatePicker id="desk-followup-date" v-model="date" aria-label="回診日期" /></div>
                  <div class="space-y-1.5"><Label for="desk-followup-time">回診時間</Label><TimePicker id="desk-followup-time" v-model="time" :ranges="APPOINTMENT_TIME_RANGES" :minute-step="APPOINTMENT_TIME_MINUTE_STEP" aria-label="回診時間" /></div>
                </div>
                <div class="flex items-center gap-3">
                  <p class="text-sm text-muted-foreground">飼主還沒決定就先留空，這筆會留在「待安排回診」。</p>
                  <Button v-if="state.completed" variant="soft" size="sm" class="ml-auto" :disabled="busy || !canBook" @click="bookFollowUp">確認回診預約</Button>
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

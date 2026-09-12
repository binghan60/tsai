<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { CalendarClock, Check, Phone, X } from '@lucide/vue';
import { http } from '../api/http';
import { useAppointmentNotifier } from '../composables/useAppointmentNotifier';
import { describeVisitChanges } from '../lib/appointmentNotifications';
import { workflowState } from '../../../shared/appointmentWorkflow.js';
import { APPOINTMENT_TIME_RANGES, APPOINTMENT_TIME_MINUTE_STEP } from '../lib/appointmentTime';
import AppointmentMilestones from './AppointmentMilestones.vue';
import ClinicalNotesPanel from './ClinicalNotesPanel.vue';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { DatePicker } from './ui/date-picker';
import { TimePicker } from './ui/time-picker';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

// 櫃台處理醫師交辦的面板。段落順序是「請轉告飼主 → 醫師交辦 → 病歷內容 → 回診」，
// 那就是櫃台當面對客人講話的順序；轉告事項最容易漏掉，所以放最上面並用警示底色。
const props = defineProps({ appointment: { type: Object, required: true } });
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
const latenessLabel = computed(() => props.appointment.latenessMinutes > 0 ? `遲到 ${props.appointment.latenessMinutes} 分` : '');

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
    snapshot: { fieldLabel: '本次簡易紀錄', before: before.visitNote, after: data.visitNote || '' },
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
      size="lg"
      :show-close-button="false"
      class="h-[min(90vh,52rem)] gap-0 bg-card p-0 sm:max-w-[min(56rem,calc(100vw-2rem))]"
      @escape-key-down="event => busy && event.preventDefault()"
      @pointer-down-outside="event => busy && event.preventDefault()"
    >
      <div class="flex h-full min-h-0 flex-col">
        <header class="shrink-0 border-b border-border px-5 pb-4 pt-5 sm:px-6">
          <div class="mb-3 flex items-center justify-between gap-3">
            <DialogDescription class="text-xs">就診詳情 · {{ appointment.date }} {{ appointment.time || '未指定時間' }}</DialogDescription>
            <Button variant="secondary" size="icon-sm" aria-label="關閉就診詳情" :disabled="busy" @click="close"><X class="h-4 w-4" /></Button>
          </div>
          <div class="flex items-center gap-3">
            <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-semibold tabular-nums text-accent-foreground">
              {{ appointment.checkinNumber ?? '—' }}
            </span>
            <div class="min-w-0 flex-1">
              <DialogTitle class="text-xl font-semibold">
                {{ appointment.petName }}<span class="ml-2 text-sm font-normal text-muted-foreground">{{ appointment.species }}</span>
              </DialogTitle>
              <p class="text-xs text-muted-foreground">
                {{ appointment.ownerName || '飼主待確認' }}
                <span v-if="latenessLabel" class="ml-2 font-semibold text-danger">{{ latenessLabel }}</span>
              </p>
            </div>
            <a
              v-if="appointment.ownerPhone"
              :href="`tel:${appointment.ownerPhone}`"
              class="inline-flex h-10 items-center gap-2 rounded-lg bg-field px-3 text-sm tabular-nums text-primary"
            ><Phone class="h-4 w-4" />{{ appointment.ownerPhone }}</a>
          </div>
          <div class="mt-3"><AppointmentMilestones :appointment="appointment" /></div>
        </header>

        <div class="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

          <section v-if="appointment.specialCareNote" class="space-y-2">
            <h3 class="text-base font-semibold text-warning">請轉告飼主</h3>
            <p class="whitespace-pre-wrap rounded-xl bg-warning-surface p-4 text-sm leading-relaxed text-warning">{{ appointment.specialCareNote }}</p>
          </section>

          <section class="space-y-2">
            <h3 class="text-base font-semibold">醫師交辦（收費與領藥）</h3>
            <p v-if="appointment.handoffNote" class="whitespace-pre-wrap rounded-xl bg-field p-4 text-sm leading-relaxed">{{ appointment.handoffNote }}</p>
            <p v-else class="rounded-xl bg-field p-4 text-sm text-muted-foreground">醫師沒有留下交辦事項。</p>
          </section>

          <section class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-base font-semibold">本次簡易紀錄</h3>
              <Button v-if="!editingNote && !state.completed" variant="secondary" size="sm" :disabled="busy" @click="startEditNote">編輯</Button>
            </div>
            <Textarea v-if="editingNote" id="desk-visit-note" v-model="visitNote" aria-label="本次簡易紀錄" rows="8" :disabled="busy || state.completed" placeholder="輸入本次看診紀錄…" />
            <p v-else class="whitespace-pre-wrap wrap-anywhere rounded-xl bg-field p-4 text-sm leading-relaxed">{{ appointment.visitNote || '尚無本次簡易紀錄。' }}</p>
            <Alert v-if="editingNote && noteConflict" variant="destructive">
              <AlertDescription>其他人已修改此紀錄，請先核對最新內容：</AlertDescription>
              <p class="my-2 whitespace-pre-wrap wrap-anywhere text-sm">{{ appointment.visitNote || '（空白）' }}</p>
              <Button variant="secondary" size="sm" :disabled="busy" @click="resetNote">採用最新內容</Button>
            </Alert>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="text-xs text-muted-foreground" role="status">{{ state.completed ? '已結案，核准修改後才能編輯' : editingNote ? '按「儲存」才會保存；取消或關閉會放棄修改' : noteSaved ? '已儲存' : '與醫師診療台及病歷日誌共用同一份紀錄' }}</p>
              <div v-if="editingNote" class="flex gap-2">
                <Button variant="secondary" size="sm" :disabled="busy" @click="cancelEditNote">取消</Button>
                <Button size="sm" :disabled="busy || noteConflict || state.completed" @click="saveNote">儲存</Button>
              </div>
            </div>
          </section>

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
          <section class="space-y-3">
            <h3 class="text-base font-semibold">回診安排</h3>
            <div v-if="needsFollowUp" class="rounded-xl bg-accent p-4">
              <p class="text-xs text-accent-foreground">醫師建議</p>
              <p class="text-sm text-accent-foreground">{{ appointment.followUpRecommendation || appointment.followUpReason }}</p>
            </div>
            <p v-else class="flex items-center gap-2 text-sm text-muted-foreground"><CalendarClock class="h-4 w-4" />醫師沒有指定回診。仍可視需要直接約下一次。</p>

            <div v-if="booked" class="space-y-2">
              <p class="flex items-center gap-2 text-sm text-success"><Check class="h-4 w-4" />已安排回診</p>
              <p class="text-lg font-semibold tabular-nums">{{ appointment.followUpDate }} {{ appointment.followUpTime }}</p>
            </div>
            <template v-else>
              <div class="grid gap-3 sm:grid-cols-2">
                <label class="block space-y-1.5 text-xs font-medium">回診日期<DatePicker v-model="date" aria-label="回診日期" /></label>
                <label class="block space-y-1.5 text-xs font-medium">回診時間
                  <TimePicker v-model="time" :ranges="APPOINTMENT_TIME_RANGES" :minute-step="APPOINTMENT_TIME_MINUTE_STEP" aria-label="回診時間" />
                </label>
              </div>
              <div class="flex items-center gap-3">
                <p class="text-xs text-muted-foreground">飼主還沒決定就先留空，這筆會留在「待安排回診」。</p>
                <Button v-if="state.completed" variant="secondary" size="sm" class="ml-auto" :disabled="busy || !canBook" @click="bookFollowUp">確認回診預約</Button>
              </div>
            </template>
          </section>
        </div>

        <div v-if="state.completed && appointment.reopenRequest?.requestedAt && !appointment.reopenRequest?.approvedAt" class="mx-5 mb-3 rounded-lg border border-warning/30 bg-warning-surface px-3 py-2 text-sm text-warning sm:mx-6">
          <span class="font-semibold">醫師請求修改</span><template v-if="appointment.reopenRequest.reason">：{{ appointment.reopenRequest.reason }}</template>
        </div>

        <footer class="flex shrink-0 items-center gap-3 border-t border-border bg-field/40 px-5 py-4 sm:px-6">
          <p class="text-xs text-muted-foreground">收費以交辦文字為準，系統不記金額</p>
          <div class="ml-auto flex gap-3">
            <Button variant="secondary" :disabled="busy" @click="close">{{ state.completed ? '關閉' : '稍後處理' }}</Button>
            <Button v-if="state.completed && appointment.reopenRequest?.requestedAt && !appointment.reopenRequest?.approvedAt" :disabled="busy" @click="approveReopen">核准修改</Button>
            <Button v-else-if="!state.completed" :disabled="busy || editingNote || !state.handedOff" @click="complete"><Check class="h-4 w-4" />完成處理</Button>
          </div>
        </footer>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { CalendarClock, Check, ChevronDown, Phone, X } from '@lucide/vue';
import { http } from '../api/http';
import { workflowState } from '../../../shared/appointmentWorkflow.js';
import { APPOINTMENT_TIME_RANGES, APPOINTMENT_TIME_MINUTE_STEP } from '../lib/appointmentTime';
import AppointmentMilestones from './AppointmentMilestones.vue';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { DatePicker } from './ui/date-picker';
import { TimePicker } from './ui/time-picker';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

// 櫃台處理醫師交辦的面板。段落順序刻意是「請轉告飼主 → 醫師交辦 → 病歷內容收起 → 回診」，
// 那就是櫃台當面對客人講話的順序；轉告事項最容易漏掉，所以放最上面並用警示底色。
const props = defineProps({ appointment: { type: Object, required: true } });
const emit = defineEmits(['updated', 'close']);

const busy = ref(false);
const error = ref('');
const showVisitNote = ref(false);
const date = ref(props.appointment.followUpDate || '');
const time = ref(props.appointment.followUpTime || '');

const state = computed(() => workflowState(props.appointment));
const booked = computed(() => Boolean(props.appointment.followUpAppointmentId));
const needsFollowUp = computed(() => Boolean(props.appointment.followUpRecommendation || props.appointment.followUpReason));
const canBook = computed(() => Boolean(date.value && time.value) && !booked.value);

watch(() => props.appointment._id, () => {
  date.value = props.appointment.followUpDate || '';
  time.value = props.appointment.followUpTime || '';
  showVisitNote.value = false;
  error.value = '';
});

function close() { if (!busy.value) emit('close'); }

async function run(action, values = {}) {
  const { data } = await http.post(`/appointments/${props.appointment._id}/workflow/${action}`, { version: props.appointment.__v ?? 0, ...values });
  emit('updated', data, action);
  return data;
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
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    if (canBook.value) await run('followup', { followUpDate: date.value, followUpTime: time.value });
    await run('complete');
    emit('close');
  } catch (err) {
    error.value = err.response?.data?.message || '操作失敗，請稍後重試';
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
      class="h-[min(90vh,52rem)] gap-0 bg-card p-0 sm:max-w-[36rem]"
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
              <p class="text-xs text-muted-foreground">{{ appointment.ownerName || '飼主待確認' }}</p>
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

          <section v-if="appointment.visitNote" class="rounded-xl border border-border">
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-xl bg-field/60 px-4 py-3 text-left"
              :aria-expanded="showVisitNote"
              @click="showVisitNote = !showVisitNote"
            >
              <span class="text-sm font-semibold">本次簡易紀錄</span>
              <span class="text-xs text-muted-foreground">病歷內容，需要時再展開</span>
              <ChevronDown class="ml-auto h-4 w-4 text-muted-foreground transition-transform" :class="{ '-rotate-90': !showVisitNote }" />
            </button>
            <p v-show="showVisitNote" class="whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed">{{ appointment.visitNote }}</p>
          </section>

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
            <Button v-else-if="!state.completed" :disabled="busy || !state.handedOff" @click="complete"><Check class="h-4 w-4" />完成處理</Button>
          </div>
        </footer>
      </div>
    </DialogContent>
  </Dialog>
</template>

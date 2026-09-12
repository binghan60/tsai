<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { ArrowRight, FileText, Undo2 } from '@lucide/vue';
import { http } from '../api/http';
import { useToast } from '../composables/useToast';
import { useAppointmentNotifier } from '../composables/useAppointmentNotifier';
import { workflowState } from '../../../shared/appointmentWorkflow.js';
import { clinicalDraft, draftPatch, mergeClinicalUpdate } from '../lib/visitDraft';
import { ageLabel } from '../lib/datetime';
import AppointmentMilestones from './AppointmentMilestones.vue';
import ClinicalNotesPanel from './ClinicalNotesPanel.vue';
import ModalDialog from './ModalDialog.vue';
import { Button } from './ui/button';
import { DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Alert, AlertDescription } from './ui/alert';

// 就診工作區：在診療台右欄編輯單筆 appointment 的臨床欄位。
// 這裡會同步病患資料、歷次病歷日誌與表單草稿入口。
const props = defineProps({
  appointment: { type: Object, required: true },
});
const toast = useToast();
const notifyChat = useAppointmentNotifier();
const emit = defineEmits(['updated', 'open-record']);

const draft = reactive(clinicalDraft(props.appointment));
const baseline = ref(clinicalDraft(props.appointment));
const conflicts = ref([]);
const busy = ref(false);
const committing = ref(false);
const error = ref('');
const reopenDialog = ref(false);
const reopenReason = ref('');
const reopenError = ref('');
const savedAt = ref(null);
const pet = ref(null);
const notes = ref([]);
const notePage = ref(1);
const noteTotalPages = ref(1);
const notesLoading = ref(false);
const notesError = ref('');
let notesRequest = 0;
const contextError = ref('');
let timer;
let disposed = false;
let savePromise = null;
let queued = null;

const state = computed(() => workflowState(props.appointment));
// 送交櫃台後即鎖定；櫃台完成前可取回修改，完成後需申請核准。
const editable = computed(() => state.value.started && !state.value.handedOff && !state.value.completed);
const dirty = computed(() => Object.keys(draftPatch(draft, baseline.value)).length > 0);
const owner = computed(() => (typeof pet.value?.ownerId === 'object' ? pet.value.ownerId : null));
const ownerFields = computed(() => {
  const data = owner.value;
  const phone = data?.phone || props.appointment.ownerPhone || '';
  return [
    { label: '姓名', value: data?.name || props.appointment.ownerName || '' },
    { label: '手機', value: phone, class: phone ? 'tabular-nums' : '' },
    { label: '市話', value: data?.landline || '', class: data?.landline ? 'tabular-nums' : '' },
    { label: 'Email', value: data?.email || '', class: data?.email ? 'break-all' : '' },
    { label: '地址', value: data?.address || '' },
    { label: '備註', value: data?.notes || '', class: data?.notes ? 'whitespace-pre-wrap' : '' },
  ].filter((field) => field.value);
});
const petSummary = computed(() => {
  if (!pet.value) return props.appointment.species || '';
  const sex = { male: '公', female: '母' }[pet.value.sex] || '';
  const neutered = { yes: '已結紮', no: '未結紮' }[pet.value.neutered] || '';
  return [pet.value.breed || props.appointment.species, sex && neutered ? `${sex} ${neutered}` : sex || neutered, ageLabel(pet.value.birthDate, new Date(), '')]
    .filter(Boolean).join(' · ');
});
const latenessLabel = computed(() => props.appointment.latenessMinutes > 0 ? `遲到 ${props.appointment.latenessMinutes} 分` : '');
const reminderFields = computed(() => {
  if (!pet.value) return [];
  const vaccine = { none: '未注射', done: `已注射${pet.value.vaccineDate ? `，最後注射時間 ${pet.value.vaccineDate}` : ''}` }[pet.value.vaccineStatus] || '';
  const history = [pet.value.medicalHistory?.join('、'), pet.value.medicalHistoryOther].filter(Boolean).join('；');
  const allergy = { none: '無過敏', yes: `有${pet.value.allergyType ? `，${pet.value.allergyType}` : ''}` }[pet.value.allergyStatus] || '';
  const checkup = { none: '未健檢', done: `有${pet.value.checkupDate ? `，上次健檢時間 ${pet.value.checkupDate}` : ''}` }[pet.value.checkupStatus] || '';
  return [
    { label: '疫苗', value: vaccine },
    { label: '病史', value: history },
    { label: '藥物過敏', value: allergy },
    { label: '健檢', value: checkup },
  ].filter((field) => field.value);
});
const hasReminders = computed(() => reminderFields.value.length > 0);
const CONFLICT_LABELS = {
  visitNote: '本次簡易紀錄', internalNote: '內部備註', handoffNote: '給櫃台的交辦', specialCareNote: '請轉告飼主',
  followUpRecommendation: '回診建議', followUpReason: '回診原因', weightKg: '體重', temperatureC: '體溫',
};
const savedLabel = computed(() => {
  if (busy.value) return '儲存中…';
  if (conflicts.value.length) return '有資料衝突，請先選擇保留內容';
  if (state.value.handedOff && !state.value.completed) return '已交櫃台，取回後才能編輯';
  if (state.value.completed) return '已結案，核准修改後才能編輯';
  if (dirty.value) return '尚未儲存';
  if (savedAt.value) return `${savedAt.value.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })} 已儲存`;
  return '已儲存';
});

// 父層 appointment 更新時，保留使用者未儲存的草稿並標記衝突欄位。
function receive(incoming) {
  if (disposed) return;
  if (busy.value) { queued = incoming; return; }
  const merged = mergeClinicalUpdate(draft, baseline.value, incoming);
  Object.assign(draft, merged.draft);
  baseline.value = merged.baseline;
  if (merged.conflicts.length) conflicts.value = [...new Set([...conflicts.value, ...merged.conflicts])];
}
watch(() => props.appointment, incoming => receive(incoming));

async function loadContext() {
  pet.value = null;
  if (!props.appointment.petId) return;
  const petId = props.appointment.petId;
  try {
    const [{ data: patient }] = await Promise.all([
      http.get(`/pets/${petId}`),
      loadNotes(notePage.value),
    ]);
    if (disposed || props.appointment.petId !== petId) return;
    pet.value = patient;
    contextError.value = '';
  } catch { contextError.value = '病史或病歷日誌未能載入，請重新載入確認。'; }
}
async function loadNotes(page = 1) {
  const token = ++notesRequest;
  const petId = props.appointment.petId;
  notes.value = [];
  if (!petId) return;
  notesLoading.value = true;
  notesError.value = '';
  try {
    const { data } = await http.get(`/pets/${petId}/clinical-notes`, {
      params: { page, limit: 5, excludeAppointmentId: props.appointment._id },
    });
    if (disposed || token !== notesRequest || petId !== props.appointment.petId) return;
    const totalPages = data.totalPages || 1;
    if (page > totalPages) return await loadNotes(totalPages);
    notes.value = data.items || [];
    notePage.value = page;
    noteTotalPages.value = totalPages;
  } catch {
    if (!disposed && token === notesRequest) notesError.value = '病歷日誌未能載入，請重試。';
  } finally {
    if (token === notesRequest) notesLoading.value = false;
  }
}
loadContext();

async function save() {
  clearTimeout(timer);
  if (savePromise) { await savePromise; return dirty.value ? save() : true; }
  if (!dirty.value) return true;
  if (!editable.value || conflicts.value.length || busy.value) return false;
  const snapshot = { ...draft };
  const patch = draftPatch(snapshot, baseline.value);
  busy.value = true;
  error.value = '';
  savePromise = (async () => {
    try {
      const { data } = await http.post(`/appointments/${props.appointment._id}/workflow/clinical`, { version: props.appointment.__v ?? 0, ...patch });
      // 後端回傳最新版 appointment，合併時保留本機仍未送出的輸入。
      const merged = mergeClinicalUpdate(draft, snapshot, data);
      Object.assign(draft, merged.draft);
      baseline.value = merged.baseline;
      savedAt.value = new Date();
      emit('updated', data);
      return true;
    } catch (err) {
      error.value = err.response?.data?.message || '儲存失敗，請重試。';
      return false;
    } finally {
      savePromise = null;
      busy.value = false;
      if (queued) { const update = queued; queued = null; receive(update); }
    }
  })();
  return savePromise;
}

watch(draft, () => {
  clearTimeout(timer);
  if (dirty.value && editable.value && !conflicts.value.length) timer = setTimeout(save, 1200);
}, { deep: true });

function resolveConflict(keepLocal) {
  if (!keepLocal) for (const key of conflicts.value) draft[key] = baseline.value[key];
  conflicts.value = [];
  error.value = '';
  if (keepLocal) save();
}

async function run(action, payload = {}) {
  if (busy.value || conflicts.value.length) return false;
  committing.value = true;
  try {
    if (!await save()) return false;
    if (dirty.value && !await save()) return false;
    busy.value = true;
    error.value = '';
    const { data } = await http.post(`/appointments/${props.appointment._id}/workflow/${action}`, {
      version: props.appointment.__v ?? 0,
      ...payload,
    });
    baseline.value = clinicalDraft(data);
    Object.assign(draft, clinicalDraft(data));
    emit('updated', data, action);
    if (action === 'record' && data.recordId) emit('open-record', data);
    return true;
  } catch (err) {
    error.value = err.response?.data?.message || '操作失敗，請重試。';
    return false;
  } finally {
    busy.value = false;
    committing.value = false;
    if (queued) { const update = queued; queued = null; receive(update); }
  }
}

function openReopenRequest() {
  reopenReason.value = '';
  reopenError.value = '';
  reopenDialog.value = true;
}

async function requestReopen() {
  const reason = reopenReason.value.trim();
  const submitted = await run('request-reopen', { reason });
  if (!submitted) {
    reopenError.value = error.value || '申請修改失敗，請重試。';
    return;
  }
  reopenDialog.value = false;
  toast.success('已送出修改申請，等待櫃台核准。');
}

function handleHistoricalNoteSaved({ note, content }) {
  notifyChat(props.appointment, 'visit_data', {
    changedParts: ['歷次病歷日誌'],
    snapshot: { fieldLabel: '歷次病歷日誌', before: note.content || '', after: content || '' },
  });
  loadNotes(notePage.value);
}

function beforeUnload(event) {
  if (!dirty.value && !busy.value) return;
  save();
  event.preventDefault();
  event.returnValue = '';
}

onBeforeRouteLeave(async () => {
  if (!dirty.value || !editable.value) return true;
  if (await save()) return true;
  toast.error(`「${props.appointment.petName}」還有內容沒有儲存成功，請先處理再離開`);
  return false;
});

onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload);
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(timer);
  window.removeEventListener('beforeunload', beforeUnload);
});
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col" :aria-label="`${appointment.petName} 就診工作區`">
    <header class="border-b border-border px-5 py-4 sm:px-6">
      <div class="sr-only">
        <h2 class="text-xl font-semibold">{{ appointment.petName }}</h2>
        <span class="text-sm text-muted-foreground">{{ petSummary }}</span>
      </div>
      <p class="sr-only">
        {{ owner?.name || appointment.ownerName || '飼主待確認' }}
        <template v-if="owner?.phone || appointment.ownerPhone"> · <span class="tabular-nums">{{ owner?.phone || appointment.ownerPhone }}</span></template>
        <template v-if="appointment.reason"> · {{ appointment.reason }}</template>
      </p>

      <div class="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section class="min-w-0 rounded-lg border border-border bg-field/50 p-3">
          <p class="text-xs font-semibold text-primary">病患資料</p>
          <p class="mt-0.5 truncate text-sm font-semibold text-foreground">
            {{ appointment.petName }}
            <span v-if="petSummary" class="font-normal text-muted-foreground">{{ petSummary }}</span>
            <span v-if="latenessLabel" class="ml-2 text-xs font-semibold text-danger">{{ latenessLabel }}</span>
          </p>
                  <dl v-if="hasReminders" class="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-warning">
                    <div v-for="field in reminderFields" :key="field.label" class="min-w-0">
                      <dt class="font-semibold">{{ field.label }}</dt>
                      <dd class="mt-0.5 whitespace-pre-wrap font-semibold">{{ field.value }}</dd>
                    </div>
                  </dl>
        </section>
        <section class="min-w-0 rounded-lg border border-border bg-field/50 p-3">
          <p class="text-xs font-semibold text-muted-foreground">飼主資料</p>
          <dl v-if="ownerFields.length" class="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div v-for="field in ownerFields" :key="field.label" class="min-w-0">
              <dt class="font-semibold text-muted-foreground">{{ field.label }}</dt>
              <dd class="mt-0.5 font-medium text-foreground" :class="field.class">{{ field.value }}</dd>
            </div>
          </dl>
          <p v-else class="mt-0.5 text-sm font-medium text-muted-foreground">未提供飼主資料</p>
        </section>
      </div>

      <div class="mt-3"><AppointmentMilestones :appointment="appointment" /></div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
      <Alert v-if="error" variant="destructive" class="mb-4"><AlertDescription>{{ error }}</AlertDescription></Alert>
      <div v-if="contextError" class="mb-4 flex items-center gap-3 rounded-lg bg-warning-surface p-3 text-sm text-warning">
        <span class="flex-1">{{ contextError }}</span>
        <Button variant="secondary" size="xs" @click="loadContext">重新載入</Button>
      </div>
      <div v-if="conflicts.length" role="alert" class="mb-4 space-y-3 rounded-xl bg-warning-surface p-4 text-sm text-warning">
        <p>此筆就診資料與其他更新衝突：{{ conflicts.map(key => CONFLICT_LABELS[key]).join('、') }}。請選擇要保留的內容。</p>
        <div v-for="key in conflicts" :key="key" class="rounded-lg bg-card p-3 text-foreground">
          <p class="text-xs font-medium text-muted-foreground">{{ CONFLICT_LABELS[key] }} · 目前內容</p>
          <p class="mt-1 whitespace-pre-wrap text-sm">{{ baseline[key] || '（空白）' }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" @click="resolveConflict(false)">使用目前內容</Button>
          <Button variant="secondary" size="sm" @click="resolveConflict(true)">保留我的修改</Button>
        </div>
      </div>

      <div class="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.85fr)]">
        <div class="space-y-4">
          <section class="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
            <h3 class="border-b border-border pb-1 text-sm font-semibold">看診資料</h3>
          <div class="grid grid-cols-2 gap-3">
            <label class="space-y-1.5 text-xs font-medium">體重（kg）
              <Input v-model="draft.weightKg" type="number" min="0" step="0.01" :disabled="!editable || committing" />
            </label>
            <label class="space-y-1.5 text-xs font-medium">體溫（°C）
              <Input v-model="draft.temperatureC" type="number" min="0" step="0.1" :disabled="!editable || committing" />
            </label>
          </div>
          <label class="block space-y-1.5">
            <span class="flex items-center gap-2 text-xs font-medium">本次簡易紀錄<span class="ml-auto font-normal text-muted-foreground">自動存入病歷日誌</span></span>
            <Textarea v-model="draft.visitNote" rows="12" :disabled="!editable || committing" placeholder="輸入本次看診紀錄…" />
          </label>
          <label class="block space-y-1.5">
            <span class="flex items-center gap-2 text-xs font-medium">備註<span class="ml-auto font-normal text-muted-foreground">僅內部可見・附於病歷日誌最後</span></span>
            <Textarea v-model="draft.internalNote" rows="4" maxlength="2000" :disabled="!editable || committing" placeholder="輸入僅供內部人員查看的備註…" />
          </label>

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
        </div>

        <section class="h-full space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
          <h3 class="border-b border-border pb-1 text-sm font-semibold">交辦與回診</h3>
          <label class="block space-y-1.5">
            <span class="text-xs font-medium">給櫃台的交辦</span>
            <Textarea v-model="draft.handoffNote" rows="6" maxlength="1000" :disabled="!editable || committing" placeholder="輸入櫃檯需要協助處理或轉告的事項…" />
          </label>
          <label class="block space-y-1.5">
            <span class="text-xs font-medium text-warning">請轉告飼主</span>
            <Textarea v-model="draft.specialCareNote" rows="3" maxlength="500" :disabled="!editable || committing" placeholder="輸入需要櫃檯轉告飼主的提醒…" />
          </label>
          <label class="block space-y-1.5">
            <span class="text-xs font-medium">回診建議</span>
            <Textarea v-model="draft.followUpRecommendation" rows="2" maxlength="500" :disabled="!editable || committing" placeholder="輸入建議回診時間或原因…" />
          </label>

        </section>
      </div>
    </div>

    <footer class="flex flex-wrap items-center gap-3 border-t border-border bg-field/40 px-5 py-3 sm:px-6">
      <p class="text-xs text-muted-foreground" role="status">{{ savedLabel }}</p>
      <div class="ml-auto flex flex-wrap gap-2">
        <Button variant="secondary" :disabled="busy || (!appointment.recordId && !editable)" @click="appointment.recordId ? emit('open-record', appointment) : run('record')">
          <FileText class="h-4 w-4" />{{ appointment.recordId ? '開啟表單草稿' : '建立表單草稿' }}
        </Button>
        <Button v-if="state.completed" variant="secondary" :disabled="busy || !!appointment.reopenRequest?.requestedAt" @click="openReopenRequest">
          {{ appointment.reopenRequest?.requestedAt ? '已申請修改' : '申請修改' }}
        </Button>
        <Button v-else-if="state.handedOff" variant="secondary" :disabled="busy" @click="run('reclaim')">
          <Undo2 class="h-4 w-4" />取回修改
        </Button>
        <Button v-else-if="appointment.status === 'arrived' && !state.handedOff" :disabled="busy || !!conflicts.length" @click="run('handoff')">
          交給櫃檯<ArrowRight class="h-4 w-4" />
        </Button>
      </div>
    </footer>

    <ModalDialog v-if="reopenDialog" size="sm" @close="reopenDialog = false">
      <form class="flex flex-col" @submit.prevent="requestReopen">
        <div class="space-y-4 p-6 sm:p-7">
          <div>
            <DialogTitle>申請修改</DialogTitle>
            <DialogDescription class="mt-1 text-xs">可補充需要更正或重新處理的原因；櫃台核准後才能修改此筆就診。</DialogDescription>
          </div>
          <label class="block space-y-1.5">
            <span class="text-xs font-medium">修改原因（選填）</span>
            <Textarea v-model="reopenReason" rows="4" maxlength="500" autofocus placeholder="例如：補充用藥交辦、修正看診紀錄…" />
          </label>
          <Alert v-if="reopenError" variant="destructive"><AlertDescription>{{ reopenError }}</AlertDescription></Alert>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" @click="reopenDialog = false">取消</Button>
          <Button type="submit" :disabled="busy">送出申請</Button>
        </DialogFooter>
      </form>
    </ModalDialog>
  </section>
</template>

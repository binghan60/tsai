<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { ArrowRight, FileText, ShieldAlert, Undo2 } from '@lucide/vue';
import { http } from '../api/http';
import { workflowState } from '../../../shared/appointmentWorkflow.js';
import { clinicalDraft, draftPatch, mergeClinicalUpdate } from '../lib/visitDraft';
import { ageLabel, formatDateTime } from '../lib/datetime';
import AppointmentMilestones from './AppointmentMilestones.vue';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Alert, AlertDescription } from './ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

// 醫師的單一病患工作區。刻意做成元件而不是獨立頁面：醫師常常同時追好幾隻動物
// （等一隻的檢驗結果時先看下一隻），診療台會同時掛著好幾個這種工作區，
// 各自保有未儲存的輸入，切換分頁不會清空（見 pages/VetConsolePage.vue）。
const props = defineProps({
  appointment: { type: Object, required: true },
  templates: { type: Array, default: () => [] },
});
const emit = defineEmits(['updated', 'open-record']);

const draft = reactive(clinicalDraft(props.appointment));
const baseline = ref(clinicalDraft(props.appointment));
const conflicts = ref([]);
const busy = ref(false);
const committing = ref(false);
const error = ref('');
const savedAt = ref(null);
const pet = ref(null);
const notes = ref([]);
const contextError = ref('');
const templateId = ref(props.appointment.templateId || '');
let timer;
let disposed = false;
let savePromise = null;
let queued = null;

const state = computed(() => workflowState(props.appointment));
// 櫃台按下「完成處理」之後這次就診結案，內容不再可改（伺服器也會擋）。
const editable = computed(() => !state.value.completed);
const dirty = computed(() => Object.keys(draftPatch(draft, baseline.value)).length > 0);
const owner = computed(() => (typeof pet.value?.ownerId === 'object' ? pet.value.ownerId : null));
const petSummary = computed(() => {
  if (!pet.value) return props.appointment.species || '';
  const sex = { male: '公', female: '母' }[pet.value.sex] || '';
  const neutered = { yes: '已絕育', no: '未絕育' }[pet.value.neutered] || '';
  return [pet.value.breed || props.appointment.species, sex && neutered ? `${sex} ${neutered}` : sex || neutered, ageLabel(pet.value.birthDate, new Date(), '')]
    .filter(Boolean).join(' · ');
});
const hasReminders = computed(() => Boolean(pet.value?.allergies || pet.value?.chronicConditions || pet.value?.currentMedications));
const CONFLICT_LABELS = {
  visitNote: '本次簡易紀錄', handoffNote: '給櫃台的交辦', specialCareNote: '請轉告飼主',
  followUpRecommendation: '回診建議', followUpReason: '回診原因', weightKg: '體重', temperatureC: '體溫',
};
const savedLabel = computed(() => {
  if (busy.value) return '儲存中…';
  if (conflicts.value.length) return '有同步衝突，請先核對';
  if (dirty.value) return '有尚未儲存的變更';
  if (savedAt.value) return `${savedAt.value.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })} 已自動儲存`;
  return '已載入儲存內容';
});

// 別人（櫃台或另一台裝置）改了這筆時，不能把醫師正在打的字洗掉；同一欄兩邊都動過才算衝突。
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
  notes.value = [];
  if (!props.appointment.petId) return;
  const petId = props.appointment.petId;
  try {
    const [{ data: patient }, { data: diary }] = await Promise.all([
      http.get(`/pets/${petId}`),
      http.get(`/pets/${petId}/clinical-notes`, { params: { limit: 8 } }),
    ]);
    if (disposed || props.appointment.petId !== petId) return;
    pet.value = patient;
    notes.value = (diary.items || []).filter(note => String(note.appointmentId) !== String(props.appointment._id));
    contextError.value = '';
  } catch { contextError.value = '病史或病歷日誌未能載入，請重新載入確認。'; }
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
      // 請求進行中打的字仍然算未儲存，所以比對的基準是送出當下的快照而不是最新草稿。
      const merged = mergeClinicalUpdate(draft, snapshot, data);
      Object.assign(draft, merged.draft);
      baseline.value = merged.baseline;
      savedAt.value = new Date();
      emit('updated', data);
      return true;
    } catch (err) {
      error.value = err.response?.data?.message || '儲存失敗，輸入仍保留，請重試';
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

async function run(action) {
  if (busy.value || conflicts.value.length) return;
  committing.value = true;
  try {
    if (!await save()) return;
    if (dirty.value && !await save()) return;
    busy.value = true;
    error.value = '';
    const { data } = await http.post(`/appointments/${props.appointment._id}/workflow/${action}`, {
      version: props.appointment.__v ?? 0,
      ...(action === 'record' ? { templateId: templateId.value } : {}),
    });
    baseline.value = clinicalDraft(data);
    Object.assign(draft, clinicalDraft(data));
    emit('updated', data, action);
    if (action === 'record' && data.recordId) emit('open-record', data);
  } catch (err) {
    error.value = err.response?.data?.message || '操作失敗，請稍後重試';
  } finally {
    busy.value = false;
    committing.value = false;
    if (queued) { const update = queued; queued = null; receive(update); }
  }
}

onBeforeUnmount(() => { disposed = true; clearTimeout(timer); });
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col" :aria-label="`${appointment.petName} 的看診工作區`">
    <header class="border-b border-border px-5 py-4 sm:px-6">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 class="text-xl font-semibold">{{ appointment.petName }}</h2>
        <span class="text-sm text-muted-foreground">{{ petSummary }}</span>
        <span v-if="pet?.medicalRecordNumber" class="ml-auto text-xs tabular-nums text-muted-foreground">{{ pet.medicalRecordNumber }}</span>
      </div>
      <p class="mt-1 text-sm">
        {{ owner?.name || appointment.ownerName || '飼主待確認' }}
        <template v-if="owner?.phone || appointment.ownerPhone"> · <span class="tabular-nums">{{ owner?.phone || appointment.ownerPhone }}</span></template>
        <template v-if="appointment.reason"> · {{ appointment.reason }}</template>
      </p>

      <div v-if="hasReminders" class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-warning-surface px-3.5 py-2.5 text-sm text-warning">
        <span class="inline-flex items-center gap-2 font-semibold"><ShieldAlert class="h-4 w-4" stroke-width="1.75" />臨床提醒</span>
        <span v-if="pet.allergies">過敏：{{ pet.allergies }}</span>
        <span v-if="pet.chronicConditions">慢性病：{{ pet.chronicConditions }}</span>
        <span v-if="pet.currentMedications">用藥：{{ pet.currentMedications }}</span>
      </div>

      <div class="mt-3"><AppointmentMilestones :appointment="appointment" /></div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
      <Alert v-if="error" variant="destructive" class="mb-4"><AlertDescription>{{ error }}</AlertDescription></Alert>
      <div v-if="contextError" class="mb-4 flex items-center gap-3 rounded-lg bg-warning-surface p-3 text-sm text-warning">
        <span class="flex-1">{{ contextError }}</span>
        <Button variant="secondary" size="xs" @click="loadContext">重新載入</Button>
      </div>
      <div v-if="!editable" class="mb-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">櫃台已完成這筆就診，內容不能再修改。需要更正請改在寵物的病歷日誌上。</div>

      <div v-if="conflicts.length" role="alert" class="mb-4 space-y-3 rounded-xl bg-warning-surface p-4 text-sm text-warning">
        <p>另一端更新了 {{ conflicts.map(key => CONFLICT_LABELS[key]).join('、') }}。你的輸入仍保留，請核對後選擇要保留哪一份。</p>
        <div v-for="key in conflicts" :key="key" class="rounded-lg bg-card p-3 text-foreground">
          <p class="text-xs font-medium text-muted-foreground">{{ CONFLICT_LABELS[key] }} · 最新內容</p>
          <p class="mt-1 whitespace-pre-wrap text-sm">{{ baseline[key] || '（空白）' }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" @click="resolveConflict(false)">採用最新內容</Button>
          <Button variant="secondary" size="sm" @click="resolveConflict(true)">保留我的輸入</Button>
        </div>
      </div>

      <div class="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div class="space-y-4">
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

          <section class="rounded-xl border border-border bg-field/60 p-4">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-sm font-semibold">歷次病歷日誌</h3>
              <Button v-if="appointment.petId" as-child variant="secondary" size="xs">
                <router-link :to="`/pets/${appointment.petId}`">完整病歷</router-link>
              </Button>
            </div>
            <article v-for="note in notes" :key="note._id" class="mt-3 border-t border-border pt-3">
              <p class="text-xs text-muted-foreground">{{ formatDateTime(note.entryDate) }}</p>
              <p class="mt-0.5 line-clamp-4 whitespace-pre-wrap text-sm">{{ note.content }}</p>
            </article>
            <p v-if="!notes.length && !contextError" class="mt-3 text-sm text-muted-foreground">尚無其他病歷日誌</p>
          </section>
        </div>

        <div class="space-y-4">
          <label class="block space-y-1.5">
            <span class="text-xs font-medium">給櫃台的交辦（收費與領藥）</span>
            <Textarea v-model="draft.handoffNote" rows="6" maxlength="1000" :disabled="!editable || committing" placeholder="例如：診察費 ＋ 胸腔 X 光兩張、止咳藥水 30ml（已包好）" />
            <span class="block text-xs text-muted-foreground">收費依這段文字，系統不計價也不加總。</span>
          </label>
          <label class="block space-y-1.5">
            <span class="text-xs font-medium text-warning">請轉告飼主</span>
            <Textarea v-model="draft.specialCareNote" rows="3" maxlength="500" :disabled="!editable || committing" placeholder="照護或用藥注意事項，櫃台會當面轉告" />
          </label>
          <label class="block space-y-1.5">
            <span class="text-xs font-medium">回診建議</span>
            <Textarea v-model="draft.followUpRecommendation" rows="2" maxlength="500" :disabled="!editable || committing" placeholder="例如：兩週後回診複查胸腔 X 光" />
            <span class="block text-xs text-muted-foreground">櫃台會與飼主確認實際時段。</span>
          </label>

          <section class="space-y-2 rounded-xl border border-border p-4">
            <h3 class="text-sm font-semibold">正式表單</h3>
            <p class="text-xs text-muted-foreground">需要完整健檢報告時才建立；簡易看診不需要。</p>
            <Select v-if="!appointment.recordId" v-model="templateId">
              <SelectTrigger class="w-full"><SelectValue placeholder="選擇表單類型" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="form in templates" :key="form._id" :value="form._id">{{ form.name }}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="secondary" size="sm" class="w-full" :disabled="busy || !editable || (!appointment.recordId && !templateId)" @click="run('record')">
              <FileText class="h-4 w-4" />{{ appointment.recordId ? '開啟本次表單' : '建立本次表單草稿' }}
            </Button>
          </section>
        </div>
      </div>
    </div>

    <footer class="flex flex-wrap items-center gap-3 border-t border-border bg-field/40 px-5 py-3 sm:px-6">
      <p class="text-xs text-muted-foreground" role="status">{{ savedLabel }}</p>
      <div class="ml-auto flex flex-wrap gap-2">
        <Button v-if="state.handedOff && !state.completed" variant="secondary" :disabled="busy" @click="run('reclaim')">
          <Undo2 class="h-4 w-4" />取回這筆
        </Button>
        <Button v-else-if="!state.handedOff" :disabled="busy || !!conflicts.length" @click="run('handoff')">
          完成看診，送交櫃台<ArrowRight class="h-4 w-4" />
        </Button>
      </div>
    </footer>
  </section>
</template>

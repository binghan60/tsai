<script setup>
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { ArrowLeft, FileText, Save, ShieldAlert } from '@lucide/vue';
import { http } from '../api/http';
import { useToast } from '../composables/useToast';
import { useClinicSync } from '../composables/useClinicSync';
import { workflowState } from '../../../shared/appointmentWorkflow.js';
import { clinicalDraft, draftPatch, mergeClinicalUpdate } from '../lib/visitDraft';
import { formatDateTime } from '../lib/datetime';
import AppointmentMilestones from '../components/AppointmentMilestones.vue';
import AppointmentBillingEditor from '../components/AppointmentBillingEditor.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';

const route = useRoute();
const router = useRouter();
const id = String(route.params.id);
const toast = useToast();
const appointment = ref(null);
const date = computed(() => appointment.value?.date || '');
const pet = ref(null);
const notes = ref([]);
const contextError = ref('');
const loading = ref(true);
const busy = ref(false);
const committing = ref(false);
const error = ref('');
const savedAt = ref(null);
const baseline = ref(clinicalDraft({}));
const draft = reactive(clinicalDraft({}));
const conflicts = ref([]);
const templates = ref([]);
const templateId = ref('');
const confirming = ref(null);
let timer;
let disposed = false;
let queuedUpdate = null;
let savePromise = null;
const state = computed(() => workflowState(appointment.value || {}));
const editable = computed(() => appointment.value && ['arrived', 'pending_checkout', 'completed'].includes(appointment.value.status));
const dirty = computed(() => Object.keys(draftPatch(draft, baseline.value)).length > 0);
const backTo = computed(() => typeof route.query.returnTo === 'string' && /^\/(appointments|reception)(\?|$)/.test(route.query.returnTo) ? route.query.returnTo : '/appointments');
const conflictLabels = { visitNote: '簡易紀錄', handoffNote: '櫃台交辦', specialCareNote: '飼主提醒', followUpRecommendation: '回診建議', followUpReason: '回診原因', billingItems: '處方與費用', weightKg: '體重', temperatureC: '體溫' };
function receive(incoming) {
  if (disposed || incoming._id !== id) return;
  if (busy.value) { if (!queuedUpdate || (incoming.__v ?? 0) >= (queuedUpdate.__v ?? 0)) queuedUpdate = incoming; return; }
  if (appointment.value && (incoming.__v ?? 0) <= (appointment.value.__v ?? 0)) return;
  const merged = mergeClinicalUpdate(draft, baseline.value, incoming);
  Object.assign(draft, merged.draft);
  baseline.value = merged.baseline;
  conflicts.value = [...new Set([...conflicts.value, ...merged.conflicts])];
  appointment.value = incoming;
}
async function refresh() {
  try {
    const { data } = await http.get(`/appointments/${id}`);
    if (!disposed) receive(data);
  } catch { if (!disposed) error.value = '無法更新就診資料，請檢查連線後重試'; }
}
const { connected } = useClinicSync(date, refresh, receive);
async function loadContext() {
  if (!appointment.value?.petId) return;
  try {
    const [{ data: patient }, { data: diary }] = await Promise.all([
      http.get(`/pets/${appointment.value.petId}`),
      http.get(`/pets/${appointment.value.petId}/clinical-notes`, { params: { limit: 10 } }),
    ]);
    pet.value = patient;
    notes.value = (diary.items || []).filter(note => String(note.appointmentId) !== id);
    contextError.value = '';
  } catch { contextError.value = '病史或病歷日誌未能載入，請重新載入確認。'; }
}
function finishBusy() {
  busy.value = false;
  if (queuedUpdate) { const update = queuedUpdate; queuedUpdate = null; receive(update); }
}
async function save() {
  clearTimeout(timer);
  if (savePromise) { await savePromise; return !dirty.value || save(); }
  if (!dirty.value) return true;
  if (!editable.value || conflicts.value.length || busy.value) return false;
  const snapshot = JSON.parse(JSON.stringify(draft));
  const patch = draftPatch(snapshot, baseline.value);
  busy.value = true;
  error.value = '';
  savePromise = (async () => {
    try {
      const { data } = await http.post(`/appointments/${id}/workflow/clinical`, { version: appointment.value.__v ?? 0, ...patch });
      // Edits typed during the request remain dirty against the confirmed snapshot.
      const merged = mergeClinicalUpdate(draft, snapshot, data);
      Object.assign(draft, merged.draft);
      baseline.value = merged.baseline;
      appointment.value = data;
      savedAt.value = new Date();
      return true;
    } catch (err) {
      error.value = err.response?.data?.message || '儲存失敗，輸入仍保留，請重試';
      if (err.response?.status === 409) await refresh();
      return false;
    } finally { savePromise = null; finishBusy(); }
  })();
  return savePromise;
}
watch(draft, () => {
  clearTimeout(timer);
  if (dirty.value && editable.value && !conflicts.value.length) timer = setTimeout(() => save(), 1200);
}, { deep: true });
function resolveConflict(useLocal) {
  if (!useLocal) for (const key of conflicts.value) draft[key] = JSON.parse(JSON.stringify(baseline.value[key]));
  conflicts.value = [];
  error.value = '';
  if (useLocal) save();
}
async function run(action) {
  if (busy.value || conflicts.value.length) return;
  committing.value = true;
  if (!await save()) { committing.value = false; return; }
  // A user may have typed while a save was in flight; flush before committing a milestone.
  if (dirty.value && !await save()) { committing.value = false; return; }
  busy.value = true;
  error.value = '';
  try {
    const { data } = await http.post(`/appointments/${id}/workflow/${action}`, { version: appointment.value.__v ?? 0, templateId: templateId.value });
    appointment.value = data;
    baseline.value = clinicalDraft(data);
    Object.assign(draft, clinicalDraft(data));
    confirming.value = null;
    if (action === 'record') {
      await router.push({ path: `/records/${data.recordId}/edit`, query: { visit: id, returnTo: backTo.value } });
    } else toast.success({ start: '已開始看診', bill: '批價完成，櫃台現在可以收款', finish: '看診完成', unbill: '已撤回批價，修改後請重新送出' }[action]);
  } catch (err) {
    error.value = err.response?.data?.message || '操作失敗，請稍後重試';
    if (err.response?.status === 409) await refresh();
  } finally { finishBusy(); committing.value = false; }
}
function beforeUnload(event) { if (dirty.value || busy.value) { event.preventDefault(); event.returnValue = ''; } }
onBeforeRouteLeave(async () => {
  if (!dirty.value) return true;
  if (await save() && !dirty.value) return true;
  return window.confirm('還有未儲存的看診內容。確定捨棄這些變更並離開？');
});
onMounted(async () => {
  window.addEventListener('beforeunload', beforeUnload);
  try {
    const { data } = await http.get(`/appointments/${id}`);
    appointment.value = data;
    baseline.value = clinicalDraft(data);
    Object.assign(draft, clinicalDraft(data));
    templateId.value = data.templateId || '';
    loadContext();
    http.get('/settings/form-templates').then(({ data: forms }) => templates.value = forms).catch(() => {});
  } catch { error.value = '無法載入這筆就診，請返回列表重試'; }
  finally { loading.value = false; }
});
onBeforeUnmount(() => { disposed = true; clearTimeout(timer); window.removeEventListener('beforeunload', beforeUnload); });
</script>

<template>
  <div class="mx-auto max-w-7xl space-y-5">
    <Button as-child variant="outline"><router-link :to="backTo"><ArrowLeft class="h-4 w-4" />返回今日診務</router-link></Button>
    <p v-if="loading" class="p-10 text-center text-muted-foreground">載入看診資料中…</p>
    <p v-if="error" role="alert" class="rounded-xl bg-danger-surface p-4 text-sm text-danger">{{ error }}</p>
    <template v-if="appointment">
      <header class="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border bg-card p-5">
        <div class="space-y-2"><p class="text-xs text-muted-foreground">{{ appointment.date }} {{ appointment.time }} · {{ pet?.medicalRecordNumber || '就診資料' }}</p><h1 class="text-2xl font-bold">{{ appointment.petName }} <span class="text-base font-normal text-muted-foreground">{{ appointment.species }} · {{ appointment.ownerName }}</span></h1><p class="text-sm">{{ appointment.reason || '未填就診原因' }}</p><AppointmentMilestones :appointment="appointment" /></div>
        <Button v-if="editable && !state.started && !state.visited" :disabled="busy" @click="run('start')">開始看診</Button>
      </header>
      <p v-if="!editable" class="rounded-lg bg-warning-surface p-3 text-sm text-warning">此筆就診尚未報到或已取消，目前僅供查看。請由櫃台處理報到。</p>
      <div v-if="conflicts.length" role="alert" class="space-y-3 rounded-xl bg-warning-surface p-4 text-sm">
        <p>另一端更新了 {{ conflicts.map(key => conflictLabels[key]).join('、') }}。你的輸入仍保留，請核對後選擇要保留的版本。</p>
        <div v-for="key in conflicts" :key="key" class="rounded-lg bg-card p-3"><b>{{ conflictLabels[key] }} · 最新內容</b><pre class="mt-1 whitespace-pre-wrap font-sans text-sm">{{ typeof baseline[key] === 'object' ? JSON.stringify(baseline[key], null, 2) : baseline[key] || '（空白）' }}</pre></div>
        <div class="flex flex-wrap gap-2"><Button variant="secondary" @click="resolveConflict(false)">採用最新內容</Button><Button variant="secondary" @click="resolveConflict(true)">保留我的輸入並儲存</Button></div>
      </div>
      <div class="grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(22rem,1fr)]">
        <div class="space-y-5">
          <section class="space-y-4 rounded-2xl border border-border bg-card p-5">
            <h2 class="text-lg font-semibold">本次診療</h2>
            <div v-if="contextError" class="space-y-2 rounded-lg bg-warning-surface p-3 text-sm"><p>{{ contextError }}</p><Button variant="secondary" size="sm" @click="loadContext">重新載入病史</Button></div>
            <div v-if="pet" class="space-y-2 rounded-lg bg-field p-3 text-sm">
              <p class="flex items-center gap-2 font-medium"><ShieldAlert class="h-4 w-4" />臨床提醒</p>
              <p>過敏：{{ pet.allergies || '未記錄' }}</p><p>慢性病：{{ pet.chronicConditions || '未記錄' }}</p><p>目前用藥：{{ pet.currentMedications || '未記錄' }}</p>
            </div>
            <div class="grid grid-cols-2 gap-3"><label class="space-y-1 text-sm">體重（kg）<Input v-model="draft.weightKg" type="number" min="0" step="0.01" :disabled="!editable || committing" /></label><label class="space-y-1 text-sm">體溫（°C）<Input v-model="draft.temperatureC" type="number" min="0" step="0.1" :disabled="!editable || committing" /></label></div>
            <label class="block space-y-2 text-sm font-medium">本次簡易紀錄<Textarea v-model="draft.visitNote" rows="7" :disabled="!editable || committing" placeholder="輸入本次看診紀錄…" /></label>
            <p class="text-xs text-muted-foreground">自動儲存至寵物的病歷日誌；後續編輯會更新同一筆紀錄。</p>
          </section>
          <section class="space-y-4 rounded-2xl border border-border bg-card p-5">
            <div class="flex items-center justify-between gap-2"><h2 class="text-lg font-semibold">歷次病歷日誌</h2><Button v-if="appointment.petId" as-child variant="secondary" size="sm"><router-link :to="`/pets/${appointment.petId}`">完整病歷</router-link></Button></div>
            <article v-for="note in notes" :key="note._id" class="border-t border-border pt-3"><p class="mb-1 text-xs text-muted-foreground">{{ formatDateTime(note.entryDate) }}</p><p class="whitespace-pre-wrap text-sm">{{ note.content }}</p></article>
            <p v-if="!notes.length && !contextError" class="text-sm text-muted-foreground">尚無其他病歷日誌</p>
          </section>
          <section class="space-y-3 rounded-2xl border border-border bg-card p-5">
            <h2 class="text-lg font-semibold">正式表單</h2><p class="text-sm text-muted-foreground">需要完整報告時，使用本次就診綁定的表單；簡易看診不需建立。</p>
            <label v-if="!appointment.recordId" class="block space-y-1 text-sm">表單類型<select v-model="templateId" class="h-11 w-full rounded-lg border border-input bg-field px-3"><option value="">選擇表單</option><option v-for="form in templates" :key="form._id" :value="form._id">{{ form.name }}</option></select></label>
            <Button variant="secondary" :disabled="busy || !editable || (!appointment.recordId && !templateId)" @click="run('record')"><FileText class="h-4 w-4" />{{ appointment.recordId ? '開啟本次表單' : '建立本次表單草稿' }}</Button>
          </section>
        </div>
        <aside class="space-y-5 rounded-2xl border border-border bg-card p-5">
          <h2 class="text-lg font-semibold">批價與交接摘要</h2>
          <section class="space-y-3"><h3 class="font-medium">處方與費用</h3><AppointmentBillingEditor v-model:items="draft.billingItems" :disabled="!editable || state.billed || busy" />
            <p v-if="state.paid" class="rounded-lg bg-success-surface p-3 text-sm text-success">已收款 NT$ {{ appointment.checkoutTotal }} · 費用與處方已鎖定</p>
            <div v-else-if="state.billed" class="space-y-2 rounded-lg bg-info-surface p-3 text-sm"><p>批價已送交櫃台。需要修改費用或處方時，先撤回批價。</p><Button variant="secondary" size="sm" :disabled="busy" @click="confirming = 'unbill'">撤回批價</Button></div>
          </section>
          <section class="space-y-3 border-t border-border pt-4"><h3 class="font-medium">交接事項</h3><label class="block space-y-1 text-sm">櫃台交辦<Textarea v-model="draft.handoffNote" :disabled="!editable || committing" maxlength="1000" placeholder="例如：本次批價已含換藥費" /></label><label class="block space-y-1 text-sm">請轉告飼主<Textarea v-model="draft.specialCareNote" :disabled="!editable || committing" maxlength="500" placeholder="照護或用藥注意事項" /></label><p v-if="appointment.handoffAcknowledgedAt" class="text-xs text-success">櫃台已完成交辦</p></section>
          <section class="space-y-3 border-t border-border pt-4"><h3 class="font-medium">回診需求</h3><label class="block space-y-1 text-sm">建議期間<Input v-model="draft.followUpRecommendation" :disabled="!editable || committing" maxlength="500" placeholder="例如：7 天後回診；不需回診可留白" /></label><label class="block space-y-1 text-sm">回診原因<Input v-model="draft.followUpReason" :disabled="!editable || committing" placeholder="例如：追蹤傷口恢復" /></label><p class="text-xs text-muted-foreground">櫃台會與飼主確認實際預約時段。</p><p v-if="appointment.followUpAppointmentId" class="text-sm text-success">已安排 {{ appointment.followUpDate }} {{ appointment.followUpTime }}</p></section>
        </aside>
      </div>
      <footer class="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-t-xl border border-border bg-card p-4 shadow-sm">
        <div class="text-xs text-muted-foreground" role="status"><p>{{ busy ? '處理中…' : conflicts.length ? '有同步衝突，請核對' : dirty ? '有尚未儲存的變更' : savedAt ? `已儲存 ${savedAt.toLocaleTimeString('zh-TW')}` : '已載入儲存內容' }}</p><p>{{ connected ? '即時連線中' : '即時連線中斷，定期重新載入' }}</p></div>
        <div v-if="editable" class="flex flex-wrap gap-2"><Button variant="secondary" :disabled="busy || !dirty || !!conflicts.length" @click="save"><Save class="h-4 w-4" />儲存</Button><Button v-if="!state.billed" variant="secondary" :disabled="busy || !!conflicts.length" @click="run('bill')">完成批價，送交櫃台</Button><Button v-if="!state.visited" :disabled="busy || !!conflicts.length" @click="run('finish')">完成看診</Button></div>
      </footer>
    </template>
    <ConfirmDialog v-if="confirming" :open="true" title="撤回這次批價？" description="櫃台將暫時無法收款。修改完成後請重新送出批價。" confirm-label="撤回批價" :loading="busy" @confirm="run('unbill')" @cancel="confirming = null" />
  </div>
</template>

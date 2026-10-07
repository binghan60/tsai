<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useField, useForm } from 'vee-validate';
import { History, Search, UserPlus, X } from '@lucide/vue';
import { http } from '../api/http';
import AppointmentSlotPicker from './AppointmentSlotPicker.vue';
import SurgeryField from './SurgeryField.vue';
import SegmentedControl from './SegmentedControl.vue';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { DEFAULT_ESTIMATED_DURATION_MINUTES, durationOverflowError } from '../lib/appointmentTime';
import { formatDate, formatDateTime, weekdayLabel } from '../lib/datetime';
import { breedText } from '../lib/petDisplay';
import { checkMobilePhone } from '../../../shared/phone.js';

// 新增與修改掛號共用的 Modal（取代原本的 AppointmentDrawer 側邊抽屜）。
// 置中雙欄：左欄「誰、為什麼」（類型、貓咪、來院原因、手術、報告模板、內部備註），
// 右欄「什麼時候」（日期快選＋時段格）。時段格拿到自己的一欄就不用捲動。
//
// 抽屜改成 Modal 的原因：櫃台頁改成整寬的時間軸後，再從右邊擠一個 576px 的抽屜進來，
// 時間軸卡片右側的狀態與按鈕會被壓壞。關閉 Modal 時直接捨棄尚未送出的內容。
//
// 送出的 payload 跟舊抽屜一樣，只多了新增模式也能帶 date——電話裡「我明天帶來」是常態。
const props = defineProps({
  // null＝新增；有值＝修改這筆
  appointment: { type: Object, default: null },
  // 頁面上的日期面板（新增時的預設日期）
  date: { type: String, required: true },
  // 頁面已經載入的那一天的掛號，時段格直接拿來算，不另外打 API
  dayItems: { type: Array, default: () => [] },
  templates: { type: Array, default: () => [] },
  defaultTemplateId: { type: String, default: '' },
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
  open: { type: Boolean, default: true },
});
const emit = defineEmits(['submit', 'close']);

const isEdit = computed(() => Boolean(props.appointment));

const MODE_OPTIONS = [
  { value: 'return', label: '回診', icon: History },
  { value: 'new', label: '初診', icon: UserPlus },
];
const OWNER_MODE_OPTIONS = [
  { value: 'new', label: '新飼主' },
  { value: 'existing', label: '既有飼主' },
];
const mode = ref('return');
const ownerMode = ref('new');
const templateId = ref(String(props.appointment?.templateId || props.defaultTemplateId || ''));
const slotDate = ref(props.appointment?.date || props.date);

const requiredText = (message) => (value) => (value && String(value).trim() !== '') || message;
const requiredTime = requiredText('請選擇預約時段');
// 飼主姓名不在這裡驗：接電話掛號時常常只問得到貓咪名跟電話，報到那一步才必填。
const requiredPetName = (value) => (!isEdit.value && mode.value !== 'new' ? true : requiredText('必填')(value));
// 電話選填，填了就要是手機（報到時拿它建立飼主）；修改時沒動到的舊電話照收，見 shared/phone.js。
const ownerPhoneRule = (value) => checkMobilePhone(value, isEdit.value ? props.appointment?.ownerPhone : undefined).error || true;
const requiredForSurgery = (value) => (!isSurgery.value || (value && String(value).trim() !== '')) || '請填寫手術名稱';

const { handleSubmit, submitCount } = useForm({
  initialValues: {
    petName: props.appointment?.petName ?? '',
    species: props.appointment?.species ?? '',
    ownerName: props.appointment?.ownerName ?? '',
    ownerPhone: props.appointment?.ownerPhone ?? '',
    time: props.appointment?.time ?? '',
    estimatedDurationMinutes: props.appointment?.estimatedDurationMinutes ?? DEFAULT_ESTIMATED_DURATION_MINUTES,
    reason: props.appointment?.reason ?? '',
    internalNote: '',
    isSurgery: props.appointment?.isSurgery ?? false,
    surgeryName: props.appointment?.surgeryName ?? '',
  },
});
const { value: petName, errorMessage: petNameError } = useField('petName', requiredPetName);
const { value: species } = useField('species');
const { value: ownerName } = useField('ownerName');
const { value: ownerPhone, errorMessage: ownerPhoneError } = useField('ownerPhone', ownerPhoneRule);
const { value: time } = useField('time', requiredTime);
const { value: estimatedDurationMinutes } = useField('estimatedDurationMinutes');
const { value: reason } = useField('reason');
const { value: internalNote } = useField('internalNote');
const { value: isSurgery } = useField('isSurgery');
const { value: surgeryName, errorMessage: surgeryNameError } = useField('surgeryName', requiredForSurgery);

// ── 貓咪／飼主搜尋：直接放在 Modal 裡，不再疊一層選擇對話框 ─────────────────
// 這是「選人用的候選清單」，跟頁面的提交式搜尋不同，邊打邊查。
// 清單限高、超過就在框內捲動（同名的貓、同一位飼主養很多隻時，只列前幾筆會找不到要的那一隻）；
// 一次最多拿 CANDIDATE_LIMIT 筆，再多就提示還有幾筆沒列出。
const CANDIDATE_LIMIT = 50;
function useCandidateSearch(endpoint) {
  const query = ref('');
  const results = ref([]);
  const total = ref(0);
  const loading = ref(false);
  const failed = ref(false);
  let timer;
  let sequence = 0;
  watch(query, (value) => {
    clearTimeout(timer);
    const keyword = value.trim();
    if (!keyword) {
      results.value = [];
      total.value = 0;
      loading.value = false;
      return;
    }
    loading.value = true;
    timer = setTimeout(async () => {
      const current = ++sequence;
      try {
        const { data } = await http.get(endpoint, { params: { q: keyword, limit: CANDIDATE_LIMIT } });
        if (current !== sequence) return;
        results.value = data.items ?? [];
        total.value = data.total ?? results.value.length;
        failed.value = false;
      } catch {
        if (current === sequence) failed.value = true;
      } finally {
        if (current === sequence) loading.value = false;
      }
    }, 250);
  });
  onBeforeUnmount(() => clearTimeout(timer));
  const hiddenCount = computed(() => (loading.value || failed.value ? 0 : Math.max(total.value - results.value.length, 0)));
  return { query, results, loading, failed, hiddenCount };
}

const petSearch = useCandidateSearch('/pets');
const ownerSearch = useCandidateSearch('/owners');
const selectedPet = ref(null);
const selectedOwner = ref(null);
const pickPetError = ref('');
const pickOwnerError = ref('');

function selectPet(pet) {
  selectedPet.value = pet;
  pickPetError.value = '';
}
function selectOwner(owner) {
  selectedOwner.value = owner;
  pickOwnerError.value = '';
}

function attendanceSummaryText(entity, subject) {
  const summary = entity?.attendanceSummary;
  if (!summary) return '';
  const parts = [];
  if (summary.lateCount > 0) parts.push(`遲到 ${summary.lateCount} 次${summary.lastLateAt ? `，最近一次為 ${formatDateTime(summary.lastLateAt)}` : ''}`);
  if (summary.noShowCount > 0) parts.push(`未到 ${summary.noShowCount} 次`);
  return parts.length ? `${subject}曾${parts.join('、')}。` : '';
}
const attendanceWarnings = computed(() => {
  if (mode.value === 'return' && selectedPet.value) {
    return [
      attendanceSummaryText(selectedPet.value, selectedPet.value.name || '貓咪'),
      attendanceSummaryText(selectedPet.value.ownerId, selectedPet.value.ownerId?.name || '飼主'),
    ].filter(Boolean);
  }
  if (mode.value === 'new' && ownerMode.value === 'existing' && selectedOwner.value) {
    return [attendanceSummaryText(selectedOwner.value, selectedOwner.value.name || '飼主')].filter(Boolean);
  }
  return [];
});

// ── 日期與時段格（AppointmentSlotPicker，跟約回診、初診表審核同一塊）──────────────
// 預設是頁面上的日期面板（新增掛號就是今天）；頁面已經載入的那天直接拿 dayItems 算格子。
const durationError = computed(() => (time.value ? durationOverflowError(time.value, estimatedDurationMinutes.value) : ''));
// 同一隻貓咪那天已經有掛號時先提醒——電話裡飼主常忘記早上已經掛過。
const duplicatePetId = computed(() => (isEdit.value ? props.appointment.petId : mode.value === 'return' ? selectedPet.value?._id : null));
const duplicatePetName = computed(() => (isEdit.value ? props.appointment.petName : selectedPet.value?.name));

// ── 送出 ─────────────────────────────────────────────────────────────────
const title = computed(() => (isEdit.value ? `修改掛號：${props.appointment.petName}` : '新增掛號'));
const description = computed(() => (isEdit.value ? '只更新這筆掛號，不會修改飼主或貓咪主檔' : '電話掛號可先指定日期與時段，飼主資料報到時再補齊'));
const summary = computed(() => {
  const name = isEdit.value ? petName.value : mode.value === 'return' ? selectedPet.value?.name : petName.value;
  const when = time.value ? `${formatDate(slotDate.value)}（${weekdayLabel(slotDate.value)}）${time.value}` : '';
  return [name, when, `預估 ${estimatedDurationMinutes.value} 分鐘`, reason.value?.trim()].filter(Boolean);
});
function onOpenChange(value) {
  if (value) return;
  emit('close');
}

const onSubmit = handleSubmit((values) => {
  if (durationError.value) return;
  const shared = {
    time: values.time,
    estimatedDurationMinutes: Number(values.estimatedDurationMinutes),
    reason: values.reason?.trim() ?? '',
    isSurgery: values.isSurgery,
    surgeryName: values.surgeryName?.trim() ?? '',
    date: slotDate.value,
  };
  if (isEdit.value) {
    emit('submit', {
      ...shared,
      ownerName: values.ownerName?.trim() ?? '',
      ownerPhone: values.ownerPhone?.trim() ?? '',
      petName: values.petName.trim(),
      species: values.species?.trim() ?? '',
      ...(templateId.value ? { templateId: templateId.value } : {}),
    });
    return;
  }
  const common = { ...shared, internalNote: values.internalNote, templateId: templateId.value };
  if (mode.value === 'return') {
    if (!selectedPet.value) {
      pickPetError.value = '請先選擇貓咪';
      return;
    }
    emit('submit', { ...common, visitType: 'return', petId: selectedPet.value._id });
    return;
  }
  if (ownerMode.value === 'existing' && !selectedOwner.value) {
    pickOwnerError.value = '請先選擇既有飼主';
    return;
  }
  emit('submit', {
    ...common,
    visitType: 'new',
    ownerId: ownerMode.value === 'existing' ? selectedOwner.value._id : undefined,
    ownerName: values.ownerName,
    ownerPhone: values.ownerPhone,
    petName: values.petName,
  });
});
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent size="wide" class="flex max-h-[92vh] flex-col p-0" :show-close-button="false">
      <header class="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4">
        <div class="min-w-0 flex-1">
          <DialogTitle class="text-base font-semibold">{{ title }}</DialogTitle>
          <DialogDescription class="mt-0.5 text-xs">{{ description }}</DialogDescription>
        </div>
        <Button type="button" variant="secondary" size="icon-sm" :aria-label="isEdit ? '取消修改' : '捨棄這筆掛號'" :disabled="submitting" @click="emit('close')">
          <X class="h-4 w-4" stroke-width="1.75" />
        </Button>
      </header>

      <form id="appointment-dialog-form" class="min-h-0 flex-1 overflow-y-auto px-5 py-4" @submit.prevent="onSubmit">
        <div class="grid gap-6 lg:grid-cols-2">
          <!-- 左欄：誰、為什麼 -->
          <div class="space-y-5">
            <template v-if="!isEdit">
              <SegmentedControl v-model="mode" :options="MODE_OPTIONS" aria-label="掛號類型" full-width />

              <div v-if="mode === 'return'" class="space-y-1.5">
                <Label for="dialog-pet-search" class="text-xs font-medium">貓咪<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
                <div v-if="selectedPet" class="flex items-center gap-3 rounded-lg border border-primary bg-accent px-3 py-2.5">
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-semibold text-accent-foreground">{{ selectedPet.name }}<span class="ml-2 text-xs font-normal">{{ breedText(selectedPet, '貓咪') }}</span></p>
                    <p class="flex gap-x-3 truncate text-xs text-accent-foreground/80"><span>{{ selectedPet.ownerId?.name }}</span><span v-if="selectedPet.ownerId?.phone" class="num">{{ selectedPet.ownerId.phone }}</span></p>
                  </div>
                  <Button type="button" variant="secondary" size="sm" @click="selectedPet = null">更換</Button>
                </div>
                <template v-else>
                  <div class="relative">
                    <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" stroke-width="1.75" aria-hidden="true" />
                    <Input id="dialog-pet-search" v-model="petSearch.query.value" autofocus inputmode="search" class="h-11 pl-9" placeholder="貓咪名、飼主姓名或電話" autocomplete="off" />
                  </div>
                  <div v-if="petSearch.query.value.trim()" class="max-h-72 overflow-y-auto rounded-lg border border-border" aria-live="polite">
                    <p v-if="petSearch.loading.value" class="px-3 py-3 text-xs text-muted-foreground">搜尋中…</p>
                    <p v-else-if="petSearch.failed.value" class="px-3 py-3 text-xs text-destructive">搜尋失敗，請稍後再試</p>
                    <p v-else-if="!petSearch.results.value.length" class="px-3 py-3 text-xs text-muted-foreground">找不到符合的貓咪；第一次來請切到「初診」。</p>
                    <button
                      v-for="pet in petSearch.results.value"
                      v-else
                      :key="pet._id"
                      type="button"
                      class="flex w-full items-center gap-3 border-b border-border bg-card px-3 py-2.5 text-left last:border-b-0 hover:bg-field"
                      @click="selectPet(pet)"
                    >
                      <span class="min-w-0 flex-1 truncate text-sm"><span class="font-semibold text-primary">{{ pet.name }}</span><span v-if="pet.breed" class="ml-2 text-xs text-muted-foreground">{{ breedText(pet) }}</span><span v-if="pet.ownerId?.name" class="ml-3 text-xs text-muted-foreground">{{ pet.ownerId.name }}</span><span v-if="pet.ownerId?.phone" class="num ml-3 text-xs text-muted-foreground">{{ pet.ownerId.phone }}</span></span>
                    </button>
                    <p v-if="petSearch.hiddenCount.value" class="px-3 py-2.5 text-xs text-muted-foreground">還有 <span class="num">{{ petSearch.hiddenCount.value }}</span> 筆沒列出，請多打幾個字縮小範圍。</p>
                  </div>
                </template>
                <p v-if="pickPetError" class="text-xs font-medium text-destructive">{{ pickPetError }}</p>
              </div>

              <template v-else>
                <SegmentedControl v-model="ownerMode" :options="OWNER_MODE_OPTIONS" aria-label="飼主類型" full-width />
                <div v-if="ownerMode === 'existing'" class="space-y-1.5">
                  <Label for="dialog-owner-search" class="text-xs font-medium">既有飼主<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
                  <div v-if="selectedOwner" class="flex items-center gap-3 rounded-lg border border-primary bg-accent px-3 py-2.5">
                    <p class="min-w-0 flex-1 truncate text-sm font-semibold text-accent-foreground">{{ selectedOwner.name }}<span v-if="selectedOwner.phone" class="num ml-2 text-xs font-normal">{{ selectedOwner.phone }}</span></p>
                    <Button type="button" variant="secondary" size="sm" @click="selectedOwner = null">更換</Button>
                  </div>
                  <template v-else>
                    <div class="relative">
                      <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" stroke-width="1.75" aria-hidden="true" />
                      <Input id="dialog-owner-search" v-model="ownerSearch.query.value" inputmode="search" class="h-11 pl-9" placeholder="飼主姓名或電話" autocomplete="off" />
                    </div>
                    <div v-if="ownerSearch.query.value.trim()" class="max-h-72 overflow-y-auto rounded-lg border border-border" aria-live="polite">
                      <p v-if="ownerSearch.loading.value" class="px-3 py-3 text-xs text-muted-foreground">搜尋中…</p>
                      <p v-else-if="ownerSearch.failed.value" class="px-3 py-3 text-xs text-destructive">搜尋失敗，請稍後再試</p>
                      <p v-else-if="!ownerSearch.results.value.length" class="px-3 py-3 text-xs text-muted-foreground">找不到符合的飼主</p>
                      <button
                        v-for="owner in ownerSearch.results.value"
                        v-else
                        :key="owner._id"
                        type="button"
                        class="flex w-full items-center gap-3 border-b border-border bg-card px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-field"
                        @click="selectOwner(owner)"
                      >
                        <span class="font-semibold text-primary">{{ owner.name }}</span><span v-if="owner.phone" class="num text-xs text-muted-foreground">{{ owner.phone }}</span>
                      </button>
                      <p v-if="ownerSearch.hiddenCount.value" class="px-3 py-2.5 text-xs text-muted-foreground">還有 <span class="num">{{ ownerSearch.hiddenCount.value }}</span> 筆沒列出，請多打幾個字縮小範圍。</p>
                    </div>
                  </template>
                  <p v-if="pickOwnerError" class="text-xs font-medium text-destructive">{{ pickOwnerError }}</p>
                  <p class="text-xs text-muted-foreground">報到時會將新貓咪建檔於此飼主名下。</p>
                </div>
                <div class="grid gap-4 sm:grid-cols-2">
                  <div class="space-y-1.5">
                    <Label for="dialog-pet-name" class="text-xs font-medium">貓咪姓名<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
                    <Input id="dialog-pet-name" v-model="petName" placeholder="例：妞妞" />
                    <p v-if="petNameError" class="text-xs font-medium text-destructive">{{ petNameError }}</p>
                  </div>
                  <div class="space-y-1.5">
                    <Label for="dialog-species" class="text-xs font-medium">物種</Label>
                    <Input id="dialog-species" v-model="species" placeholder="例：犬" />
                  </div>
                </div>
                <div v-if="ownerMode === 'new'" class="grid gap-4 sm:grid-cols-2">
                  <div class="space-y-1.5">
                    <Label for="dialog-owner-name" class="text-xs font-medium">飼主姓名</Label>
                    <Input id="dialog-owner-name" v-model="ownerName" placeholder="接電話時問得到再填" />
                  </div>
                  <div class="space-y-1.5">
                    <Label for="dialog-owner-phone" class="text-xs font-medium">手機</Label>
                    <Input id="dialog-owner-phone" v-model="ownerPhone" class="num" inputmode="tel" placeholder="例：0912-345-678" :aria-invalid="Boolean(ownerPhoneError)" />
                    <p v-if="ownerPhoneError" class="text-xs font-medium text-destructive">{{ ownerPhoneError }}</p>
                  </div>
                </div>
              </template>

              <Alert v-for="warning in attendanceWarnings" :key="warning" class="border-warning/35 bg-warning-surface text-warning">
                <AlertDescription>{{ warning }}</AlertDescription>
              </Alert>
            </template>

            <template v-else>
              <div class="grid gap-4 sm:grid-cols-2">
                <div class="space-y-1.5">
                  <Label for="dialog-edit-pet-name" class="text-xs font-medium">貓咪姓名<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
                  <Input id="dialog-edit-pet-name" v-model="petName" />
                  <p v-if="petNameError" class="text-xs font-medium text-destructive">{{ petNameError }}</p>
                </div>
                <div class="space-y-1.5">
                  <Label for="dialog-edit-species" class="text-xs font-medium">物種</Label>
                  <Input id="dialog-edit-species" v-model="species" placeholder="例：貓" />
                </div>
                <div class="space-y-1.5">
                  <Label for="dialog-edit-owner-name" class="text-xs font-medium">飼主姓名</Label>
                  <Input id="dialog-edit-owner-name" v-model="ownerName" />
                </div>
                <div class="space-y-1.5">
                  <Label for="dialog-edit-owner-phone" class="text-xs font-medium">手機</Label>
                  <Input id="dialog-edit-owner-phone" v-model="ownerPhone" class="num" inputmode="tel" :aria-invalid="Boolean(ownerPhoneError)" />
                  <p v-if="ownerPhoneError" class="text-xs font-medium text-destructive">{{ ownerPhoneError }}</p>
                </div>
              </div>
            </template>

            <div class="space-y-1.5">
              <Label for="dialog-reason" class="text-xs font-medium">來院原因</Label>
              <Input id="dialog-reason" v-model="reason" placeholder="例：打疫苗、回診拿藥、不舒服" />
            </div>

            <SurgeryField v-model:is-surgery="isSurgery" v-model:surgery-name="surgeryName" :error="surgeryNameError" />

            <div class="space-y-1.5">
              <Label for="dialog-template" class="text-xs font-medium">健檢表單</Label>
              <Select v-model="templateId">
                <SelectTrigger id="dialog-template" class="w-full"><SelectValue placeholder="需要時可由醫師選擇" /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="template in templates" :key="template._id" :value="template._id">{{ template.name }}</SelectItem>
                </SelectContent>
              </Select>
              <p class="text-sm text-muted-foreground">報到時用這份建立健檢報告草稿。</p>
            </div>
            <div v-if="!isEdit" class="space-y-1.5">
              <Label for="dialog-internal-note" class="text-xs font-medium">內部備註</Label>
              <Textarea id="dialog-internal-note" v-model="internalNote" rows="3" maxlength="2000" placeholder="僅院內可見，醫師診療台會帶入同一則" />
            </div>
          </div>

          <!-- 右欄：什麼時候 -->
          <AppointmentSlotPicker
            v-model:date="slotDate"
            v-model:time="time"
            v-model:duration="estimatedDurationMinutes"
            :day-items="dayItems"
            :day-items-date="date"
            :exclude-id="appointment?._id ? String(appointment._id) : ''"
            :pet-id="duplicatePetId ? String(duplicatePetId) : ''"
            :pet-name="duplicatePetName || ''"
            :show-errors="submitCount > 0"
          />
        </div>

        <Alert v-if="errorMessage" variant="destructive" class="mt-4">
          <AlertDescription>{{ errorMessage }}</AlertDescription>
        </Alert>
      </form>

      <footer class="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-5 py-3">
        <p class="flex min-w-0 flex-1 gap-x-4 overflow-hidden whitespace-nowrap text-xs text-muted-foreground"><span v-for="(part, index) in summary" :key="index" :class="index === summary.length - 1 ? 'min-w-0 truncate' : 'shrink-0'">{{ part }}</span></p>
        <Button type="button" variant="secondary" :disabled="submitting" @click="emit('close')">取消</Button>
        <Button type="submit" form="appointment-dialog-form" :disabled="submitting">{{ submitting ? '處理中…' : isEdit ? '儲存變更' : '掛號' }}</Button>
      </footer>
    </DialogContent>
  </Dialog>
</template>

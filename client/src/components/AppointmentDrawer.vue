<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useField, useForm } from 'vee-validate';
import { ChevronDown, History, Search, UserPlus } from '@lucide/vue';
import { http } from '../api/http';
import SideDrawer from './SideDrawer.vue';
import SlotGrid from './SlotGrid.vue';
import SegmentedControl from './SegmentedControl.vue';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Alert, AlertDescription } from './ui/alert';
import { DatePicker } from './ui/date-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { buildSlotGrid } from '../lib/receptionBoard';
import { clinicDateInput, formatDate, formatDateTime, weekdayLabel } from '../lib/datetime';

// 新增與修改掛號共用的抽屜，取代原本的 NewAppointmentDialog／EditAppointmentDialog。
// 送出的 payload 跟那兩個對話框完全一樣，後端沒有跟著改。
const props = defineProps({
  // null＝新增；有值＝修改這筆
  appointment: { type: Object, default: null },
  // 新增時掛在哪一天（跟著頁面上的日期面板走）
  date: { type: String, required: true },
  // 頁面已經載入的那一天的掛號，時段格直接拿來算，不另外打 API
  dayItems: { type: Array, default: () => [] },
  templates: { type: Array, default: () => [] },
  defaultTemplateId: { type: String, default: '' },
  submitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
});
const emit = defineEmits(['submit', 'close', 'minimize']);

const isEdit = computed(() => Boolean(props.appointment));
const today = clinicDateInput();

const MODE_OPTIONS = [
  { value: 'return', label: '回診', icon: History },
  { value: 'new', label: '初診', icon: UserPlus },
];
const OWNER_MODE_OPTIONS = [
  { value: 'new', label: '新飼主' },
  { value: 'existing', label: '既有飼主・新增寵物' },
];
const mode = ref('return');
const ownerMode = ref('new');
const showMore = ref(false);
const templateId = ref(String(props.appointment?.templateId || props.defaultTemplateId || ''));
const slotDate = ref(props.appointment?.date || props.date);

const requiredText = (message) => (value) => (value && String(value).trim() !== '') || message;
const requiredTime = requiredText('請選擇預約時段');
// 飼主姓名不在這裡驗：接電話掛號時常常只問得到寵物名跟電話，報到那一步才必填。
const requiredPetName = (value) => (!isEdit.value && mode.value !== 'new' ? true : requiredText('必填')(value));
const requiredForSurgery = (value) => (!isSurgery.value || (value && String(value).trim() !== '')) || '請填寫手術名稱';

const { handleSubmit, submitCount } = useForm({
  initialValues: {
    petName: props.appointment?.petName ?? '',
    species: props.appointment?.species ?? '',
    ownerName: props.appointment?.ownerName ?? '',
    ownerPhone: props.appointment?.ownerPhone ?? '',
    time: props.appointment?.time ?? '',
    reason: props.appointment?.reason ?? '',
    internalNote: '',
    isSurgery: props.appointment?.isSurgery ?? false,
    surgeryName: props.appointment?.surgeryName ?? '',
  },
});
const { value: petName, errorMessage: petNameError } = useField('petName', requiredPetName);
const { value: species } = useField('species');
const { value: ownerName } = useField('ownerName');
const { value: ownerPhone } = useField('ownerPhone');
const { value: time, errorMessage: timeError } = useField('time', requiredTime);
const { value: reason } = useField('reason');
const { value: internalNote } = useField('internalNote');
const { value: isSurgery } = useField('isSurgery');
const { value: surgeryName, errorMessage: surgeryNameError } = useField('surgeryName', requiredForSurgery);

// ── 寵物／飼主搜尋：直接放在抽屜裡，不再疊一層選擇對話框 ─────────────────
// 這是「選人用的候選清單」，跟頁面的提交式搜尋不同，邊打邊查。
function useCandidateSearch(endpoint) {
  const query = ref('');
  const results = ref([]);
  const loading = ref(false);
  const failed = ref(false);
  let timer;
  let sequence = 0;
  watch(query, (value) => {
    clearTimeout(timer);
    const keyword = value.trim();
    if (!keyword) {
      results.value = [];
      loading.value = false;
      return;
    }
    loading.value = true;
    timer = setTimeout(async () => {
      const current = ++sequence;
      try {
        const { data } = await http.get(endpoint, { params: { q: keyword, limit: 6 } });
        if (current !== sequence) return;
        results.value = data.items ?? [];
        failed.value = false;
      } catch {
        if (current === sequence) failed.value = true;
      } finally {
        if (current === sequence) loading.value = false;
      }
    }, 250);
  });
  onBeforeUnmount(() => clearTimeout(timer));
  return { query, results, loading, failed };
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
      attendanceSummaryText(selectedPet.value, selectedPet.value.name || '寵物'),
      attendanceSummaryText(selectedPet.value.ownerId, selectedPet.value.ownerId?.name || '飼主'),
    ].filter(Boolean);
  }
  if (mode.value === 'new' && ownerMode.value === 'existing' && selectedOwner.value) {
    return [attendanceSummaryText(selectedOwner.value, selectedOwner.value.name || '飼主')].filter(Boolean);
  }
  return [];
});

// ── 時段格 ───────────────────────────────────────────────────────────────
// 修改掛號可以換日期；換到頁面沒載入的那天，才自己去抓那天的掛號。
const otherDayItems = ref(null);
watch(slotDate, async (value) => {
  otherDayItems.value = null;
  if (!value || value === props.date) return;
  try {
    const { data } = await http.get('/appointments', { params: { date: value } });
    if (slotDate.value === value) otherDayItems.value = data.items ?? [];
  } catch {
    if (slotDate.value === value) otherDayItems.value = [];
  }
});
const slotSessions = computed(() => {
  const items = slotDate.value === props.date ? props.dayItems : otherDayItems.value ?? [];
  return buildSlotGrid(items, { excludeId: props.appointment?._id });
});

// ── 送出 ─────────────────────────────────────────────────────────────────
const title = computed(() => (isEdit.value ? `修改掛號：${props.appointment.petName}` : '新增掛號'));
const description = computed(() => {
  if (isEdit.value) return '只更新這筆掛號，不會修改飼主或寵物主檔';
  return `掛在 ${formatDate(props.date)}（${weekdayLabel(props.date)}）${props.date === today ? ' · 今天' : ''}`;
});
const summary = computed(() => {
  const name = isEdit.value ? petName.value : mode.value === 'return' ? selectedPet.value?.name : petName.value;
  return [name, time.value ? `${formatDate(slotDate.value)} ${time.value}` : ''].filter(Boolean).join(' · ');
});
// 新增掛號收起來之後，頁首按鈕要叫得出「繼續掛號：豆豆」——只放名字，日期時段放不下。
const draftName = computed(() => (mode.value === 'return' ? selectedPet.value?.name : petName.value?.trim()) || '');
defineExpose({ draftName });

const onSubmit = handleSubmit((values) => {
  const shared = {
    time: values.time,
    reason: values.reason?.trim() ?? '',
    isSurgery: values.isSurgery,
    surgeryName: values.surgeryName?.trim() ?? '',
  };
  if (isEdit.value) {
    emit('submit', {
      ...shared,
      date: slotDate.value,
      ownerName: values.ownerName?.trim() ?? '',
      ownerPhone: values.ownerPhone?.trim() ?? '',
      petName: values.petName.trim(),
      species: values.species?.trim() ?? '',
      ...(templateId.value ? { templateId: templateId.value } : {}),
    });
    return;
  }
  const common = { ...shared, date: props.date, internalNote: values.internalNote, templateId: templateId.value };
  if (mode.value === 'return') {
    if (!selectedPet.value) {
      pickPetError.value = '請先選擇寵物';
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
  <SideDrawer
    :title="title"
    :description="description"
    :close-disabled="submitting"
    :close-label="isEdit ? '取消修改' : '捨棄這筆掛號'"
    :close-on-escape="isEdit"
    @escape="!isEdit && emit('minimize')"
    @close="emit('close')"
  >
    <template v-if="!isEdit" #actions>
      <Button type="button" variant="secondary" size="sm" :disabled="submitting" @click="emit('minimize')">收起，稍後繼續</Button>
    </template>

    <form id="appointment-drawer-form" class="space-y-5" @submit.prevent="onSubmit">
      <template v-if="!isEdit">
        <SegmentedControl v-model="mode" :options="MODE_OPTIONS" aria-label="掛號類型" full-width />

        <div v-if="mode === 'return'" class="space-y-1.5">
          <Label for="drawer-pet-search" class="text-xs font-medium">寵物<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
          <div v-if="selectedPet" class="flex items-center gap-3 rounded-lg border border-primary bg-accent px-3 py-2.5">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-accent-foreground">{{ selectedPet.name }}<span class="ml-2 text-xs font-normal">{{ selectedPet.species || '寵物' }}</span></p>
              <p class="truncate text-xs text-accent-foreground/80">{{ selectedPet.ownerId?.name || '飼主未知' }}<template v-if="selectedPet.ownerId?.phone"> · {{ selectedPet.ownerId.phone }}</template></p>
            </div>
            <Button type="button" variant="secondary" size="sm" @click="selectedPet = null">更換</Button>
          </div>
          <template v-else>
            <div class="relative">
              <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" stroke-width="1.75" aria-hidden="true" />
              <Input id="drawer-pet-search" v-model="petSearch.query.value" autofocus inputmode="search" class="h-11 pl-9" placeholder="寵物名、飼主姓名或電話" autocomplete="off" />
            </div>
            <div v-if="petSearch.query.value.trim()" class="overflow-hidden rounded-lg border border-border" aria-live="polite">
              <p v-if="petSearch.loading.value" class="px-3 py-3 text-xs text-muted-foreground">搜尋中…</p>
              <p v-else-if="petSearch.failed.value" class="px-3 py-3 text-xs text-destructive">搜尋失敗，請稍後再試</p>
              <p v-else-if="!petSearch.results.value.length" class="px-3 py-3 text-xs text-muted-foreground">找不到符合的寵物；第一次來請切到「初診」。</p>
              <button
                v-for="pet in petSearch.results.value"
                v-else
                :key="pet._id"
                type="button"
                class="flex w-full items-center gap-3 border-b border-border bg-card px-3 py-2.5 text-left last:border-b-0 hover:bg-field"
                @click="selectPet(pet)"
              >
                <span class="min-w-0 flex-1 truncate text-sm"><span class="font-semibold text-primary">{{ pet.name }}</span><span class="ml-2 text-xs text-muted-foreground">{{ pet.species || '寵物' }} · {{ pet.ownerId?.name || '飼主未知' }}<template v-if="pet.ownerId?.phone"> · {{ pet.ownerId.phone }}</template></span></span>
              </button>
            </div>
          </template>
          <p v-if="pickPetError" class="text-xs font-medium text-destructive">{{ pickPetError }}</p>
        </div>

        <template v-else>
          <SegmentedControl v-model="ownerMode" :options="OWNER_MODE_OPTIONS" aria-label="飼主類型" full-width />
          <div v-if="ownerMode === 'existing'" class="space-y-1.5">
            <Label for="drawer-owner-search" class="text-xs font-medium">既有飼主<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
            <div v-if="selectedOwner" class="flex items-center gap-3 rounded-lg border border-primary bg-accent px-3 py-2.5">
              <p class="min-w-0 flex-1 truncate text-sm font-semibold text-accent-foreground">{{ selectedOwner.name }}<span class="ml-2 text-xs font-normal">{{ selectedOwner.phone || '未填寫電話' }}</span></p>
              <Button type="button" variant="secondary" size="sm" @click="selectedOwner = null">更換</Button>
            </div>
            <template v-else>
              <div class="relative">
                <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" stroke-width="1.75" aria-hidden="true" />
                <Input id="drawer-owner-search" v-model="ownerSearch.query.value" inputmode="search" class="h-11 pl-9" placeholder="飼主姓名或電話" autocomplete="off" />
              </div>
              <div v-if="ownerSearch.query.value.trim()" class="overflow-hidden rounded-lg border border-border" aria-live="polite">
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
                  <span class="font-semibold text-primary">{{ owner.name }}</span><span class="text-xs text-muted-foreground">{{ owner.phone || '未填寫電話' }}</span>
                </button>
              </div>
            </template>
            <p v-if="pickOwnerError" class="text-xs font-medium text-destructive">{{ pickOwnerError }}</p>
            <p class="text-xs text-muted-foreground">報到時會將新寵物建檔於此飼主名下。</p>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="drawer-pet-name" class="text-xs font-medium">寵物姓名<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
              <Input id="drawer-pet-name" v-model="petName" placeholder="例：妞妞" />
              <p v-if="petNameError" class="text-xs font-medium text-destructive">{{ petNameError }}</p>
            </div>
            <div v-if="ownerMode === 'new'" class="space-y-1.5">
              <Label for="drawer-owner-name" class="text-xs font-medium">飼主姓名</Label>
              <Input id="drawer-owner-name" v-model="ownerName" placeholder="例：王小姐" />
            </div>
          </div>
          <div v-if="ownerMode === 'new'" class="space-y-1.5">
            <Label for="drawer-owner-phone" class="text-xs font-medium">聯絡電話</Label>
            <Input id="drawer-owner-phone" v-model="ownerPhone" placeholder="例：0912-345-678" />
          </div>
        </template>

        <Alert v-for="warning in attendanceWarnings" :key="warning" class="border-warning/35 bg-warning-surface text-warning">
          <AlertDescription>{{ warning }}</AlertDescription>
        </Alert>
      </template>

      <template v-else>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="drawer-edit-pet-name" class="text-xs font-medium">寵物姓名<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
            <Input id="drawer-edit-pet-name" v-model="petName" />
            <p v-if="petNameError" class="text-xs font-medium text-destructive">{{ petNameError }}</p>
          </div>
          <div class="space-y-1.5">
            <Label for="drawer-edit-species" class="text-xs font-medium">物種</Label>
            <Input id="drawer-edit-species" v-model="species" placeholder="例：貓" />
          </div>
          <div class="space-y-1.5">
            <Label for="drawer-edit-owner-name" class="text-xs font-medium">飼主姓名</Label>
            <Input id="drawer-edit-owner-name" v-model="ownerName" />
          </div>
          <div class="space-y-1.5">
            <Label for="drawer-edit-owner-phone" class="text-xs font-medium">聯絡電話</Label>
            <Input id="drawer-edit-owner-phone" v-model="ownerPhone" />
          </div>
        </div>
      </template>

      <div class="space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <Label class="text-xs font-medium">預約時段<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
          <DatePicker v-if="isEdit" v-model="slotDate" :clearable="false" aria-label="預約日期" class="w-44" />
        </div>
        <SlotGrid v-model="time" :sessions="slotSessions" :invalid="submitCount > 0 && Boolean(timeError)" />
        <p v-if="timeError && submitCount > 0" class="text-xs font-medium text-destructive">{{ timeError }}</p>
      </div>

      <div class="space-y-1.5">
        <Label for="drawer-reason" class="text-xs font-medium">來院原因</Label>
        <Input id="drawer-reason" v-model="reason" placeholder="例：打疫苗、回診拿藥、不舒服" />
      </div>

      <div class="flex items-start gap-3">
        <label for="drawer-is-surgery" class="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-sm font-medium">
          <Checkbox id="drawer-is-surgery" v-model="isSurgery" />
          手術
        </label>
        <div class="min-w-0 flex-1 space-y-1">
          <Input v-model="surgeryName" :disabled="!isSurgery" placeholder="手術名稱" aria-label="手術名稱" />
          <p v-if="surgeryNameError" class="text-xs font-medium text-destructive">{{ surgeryNameError }}</p>
        </div>
      </div>
      <div class="space-y-4">
        <div class="space-y-1.5">
          <Label for="drawer-template" class="text-xs font-medium">報告模板</Label>
          <Select v-model="templateId">
            <SelectTrigger id="drawer-template" class="w-full"><SelectValue placeholder="需要時可由醫師選擇" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="template in templates" :key="template._id" :value="template._id">{{ template.name }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div v-if="!isEdit" class="space-y-1.5">
          <Label for="drawer-internal-note" class="text-xs font-medium">內部備註</Label>
          <Textarea id="drawer-internal-note" v-model="internalNote" rows="3" maxlength="2000" placeholder="醫師看診台會帶入同一則內部備註…" />
          <p class="text-xs text-muted-foreground">僅供院內人員查看，可在醫師看診台繼續編輯。</p>
        </div>
      </div>

      <Alert v-if="errorMessage" variant="destructive">
        <AlertDescription>{{ errorMessage }}</AlertDescription>
      </Alert>
    </form>
    <template #footer>
      <p class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{{ summary }}</p>
      <Button type="button" variant="secondary" :disabled="submitting" @click="emit('close')">取消</Button>
      <Button type="submit" form="appointment-drawer-form" :disabled="submitting">{{ submitting ? '處理中…' : isEdit ? '儲存變更' : '確認掛號' }}</Button>
    </template>
  </SideDrawer>
</template>

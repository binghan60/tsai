<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useField, useForm } from 'vee-validate';
import { History, Search, UserPlus, X } from '@lucide/vue';
import { http } from '../api/http';
import SlotGrid from './SlotGrid.vue';
import SegmentedControl from './SegmentedControl.vue';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Alert, AlertDescription } from './ui/alert';
import { DatePicker } from './ui/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { buildSlotGrid, duplicateBookings } from '../lib/receptionBoard';
import { DEFAULT_ESTIMATED_DURATION_MINUTES, MAX_ESTIMATED_DURATION_MINUTES } from '../lib/appointmentTime';
import { clinicDateInput, clinicTimeInput, formatDate, formatDateTime, weekdayLabel } from '../lib/datetime';

// 新增與修改掛號共用的 Modal（取代原本的 AppointmentDrawer 側邊抽屜）。
// 置中雙欄：左欄「誰・為什麼」（類型、寵物、來院原因、手術、報告模板、內部備註），
// 右欄「什麼時候」（日期快選＋時段格）。時段格拿到自己的一欄就不用捲動。
//
// 抽屜改成 Modal 的原因：櫃台頁改成整寬的時間軸後，再從右邊擠一個 576px 的抽屜進來，
// 時間軸卡片右側的狀態與按鈕會被壓壞。「講電話掛到一半飼主走到櫃台前」這件事改由
// 「收起，稍後繼續」承接：整筆收成頁首一顆按鈕（元件仍掛載、內容保留），看板全部露出來。
// Esc 與點遮罩在新增模式也是收起，不是丟掉。
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
  // false＝收起（Modal 關閉但元件留著，填到一半的內容不會消失）
  open: { type: Boolean, default: true },
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
const { value: ownerPhone } = useField('ownerPhone');
const { value: time, errorMessage: timeError } = useField('time', requiredTime);
const { value: estimatedDurationMinutes } = useField('estimatedDurationMinutes');
const { value: reason } = useField('reason');
const { value: internalNote } = useField('internalNote');
const { value: isSurgery } = useField('isSurgery');
const { value: surgeryName, errorMessage: surgeryNameError } = useField('surgeryName', requiredForSurgery);

// ── 寵物／飼主搜尋：直接放在 Modal 裡，不再疊一層選擇對話框 ─────────────────
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

// ── 日期與時段格 ────────────────────────────────────────────────────────────
// 預設是頁面上的日期面板（新增掛號就是今天），換到別天直接在日期選單裡打字或翻日曆；
// 換到頁面沒載入的那天，才自己去抓那天的掛號。
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
const slotItems = computed(() => (slotDate.value === props.date ? props.dayItems : otherDayItems.value ?? []));
const slotSessions = computed(() => buildSlotGrid(slotItems.value, {
  excludeId: props.appointment?._id,
  minTime: slotDate.value === today ? clinicTimeInput(new Date()) : '',
}));
const durationError = computed(() => {
  if (!time.value) return '';
  const start = Number(time.value.slice(0, 2)) * 60 + Number(time.value.slice(3, 5));
  for (const session of slotSessions.value) {
    const sessionStart = Number(session.start.slice(0, 2)) * 60 + Number(session.start.slice(3, 5));
    const sessionEnd = Number(session.end.slice(0, 2)) * 60 + Number(session.end.slice(3, 5)) + 15;
    if (start >= sessionStart && start < sessionEnd) {
      return start + Number(estimatedDurationMinutes.value) <= sessionEnd ? '' : '預估診療時間超出可掛號時段，請縮短時間或改選其他時段';
    }
  }
  return '';
});

function changeDuration(delta) {
  estimatedDurationMinutes.value = Math.min(MAX_ESTIMATED_DURATION_MINUTES, Math.max(15, Number(estimatedDurationMinutes.value) + delta));
}

// 同一隻寵物那天已經有掛號時先提醒——電話裡飼主常忘記早上已經掛過。
const duplicatePetId = computed(() => (isEdit.value ? props.appointment.petId : mode.value === 'return' ? selectedPet.value?._id : null));
const duplicateWarning = computed(() => {
  const found = duplicateBookings(slotItems.value, duplicatePetId.value, props.appointment?._id);
  if (!found.length) return '';
  const name = isEdit.value ? props.appointment.petName : selectedPet.value?.name;
  const when = slotDate.value === today ? '今天' : formatDate(slotDate.value);
  return `${name}${when} ${found.map((item) => item.time).join('、')} 已有掛號${found[0].reason ? `（${found[0].reason}）` : ''}，確認不是重複掛號。`;
});

// ── 送出 ─────────────────────────────────────────────────────────────────
const title = computed(() => (isEdit.value ? `修改掛號：${props.appointment.petName}` : '新增掛號'));
const description = computed(() => (isEdit.value ? '只更新這筆掛號，不會修改飼主或寵物主檔' : '電話掛號可先指定日期與時段，飼主資料報到時再補齊'));
const summary = computed(() => {
  const name = isEdit.value ? petName.value : mode.value === 'return' ? selectedPet.value?.name : petName.value;
  const when = time.value ? `${formatDate(slotDate.value)}（${weekdayLabel(slotDate.value)}）${time.value}` : '';
  return [name, when, `預估 ${estimatedDurationMinutes.value} 分鐘`, reason.value?.trim()].filter(Boolean).join(' · ');
});
// 新增掛號收起來之後，頁首按鈕要叫得出「繼續掛號：豆豆」——只放名字，日期時段放不下。
const draftName = computed(() => (mode.value === 'return' ? selectedPet.value?.name : petName.value?.trim()) || '');
defineExpose({ draftName });

// 新增模式按 Esc／點遮罩是收起不是丟掉；修改模式關掉就是取消修改。
function onOpenChange(value) {
  if (value) return;
  emit(isEdit.value ? 'close' : 'minimize');
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
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent size="wide" class="flex max-h-[92vh] flex-col p-0" :show-close-button="false">
      <header class="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4">
        <div class="min-w-0 flex-1">
          <DialogTitle class="text-base font-semibold">{{ title }}</DialogTitle>
          <DialogDescription class="mt-0.5 text-xs">{{ description }}</DialogDescription>
        </div>
        <Button v-if="!isEdit" type="button" variant="secondary" size="sm" :disabled="submitting" @click="emit('minimize')">收起，稍後繼續</Button>
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
                <Label for="dialog-pet-search" class="text-xs font-medium">寵物<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
                <div v-if="selectedPet" class="flex items-center gap-3 rounded-lg border border-primary bg-accent px-3 py-2.5">
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-semibold text-accent-foreground">{{ selectedPet.name }}<span class="ml-2 text-xs font-normal">{{ [selectedPet.species, selectedPet.breed].filter(Boolean).join(' · ') || '寵物' }}</span></p>
                    <p class="truncate text-xs text-accent-foreground/80">{{ selectedPet.ownerId?.name || '飼主未知' }}<template v-if="selectedPet.ownerId?.phone"> · {{ selectedPet.ownerId.phone }}</template></p>
                  </div>
                  <Button type="button" variant="secondary" size="sm" @click="selectedPet = null">更換</Button>
                </div>
                <template v-else>
                  <div class="relative">
                    <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" stroke-width="1.75" aria-hidden="true" />
                    <Input id="dialog-pet-search" v-model="petSearch.query.value" autofocus inputmode="search" class="h-11 pl-9" placeholder="寵物名、飼主姓名或電話" autocomplete="off" />
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
                  <Label for="dialog-owner-search" class="text-xs font-medium">既有飼主<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
                  <div v-if="selectedOwner" class="flex items-center gap-3 rounded-lg border border-primary bg-accent px-3 py-2.5">
                    <p class="min-w-0 flex-1 truncate text-sm font-semibold text-accent-foreground">{{ selectedOwner.name }}<span class="ml-2 text-xs font-normal">{{ selectedOwner.phone || '未填寫電話' }}</span></p>
                    <Button type="button" variant="secondary" size="sm" @click="selectedOwner = null">更換</Button>
                  </div>
                  <template v-else>
                    <div class="relative">
                      <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" stroke-width="1.75" aria-hidden="true" />
                      <Input id="dialog-owner-search" v-model="ownerSearch.query.value" inputmode="search" class="h-11 pl-9" placeholder="飼主姓名或電話" autocomplete="off" />
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
                    <Label for="dialog-pet-name" class="text-xs font-medium">寵物姓名<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
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
                    <Label for="dialog-owner-phone" class="text-xs font-medium">聯絡電話</Label>
                    <Input id="dialog-owner-phone" v-model="ownerPhone" placeholder="例：0912-345-678" />
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
                  <Label for="dialog-edit-pet-name" class="text-xs font-medium">寵物姓名<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
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
                  <Label for="dialog-edit-owner-phone" class="text-xs font-medium">聯絡電話</Label>
                  <Input id="dialog-edit-owner-phone" v-model="ownerPhone" />
                </div>
              </div>
            </template>

            <div class="space-y-1.5">
              <Label for="dialog-reason" class="text-xs font-medium">來院原因</Label>
              <Input id="dialog-reason" v-model="reason" placeholder="例：打疫苗、回診拿藥、不舒服" />
            </div>

            <!-- 勾了手術整列變淡紫底，跟時間軸上的手術卡片同一套；時段格也會多出手術時段。 -->
            <div class="flex items-start gap-3 rounded-lg border px-3 py-1.5 transition-colors" :class="isSurgery ? 'border-surgery/35 bg-surgery-surface/60' : 'border-transparent'">
              <label for="dialog-is-surgery" class="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-sm font-medium" :class="isSurgery ? 'text-surgery' : ''">
                <Checkbox id="dialog-is-surgery" v-model="isSurgery" />
                手術
              </label>
              <div class="min-w-0 flex-1 space-y-1 py-1">
                <Input v-model="surgeryName" :disabled="!isSurgery" placeholder="手術名稱" aria-label="手術名稱" />
                <p v-if="surgeryNameError" class="text-xs font-medium text-destructive">{{ surgeryNameError }}</p>
              </div>
            </div>

            <div class="space-y-1.5">
              <Label for="dialog-template" class="text-xs font-medium">報告模板</Label>
              <Select v-model="templateId">
                <SelectTrigger id="dialog-template" class="w-full"><SelectValue placeholder="需要時可由醫師選擇" /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="template in templates" :key="template._id" :value="template._id">{{ template.name }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div v-if="!isEdit" class="space-y-1.5">
              <Label for="dialog-internal-note" class="text-xs font-medium">內部備註</Label>
              <Textarea id="dialog-internal-note" v-model="internalNote" rows="3" maxlength="2000" placeholder="僅院內可見，醫師診療台會帶入同一則" />
            </div>
          </div>

          <!-- 右欄：什麼時候 -->
          <div class="space-y-3">
            <div class="space-y-2">
              <Label class="text-xs font-medium">日期與時段<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
              <!-- 預設跟著頁面日期；可一鍵回到今天，其他日子直接在日期選單裡輸入或翻日曆。 -->
              <div class="flex items-center gap-2">
                <DatePicker v-model="slotDate" :clearable="false" aria-label="預約日期" class="min-w-0 flex-1" />
                <Button type="button" class="h-10 shrink-0 px-5 font-semibold shadow-sm" @click="slotDate = today">今天</Button>
              </div>
            </div>
            <div class="space-y-2 rounded-lg border border-border bg-field/40 p-3">
              <div class="flex items-center justify-between gap-3">
                <Label class="text-xs font-medium">預估診療時間</Label>
                <div class="flex items-center gap-2">
                  <Button type="button" variant="secondary" size="sm" class="h-9 min-w-12 px-2 text-xs font-bold shadow-sm" :disabled="estimatedDurationMinutes <= 15" aria-label="減少 15 分鐘" @click="changeDuration(-15)">−</Button>
                  <span class="min-w-16 text-center text-xs font-semibold tabular-nums">{{ estimatedDurationMinutes }} 分鐘</span>
                  <Button type="button" variant="secondary" size="sm" class="h-9 min-w-12 px-2 text-xs font-bold shadow-sm" :disabled="estimatedDurationMinutes >= MAX_ESTIMATED_DURATION_MINUTES" aria-label="增加 15 分鐘" @click="changeDuration(15)">＋</Button>
                </div>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <Button v-for="minutes in [15, 30, 45, 60, 90, 120]" :key="minutes" type="button" size="sm" class="h-9 min-w-12 px-2 text-xs font-semibold shadow-sm" :variant="estimatedDurationMinutes === minutes ? 'default' : 'secondary'" @click="estimatedDurationMinutes = minutes">{{ minutes }}</Button>
              </div>
            </div>
            <SlotGrid v-model="time" :sessions="slotSessions" :duration-minutes="Number(estimatedDurationMinutes)" :invalid="submitCount > 0 && Boolean(timeError || durationError)" />
            <p v-if="timeError && submitCount > 0" class="text-xs font-medium text-destructive">{{ timeError }}</p>
            <p v-if="durationError" class="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{{ durationError }}</p>
            <Alert v-if="duplicateWarning" class="border-warning/35 bg-warning-surface text-warning">
              <AlertDescription>{{ duplicateWarning }}</AlertDescription>
            </Alert>
          </div>
        </div>

        <Alert v-if="errorMessage" variant="destructive" class="mt-4">
          <AlertDescription>{{ errorMessage }}</AlertDescription>
        </Alert>
      </form>

      <footer class="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-5 py-3">
        <p class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{{ summary }}</p>
        <Button type="button" variant="secondary" :disabled="submitting" @click="emit('close')">取消</Button>
        <Button type="submit" form="appointment-dialog-form" :disabled="submitting">{{ submitting ? '處理中…' : isEdit ? '儲存變更' : '掛號' }}</Button>
      </footer>
    </DialogContent>
  </Dialog>
</template>

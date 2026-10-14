<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { Search } from '@lucide/vue';
import { useRouter } from 'vue-router';
import { http } from '../api/http';
import { apiErrorMessage } from '../lib/apiError';
import { clinicDateInput, shortDate, weekdayLabel } from '../lib/datetime';
import ModalDialog from './ModalDialog.vue';
import ListSkeleton from './ListSkeleton.vue';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { DatePicker } from './ui/date-picker';
import { TimePicker } from './ui/time-picker';
import { Alert, AlertDescription } from './ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useCandidateSearch } from '../composables/useCandidateSearch';
import { breedText } from '../lib/petDisplay';

// 「新增健檢」：健檢報告一律從看診建立。一張視窗：頂端選貓（從貓咪頁、貓咪清單進來時已經選好，可以更換；
// 從報告清單進來時先選），下面左欄列這隻貓有看診的掛號（新到舊），已有報告的直接接著填或看，
// 沒有的按「建立報告」（workflow 的 record）；右欄「補登看診」給不在清單上的看診（當天忘了掛號、補建以前的健檢），
// 建立一筆已完成的看診，同時建立報告草稿。
const props = defineProps({
  // 已經知道是哪隻貓時傳進來（{ _id, name, breed, ownerId: { name, phone } }）；沒有就先選。
  pet: { type: Object, default: null },
});
const emit = defineEmits(['close']);
const router = useRouter();

const selectedPet = ref(props.pet);
const petSearch = useCandidateSearch('/pets');
const petSearchInput = ref(null);
function pickPet(pet) {
  selectedPet.value = pet;
  petSearch.query.value = '';
}
async function changePet() {
  selectedPet.value = null;
  await nextTick();
  petSearchInput.value?.$el?.focus?.();
}

const visits = ref([]);
const loading = ref(false);
const error = ref('');
const busyId = ref('');
const templates = ref([]);
const defaultTemplateId = ref('');

const STATUS_LABELS = { arrived: '在院', pending_checkout: '待櫃台處理', completed: '已完成' };

const visitsHeading = ref(null);
// 打開時：已經選好貓就把焦點放在左欄標題（預設會落在補登的日期欄，那裡的滑過提示會蓋住右欄標題）；
// 還沒選就放在選貓的搜尋欄。
function focusStart(event) {
  event.preventDefault();
  if (selectedPet.value) visitsHeading.value?.focus();
  else petSearchInput.value?.$el?.focus?.();
}

onMounted(async () => {
  try {
    const [templateResponse, settingsResponse] = await Promise.all([
      http.get('/settings/form-templates'),
      http.get('/settings/appointment-settings'),
    ]);
    templates.value = (templateResponse.data ?? []).filter((template) => template.enabled !== false);
    defaultTemplateId.value = String(settingsResponse.data?.defaultAppointmentTemplateId ?? templates.value[0]?._id ?? '');
    backfill.value.templateId = defaultTemplateId.value;
  } catch (err) {
    error.value = apiErrorMessage(err, '讀不到健檢表單，請稍後再試');
  }
});

// 換了貓就重讀那隻的看診；慢的回應不蓋掉後來選的貓。
let visitRequest = 0;
watch(() => selectedPet.value?._id, async (petId) => {
  const current = ++visitRequest;
  visits.value = [];
  error.value = '';
  if (!petId) return;
  loading.value = true;
  try {
    const { data } = await http.get('/appointments/visits', { params: { petId } });
    if (current === visitRequest) visits.value = data.items ?? [];
  } catch (err) {
    if (current === visitRequest) error.value = apiErrorMessage(err, '讀不到這隻貓的看診，請稍後再試');
  } finally {
    if (current === visitRequest) loading.value = false;
  }
}, { immediate: true });

function whenLabel(visit) {
  return `${shortDate(visit.date)}（${weekdayLabel(visit.date)}）${visit.time ? ` ${visit.time}` : ''}`;
}

async function createReport(visit) {
  busyId.value = String(visit._id);
  error.value = '';
  try {
    const { data } = await http.post(`/appointments/${visit._id}/workflow/record`, {
      version: visit.__v ?? 0,
      ...(visit.templateId ? {} : { templateId: defaultTemplateId.value }),
    });
    await router.push(`/records/${data.record._id}/edit`);
    emit('close');
  } catch (err) {
    error.value = apiErrorMessage(err, '建立報告失敗，請稍後再試');
  } finally {
    busyId.value = '';
  }
}

function openReport(visit) {
  const path = visit.report.status === 'draft' ? `/records/${visit.report._id}/edit` : `/records/${visit.report._id}/preview`;
  router.push(path);
  emit('close');
}

// 補登看診
const backfill = ref({ date: clinicDateInput(), time: '', reason: '', templateId: '' });
const saving = ref(false);
const backfillError = computed(() => {
  if (!backfill.value.date) return '請選擇看診日期';
  if (backfill.value.date > clinicDateInput()) return '補登只能補今天以前的看診';
  if (!backfill.value.templateId) return '請選擇健檢表單';
  return '';
});
const attempted = ref(false);
const backfillErrorMessage = ref('');

async function submitBackfill() {
  attempted.value = true;
  if (backfillError.value || !selectedPet.value) return;
  saving.value = true;
  backfillErrorMessage.value = '';
  try {
    const { data } = await http.post('/appointments/backfill', { petId: selectedPet.value._id, ...backfill.value });
    await router.push(`/records/${data.record._id}/edit`);
    emit('close');
  } catch (err) {
    backfillErrorMessage.value = apiErrorMessage(err, '補登失敗，請稍後再試');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ModalDialog size="xl" title="新增健檢" @close="emit('close')" @open-auto-focus="focusStart">
    <!-- 頂端選貓：選好的是一條淡主色、右邊「更換」；還沒選是搜尋欄＋候選清單（跟掛號視窗同一套，邊打邊查）。 -->
    <div class="border-b border-border px-6 py-4">
      <div v-if="selectedPet" class="flex items-center gap-3 rounded-lg border border-primary bg-accent px-4 py-2.5">
        <span class="text-sm font-semibold text-accent-foreground">貓咪</span>
        <p class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 text-accent-foreground">
          <span class="text-lg font-semibold">{{ selectedPet.name }}</span>
          <span v-if="selectedPet.breed" class="text-sm">{{ breedText(selectedPet) }}</span>
          <span v-if="selectedPet.ownerId?.name" class="text-sm">{{ selectedPet.ownerId.name }}</span>
          <span v-if="selectedPet.ownerId?.phone" class="num text-sm">{{ selectedPet.ownerId.phone }}</span>
        </p>
        <Button type="button" variant="secondary" size="sm" @click="changePet">更換</Button>
      </div>
      <div v-else class="space-y-2">
        <Label for="new-report-pet-search">貓咪</Label>
        <div class="relative">
          <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" stroke-width="1.75" aria-hidden="true" />
          <Input id="new-report-pet-search" ref="petSearchInput" v-model="petSearch.query.value" inputmode="search" class="pl-9" placeholder="貓咪名、飼主姓名或電話" autocomplete="off" />
        </div>
        <div v-if="petSearch.query.value.trim()" class="max-h-80 overflow-y-auto rounded-lg border border-border" aria-live="polite">
          <p v-if="petSearch.loading.value" class="px-3 py-3 text-sm text-muted-foreground">搜尋中…</p>
          <p v-else-if="petSearch.failed.value" class="px-3 py-3 text-sm text-destructive">搜尋失敗，請稍後再試</p>
          <p v-else-if="!petSearch.results.value.length" class="px-3 py-3 text-sm text-muted-foreground">找不到符合的貓咪</p>
          <button
            v-for="pet in petSearch.results.value"
            v-else
            :key="pet._id"
            type="button"
            class="flex w-full items-center gap-3 border-b border-border bg-card px-3 py-2.5 text-left last:border-b-0 hover:bg-field"
            @click="pickPet(pet)"
          >
            <span class="min-w-0 flex-1 truncate"><span class="font-semibold text-primary">{{ pet.name }}</span><span v-if="pet.breed" class="ml-3 text-sm text-muted-foreground">{{ breedText(pet) }}</span><span v-if="pet.ownerId?.name" class="ml-3 text-sm text-muted-foreground">{{ pet.ownerId.name }}</span><span v-if="pet.ownerId?.phone" class="num ml-3 text-sm text-muted-foreground">{{ pet.ownerId.phone }}</span></span>
          </button>
          <p v-if="petSearch.hiddenCount.value" class="px-3 py-2.5 text-sm text-muted-foreground">還有 <span class="num">{{ petSearch.hiddenCount.value }}</span> 筆沒列出，請多打幾個字縮小範圍。</p>
        </div>
      </div>
    </div>

    <div v-if="selectedPet" class="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <!-- 左欄：這隻貓的看診，新到舊。 -->
      <section class="@container flex min-w-0 flex-col border-b border-border lg:border-r lg:border-b-0" aria-labelledby="new-report-visits">
        <h3 id="new-report-visits" ref="visitsHeading" tabindex="-1" class="px-6 pt-4 pb-2 text-base font-semibold outline-none">選擇看診</h3>
        <ListSkeleton v-if="loading" :rows="4" inset />
        <template v-else>
          <div v-if="visits.length" class="hidden gap-4 border-y border-border bg-sunken px-6 py-2 text-sm font-semibold text-muted-foreground @2xl:grid @2xl:grid-cols-[13.5rem_minmax(0,1fr)_6.5rem_9rem]">
            <span>看診</span><span>來院原因</span><span>看診狀態</span><span></span>
          </div>
          <ul v-if="visits.length" class="max-h-[52vh] divide-y divide-border overflow-y-auto border-t border-border @2xl:border-t-0">
            <li v-for="visit in visits" :key="visit._id" class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-6 py-3 @2xl:grid-cols-[13.5rem_minmax(0,1fr)_6.5rem_9rem]">
              <span class="num col-start-1 font-medium whitespace-nowrap @2xl:row-start-1">{{ whenLabel(visit) }}</span>
              <span class="col-start-1 min-w-0 truncate @2xl:col-start-2 @2xl:row-start-1" :class="visit.reason ? '' : 'hidden @2xl:block'" v-tip.overflow="visit.reason">{{ visit.reason }}</span>
              <span class="col-start-1 text-sm @2xl:col-start-3 @2xl:row-start-1" :class="visit.status === 'completed' ? 'text-muted-foreground' : 'font-semibold text-warning'">{{ STATUS_LABELS[visit.status] }}</span>
              <span class="col-start-2 row-span-3 row-start-1 flex justify-end @2xl:col-start-4 @2xl:row-span-1">
                <Button v-if="visit.report?.status === 'draft'" type="button" variant="soft" size="sm" @click="openReport(visit)">繼續填寫草稿</Button>
                <Button v-else-if="visit.report" type="button" variant="secondary" size="sm" @click="openReport(visit)">查看報告</Button>
                <Button v-else type="button" variant="soft" size="sm" :disabled="Boolean(busyId)" @click="createReport(visit)">{{ busyId === String(visit._id) ? '建立中…' : '建立報告' }}</Button>
              </span>
            </li>
          </ul>
          <p v-else class="px-6 py-10 text-center text-muted-foreground">這隻貓還沒有看診紀錄</p>
        </template>
        <div v-if="error" class="px-6 py-3"><Alert variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert></div>
      </section>

      <!-- 右欄：要寫的看診不在左邊就補登一筆。 -->
      <form class="flex flex-col bg-sunken/50" aria-labelledby="new-report-backfill" @submit.prevent="submitBackfill">
        <h3 id="new-report-backfill" class="px-6 pt-4 pb-2 text-base font-semibold">補登看診</h3>
        <div class="grid flex-1 content-start gap-4 px-6 pb-4 sm:grid-cols-2 lg:grid-cols-1">
          <div class="space-y-1.5">
            <Label for="backfill-date">看診日期<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
            <DatePicker id="backfill-date" v-model="backfill.date" aria-label="看診日期" />
          </div>
          <div class="space-y-1.5">
            <Label for="backfill-time">時間</Label>
            <TimePicker id="backfill-time" v-model="backfill.time" placeholder="時間" aria-label="看診時間" />
          </div>
          <div class="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label for="backfill-reason">來院原因</Label>
            <Input id="backfill-reason" v-model="backfill.reason" maxlength="500" placeholder="例：年度健檢、皮膚複診" />
          </div>
          <div class="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label for="backfill-template">健檢表單<span class="text-danger" aria-hidden="true">*</span><span class="sr-only">必填</span></Label>
            <Select v-model="backfill.templateId">
              <SelectTrigger id="backfill-template" class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="template in templates" :key="template._id" :value="String(template._id)">{{ template.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p v-if="attempted && backfillError" class="text-sm font-medium text-destructive sm:col-span-2 lg:col-span-1">{{ backfillError }}</p>
          <Alert v-if="backfillErrorMessage" variant="destructive" class="sm:col-span-2 lg:col-span-1"><AlertDescription>{{ backfillErrorMessage }}</AlertDescription></Alert>
        </div>
        <div class="flex justify-end border-t border-border px-6 py-4">
          <Button type="submit" variant="soft" :disabled="saving || loading">{{ saving ? '補登中…' : '補登並建立報告' }}</Button>
        </div>
      </form>
    </div>
  </ModalDialog>
</template>

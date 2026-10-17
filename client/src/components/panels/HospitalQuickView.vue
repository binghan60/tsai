<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ArrowRight, ChevronDown, Plus } from '@lucide/vue';
import { http } from '../../api/http';
import { useLiveReload } from '../../composables/useLiveReload';
import { apiErrorMessage } from '../../lib/apiError';
import { clinicTimeInput, shortDate } from '../../lib/datetime';
import { daySections, filledFields, shortDateTime, STAFF_LABELS, stayDays, weightTrend } from '../../lib/hospitalization';
import { instrumentLabel } from '../../lib/labResults';
import { effectiveAssays, labFlag } from '../../../../shared/labValues.js';
import SidePanel from './SidePanel.vue';
import PatientLink from '../PatientLink.vue';
import StrayBadge from '../StrayBadge.vue';
import SpecGrid from '../SpecGrid.vue';
import SpecCell from '../SpecCell.vue';
import RichText from '../RichText.vue';
import HospitalTimelineRow from '../HospitalTimelineRow.vue';
import LabResultGroups from '../LabResultGroups.vue';
import ListSkeleton from '../ListSkeleton.vue';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

// 住院速覽：掛號台點「住院中」一列打開。櫃台接飼主電話問「牠今天怎麼樣」時，不離開掛號台就能看：
// 第幾天、體重變化、照護紀錄（最新的一天展開、其餘收著）、檢驗結果。只看不改，要記一筆或修改到住院專區。
const props = defineProps({
  hospitalizationId: { type: String, required: true },
});
const emit = defineEmits(['close']);

const detail = ref(null);
const loading = ref(true);
const error = ref('');
const labResults = ref([]);
let request = 0;

async function load({ silent = false } = {}) {
  const token = ++request;
  if (!silent) {
    loading.value = true;
    error.value = '';
  }
  try {
    const { data } = await http.get(`/hospitalizations/${props.hospitalizationId}`);
    if (token === request) {
      detail.value = data;
      error.value = '';
    }
  } catch (err) {
    if (token === request && !silent) error.value = err.response?.status === 404 ? '找不到這筆住院紀錄，可能已被刪除。' : apiErrorMessage(err, '住院紀錄暫時無法載入，請稍後重試');
  } finally {
    if (token === request && !silent) loading.value = false;
  }
}

async function loadLabs() {
  try {
    const { data } = await http.get('/lab-results', { params: { hospitalizationId: props.hospitalizationId } });
    labResults.value = data.items ?? [];
  } catch {
    // 讀不到就維持原樣；下一次有結果進來會再讀。
  }
}

useLiveReload(() => load({ silent: true }), {
  events: ['hospitalization:updated', 'patients:updated'],
  match: (event, payload) => event !== 'hospitalization:updated' || String(payload?._id ?? '') === props.hospitalizationId,
});
useLiveReload(loadLabs, { events: ['lab-results:updated'] });
onMounted(() => {
  load();
  loadLabs();
});

const pet = computed(() => detail.value?.pet ?? null);
const status = computed(() => detail.value?.status ?? '');
const admitted = computed(() => status.value === 'admitted');
const dates = computed(() => detail.value?.dates ?? []);
const dayNumber = computed(() => stayDays(detail.value?.admittedAt, detail.value?.dischargedAt ?? new Date()));
const weights = computed(() => weightTrend(detail.value?.admittingAppointment?.weightKg, detail.value?.entries));
const sections = computed(() => daySections(dates.value, detail.value?.entries));

// 照護紀錄：最新的一天預設展開，其他天點了才展開（使用者點過的以點過的為準）。
const toggled = reactive({});
function isOpen(day, index) {
  return day.date in toggled ? toggled[day.date] : index === 0;
}
function toggleDay(day, index) {
  toggled[day.date] = !isOpen(day, index);
}

const expandedLab = ref('');
// API 是舊到新；這裡新到舊，最近驗的在上面（跟住院專區一樣）。
const labRows = computed(() => [...labResults.value].reverse().map((result) => {
  const { purpose, name } = instrumentLabel(result.instrument);
  return {
    id: String(result._id),
    result,
    time: shortDateTime(result.runAt),
    title: purpose || name,
    abnormal: effectiveAssays(result).filter((assay) => labFlag(assay)).length,
  };
}));
</script>

<template>
  <SidePanel title="住院速覽" @close="emit('close')">
    <ListSkeleton v-if="loading" :rows="3" inset />
    <Alert v-else-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

    <div v-else-if="detail" class="space-y-5">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-base font-semibold"><PatientLink :pet-id="pet?._id">{{ pet?.name }}</PatientLink></span>
        <StrayBadge v-if="pet?.isStray" />
        <Badge v-if="admitted" variant="status" class="bg-info-surface text-info">住院中　第 <span class="num">{{ dayNumber }}</span> 天</Badge>
        <span v-else-if="status === 'discharged'" class="text-sm font-semibold text-success">已出院</span>
        <span v-else-if="status === 'cancelled'" class="text-sm text-muted-foreground">已取消</span>
      </div>

      <!-- 包一層：SpecGrid 自己的負邊距會吃掉 space-y 給的間距。 -->
      <div>
        <SpecGrid>
          <SpecCell label="飼主"><PatientLink v-if="pet?.ownerId?.name" :pet-id="pet._id" quiet>{{ pet.ownerId.name }}</PatientLink></SpecCell>
          <SpecCell label="入院" mono>{{ shortDateTime(detail.admittedAt) }}</SpecCell>
          <SpecCell v-if="detail.dischargedAt" label="出院" mono>{{ shortDateTime(detail.dischargedAt) }}</SpecCell>
        </SpecGrid>
      </div>

      <div class="space-y-0.5">
        <span class="spec-label">住院原因</span>
        <p class="min-h-lh text-base whitespace-pre-wrap wrap-anywhere">{{ detail.reason }}</p>
      </div>

      <section v-if="weights.length" class="space-y-2" aria-labelledby="hospital-quick-weight">
        <h3 id="hospital-quick-weight" class="text-base font-semibold">體重</h3>
        <div class="grid grid-cols-3 gap-2">
          <div v-for="row in weights" :key="row.key" class="rounded-lg bg-sunken px-3 py-2">
            <span class="num block text-xs text-muted-foreground">{{ row.label }}</span>
            <span class="num text-base font-semibold">{{ row.kg }}</span><span class="text-sm text-muted-foreground"> kg</span>
            <span v-if="row.delta" class="num ml-1.5 text-sm text-subtle-foreground">{{ row.delta }}</span>
          </div>
        </div>
      </section>

      <section v-for="(day, index) in sections" :key="day.date" class="space-y-2" :aria-label="`${shortDate(day.date)} 照護紀錄`">
        <button
          type="button"
          class="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-border"
          :aria-expanded="isOpen(day, index)"
          @click="toggleDay(day, index)"
        >
          <ChevronDown class="size-5 shrink-0 text-subtle-foreground transition-transform" :class="isOpen(day, index) ? '' : '-rotate-90'" stroke-width="1.75" aria-hidden="true" />
          <span class="text-base font-semibold"><span class="num">{{ shortDate(day.date) }}</span>　第 <span class="num">{{ day.dayNumber }}</span> 天</span>
          <span v-if="day.entries.length" class="ml-auto text-sm text-subtle-foreground"><span class="num">{{ day.entries.length }}</span> 筆</span>
        </button>
        <div v-if="isOpen(day, index) && day.entries.length" class="flex flex-col">
          <HospitalTimelineRow v-for="entry in day.entries" :key="entry._id" :time="clinicTimeInput(entry.recordedAt)" :staff="STAFF_LABELS[entry.staff] ?? ''">
            <dl class="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-2 gap-y-1 rounded-xl border border-border bg-card px-4 py-2.5">
              <template v-for="field in filledFields(entry)" :key="field.key">
                <dt class="pt-0.5 text-sm text-muted-foreground">{{ field.label }}</dt>
                <dd class="min-w-0 text-base wrap-break-word whitespace-pre-wrap" :class="field.mono ? 'num' : ''">
                  <RichText v-if="field.rich" :text="field.value" />
                  <template v-else>{{ field.value }}</template>
                </dd>
              </template>
            </dl>
          </HospitalTimelineRow>
        </div>
      </section>

      <section v-if="labRows.length" class="space-y-2" aria-labelledby="hospital-quick-lab">
        <h3 id="hospital-quick-lab" class="text-base font-semibold">檢驗結果</h3>
        <div v-for="row in labRows" :key="row.id" class="overflow-hidden rounded-lg bg-sunken">
          <button
            type="button"
            class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-border"
            :aria-expanded="expandedLab === row.id"
            @click="expandedLab = expandedLab === row.id ? '' : row.id"
          >
            <span class="num">{{ row.time }}</span>
            <span class="min-w-0 truncate">{{ row.title }}</span>
            <Badge v-if="row.abnormal" variant="status" class="ml-auto bg-danger-surface text-danger">異常 <span class="num">{{ row.abnormal }}</span> 項</Badge>
            <ChevronDown class="size-4 shrink-0 text-muted-foreground transition-transform" :class="[row.abnormal ? '' : 'ml-auto', expandedLab === row.id ? 'rotate-180' : '']" stroke-width="1.75" aria-hidden="true" />
          </button>
          <div v-if="expandedLab === row.id" class="border-t border-border px-3 py-2">
            <LabResultGroups :results="[row.result]" dense />
          </div>
        </div>
      </section>
    </div>

    <template v-if="detail" #footer>
      <Button as-child variant="secondary"><router-link :to="`/hospital/${hospitalizationId}`">住院專區<ArrowRight stroke-width="1.75" /></router-link></Button>
      <Button v-if="admitted" as-child variant="soft"><router-link :to="{ path: `/hospital/${hospitalizationId}`, query: { new: '1' } }"><Plus stroke-width="1.75" />記一筆</router-link></Button>
    </template>
  </SidePanel>
</template>

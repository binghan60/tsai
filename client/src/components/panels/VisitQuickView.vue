<script setup>
import { computed, onActivated, onBeforeUnmount, onMounted, ref } from 'vue';
import { ArrowRight, Check } from '@lucide/vue';
import { http } from '../../api/http';
import { getSocket } from '../../api/socket';
import { useLiveReload } from '../../composables/useLiveReload';
import { useUtilityPanelStore } from '../../stores/utilityPanel';
import { apiErrorMessage } from '../../lib/apiError';
import { shortDate } from '../../lib/datetime';
import { visitMilestones } from '../../lib/visitProgress';
import SidePanel from './SidePanel.vue';
import CheckinNumber from '../CheckinNumber.vue';
import PatientLink from '../PatientLink.vue';
import StrayBadge from '../StrayBadge.vue';
import HospitalBadge from '../HospitalBadge.vue';
import SurgeryBadge from '../SurgeryBadge.vue';
import SpecGrid from '../SpecGrid.vue';
import SpecCell from '../SpecCell.vue';
import RichText from '../RichText.vue';
import VisitLabTable from '../VisitLabTable.vue';
import ListSkeleton from '../ListSkeleton.vue';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

// 看診速覽：櫃台在掛號台看在院的這一筆走到哪一步、醫師寫了什麼（送交櫃台之前櫃台就能先看）。
// 只看不改——送交櫃台前看診內容是醫師的，櫃台要改的在處理視窗。
// 醫師在診療台自動存檔時伺服器把整筆掛號推到當天的房間（掛號台已經加入），收到同一筆就直接換上。
const props = defineProps({
  appointmentId: { type: String, required: true },
});
const emit = defineEmits(['close']);
const panel = useUtilityPanelStore();

const appointment = ref(null);
const loading = ref(true);
const error = ref('');
const now = ref(Date.now());
let request = 0;
let clock;

async function load({ silent = false } = {}) {
  const token = ++request;
  if (!silent) {
    loading.value = true;
    error.value = '';
  }
  try {
    const { data } = await http.get(`/appointments/${props.appointmentId}`);
    if (token === request) {
      appointment.value = data;
      error.value = '';
    }
  } catch (err) {
    if (token === request && !silent) error.value = err.response?.status === 404 ? '找不到這筆掛號，可能已被刪除。' : apiErrorMessage(err, '看診內容暫時無法載入，請稍後重試');
  } finally {
    if (token === request && !silent) loading.value = false;
  }
}

function onAppointmentUpdate(item) {
  if (String(item?._id) !== props.appointmentId) return;
  if ((item.__v ?? 0) < (appointment.value?.__v ?? 0)) return;
  request += 1;
  appointment.value = item;
  loading.value = false;
  error.value = '';
}

// 斷線重連時補讀一次（斷線期間的推播收不到）。
useLiveReload(() => load({ silent: true }));
const socket = getSocket();
onMounted(() => {
  load();
  socket.on('appointment:updated', onAppointmentUpdate);
  clock = setInterval(() => {
    now.value = Date.now();
  }, 30000);
});
// 面板在 KeepAlive 裡：關掉再打開同一筆是同一個實例、不會再 mounted。關著的期間可能離開過掛號台或換過日期
// （不在那一天的房間、收不到推播），所以每次重新打開都靜默重讀一次。第一次打開 mounted 已經讀了，跳過。
let activatedOnce = false;
onActivated(() => {
  if (activatedOnce) load({ silent: true });
  activatedOnce = true;
});
onBeforeUnmount(() => {
  request += 1;
  socket.off('appointment:updated', onAppointmentUpdate);
  clearInterval(clock);
});

const steps = computed(() => visitMilestones(appointment.value, new Date(now.value)));
const careNote = computed(() => appointment.value?.specialCareNote?.trim() ?? '');
const consoleLink = computed(() => (appointment.value ? { path: '/appointments', query: { date: appointment.value.date, open: appointment.value._id } } : null));
const hasValue = (value) => value !== null && value !== undefined && value !== '';
</script>

<template>
  <SidePanel title="看診速覽" @close="emit('close')">
    <ListSkeleton v-if="loading" :rows="3" inset />
    <Alert v-else-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

    <div v-else-if="appointment" class="space-y-5">
      <div class="flex items-start gap-3">
        <CheckinNumber :appointment="appointment" />
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-base font-semibold"><PatientLink :pet-id="appointment.petId">{{ appointment.petName }}</PatientLink></span>
            <Badge v-if="appointment.visitType === 'new'" variant="status" class="bg-info-surface text-info">初診</Badge>
            <StrayBadge v-if="appointment.isStray" />
            <HospitalBadge v-if="appointment.hospitalizationId" />
            <SurgeryBadge v-if="appointment.isSurgery" :name="appointment.surgeryName" />
          </div>
          <p class="min-h-lh text-base wrap-anywhere">{{ appointment.reason }}</p>
        </div>
      </div>

      <!-- 四個里程碑：走過的打勾、現在這一步主色空心圈＋經過多久、還沒到的灰圈。 -->
      <ol class="grid grid-cols-4" aria-label="看診進度">
        <li v-for="(step, index) in steps" :key="step.key" class="relative flex flex-col items-center gap-1 text-center" :aria-current="step.state === 'active' ? 'step' : undefined">
          <span v-if="index < steps.length - 1" class="absolute top-3.5 left-1/2 h-0.5 w-full" :class="steps[index + 1].state === 'pending' ? 'bg-border-strong' : 'bg-primary'" aria-hidden="true"></span>
          <span
            class="relative flex size-7 items-center justify-center rounded-full"
            :class="step.state === 'done' ? 'bg-primary text-primary-foreground' : step.state === 'active' ? 'bg-card shadow-[inset_0_0_0_3px_var(--primary)]' : 'bg-card shadow-[inset_0_0_0_2px_var(--border-strong)]'"
            aria-hidden="true"
          >
            <Check v-if="step.state === 'done'" class="size-4" stroke-width="2.5" />
            <span v-else-if="step.state === 'active'" class="size-2.5 rounded-full bg-primary"></span>
          </span>
          <span class="text-xs font-semibold" :class="step.state === 'active' ? 'text-primary' : step.state === 'pending' ? 'text-subtle-foreground' : 'text-foreground'">{{ step.label }}</span>
          <span class="num min-h-lh text-xs text-muted-foreground">{{ step.time }}</span>
          <span v-if="step.elapsed" class="num text-xs text-muted-foreground">{{ step.elapsed }}</span>
        </li>
      </ol>

      <!-- 包一層：SpecGrid 自己的負邊距會吃掉 space-y 給的間距。 -->
      <div>
        <SpecGrid>
          <SpecCell label="飼主"><PatientLink v-if="appointment.ownerName" :pet-id="appointment.petId" quiet>{{ appointment.ownerName }}</PatientLink></SpecCell>
          <SpecCell v-if="appointment.ownerPhone" label="電話" mono><a :href="`tel:${appointment.ownerPhone}`" class="text-primary">{{ appointment.ownerPhone }}</a></SpecCell>
          <SpecCell v-if="appointment.walkInAt" label="預約">{{ shortDate(appointment.date) }} 現場</SpecCell>
          <SpecCell v-else label="預約" mono>{{ shortDate(appointment.date) }} {{ appointment.time || '' }}</SpecCell>
        </SpecGrid>
      </div>

      <!-- 有內容才用警示底（跟處理視窗同一套：「有橘色＝要講」）；空的照畫格子、灰底留白。 -->
      <section class="space-y-2" aria-labelledby="visit-quick-care">
        <h3 id="visit-quick-care" class="text-base font-semibold text-warning">請轉告飼主</h3>
        <p class="min-h-[calc(1lh+1.5rem)] rounded-xl px-4 py-3 text-base leading-relaxed font-medium whitespace-pre-wrap wrap-anywhere" :class="careNote ? 'bg-warning-surface text-warning' : 'bg-sunken'">{{ appointment.specialCareNote }}</p>
      </section>

      <section class="space-y-2" aria-labelledby="visit-quick-note">
        <h3 id="visit-quick-note" class="text-base font-semibold">本次簡易紀錄</h3>
        <div class="px-4">
          <SpecGrid>
            <SpecCell label="體重" mono><template v-if="hasValue(appointment.weightKg)">{{ appointment.weightKg }} kg</template></SpecCell>
            <SpecCell label="體溫" mono><template v-if="hasValue(appointment.temperatureC)">{{ appointment.temperatureC }} °C</template></SpecCell>
          </SpecGrid>
        </div>
        <RichText class="min-h-[calc(1lh+1.5rem)] rounded-xl bg-sunken px-4 py-3 text-base leading-relaxed wrap-anywhere" :text="appointment.visitNote || ''" />
      </section>

      <section v-if="appointment.petId" class="space-y-2" aria-labelledby="visit-quick-lab">
        <h3 id="visit-quick-lab" class="text-base font-semibold">檢驗報告</h3>
        <VisitLabTable :appointment="appointment" />
      </section>

      <!-- 收了住院的看診不寫藥單（院內用藥記在住院紀錄）。 -->
      <section v-if="!appointment.hospitalizationId" class="space-y-2" aria-labelledby="visit-quick-rx">
        <h3 id="visit-quick-rx" class="text-base font-semibold">藥單</h3>
        <RichText class="min-h-[calc(1lh+1.5rem)] rounded-xl bg-sunken px-4 py-3 text-base leading-relaxed wrap-anywhere" :text="appointment.prescription || ''" />
      </section>

      <section class="space-y-2" aria-labelledby="visit-quick-followup">
        <h3 id="visit-quick-followup" class="text-base font-semibold">回診建議</h3>
        <p class="min-h-[calc(1lh+1.5rem)] rounded-xl bg-sunken px-4 py-3 text-base leading-relaxed whitespace-pre-wrap wrap-anywhere">{{ appointment.followUpRecommendation }}</p>
      </section>

      <section class="space-y-2" aria-labelledby="visit-quick-internal">
        <h3 id="visit-quick-internal" class="text-base font-semibold">內部備註</h3>
        <p class="min-h-[calc(1lh+1.5rem)] rounded-xl bg-sunken px-4 py-3 text-base leading-relaxed whitespace-pre-wrap wrap-anywhere">{{ appointment.internalNote }}</p>
      </section>
    </div>

    <template v-if="appointment" #footer>
      <Button v-if="appointment.hospitalizationId" variant="secondary" @click="panel.openHospital(appointment.hospitalizationId)">住院紀錄</Button>
      <Button v-if="appointment.petId" as-child variant="secondary"><router-link :to="`/pets/${appointment.petId}`">完整病歷</router-link></Button>
      <Button as-child variant="soft"><router-link :to="consoleLink">到診療台<ArrowRight stroke-width="1.75" /></router-link></Button>
    </template>
  </SidePanel>
</template>

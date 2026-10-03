<script setup>
import { computed, onActivated, onMounted, ref, watch } from 'vue';
import { FlaskConical, Search } from '@lucide/vue';
import { http } from '../../api/http';
import { useToast } from '../../composables/useToast';
import { formatDateTime } from '../../lib/datetime';
import { bridgeStatusLine, fillMessage, instrumentLabel, visitStatusLabel } from '../../lib/labResults';
import { labFlag } from '../../../../shared/labValues.js';
import { useUtilityPanelStore } from '../../stores/utilityPanel';
import { useWorkCountsStore } from '../../stores/workCounts';
import SidePanel from './SidePanel.vue';
import EmptyState from '../EmptyState.vue';
import ListSkeleton from '../ListSkeleton.vue';
import ConfirmDialog from '../ConfirmDialog.vue';
import PetPickerDialog from '../PetPickerDialog.vue';
import { Alert, AlertDescription } from '../ui/alert';
import { Button } from '../ui/button';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';

// IDEXX 檢驗結果的待確認清單：認不出是哪隻貓的結果（IDEXX 主機上手打名字、沒帶系統的貓咪編號）放在這裡，
// 人選一下是哪隻貓，就照自動填入的規則填進那隻貓當天的健檢報告（見 docs/IDEXX_INTERLINK.md）。
// 點一筆推入確認畫面；候選是檢驗當天的掛號，同名而且只有一隻就預先選好。
const panel = useUtilityPanelStore();
const counts = useWorkCountsStore();
const toast = useToast();
const items = ref([]);
const loading = ref(true);
const error = ref('');
const busy = ref(false);
const selectedPetId = ref('');
// 從「搜尋其他貓咪」選來的貓，不在當天的掛號候選裡。
const pickedPet = ref(null);
const pickerOpen = ref(false);
const dismissing = ref(false);

const view = computed(() => (panel.stacks.lab || []).at(-1) || null);
const current = computed(() => items.value.find((item) => String(item._id) === view.value?.id) ?? null);
const options = computed(() => {
  const candidates = (current.value?.candidates ?? []).map((candidate) => ({
    petId: String(candidate.petId),
    petName: candidate.petName,
    ownerName: candidate.ownerName,
    detail: [candidate.time, visitStatusLabel(candidate.status)].filter(Boolean).join('　'),
    sameName: candidate.sameName,
  }));
  if (pickedPet.value && !candidates.some((option) => option.petId === String(pickedPet.value._id))) {
    candidates.push({ petId: String(pickedPet.value._id), petName: pickedPet.value.name, ownerName: pickedPet.value.ownerId?.name ?? '', detail: '搜尋選的', sameName: false });
  }
  return candidates;
});
const selectedName = computed(() => options.value.find((option) => option.petId === selectedPetId.value)?.petName ?? '');

async function refresh() {
  try {
    const { data } = await http.get('/lab-results', { params: { limit: 50 } });
    items.value = data.items || [];
    error.value = '';
  } catch {
    error.value = '檢驗結果載入失敗，請重試。';
  } finally {
    loading.value = false;
  }
}

function idexxOwner(item) {
  return [item.client?.firstName, item.client?.lastName].filter(Boolean).join(' ');
}

function suggestion(item) {
  return item.candidates?.find((candidate) => candidate.suggested) ?? null;
}

function range(assay) {
  const min = assay.referenceMin;
  const max = assay.referenceMax;
  if (min == null && max == null) return '';
  return `${min ?? ''}–${max ?? ''}`;
}

function openItem(item) {
  panel.push({ type: 'confirm', id: String(item._id) }, 'lab');
}

// 換一筆就重選；同一筆因為即時更新重讀時不要把使用者選到一半的蓋掉。
watch(() => view.value?.id, () => {
  selectedPetId.value = '';
  pickedPet.value = null;
});
watch(current, (item) => {
  if (item && !selectedPetId.value) selectedPetId.value = String(suggestion(item)?.petId ?? '');
}, { immediate: true });

function onPick(pet) {
  pickedPet.value = pet;
  selectedPetId.value = String(pet._id);
  pickerOpen.value = false;
}

function afterChange() {
  refresh();
  counts.loadLabResults();
}

async function undo(id, petName) {
  try {
    const { data } = await http.post(`/lab-results/${id}/unmatch`);
    const kept = data.kept?.length ? `；${data.kept.join('、')} 已經被改過，保留下來` : '';
    toast.addToast({ type: 'success', title: '已復原', message: `已從${petName}的報告拿掉 IDEXX 的數值，結果回到待確認${kept}`, duration: 5000 });
  } catch (err) {
    toast.error(err.response?.data?.message || '復原失敗，請稍後再試');
  } finally {
    afterChange();
  }
}

async function confirmMatch() {
  const item = current.value;
  const petId = selectedPetId.value;
  const petName = selectedName.value;
  if (!item || !petId || busy.value) return;
  busy.value = true;
  try {
    const { data } = await http.post(`/lab-results/${item._id}/match`, { petId });
    const { type, message } = fillMessage(data.fill, petName);
    toast.addToast({
      type,
      title: type === 'error' ? '填入失敗' : '已確認',
      message,
      action: { label: '復原', handler: () => undo(item._id, petName) },
    });
    panel.back();
  } catch (err) {
    toast.error(err.response?.data?.message || '確認失敗，請稍後再試');
  } finally {
    busy.value = false;
    afterChange();
  }
}

async function confirmDismiss() {
  const item = current.value;
  if (!item || busy.value) return;
  busy.value = true;
  try {
    await http.post(`/lab-results/${item._id}/dismiss`);
    toast.success('這份檢驗結果不會填進任何報告', '已忽略');
    dismissing.value = false;
    panel.back();
  } catch (err) {
    toast.error(err.response?.data?.message || '忽略失敗，請稍後再試');
  } finally {
    busy.value = false;
    afterChange();
  }
}

// 診所電腦上抓檔程式的狀態（每分鐘由 useGlobalChat 重讀；打開面板時再讀一次，看到的才是最新的）。
// 從來沒有回報過（診所還沒裝）就不顯示。
// 使用者要求做成燈號（綠／黃／紅），滑過去才顯示詳細資訊，不要佔一整列。
const BRIDGE_LIGHTS = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' };
const bridgeLights = computed(() => counts.bridges.map((bridge) => {
  const line = bridgeStatusLine(bridge);
  return { id: bridge.bridgeId, tone: line.tone, tip: `${line.text}　${line.detail}` };
}));

function refreshAll() {
  refresh();
  counts.loadBridges();
}

// 工具欄上的數字變了（新結果進來、別台處理掉）就重讀清單。
watch(() => counts.labResults, refresh);
onMounted(refreshAll);
onActivated(refreshAll);
</script>

<template>
  <!-- KeepAlive 底下的根節點要是普通元素（見 IntakePanel.vue）。 -->
  <div class="h-full min-h-0">
    <SidePanel
      v-if="view?.type === 'confirm'"
      title="確認檢驗結果"
      :can-back="true"
      back-label="返回檢驗結果清單"
      flush
      @back="panel.back()"
      @close="panel.close()"
    >
      <ListSkeleton v-if="loading" :rows="3" inset />
      <EmptyState v-else-if="!current" :icon="FlaskConical" title="這份檢驗結果已經處理掉了" inset />
      <template v-else>
        <div class="space-y-1 border-b border-border px-5 py-4">
          <p class="flex items-baseline gap-2">
            <span class="text-lg font-semibold">{{ instrumentLabel(current.instrument).purpose }}</span>
            <span class="text-sm text-muted-foreground">{{ instrumentLabel(current.instrument).name }}</span>
            <span class="num ml-auto text-sm text-muted-foreground">{{ formatDateTime(current.runAt) }}</span>
          </p>
          <p class="text-sm text-muted-foreground">
            IDEXX 上的名字：<span class="font-medium text-foreground">{{ current.patient?.name }}</span>
            <template v-if="idexxOwner(current)">　飼主：<span class="text-foreground">{{ idexxOwner(current) }}</span></template>
          </p>
        </div>

        <section class="space-y-3 border-b border-border px-5 py-4" aria-labelledby="lab-match-title">
          <h3 id="lab-match-title" class="text-sm font-semibold">是哪一隻？<span class="font-normal text-muted-foreground">（檢驗當天的掛號）</span></h3>
          <RadioGroup v-if="options.length" v-model="selectedPetId" aria-labelledby="lab-match-title" class="gap-1.5">
            <label
              v-for="option in options"
              :key="option.petId"
              class="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors"
              :class="selectedPetId === option.petId ? 'border-primary bg-accent' : 'border-border hover:bg-hover'"
            >
              <RadioGroupItem :value="option.petId" />
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2">
                  <span class="truncate text-base font-semibold">{{ option.petName }}</span>
                  <span v-if="option.sameName" class="rounded-md bg-info-surface px-1.5 text-xs font-medium text-info">同名</span>
                </span>
                <span class="flex gap-3 text-sm text-muted-foreground">
                  <span class="truncate">{{ option.ownerName }}</span>
                  <span class="num shrink-0">{{ option.detail }}</span>
                </span>
              </span>
            </label>
          </RadioGroup>
          <p v-else class="text-sm text-muted-foreground">檢驗當天沒有掛號，請用搜尋找貓咪。</p>
          <Button variant="secondary" size="sm" @click="pickerOpen = true"><Search stroke-width="1.75" />搜尋其他貓咪</Button>
        </section>

        <section class="px-5 py-4" aria-labelledby="lab-values-title">
          <h3 id="lab-values-title" class="mb-2 text-sm font-semibold">檢驗數值</h3>
          <table class="w-full text-sm">
            <tbody class="divide-y divide-border">
              <tr v-for="assay in current.assays" :key="assay.code">
                <th scope="row" class="num py-1.5 pr-3 text-left font-medium text-muted-foreground">{{ assay.code }}</th>
                <td class="py-1.5 pr-3">
                  <span class="num">{{ assay.value }}</span>
                  <span v-if="assay.unit" class="ml-1 text-muted-foreground">{{ assay.unit }}</span>
                  <span v-if="labFlag(assay)" class="ml-1 font-bold text-danger">{{ labFlag(assay) }}</span>
                </td>
                <td class="num py-1.5 text-right text-subtle-foreground">{{ range(assay) }}</td>
              </tr>
            </tbody>
          </table>
          <ul v-if="current.notes?.length" class="mt-3 space-y-1.5 text-sm text-muted-foreground">
            <li v-for="(note, index) in current.notes" :key="index">{{ note }}</li>
          </ul>
        </section>
      </template>

      <template v-if="current" #footer>
        <div class="flex w-full items-center gap-2">
          <Button variant="secondary" :disabled="busy" @click="dismissing = true">忽略</Button>
          <Button variant="soft" class="ml-auto" :disabled="busy || !selectedPetId" @click="confirmMatch">
            確認{{ selectedName ? `是${selectedName}` : '' }}並填入
          </Button>
        </div>
      </template>
    </SidePanel>

    <SidePanel v-else title="檢驗" description="選好是哪隻貓，就會填進健檢報告" flush @close="panel.close()">
      <template v-if="bridgeLights.length" #actions>
        <!-- 燈號外面留 36px 的感應範圍，滑鼠才好停；tabindex 讓鍵盤也看得到提示。 -->
        <span
          v-for="light in bridgeLights"
          :key="light.id"
          v-tip="light.tip"
          role="img"
          tabindex="0"
          :aria-label="light.tip"
          class="flex size-9 items-center justify-center rounded-lg"
        >
          <span class="size-3 rounded-full ring-2 ring-card" :class="BRIDGE_LIGHTS[light.tone]"></span>
        </span>
      </template>
      <ListSkeleton v-if="loading" :rows="3" inset />
      <Alert v-else-if="error" variant="destructive" class="mx-5 mt-4 w-auto"><AlertDescription>{{ error }}</AlertDescription></Alert>
      <EmptyState v-else-if="!items.length" :icon="FlaskConical" title="沒有待確認的檢驗結果" inset />
      <ul v-else class="divide-y divide-border">
        <li v-for="item in items" :key="item._id">
          <button type="button" class="flex w-full flex-col gap-0.5 px-5 py-3 text-left hover:bg-hover" @click="openItem(item)">
            <span class="flex items-baseline gap-2">
              <span class="text-base font-semibold">{{ instrumentLabel(item.instrument).purpose }}</span>
              <span class="truncate text-sm text-muted-foreground">{{ instrumentLabel(item.instrument).name }}</span>
              <span class="num ml-auto shrink-0 text-xs text-subtle-foreground">{{ formatDateTime(item.runAt) }}</span>
            </span>
            <span class="text-sm text-muted-foreground">IDEXX 上的名字：<span class="font-medium text-foreground">{{ item.patient?.name }}</span></span>
            <span v-if="suggestion(item)" class="text-sm text-primary">建議：{{ suggestion(item).petName }}（{{ suggestion(item).time }}）</span>
          </button>
        </li>
      </ul>
    </SidePanel>

    <PetPickerDialog :open="pickerOpen" @close="pickerOpen = false" @select="onPick" />
    <ConfirmDialog
      :open="dismissing"
      title="忽略這份檢驗結果？"
      description="例如 IDEXX 的品管測試或練習用的檢驗。忽略後它不會填進任何報告，也不會再出現在清單上。"
      confirm-label="忽略"
      :loading="busy"
      @update:open="(value) => !value && (dismissing = false)"
      @confirm="confirmDismiss"
    />
  </div>
</template>

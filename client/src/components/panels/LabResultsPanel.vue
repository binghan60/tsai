<script setup>
import { apiErrorMessage } from '../../lib/apiError.js';
import { computed, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FlaskConical, Search } from '@lucide/vue';
import { http } from '../../api/http';
import { getSocket } from '../../api/socket';
import { useToast } from '../../composables/useToast';
import { clinicDateInput, formatDateTime, weekdayLabel } from '../../lib/datetime';
import { bridgeStatusLine, fillMessage, instrumentLabel, visitStatusLabel } from '../../lib/labResults';
import { labFlag } from '../../../../shared/labValues.js';
import { useUtilityPanelStore } from '../../stores/utilityPanel';
import { useWorkCountsStore } from '../../stores/workCounts';
import SidePanel from './SidePanel.vue';
import EmptyState from '../EmptyState.vue';
import ListSkeleton from '../ListSkeleton.vue';
import ConfirmDialog from '../ConfirmDialog.vue';
import LabConflictDialog from '../LabConflictDialog.vue';
import ModalDialog from '../ModalDialog.vue';
import Pagination from '../Pagination.vue';
import { Alert, AlertDescription } from '../ui/alert';
import { Button } from '../ui/button';
import { DatePicker } from '../ui/date-picker';
import { Input } from '../ui/input';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';

// IDEXX 檢驗結果的待確認清單：認不出是哪隻貓的結果（IDEXX 主機上手打名字、沒帶系統的貓咪編號）放在這裡，
// 人選一下是哪隻貓，就照自動填入的規則填進那隻貓當天的健檢報告（見 docs/IDEXX_INTERLINK.md）。
// 點一筆推入確認畫面；候選是檢驗當天的掛號，同名而且只有一隻就預先選好。
// 只能選當天有看診的貓：沒有看診就沒有病歷日誌與健檢報告可以填，伺服器不會配對、結果留在清單上
// （所以這裡沒有「搜尋其他貓咪」；別天的看診要用診療台的「匯入檢驗結果」指定）。
const panel = useUtilityPanelStore();
const counts = useWorkCountsStore();
const toast = useToast();
const items = ref([]);
const loading = ref(true);
const error = ref('');
const busy = ref(false);
const selectedPetId = ref('');
const dismissing = ref(false);

// 待確認的結果可能堆到上百筆，清單分頁、標題列出總筆數。
const PAGE_SIZE = 20;
const page = ref(1);
const total = ref(0);
const totalPages = ref(1);
const listTop = ref(null);
let listRequest = 0;
// 搜尋 IDEXX 上的貓名／飼主名（跟診療台「匯入檢驗結果」同一個參數）。清單可能有幾百筆，一頁一頁翻找不到。
const keyword = ref('');
let searchTimer;

const view = computed(() => (panel.stacks.lab || []).at(-1) || null);
// 確認畫面開著時，新結果進來會把這筆擠到下一頁，所以留一份點開當下的資料當後備；
// 別台已經處理掉的話，按確認／忽略時伺服器回 409。
const openedItem = ref(null);
const current = computed(() => {
  const id = view.value?.id;
  if (!id) return null;
  return items.value.find((item) => String(item._id) === id) ?? (String(openedItem.value?._id) === id ? openedItem.value : null);
});
const options = computed(() => (current.value?.candidates ?? []).map((candidate) => ({
  petId: String(candidate.petId),
  petName: candidate.petName,
  ownerName: candidate.ownerName,
  detail: [candidate.time, visitStatusLabel(candidate.status)].filter(Boolean).join('　'),
  sameName: candidate.sameName,
})));
const selectedName = computed(() => options.value.find((option) => option.petId === selectedPetId.value)?.petName ?? '');

// 數值跟報告不同、還沒處理的（自動認出貓的結果當時沒人在場，放在這裡；打開健檢報告時也會跳出來）。
const conflicts = ref([]);
const conflictGroup = ref(null);

async function refresh() {
  const id = ++listRequest;
  try {
    const [{ data }, { data: conflictData }] = await Promise.all([
      http.get('/lab-results', { params: { page: page.value, limit: PAGE_SIZE, ...(keyword.value.trim() ? { q: keyword.value.trim() } : {}) } }),
      http.get('/lab-results/conflicts'),
    ]);
    if (id !== listRequest) return;
    total.value = data.total ?? 0;
    totalPages.value = data.totalPages || 1;
    conflicts.value = conflictData.items || [];
    error.value = '';
    // 最後一頁的都處理完了：退回新的最後一頁（watch(page) 會再讀一次）。
    if (page.value > totalPages.value) {
      page.value = totalPages.value;
      return;
    }
    items.value = data.items || [];
  } catch {
    if (id === listRequest) error.value = '檢驗結果載入失敗，請重試。';
  } finally {
    if (id === listRequest) loading.value = false;
  }
}

watch(page, () => {
  refresh();
  listTop.value?.scrollIntoView({ block: 'start' });
});
watch(keyword, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (page.value === 1) refresh();
    else page.value = 1;
  }, 300);
});

function idexxOwner(item) {
  return [item.client?.firstName, item.client?.lastName].filter(Boolean).join(' ');
}

// 候選掛號是哪一天的（跟伺服器 withCandidates 同一個口徑：檢驗時間，沒有就用收到的時間，照診所時區取日期）。
// 隔天才處理的結果很常見，標出日期才不會誤以為是今天的掛號。
function runDayLabel(item) {
  const date = clinicDateInput(item.runAt ?? item.createdAt);
  if (!date) return '';
  const [, month, day] = date.split('-');
  const label = `${Number(month)}/${Number(day)}（${weekdayLabel(date)}）`;
  return date === clinicDateInput() ? `今天 ${label}` : label;
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
  openedItem.value = item;
  panel.push({ type: 'confirm', id: String(item._id) }, 'lab');
}

// 換一筆就重選；同一筆因為即時更新重讀時不要把使用者選到一半的蓋掉。
watch(() => view.value?.id, () => {
  selectedPetId.value = '';
});
watch(current, (item) => {
  if (item && !selectedPetId.value) selectedPetId.value = String(suggestion(item)?.petId ?? '');
}, { immediate: true });

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
    toast.error(apiErrorMessage(err, '復原失敗，請稍後再試'));
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
    // 那天沒有看診（候選是同一天好幾筆、都還沒報到）：伺服器沒有配對，留在這個畫面。
    if (data.fill?.status === 'no_visit') {
      toast.addToast({ type, title: '沒有確認', message, duration: 5000 });
      return;
    }
    toast.addToast({
      type,
      title: type === 'error' ? '填入失敗' : '已確認',
      message,
      action: { label: '復原', handler: () => undo(item._id, petName) },
    });
    panel.back();
    // 有跟報告不同的值：馬上跳出比對視窗讓人決定要不要換。
    if (data.fill?.conflicts) {
      const { data: conflictData } = await http.get('/lab-results/conflicts', { params: { appointmentId: data.fill.appointmentId } });
      conflictGroup.value = (conflictData.items || []).find((group) => String(group.id) === String(item._id)) ?? null;
    }
  } catch (err) {
    toast.error(apiErrorMessage(err, '確認失敗，請稍後再試'));
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
    // 忽略之後它不在任何清單上，按錯只有這裡救得回來。
    toast.addToast({
      type: 'success', title: '已忽略', message: '這份檢驗結果不會填進任何報告',
      action: { label: '復原', handler: () => restoreDismissed(() => http.post(`/lab-results/${item._id}/undismiss`)) },
    });
    dismissing.value = false;
    panel.back();
  } catch (err) {
    toast.error(apiErrorMessage(err, '忽略失敗，請稍後再試'));
  } finally {
    busy.value = false;
    afterChange();
  }
}

async function restoreDismissed(request) {
  try {
    await request();
    toast.success('已經回到待確認清單', '已復原');
  } catch (err) {
    toast.error(apiErrorMessage(err, '復原失敗，請稍後再試'));
  } finally {
    afterChange();
  }
}

// 忽略舊的：一次忽略某一天以前驗的（IDEXX 主機補傳歷史紀錄會進來幾百筆，一筆一筆按不完）。
// 先算有幾筆再讓人確認；忽略後的提示可以整批復原。
const bulk = ref(null); // { before, count, loading }
const bulkBusy = ref(false);
let bulkRequest = 0;

function openBulk() {
  bulk.value = { before: clinicDateInput(new Date(Date.now() - 6 * 86_400_000)), count: null };
}

watch(() => bulk.value?.before, async (before) => {
  const id = ++bulkRequest;
  if (!bulk.value) return;
  bulk.value.count = null;
  if (!before) return;
  try {
    const { data } = await http.get('/lab-results', { params: { before, limit: 1 } });
    if (id === bulkRequest && bulk.value) bulk.value.count = data.total ?? 0;
  } catch {
    // 算不出來就不給按。
  }
});

async function confirmBulk() {
  if (!bulk.value?.count || bulkBusy.value) return;
  bulkBusy.value = true;
  try {
    const { data } = await http.post('/lab-results/dismiss-before', { before: bulk.value.before });
    toast.addToast({
      type: 'success', title: `已忽略 ${data.dismissed} 筆`, message: '這些檢驗結果不會填進任何報告',
      action: { label: '復原', handler: () => restoreDismissed(() => http.post('/lab-results/undismiss-batch', { dismissedAt: data.dismissedAt })) },
    });
    bulk.value = null;
  } catch (err) {
    toast.error(apiErrorMessage(err, '忽略失敗，請稍後再試'));
  } finally {
    bulkBusy.value = false;
    afterChange();
  }
}

// 診所電腦上抓檔程式的狀態（每分鐘由 useGlobalChat 重讀；打開面板時再讀一次，看到的才是最新的）。
// 從來沒有回報過（診所還沒裝）就不顯示。
// 使用者要求做成燈號（綠／黃／紅），滑過去才顯示詳細資訊，不要佔一整列。
const BRIDGE_LIGHTS = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' };
// 紅燈（已經沒在回報）可以點掉：換了電腦或改了名稱，舊的那筆會一直亮紅燈。還在回報的不能移除。
const bridgeLights = computed(() => counts.bridges.map((bridge) => {
  const line = bridgeStatusLine(bridge);
  const removable = line.tone === 'danger';
  return { id: bridge.bridgeId, tone: line.tone, removable, tip: `${line.text}　${line.detail}${removable ? '　點一下可以移除這筆紀錄' : ''}` };
}));
const removingBridge = ref('');
const removeBusy = ref(false);

async function confirmRemoveBridge() {
  if (!removingBridge.value || removeBusy.value) return;
  removeBusy.value = true;
  try {
    await http.delete(`/lab-results/bridge-status/${encodeURIComponent(removingBridge.value)}`);
    removingBridge.value = '';
  } catch (err) {
    toast.error(apiErrorMessage(err, '移除失敗，請稍後再試'));
  } finally {
    removeBusy.value = false;
    counts.loadBridges();
  }
}

function refreshAll() {
  refresh();
  counts.loadBridges();
}

// 新結果進來、別台處理掉就重讀清單。直接聽事件，不看工具欄的數字——那個數字只算近七天，更早的變動不會讓它變。
const socket = getSocket();
onMounted(() => {
  refreshAll();
  socket.on('lab-results:updated', refresh);
});
onBeforeUnmount(() => {
  socket.off('lab-results:updated', refresh);
  clearTimeout(searchTimer);
});
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
          <h3 id="lab-match-title" class="text-sm font-semibold">是哪一隻？<span class="num ml-2 font-normal text-muted-foreground">{{ runDayLabel(current) }}的掛號</span></h3>
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
          <p v-else class="text-sm text-muted-foreground">{{ runDayLabel(current) }}沒有掛號。</p>
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
        <component
          :is="light.removable ? 'button' : 'span'"
          v-for="light in bridgeLights"
          :key="light.id"
          v-tip="light.tip"
          :type="light.removable ? 'button' : undefined"
          :role="light.removable ? undefined : 'img'"
          :tabindex="light.removable ? undefined : 0"
          :aria-label="light.tip"
          class="flex size-9 items-center justify-center rounded-lg"
          :class="light.removable ? 'cursor-pointer hover:bg-hover' : ''"
          @click="light.removable && (removingBridge = light.id)"
        >
          <span class="size-3 rounded-full ring-2 ring-card" :class="BRIDGE_LIGHTS[light.tone]"></span>
        </component>
      </template>
      <span ref="listTop" aria-hidden="true"></span>
      <section v-if="conflicts.length" class="border-b border-border" aria-labelledby="lab-conflicts-title">
        <h3 id="lab-conflicts-title" class="px-5 pt-3 pb-1 text-sm font-semibold">數值跟報告不同</h3>
        <ul class="divide-y divide-border">
          <li v-for="group in conflicts" :key="group.id">
            <button type="button" class="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-hover" @click="conflictGroup = group">
              <span class="min-w-0 flex-1">
                <span class="block truncate text-base font-semibold">{{ group.petName }}</span>
                <span class="block truncate text-sm text-muted-foreground">{{ group.items.map((entry) => entry.label).join('、') }}</span>
              </span>
              <span class="num shrink-0 rounded-md bg-warning-surface px-2 py-0.5 text-xs font-semibold text-warning">{{ group.items.length }} 項</span>
            </button>
          </li>
        </ul>
      </section>
      <div v-if="!loading && !error && (items.length || keyword)" class="relative mx-5 mt-3">
        <Search class="pointer-events-none absolute top-1/2 left-3 size-4.5 -translate-y-1/2 text-subtle-foreground" stroke-width="1.75" aria-hidden="true" />
        <Input v-model="keyword" type="search" class="pl-10" aria-label="搜尋 IDEXX 上的貓咪名字或飼主" placeholder="搜尋 IDEXX 上的貓咪名字或飼主" />
      </div>
      <ListSkeleton v-if="loading" :rows="3" inset />
      <Alert v-else-if="error" variant="destructive" class="mx-5 mt-4 w-auto"><AlertDescription>{{ error }}</AlertDescription></Alert>
      <EmptyState v-else-if="!items.length && keyword.trim()" :icon="FlaskConical" title="找不到符合的檢驗結果" inset />
      <EmptyState v-else-if="!items.length && !conflicts.length" :icon="FlaskConical" title="沒有待確認的檢驗結果" inset />
      <section v-else-if="items.length" aria-labelledby="lab-pending-title">
        <h3 id="lab-pending-title" class="flex items-center gap-2 px-5 pt-3 pb-1 text-sm font-semibold">
          還沒選貓
          <span class="num font-normal text-muted-foreground">共 {{ total.toLocaleString('zh-TW') }} 筆</span>
          <span v-if="totalPages > 1" class="num text-xs font-normal text-subtle-foreground">第 {{ page }}／{{ totalPages }} 頁</span>
          <Button variant="secondary" size="xs" class="ml-auto" @click="openBulk">忽略舊的</Button>
        </h3>
        <ul class="divide-y divide-border">
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
      </section>
      <template v-if="totalPages > 1" #footer>
        <Pagination v-model:page="page" class="w-full" :total-pages="totalPages" />
      </template>
    </SidePanel>

    <ConfirmDialog
      :open="Boolean(removingBridge)"
      title="移除這台電腦的紀錄？"
      :description="`「${removingBridge}」已經沒有在回報。移除後燈號會消失；如果它之後又開始回報，會自動再出現。`"
      confirm-label="移除"
      :loading="removeBusy"
      @update:open="(value) => !value && (removingBridge = '')"
      @confirm="confirmRemoveBridge"
    />
    <ModalDialog v-if="bulk" size="sm" title="忽略舊的檢驗結果" description="這一天以前驗的、還沒選貓的結果一次忽略；當天的不算。" @close="bulk = null">
      <div class="space-y-3 px-6 py-4">
        <DatePicker v-model="bulk.before" :clearable="false" aria-label="忽略這一天以前驗的" class="w-44" />
        <p class="min-h-lh text-base">
          <template v-if="bulk.count !== null">共 <span class="num font-semibold">{{ bulk.count.toLocaleString('zh-TW') }}</span> 筆</template>
        </p>
      </div>
      <div class="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
        <Button variant="secondary" :disabled="bulkBusy" @click="bulk = null">取消</Button>
        <Button variant="destructive-solid" :disabled="bulkBusy || !bulk.count" @click="confirmBulk">忽略</Button>
      </div>
    </ModalDialog>
    <LabConflictDialog
      v-if="conflictGroup"
      :group="conflictGroup"
      @close="conflictGroup = null"
      @resolved="conflictGroup = null; afterChange()"
    />
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

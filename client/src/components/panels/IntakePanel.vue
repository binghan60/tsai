<script setup>
import { computed, onActivated, onMounted, ref, watch } from 'vue';
import { ClipboardList, Copy, KeyRound } from '@lucide/vue';
import { http } from '../../api/http';
import { useToast } from '../../composables/useToast';
import { useAppointmentNotifier } from '../../composables/useAppointmentNotifier';
import { clinicDateInput, formatDateTime, weekdayLabel } from '../../lib/datetime';
import { useUtilityPanelStore } from '../../stores/utilityPanel';
import { useWorkCountsStore } from '../../stores/workCounts';
import SidePanel from './SidePanel.vue';
import IntakeReview from '../IntakeReview.vue';
import EmptyState from '../EmptyState.vue';
import ListSkeleton from '../ListSkeleton.vue';
import RowActions from '../RowActions.vue';
import FilterTabs from '../FilterTabs.vue';
import ConfirmDialog from '../ConfirmDialog.vue';
import Pagination from '../Pagination.vue';
import { Alert, AlertDescription } from '../ui/alert';
import { Button } from '../ui/button';

// 初診面板（只在掛號台出現）：發驗證碼給現場要填表的飼主、管理已發出還沒用掉的驗證碼，以及審核已送出的初診表。
// 點一份推入逐欄審核；掛號或退回後退回清單。
const panel = useUtilityPanelStore();
const counts = useWorkCountsStore();
const toast = useToast();
const notifyChat = useAppointmentNotifier();
const items = ref([]);
const loading = ref(true);
const error = ref('');
const codes = ref([]);
const codesLoading = ref(true);
const codesError = ref('');
const issuing = ref(false);
const lastIssuedId = ref('');
const voiding = ref(null);
const voidBusy = ref(false);
const view = computed(() => (panel.stacks.intake || []).at(-1) || null);
// 兩份清單做的事不同（逐欄審核／複製、作廢），分頁籤各用整個高度；預設停在要人動手的待審核。
const TABS = [
  { key: 'pending', label: '待審核' },
  { key: 'codes', label: '已發出的驗證碼', short: '已發出' },
];
const tab = ref('pending');
const tabCounts = computed(() => ({ pending: items.value.length, codes: codes.value.length }));
const CODE_ACTIONS = [{ key: 'void', label: '作廢（取消這筆掛號）', danger: true }];

// 兩份清單都是整份拿回來，前端分頁；頁碼列固定在面板底部，跟其他面板一樣。換頁籤回第一頁。
const PAGE_SIZE = 20;
const page = ref(1);
const listTop = ref(null);
const tabList = computed(() => (tab.value === 'pending' ? items.value : codes.value));
const totalPages = computed(() => Math.max(1, Math.ceil(tabList.value.length / PAGE_SIZE)));
const pageSlice = (list) => list.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE);
const pageItems = computed(() => pageSlice(items.value));
const pageCodes = computed(() => pageSlice(codes.value));
watch(tab, () => { page.value = 1; });
// 審核掉、作廢讓最後一頁空掉時退回新的最後一頁。
watch(totalPages, (value) => { if (page.value > value) page.value = value; });
function goToPage(value) {
  page.value = value;
  listTop.value?.scrollIntoView({ block: 'start' });
}

async function refresh() {
  try {
    const { data } = await http.get('/intake-submissions');
    items.value = data.items || [];
    error.value = '';
  } catch {
    error.value = '待審初診表載入失敗，請重試。';
  } finally {
    loading.value = false;
  }
}

// 已發出、飼主還能用的驗證碼（不分日期）。飼主送出初診表、掛號被取消或過期就會從這裡消失。
async function refreshCodes() {
  try {
    const { data } = await http.get('/appointments/intake-codes');
    codes.value = data.items || [];
    codesError.value = '';
  } catch {
    codesError.value = '已發出的驗證碼載入失敗，請重試。';
  } finally {
    codesLoading.value = false;
  }
}

function refreshAll() {
  refresh();
  refreshCodes();
}

// 現場要填初診表：先建一筆「初診資料待填」的掛號拿驗證碼，飼主用驗證碼在公開頁填表。
async function issueCode() {
  if (issuing.value) return;
  issuing.value = true;
  try {
    // 來院原因留空：審核初診表時會帶出掛號上的來院原因，填個佔位字只會讓櫃台多刪一次。
    const { data } = await http.post('/appointments', { date: clinicDateInput(), petName: '初診資料待填' });
    lastIssuedId.value = String(data._id);
    tab.value = 'codes';
    // 新發的排在最前面（新到舊）；原本就停在「已發出」的第 2 頁時切頁籤不會歸零，要自己跳回來。
    page.value = 1;
    toast.success(`初診驗證碼：${data.intakeVerificationCode}`);
    refreshCodes();
  } catch (err) {
    toast.error(err.response?.data?.message || '無法產生初診驗證碼，請稍後再試');
  } finally {
    issuing.value = false;
  }
}

// 掛今天的只寫時段；掛別天的要寫出日期，不然櫃台會以為是今天的號。
function scheduleLabel(item) {
  const time = item.time || '';
  if (item.date === clinicDateInput()) return `今天 ${time}`.trim();
  const [, month, day] = item.date.split('-');
  return `${Number(month)}/${Number(day)}（${weekdayLabel(item.date)}）${time}`;
}

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    toast.success(code, '已複製驗證碼');
  } catch {
    toast.error('無法複製，請手動抄下驗證碼');
  }
}

// 驗證碼綁在掛號上，作廢＝取消那筆掛號；取消後公開初診頁就不再接受這組碼。
async function confirmVoid() {
  const item = voiding.value;
  if (!item || voidBusy.value) return;
  voidBusy.value = true;
  try {
    const { data } = await http.post(`/appointments/${item._id}/cancel`, { version: item.__v ?? 0, cancelReason: '初診驗證碼作廢' });
    notifyChat(data, 'cancel');
    toast.success(`${item.intakeVerificationCode}（${item.petName}）`, '驗證碼已作廢');
    voiding.value = null;
    refreshCodes();
  } catch (err) {
    toast.error(err.response?.data?.message || '作廢失敗，請稍後重試');
  } finally {
    voidBusy.value = false;
  }
}

function onDecided() {
  panel.back();
  refreshAll();
  counts.loadIntake();
}

// 工具欄上的數字變了（別台審過、飼主剛送出）就重讀清單；送出初診表也會讓一組驗證碼用掉。
watch(() => counts.intake, refreshAll);
onMounted(refreshAll);
onActivated(refreshAll);
</script>

<template>
  <!-- KeepAlive 底下的根節點要是普通元素：直接放元件（還用 v-if 切換）收起時 Vue 會出錯。 -->
  <div class="h-full min-h-0">
    <SidePanel
      v-if="view?.type === 'review'"
      title="審核初診表"
      :can-back="true"
      back-label="返回初診表清單"
      @back="panel.back()"
      @close="panel.close()"
    >
      <IntakeReview :key="view.submissionId" :submission-id="view.submissionId" @decided="onDecided" />
    </SidePanel>
    <SidePanel v-else title="初診" description="飼主用驗證碼在初診頁填表，送出後在這裡審核" flush @close="panel.close()">
      <div ref="listTop" class="space-y-3 border-b border-border px-5 py-4">
        <Button variant="soft" class="w-full" :disabled="issuing" @click="issueCode"><KeyRound stroke-width="1.75" />發初診驗證碼</Button>
        <FilterTabs v-model="tab" :items="TABS" :counts="tabCounts" aria-label="初診清單" fit />
      </div>

      <template v-if="tab === 'pending'">
        <div class="flex items-center justify-between gap-3 px-5 pt-3 pb-2">
          <p class="text-xs text-subtle-foreground">飼主已送出，點一份逐欄審核</p>
          <router-link to="/reception/intakes" class="shrink-0 text-sm font-medium text-primary hover:underline">全頁審核</router-link>
        </div>
        <ListSkeleton v-if="loading" :rows="3" inset />
        <Alert v-else-if="error" variant="destructive" class="mx-5 w-auto"><AlertDescription>{{ error }}</AlertDescription></Alert>
        <EmptyState v-else-if="!items.length" :icon="ClipboardList" title="沒有待審核的初診表" inset />
        <ul v-else class="divide-y divide-border border-t border-border">
          <li v-for="item in pageItems" :key="item._id">
            <button type="button" class="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-hover" @click="panel.push({ type: 'review', submissionId: item._id }, 'intake')">
              <span class="min-w-0 flex-1">
                <span class="block truncate text-base font-semibold text-primary">{{ item.pet?.name }}</span>
                <span class="flex gap-3 text-sm text-muted-foreground"><span class="truncate">{{ item.owner?.name }}</span><span class="num shrink-0">{{ item.owner?.phone }}</span></span>
              </span>
              <span class="num shrink-0 text-xs text-subtle-foreground">{{ formatDateTime(item.createdAt) }}</span>
            </button>
          </li>
        </ul>
      </template>

      <!-- 已發出、飼主還沒送出初診表的驗證碼：不分日期，掛明天的也在這裡 -->
      <template v-else>
        <p class="px-5 pt-3 pb-2 text-xs text-subtle-foreground">飼主還沒送出初診表；送出後會移到「待審核」</p>
        <ListSkeleton v-if="codesLoading" :rows="2" inset />
        <Alert v-else-if="codesError" variant="destructive" class="mx-5 w-auto"><AlertDescription>{{ codesError }}</AlertDescription></Alert>
        <EmptyState v-else-if="!codes.length" :icon="KeyRound" title="沒有等待填寫的驗證碼" inset />
        <ul v-else class="divide-y divide-border border-t border-border">
          <li
            v-for="item in pageCodes"
            :key="item._id"
            class="flex items-center gap-3 px-5 py-3"
            :class="String(item._id) === lastIssuedId ? 'bg-accent' : ''"
          >
            <span class="num w-18 shrink-0 text-lg font-semibold tracking-[0.2em] text-foreground">{{ item.intakeVerificationCode }}</span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-base font-semibold">{{ item.petName }}</span>
              <span class="flex gap-3 text-sm text-muted-foreground">
                <span class="num shrink-0">{{ scheduleLabel(item) }}</span>
                <span v-if="item.ownerPhone" class="num truncate">{{ item.ownerPhone }}</span>
              </span>
            </span>
            <Button variant="secondary" size="icon-sm" aria-label="複製驗證碼" v-tip="'複製驗證碼'" @click="copyCode(item.intakeVerificationCode)"><Copy stroke-width="1.75" /></Button>
            <RowActions :actions="CODE_ACTIONS" :label="`${item.petName} 的其他操作`" @select="voiding = item" />
          </li>
        </ul>
      </template>
      <template v-if="totalPages > 1" #footer>
        <Pagination class="w-full" :page="page" :total-pages="totalPages" @update:page="goToPage" />
      </template>
    </SidePanel>

    <ConfirmDialog
      :open="Boolean(voiding)"
      title="作廢這組驗證碼？"
      :description="voiding ? `驗證碼 ${voiding.intakeVerificationCode}（${voiding.petName}，${scheduleLabel(voiding)}）作廢後飼主就不能再用它填初診表，這筆掛號也會一起取消。` : ''"
      confirm-label="作廢"
      destructive
      :loading="voidBusy"
      @update:open="(value) => !value && (voiding = null)"
      @confirm="confirmVoid"
    />
  </div>
</template>

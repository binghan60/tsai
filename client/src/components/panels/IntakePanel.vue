<script setup>
import { computed, onActivated, onMounted, ref, watch } from 'vue';
import { ClipboardList, KeyRound } from '@lucide/vue';
import { http } from '../../api/http';
import { useToast } from '../../composables/useToast';
import { clinicDateInput, formatDateTime } from '../../lib/datetime';
import { useUtilityPanelStore } from '../../stores/utilityPanel';
import { useWorkCountsStore } from '../../stores/workCounts';
import SidePanel from './SidePanel.vue';
import IntakeReview from '../IntakeReview.vue';
import EmptyState from '../EmptyState.vue';
import ListSkeleton from '../ListSkeleton.vue';
import { Alert, AlertDescription } from '../ui/alert';
import { Button } from '../ui/button';

// 初診面板（只在掛號台出現）：發驗證碼給現場要填表的飼主，以及審核已送出的初診表。
// 點一份推入逐欄審核；掛號或退回後退回清單。
const panel = useUtilityPanelStore();
const counts = useWorkCountsStore();
const toast = useToast();
const items = ref([]);
const loading = ref(true);
const error = ref('');
const issuing = ref(false);
const lastCode = ref('');
const view = computed(() => (panel.stacks.intake || []).at(-1) || null);

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

// 現場要填初診表：先建一筆「初診資料待填」的掛號拿驗證碼，飼主用驗證碼在公開頁填表。
async function issueCode() {
  if (issuing.value) return;
  issuing.value = true;
  try {
    const { data } = await http.post('/appointments', { date: clinicDateInput(), petName: '初診資料待填', reason: '現場填寫初診資料' });
    lastCode.value = data.intakeVerificationCode || '';
    toast.success(`初診驗證碼：${data.intakeVerificationCode}`);
  } catch (err) {
    toast.error(err.response?.data?.message || '無法產生初診驗證碼，請稍後再試');
  } finally {
    issuing.value = false;
  }
}

function onDecided() {
  panel.back();
  refresh();
  counts.loadIntake();
}

// 工具欄上的數字變了（別台審過、飼主剛送出）就重讀清單。
watch(() => counts.intake, refresh);
onMounted(refresh);
onActivated(refresh);
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
      <div class="space-y-3 border-b border-border px-5 py-4">
        <Button variant="soft" class="w-full" :disabled="issuing" @click="issueCode"><KeyRound stroke-width="1.75" />發初診驗證碼</Button>
        <p v-if="lastCode" class="flex items-baseline justify-between rounded-lg bg-accent px-4 py-2.5 text-accent-foreground">
          <span class="text-sm">剛發出的驗證碼</span>
          <span class="num text-lg font-semibold tracking-[0.2em]">{{ lastCode }}</span>
        </p>
      </div>

      <div class="flex items-center justify-between px-5 pt-4 pb-2">
        <h3 class="text-base font-semibold">待審核 <span class="num ml-1 text-subtle-foreground">{{ items.length }}</span></h3>
        <router-link to="/reception/intakes" class="text-sm font-medium text-primary hover:underline">全頁審核</router-link>
      </div>
      <ListSkeleton v-if="loading" :rows="3" inset />
      <Alert v-else-if="error" variant="destructive" class="mx-5 w-auto"><AlertDescription>{{ error }}</AlertDescription></Alert>
      <EmptyState v-else-if="!items.length" :icon="ClipboardList" title="沒有待審核的初診表" inset />
      <ul v-else class="divide-y divide-border border-t border-border">
        <li v-for="item in items" :key="item._id">
          <button type="button" class="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-hover" @click="panel.push({ type: 'review', submissionId: item._id }, 'intake')">
            <span class="min-w-0 flex-1">
              <span class="block truncate text-base font-semibold text-primary">{{ item.pet?.name }}</span>
              <span class="flex gap-3 text-sm text-muted-foreground"><span class="truncate">{{ item.owner?.name }}</span><span class="num shrink-0">{{ item.owner?.phone }}</span></span>
            </span>
            <span class="num shrink-0 text-xs text-subtle-foreground">{{ formatDateTime(item.createdAt) }}</span>
          </button>
        </li>
      </ul>
    </SidePanel>
  </div>
</template>

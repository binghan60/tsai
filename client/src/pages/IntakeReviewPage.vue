<script setup>
import { onMounted, ref } from 'vue';
import { ArrowLeft, Check, ClipboardList, RefreshCw, X } from '@lucide/vue';
import { http } from '../api/http';
import { useToast } from '../composables/useToast';
import { formatDateTime } from '../lib/datetime';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import ListSkeleton from '../components/ListSkeleton.vue';

const toast = useToast();
const items = ref([]);
const loading = ref(true);
const error = ref('');
const busy = ref(false);
const confirmation = ref(null);
const selectedId = ref('');

function value(value, fallback = '未填寫') { return value === null || value === undefined || value === '' ? fallback : value; }
async function refresh() {
  loading.value = true;
  try {
    const { data } = await http.get('/intake-submissions');
    items.value = data.items || [];
    error.value = '';
  } catch { error.value = '待審核初診表載入失敗，請重試。'; }
  finally { loading.value = false; }
}
async function decide() {
  if (!confirmation.value || busy.value) return;
  const { item, action } = confirmation.value;
  busy.value = true;
  try {
    const { data } = await http.post(`/intake-submissions/${item._id}/${action}`);
    items.value = items.value.filter(current => current._id !== item._id);
    selectedId.value = '';
    confirmation.value = null;
    if (action === 'approve') toast.success(`已建立「${data.pet.name}」與飼主的正式資料`);
    else toast.success('已退回這份初診表');
  } catch (err) { toast.error(err.response?.data?.message || '審核失敗，請重新整理後再試'); }
  finally { busy.value = false; }
}
onMounted(refresh);
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-5 pb-8">
    <header class="flex flex-wrap items-center gap-4">
      <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground"><ClipboardList class="h-5 w-5" /></span>
      <div><h1 class="text-xl font-semibold">初診表審核</h1><p class="mt-0.5 text-xs text-muted-foreground">核准後才建立正式飼主與寵物資料</p></div>
      <div class="ml-auto flex gap-2"><Button variant="secondary" size="sm" as-child><router-link to="/reception"><ArrowLeft class="h-4 w-4" />返回櫃台</router-link></Button><Button variant="secondary" size="sm" :disabled="loading" @click="refresh"><RefreshCw class="h-4 w-4" />重新載入</Button></div>
    </header>
    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-if="loading" :rows="4" />
    <section v-if="!loading && !selectedId" class="overflow-hidden rounded-xl border border-border bg-card">
      <div class="flex items-center gap-3 border-b border-border px-5 py-3"><h2 class="text-base font-semibold">待審核</h2><span class="rounded-full bg-muted px-3 py-1 text-xs font-medium">{{ items.length }} 份</span></div>
      <p v-if="!items.length" class="px-5 py-12 text-center text-sm text-muted-foreground">目前沒有待審核的初診表。</p>
      <button v-for="item in items" :key="item._id" type="button" class="flex w-full flex-wrap items-center gap-4 border-b border-border px-5 py-4 text-left last:border-b-0 hover:bg-field" @click="selectedId = item._id">
        <span class="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-base font-semibold text-accent-foreground">{{ item.pet.name?.slice(0, 1) || '?' }}</span>
        <span class="min-w-0 flex-1"><span class="block truncate text-base font-semibold">{{ item.pet.name }}</span><span class="mt-0.5 block truncate text-sm text-muted-foreground">{{ item.owner.name }} · {{ item.owner.phone }}</span></span>
        <span class="shrink-0 text-xs text-muted-foreground">{{ formatDateTime(item.createdAt) }}</span>
      </button>
    </section>
    <section v-else-if="!loading" class="paper-detail-shell">
      <div class="mb-3 flex items-center justify-between"><Button variant="secondary" size="sm" @click="selectedId = ''"><ArrowLeft class="h-4 w-4" />返回列表</Button><span class="text-xs text-muted-foreground">完整初診表</span></div>
      <article v-for="item in items.filter(item => item._id === selectedId)" :key="item._id" class="paper-form">
        <div class="paper-header"><div><p class="paper-logo">ROYAL CANIN</p><h3>初診掛號單</h3></div><div class="paper-actions"><span>送出於 {{ formatDateTime(item.createdAt) }}</span><Button size="sm" :disabled="busy" @click="confirmation = { item, action: 'approve' }"><Check class="h-4 w-4" />核准並建立</Button><Button variant="secondary" size="sm" :disabled="busy" @click="confirmation = { item, action: 'reject' }"><X class="h-4 w-4" />退回</Button></div></div>
        <section class="paper-section"><h4>貓孩兒</h4><div class="paper-grid"><div><p class="paper-subtitle">基本資料</p><p class="paper-line"><b>名字：</b>{{ value(item.pet.name) }}</p><p class="paper-line"><b>性別：</b>{{ { male: '男生', female: '女生' }[item.pet.sex] || '未填寫' }}</p><p class="paper-line"><b>品種：</b>{{ value(item.pet.breed) }}</p><p class="paper-line"><b>花色：</b>{{ value(item.pet.color) }}</p></div><div><p class="paper-subtitle">生活狀況</p><p class="paper-line"><b>家中貓口：</b>{{ item.pet.householdCatCount ?? '未填寫' }}<template v-if="item.pet.householdCatCount !== null"> 隻</template></p><p class="paper-line"><b>飲食：</b>{{ value(item.pet.diet) }}</p><p class="paper-line"><b>主餐配菜：</b>{{ item.pet.foods?.join('、') || '未填寫' }}</p><p class="paper-line"><b>放飯頻率：</b>{{ { free: '任食', scheduled: `定食定量${item.pet.mealsPerDay ? `：一日 ${item.pet.mealsPerDay} 餐` : ''}` }[item.pet.feedingType] || '未填寫' }}</p></div></div><div class="paper-medical"><p class="paper-subtitle">醫療紀錄</p><p class="paper-line"><b>結紮：</b>{{ { yes: '已結紮', no: '未結紮' }[item.pet.neutered] || '未填寫' }}</p><p class="paper-line"><b>疫苗：</b>{{ item.pet.vaccineStatus === 'done' ? `已注射：${item.pet.vaccineDate || '未填最後注射時間'}` : item.pet.vaccineStatus === 'none' ? '未注射' : '未填寫' }}</p><p class="paper-line"><b>病史：</b>{{ item.pet.medicalHistory?.join('、') || '無／未填寫' }}<template v-if="item.pet.medicalHistoryOther">；{{ item.pet.medicalHistoryOther }}</template></p><p class="paper-line"><b>藥物過敏：</b>{{ item.pet.allergyStatus === 'yes' ? `有：${item.pet.allergyType || '未填類別'}` : item.pet.allergyStatus === 'none' ? '無過敏' : '未填寫' }}</p><p class="paper-line"><b>健檢：</b>{{ item.pet.checkupStatus === 'done' ? `有：${item.pet.checkupDate || '未填時間'}` : item.pet.checkupStatus === 'none' ? '未健檢' : '未填寫' }}</p></div></section>
        <section class="paper-section paper-owner"><h4>家長</h4><p class="paper-subtitle">基本資料</p><p class="paper-line"><b>姓名：</b>{{ value(item.owner.name) }}</p><p class="paper-line"><b>市話：</b>{{ value(item.owner.landline) }}　<b>手機：</b>{{ value(item.owner.phone) }}</p><p class="paper-line"><b>地址：</b>{{ value(item.owner.address) }}</p><p class="paper-line"><b>Email：</b>{{ value(item.owner.email) }}</p></section>
      </article>
    </section>
    <ConfirmDialog v-if="confirmation" :open="true" :title="confirmation.action === 'approve' ? '核准並建立正式資料？' : '退回這份初診表？'" :description="confirmation.action === 'approve' ? `會建立飼主「${confirmation.item.owner.name}」與寵物「${confirmation.item.pet.name}」，完成後不能再次核准。` : `「${confirmation.item.pet.name}」不會建立正式資料。`" :loading="busy" confirm-label="確認" @confirm="decide" @cancel="confirmation = null" />
  </div>
</template>

<style scoped>
.paper-form { margin: 20px; border-radius: 8px; background: var(--intake-white); box-shadow: 0 4px 10px var(--intake-shadow); color: var(--intake-text); font-family: "PingFang TC", "Microsoft JhengHei", sans-serif; }
.paper-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 2px solid var(--intake-border); padding: 20px 24px 15px; text-align: center; }.paper-logo { margin: 0; color: var(--intake-red); font-size: 14px; font-weight: bold; letter-spacing: 2px; }.paper-header h3 { margin: 6px 0 0; font-size: 22px; letter-spacing: 2px; }.paper-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; color: var(--intake-secondary); font-size: 12px; }.paper-section { padding: 20px 24px 0; }.paper-section h4 { margin: 0 0 12px; color: var(--intake-heading); font-size: 18px; }.paper-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }.paper-subtitle { margin: 0 0 10px; border-bottom: 1px dashed var(--intake-dash); padding-bottom: 4px; color: var(--intake-orange); font-weight: bold; }.paper-line { margin: 0 0 10px; border-bottom: 1px solid var(--intake-border); padding-bottom: 5px; font-size: 14px; line-height: 1.7; }.paper-line b { color: var(--intake-label); }.paper-medical { margin-top: 15px; }.paper-owner { margin-top: 20px; border-top: 1px dashed var(--intake-dash); padding-bottom: 24px; }
@media (max-width: 640px) { .paper-form { margin: 12px; }.paper-header, .paper-section { padding-left: 16px; padding-right: 16px; }.paper-header { align-items: flex-start; }.paper-actions { justify-content: flex-start; }.paper-grid { grid-template-columns: 1fr; gap: 8px; } }
</style>

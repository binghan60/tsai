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

function value(value, fallback = '未填寫') { return value === null || value === undefined || value === '' ? fallback : value; }
function petSummary(pet) {
  const sex = { male: '男生', female: '女生', unknown: '未填' }[pet.sex] || '未填';
  const neutered = { yes: '已結紮', no: '未結紮', unknown: '未填' }[pet.neutered] || '未填';
  return [pet.breed, pet.color, sex, neutered].filter(Boolean).join(' · ');
}
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
    <section v-else class="overflow-hidden rounded-xl border border-border bg-card">
      <div class="flex items-center gap-3 border-b border-border px-5 py-3"><h2 class="text-base font-semibold">待審核</h2><span class="rounded-full bg-muted px-3 py-1 text-xs font-medium">{{ items.length }} 份</span></div>
      <p v-if="!items.length" class="px-5 py-12 text-center text-sm text-muted-foreground">目前沒有待審核的初診表。</p>
      <article v-for="item in items" :key="item._id" class="border-b border-border px-5 py-5 last:border-b-0">
        <div class="flex flex-wrap items-start gap-4"><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><h3 class="text-lg font-semibold">{{ item.pet.name }}</h3><span class="text-sm text-muted-foreground">{{ petSummary(item.pet) }}</span></div><p class="mt-1 text-sm text-muted-foreground">飼主：{{ item.owner.name }} · {{ item.owner.phone }}<template v-if="item.owner.landline"> · {{ item.owner.landline }}</template></p><p class="mt-1 text-xs text-muted-foreground">送出於 {{ formatDateTime(item.createdAt) }}</p></div><div class="flex shrink-0 gap-2"><Button size="sm" :disabled="busy" @click="confirmation = { item, action: 'approve' }"><Check class="h-4 w-4" />核准並建立</Button><Button variant="secondary" size="sm" :disabled="busy" @click="confirmation = { item, action: 'reject' }"><X class="h-4 w-4" />退回</Button></div></div>
        <dl class="mt-4 grid gap-x-6 gap-y-3 rounded-lg bg-field p-4 text-sm sm:grid-cols-2"><div><dt class="text-xs font-medium text-muted-foreground">地址／Email</dt><dd class="mt-1 whitespace-pre-wrap">{{ value(item.owner.address) }}<template v-if="item.owner.email"> · {{ item.owner.email }}</template></dd></div><div><dt class="text-xs font-medium text-muted-foreground">生活狀況</dt><dd class="mt-1">{{ value(item.pet.diet) }}<template v-if="item.pet.foods?.length"> · {{ item.pet.foods.join('、') }}</template><template v-if="item.pet.householdCatCount !== null"> · 家中 {{ item.pet.householdCatCount }} 隻</template></dd></div><div><dt class="text-xs font-medium text-muted-foreground">疫苗／健檢</dt><dd class="mt-1">{{ item.pet.vaccineStatus === 'done' ? `已注射 ${item.pet.vaccineDate || ''}` : item.pet.vaccineStatus === 'none' ? '未注射' : '未填' }} · {{ item.pet.checkupStatus === 'done' ? `有健檢 ${item.pet.checkupDate || ''}` : item.pet.checkupStatus === 'none' ? '未健檢' : '未填' }}</dd></div><div><dt class="text-xs font-medium text-muted-foreground">病史／過敏</dt><dd class="mt-1">{{ item.pet.medicalHistory?.join('、') || '無／未填' }}<template v-if="item.pet.medicalHistoryOther"> · {{ item.pet.medicalHistoryOther }}</template><template v-if="item.pet.allergyStatus === 'yes'"> · 過敏：{{ item.pet.allergyType || '未填類別' }}</template></dd></div></dl>
      </article>
    </section>
    <ConfirmDialog v-if="confirmation" :open="true" :title="confirmation.action === 'approve' ? '核准並建立正式資料？' : '退回這份初診表？'" :description="confirmation.action === 'approve' ? `會建立飼主「${confirmation.item.owner.name}」與寵物「${confirmation.item.pet.name}」，完成後不能再次核准。` : `「${confirmation.item.pet.name}」不會建立正式資料。`" :loading="busy" confirm-label="確認" @confirm="decide" @cancel="confirmation = null" />
  </div>
</template>

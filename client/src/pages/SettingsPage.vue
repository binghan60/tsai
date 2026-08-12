<script setup>
import { onMounted, ref, watch } from 'vue';
import { AlertTriangle, Save, SlidersHorizontal } from '@lucide/vue';
import { http } from '../api/http';
import { REFERENCE_GROUPS } from '../lib/labTests';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';

const species = ref('cat');
const ranges = ref([]);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const success = ref('');

const speciesOptions = [
  { title: '貓', value: 'cat' },
  { title: '狗', value: 'dog' },
  { title: '其他／通用', value: 'all' },
];

async function fetchRanges() {
  loading.value = true;
  error.value = '';
  success.value = '';
  try {
    const { data } = await http.get('/settings/lab-ranges', { params: { species: species.value } });
    ranges.value = data.ranges;
  } catch (err) {
    error.value = '標準值設定暫時無法載入';
  } finally {
    loading.value = false;
  }
}

async function saveRanges() {
  saving.value = true;
  error.value = '';
  success.value = '';
  try {
    const payload = ranges.value.map((item) => ({
      key: item.key,
      unit: item.unit,
      min: item.min === '' ? null : item.min,
      max: item.max === '' ? null : item.max,
      enabled: item.enabled,
    }));
    const { data } = await http.put('/settings/lab-ranges', { species: species.value, ranges: payload });
    ranges.value = data.ranges;
    success.value = '標準值已儲存，新的健檢輸入會立即套用。';
  } catch (err) {
    error.value = err.response?.data?.message ?? '標準值儲存失敗';
  } finally {
    saving.value = false;
  }
}

watch(species, fetchRanges);
onMounted(fetchRanges);
</script>

<template>
  <section class="mx-auto max-w-7xl space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div><h1 class="text-xl font-semibold text-ink-900 dark:text-white">標準值設定</h1><p class="mt-1 text-sm text-ink-500 dark:text-zinc-400">依物種設定基本量測與檢驗範圍，供健檢表自動判斷正常或異常。</p></div>
      <Button type="button" class="min-h-11" :disabled="saving || loading" @click="saveRanges"><Save class="h-4 w-4" />{{ saving ? '儲存中…' : '儲存標準值' }}</Button>
    </div>

    <div class="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle class="mt-0.5 h-5 w-5 shrink-0" /><p>參考區間會因檢驗設備、單位、物種與實驗室而異，請由診所確認後設定。未填上下限的項目不會自動判斷。</p></div>

    <div class="rounded-2xl border border-cream-300 bg-cream-50 p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
      <Label class="sr-only">套用物種</Label>
      <Select v-model="species" :disabled="loading || saving">
        <SelectTrigger class="min-h-11 w-full sm:max-w-72"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem v-for="option in speciesOptions" :key="option.value" :value="option.value">套用物種：{{ option.title }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <p v-if="error" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">{{ error }}</p>
    <p v-if="success" class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">{{ success }}</p>
    <p v-if="loading" class="text-sm text-ink-500 dark:text-zinc-400" role="status">載入標準值…</p>

    <template v-else>
      <section v-for="group in REFERENCE_GROUPS" :key="group" class="overflow-hidden rounded-2xl border border-cream-300 bg-cream-50 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div class="flex items-center gap-2 border-b border-cream-300 px-5 py-4 dark:border-zinc-800"><SlidersHorizontal class="h-4 w-4 text-belle-600 dark:text-brand-400" /><h2 class="text-sm font-semibold text-ink-900 dark:text-white">{{ group }}</h2></div>
        <div class="divide-y divide-cream-300 dark:divide-zinc-800">
          <div v-for="item in ranges.filter((range) => range.group === group)" :key="item.key" class="grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-[minmax(140px,1fr)_minmax(0,540px)_100px] md:items-center">
            <div><p class="text-sm font-medium text-ink-800 dark:text-zinc-200">{{ item.label }}</p><p v-if="item.numeric === false" class="mt-0.5 text-xs text-ink-400 dark:text-zinc-400">非數值項目，請在健檢表手動判斷</p></div>
            <template v-if="item.numeric !== false">
              <div class="grid gap-3 sm:grid-cols-3">
                <div class="space-y-1"><Label class="text-xs font-medium text-ink-500 dark:text-zinc-400">下限</Label><Input v-model="item.min" type="number" class="min-h-11" /></div>
                <div class="space-y-1"><Label class="text-xs font-medium text-ink-500 dark:text-zinc-400">上限</Label><Input v-model="item.max" type="number" class="min-h-11" /></div>
                <div class="space-y-1"><Label class="text-xs font-medium text-ink-500 dark:text-zinc-400">單位</Label><Input v-model="item.unit" class="min-h-11" /></div>
              </div>
              <div class="flex items-center gap-1.5 whitespace-nowrap md:justify-end">
                <Switch v-model="item.enabled" :aria-label="`${item.label}自動判斷`" />
                <span class="text-xs text-ink-600 dark:text-zinc-300">啟用</span>
              </div>
            </template>
            <span v-else class="text-xs text-ink-400 dark:text-zinc-400 md:col-span-2">此項目不套用自動數值判斷</span>
          </div>
        </div>
      </section>
    </template>
  </section>
</template>

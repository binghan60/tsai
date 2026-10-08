<script setup>
import { apiErrorMessage } from '../lib/apiError';
import { computed, ref, watch } from 'vue';
import { ArrowRight } from '@lucide/vue';
import { http } from '../api/http';
import { useToast } from '../composables/useToast';
import { formatDateTime } from '../lib/datetime';
import { instrumentLabel } from '../lib/labResults';
import { labFlag } from '../../../shared/labValues.js';
import ModalDialog from './ModalDialog.vue';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';

// IDEXX 結果跟報告上已經填的值不同時的比對視窗，像 Windows 複製檔案時的「取代或略過」：
// 逐項列出「報告上目前」→「IDEXX」，可以全部覆蓋、只覆蓋勾選的、或都不要。
// 預設全部不勾（使用者決定：醫師手打的可能是刻意修正的，每一項都要人確認才換）；
// 所以有顏色的是「覆蓋勾選的」，不是一按就全部換掉的「全部覆蓋」。
// 每一項下面列參考範圍與單位、兩邊的值偏高偏低標 ↑↓——沒有這些醫師判斷不了要不要換。
// 關掉（右上角 ✕）＝稍後再說，不算處理；三個按鈕按下去才算，伺服器記下後兩邊（「檢驗」面板、健檢報告）都不再出現。
// 按下去之後的提示帶「復原」：換掉的格子填回去、差異重新打開（POST /lab-results/:id/conflicts/reopen）。
const props = defineProps({
  // 伺服器 GET /lab-results/conflicts 的一筆：
  // { id, instrument, runAt, petName, items: [{ key, label, current, idexx, unit, referenceMin, referenceMax }] }
  group: { type: Object, required: true },
});
const emit = defineEmits(['close', 'resolved']);
const toast = useToast();
const selected = ref([]);
const busy = ref(false);

watch(() => props.group?.id, () => { selected.value = []; }, { immediate: true });

const title = computed(() => {
  const { purpose, name } = instrumentLabel(props.group.instrument);
  return `${props.group.petName}　${[purpose, name].filter(Boolean).join(' ')}`;
});

function rangeText(item) {
  const hasMin = item.referenceMin !== null && item.referenceMin !== undefined;
  const hasMax = item.referenceMax !== null && item.referenceMax !== undefined;
  const range = hasMin && hasMax ? `${item.referenceMin}–${item.referenceMax}` : hasMin ? `≥ ${item.referenceMin}` : hasMax ? `≤ ${item.referenceMax}` : '';
  return [range, item.unit].filter(Boolean).join(' ');
}

const rows = computed(() => props.group.items.map((item) => ({
  ...item,
  range: rangeText(item),
  currentFlag: labFlag({ ...item, value: item.current }),
  idexxFlag: labFlag({ ...item, value: item.idexx }),
})));

function toggle(key, checked) {
  selected.value = checked ? [...new Set([...selected.value, key])] : selected.value.filter((value) => value !== key);
}

async function undo(id) {
  try {
    await http.post(`/lab-results/${id}/conflicts/reopen`);
    toast.success('數值已經換回去，這份檢驗結果會再詢問一次', '已復原');
  } catch (err) {
    toast.error(apiErrorMessage(err, '復原失敗，請稍後再試'));
  }
}

async function resolve(keys) {
  if (busy.value) return;
  busy.value = true;
  const id = props.group.id;
  try {
    const { data } = await http.post(`/lab-results/${id}/conflicts/resolve`, { overwrite: keys });
    const labels = props.group.items.filter((item) => data.overwritten.includes(item.key)).map((item) => item.label);
    toast.addToast({
      type: 'success',
      title: labels.length ? '已換成 IDEXX 的數值' : '已保留報告上的數值',
      message: labels.length ? labels.join('、') : '這份檢驗結果不會再詢問',
      action: { label: '復原', handler: () => undo(id) },
    });
    emit('resolved', data.overwritten);
  } catch (err) {
    toast.error(apiErrorMessage(err, '處理失敗，請稍後再試'));
    // 別台已經處理掉（409）就不必再顯示。
    if (err.response?.status === 409) emit('resolved', []);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ModalDialog size="md" title="IDEXX 檢驗結果跟報告上的數值不同" :description="`${title}　${formatDateTime(group.runAt)}`" @close="emit('close')">
    <div class="px-6 py-4">
      <p class="mb-3 text-sm text-muted-foreground">勾選要換成 IDEXX 數值的項目；沒勾的保留報告上目前的值。</p>
      <table class="w-full text-base">
        <thead>
          <tr class="border-b border-border text-left text-xs text-subtle-foreground">
            <th class="w-10 pb-2 font-medium"><span class="sr-only">覆蓋</span></th>
            <th class="pb-2 font-medium">項目</th>
            <th class="pb-2 text-right font-medium">報告上目前</th>
            <th class="w-8 pb-2"></th>
            <th class="pb-2 font-medium">IDEXX</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="item in rows" :key="item.key" :class="selected.includes(item.key) ? 'bg-accent' : ''">
            <td class="py-2.5 pl-1">
              <Checkbox
                :model-value="selected.includes(item.key)"
                :aria-label="`把 ${item.label} 換成 IDEXX 的 ${item.idexx}`"
                @update:model-value="toggle(item.key, $event === true)"
              />
            </td>
            <td class="py-2.5 pr-3">
              <span class="block font-medium">{{ item.label }}</span>
              <span class="num block min-h-lh text-xs text-subtle-foreground">{{ item.range }}</span>
            </td>
            <td class="num py-2.5 text-right" :class="[selected.includes(item.key) ? 'text-subtle-foreground line-through' : '', item.currentFlag && !selected.includes(item.key) ? 'text-danger' : '']">
              {{ item.current }}<span v-if="item.currentFlag" class="ml-0.5" :aria-label="item.currentFlag === '↑' ? '偏高' : '偏低'">{{ item.currentFlag }}</span>
            </td>
            <td class="py-2.5 text-center text-subtle-foreground"><ArrowRight class="mx-auto size-4" stroke-width="1.75" aria-hidden="true" /></td>
            <td class="num py-2.5 font-semibold" :class="item.idexxFlag ? 'text-danger' : ''">
              {{ item.idexx }}<span v-if="item.idexxFlag" class="ml-0.5" :aria-label="item.idexxFlag === '↑' ? '偏高' : '偏低'">{{ item.idexxFlag }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="flex flex-wrap items-center gap-2 border-t border-border px-6 py-4">
      <Button variant="secondary" :disabled="busy" @click="resolve([])">都不要</Button>
      <Button variant="secondary" class="ml-auto" :disabled="busy" @click="resolve(group.items.map((item) => item.key))">全部覆蓋</Button>
      <Button variant="soft" :disabled="busy || !selected.length" @click="resolve(selected)">覆蓋勾選的（{{ selected.length }}）</Button>
    </div>
  </ModalDialog>
</template>

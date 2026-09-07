<script setup>
import { computed } from 'vue';
import { Plus, Trash2 } from '@lucide/vue';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

// 批價／開藥合併清單的共用編輯器：候診卡片（醫生填批價/開藥）與待結帳卡片（櫃台調整）
// 共用同一份欄位邏輯，避免兩處各寫一份、之後改動只改一邊。真正的加總與正規化仍以
// 伺服器 lib/appointmentBilling.js 為準，這裡的小計只是送出前的即時預覽。
const props = defineProps({
  items: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:items']);

function addItem() {
  emit('update:items', [...props.items, { kind: 'fee', name: '', quantity: 1, unitPrice: 0, amount: 0, dosage: '', instructions: '' }]);
}

function removeItem(index) {
  emit('update:items', props.items.filter((_, i) => i !== index));
}

function updateItem(index, patch) {
  emit('update:items', props.items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
}

// 數量或單價改變時，小計自動跟著算；使用者仍可以在小計欄位手動覆寫（例如整批藥另外喊價）。
function recalculateAmount(index, item) {
  const quantity = Number(item.quantity) || 0;
  const unitPrice = Number(item.unitPrice) || 0;
  updateItem(index, { quantity, unitPrice, amount: Math.round(quantity * unitPrice) });
}

const subtotal = computed(() => props.items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0));
</script>

<template>
  <div class="space-y-2.5">
    <div v-if="!items.length" class="rounded-lg border border-dashed border-border bg-field/30 px-3 py-4 text-center text-xs text-muted-foreground">
      尚未新增項目
    </div>
    <div v-for="(item, index) in items" :key="index" class="space-y-2 rounded-lg border border-border/70 bg-card p-2.5">
      <div class="flex items-center gap-2">
        <Select :model-value="item.kind" :disabled="disabled" @update:model-value="(value) => updateItem(index, { kind: value })">
          <SelectTrigger class="h-9 w-24 shrink-0 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="fee">費用</SelectItem>
            <SelectItem value="medication">藥品</SelectItem>
          </SelectContent>
        </Select>
        <input
          :value="item.name"
          type="text"
          placeholder="項目名稱"
          class="h-9 min-w-0 flex-1 rounded-lg border border-input bg-card px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          :disabled="disabled"
          @input="updateItem(index, { name: $event.target.value })"
        />
        <Button type="button" variant="destructive" size="icon-xs" :disabled="disabled" :aria-label="`移除 ${item.name || '這個項目'}`" @click="removeItem(index)">
          <Trash2 class="h-3.5 w-3.5" stroke-width="1.75" />
        </Button>
      </div>
      <div class="grid grid-cols-3 gap-2">
        <label class="space-y-1 text-xs text-muted-foreground">
          數量
          <input
            :value="item.quantity"
            type="text"
            inputmode="decimal"
            class="h-8 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            :disabled="disabled"
            @input="recalculateAmount(index, { ...item, quantity: $event.target.value })"
          />
        </label>
        <label class="space-y-1 text-xs text-muted-foreground">
          單價
          <input
            :value="item.unitPrice"
            type="text"
            inputmode="decimal"
            class="h-8 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            :disabled="disabled"
            @input="recalculateAmount(index, { ...item, unitPrice: $event.target.value })"
          />
        </label>
        <label class="space-y-1 text-xs text-muted-foreground">
          小計
          <input
            :value="item.amount"
            type="text"
            inputmode="decimal"
            class="h-8 w-full rounded-md border border-input bg-card px-2 text-sm font-semibold text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            :disabled="disabled"
            @input="updateItem(index, { amount: $event.target.value })"
          />
        </label>
      </div>
      <div v-if="item.kind === 'medication'" class="grid grid-cols-2 gap-2">
        <input
          :value="item.dosage"
          type="text"
          placeholder="劑量"
          class="h-8 w-full rounded-md border border-input bg-card px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          :disabled="disabled"
          @input="updateItem(index, { dosage: $event.target.value })"
        />
        <input
          :value="item.instructions"
          type="text"
          placeholder="用法用量，例：每日兩次，飯後"
          class="h-8 w-full rounded-md border border-input bg-card px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          :disabled="disabled"
          @input="updateItem(index, { instructions: $event.target.value })"
        />
      </div>
    </div>
    <div class="flex items-center justify-between gap-2">
      <Button type="button" variant="secondary" size="xs" :disabled="disabled" @click="addItem">
        <Plus class="h-3.5 w-3.5" stroke-width="1.9" />新增項目
      </Button>
      <p class="text-xs font-semibold text-foreground">建議小計 NT$ {{ subtotal }}</p>
    </div>
  </div>
</template>

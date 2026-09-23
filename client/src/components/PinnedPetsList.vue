<script setup>
import { ref } from 'vue';
import { Hash, X } from '@lucide/vue';
import { usePinnedPetsStore } from '../stores/pinnedPets';
import { useToast } from '../composables/useToast';
import { clinicDateInput, formatDateTime } from '../lib/datetime';
import { Button } from './ui/button';
import { Card } from './ui/card';

// 寵物暫存區清單，診療台與櫃台共用。點整列開病歷速覽 Modal，右邊的 X 手動移除——
// 暫存區不會自己清空，只有人按了才拿掉。
const store = usePinnedPetsStore();
const toast = useToast();
const removing = ref('');
const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
const dateTimeOptions = { month: 'numeric', day: 'numeric', ...timeOptions };

// 暫存區會跨日留著，不是今天放進來的要帶日期，否則「09:30」看不出是哪一天。
function pinnedAtLabel(value) {
  return formatDateTime(value, clinicDateInput(value) === clinicDateInput() ? timeOptions : dateTimeOptions);
}

function pinnedByLabel(item) {
  return item.pinnedBy === 'front_desk' ? '櫃台' : '醫生';
}

async function remove(item) {
  if (removing.value) return;
  removing.value = String(item.petId);
  try {
    await store.unpin(item.petId);
  } catch (err) {
    toast.error(err.response?.data?.message || '移除失敗，請稍後再試');
  } finally {
    removing.value = '';
  }
}
</script>

<template>
  <!-- 一隻一列、欄位對齊（寵物｜飼主｜誰放進來），跟診療台已交櫃台／已完成清單同一種列。 -->
  <Card v-if="store.items.length" class="overflow-hidden p-0" style="--data-columns: minmax(10rem, 1.2fr) minmax(9rem, 1fr) minmax(9rem, 1fr) 2.25rem">
    <div class="desktop-data-header text-xs font-semibold text-muted-foreground">
      <span class="desktop-data-cell">寵物</span>
      <span class="desktop-data-cell">飼主</span>
      <span class="desktop-data-cell">放入</span>
      <span class="desktop-data-cell"></span>
    </div>
    <div
      v-for="item in store.items"
      :key="item._id"
      class="desktop-data-row cursor-pointer transition-colors hover:bg-field focus-visible:bg-field focus-visible:outline-none"
      role="button"
      tabindex="0"
      :aria-label="`查看 ${item.pet.name} 的病歷`"
      @click="store.openQuickView(item.petId)"
      @keydown.enter.self.prevent="store.openQuickView(item.petId)"
      @keydown.space.self.prevent="store.openQuickView(item.petId)"
    >
      <span class="desktop-data-cell flex items-baseline gap-1.5">
        <span class="min-w-0 truncate text-sm font-semibold text-primary">{{ item.pet.name }}</span>
        <span class="shrink-0 text-xs text-muted-foreground">{{ item.pet.species || '未填物種' }}</span>
      </span>
      <span class="desktop-data-cell truncate text-sm" :class="item.pet.owner?.name ? '' : 'text-muted-foreground'">
        {{ item.pet.owner?.name || '—' }}<span v-if="item.pet.owner?.phone" class="text-xs text-muted-foreground"> · {{ item.pet.owner.phone }}</span>
      </span>
      <span class="desktop-data-cell flex items-center gap-1 text-xs text-muted-foreground">
        <Hash v-if="item.source === 'mention'" class="h-3 w-3 shrink-0" stroke-width="1.75" />
        <span class="truncate">{{ pinnedByLabel(item) }}{{ item.source === 'mention' ? '在聊天標記' : '加入' }} · <span class="tabular-nums">{{ pinnedAtLabel(item.pinnedAt) }}</span></span>
      </span>
      <span class="desktop-data-cell text-right">
        <Button
          type="button"
          variant="secondary"
          size="icon-xs"
          :disabled="removing === String(item.petId)"
          :aria-label="`從暫存區移除 ${item.pet.name}`"
          @click.stop="remove(item)"
          @keydown.stop
        >
          <X class="h-3.5 w-3.5" stroke-width="1.75" />
        </Button>
      </span>
    </div>
  </Card>
</template>

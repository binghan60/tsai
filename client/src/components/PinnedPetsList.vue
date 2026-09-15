<script setup>
import { ref } from 'vue';
import { AtSign, X } from '@lucide/vue';
import { usePinnedPetsStore } from '../stores/pinnedPets';
import { useToast } from '../composables/useToast';
import { clinicDateInput, formatDateTime } from '../lib/datetime';
import { Button } from './ui/button';

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
  <div class="space-y-2">
    <div
      v-for="item in store.items"
      :key="item._id"
      class="flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-card p-3 transition-colors hover:bg-field focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      role="button"
      tabindex="0"
      @click="store.openQuickView(item.petId)"
      @keydown.enter.prevent="store.openQuickView(item.petId)"
      @keydown.space.prevent="store.openQuickView(item.petId)"
    >
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm">
          <span class="font-semibold text-primary">{{ item.pet.name }}</span>
          <span class="text-xs text-muted-foreground"> · {{ item.pet.species || '未填物種' }}<template v-if="item.pet.owner?.name"> · {{ item.pet.owner.name }}</template></span>
        </p>
        <p class="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          <AtSign v-if="item.source === 'mention'" class="h-3 w-3" stroke-width="1.75" />
          {{ pinnedByLabel(item) }}{{ item.source === 'mention' ? '在聊天標記' : '加入' }} · {{ pinnedAtLabel(item.pinnedAt) }}
        </p>
      </div>
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
    </div>
  </div>
</template>

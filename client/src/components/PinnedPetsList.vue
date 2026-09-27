<script setup>
import { ref } from 'vue';
import { Hash, X } from '@lucide/vue';
import { usePinnedPetsStore } from '../stores/pinnedPets';
import { useToast } from '../composables/useToast';
import { clinicDateInput, formatDateTime } from '../lib/datetime';
import { Button } from './ui/button';

// 暫存區清單（右側暫存區面板的首頁）。點整列推入病歷速覽，右邊的 X 手動移除——
// 暫存區不會自己清空，只有人按了才拿掉。
const store = usePinnedPetsStore();
const emit = defineEmits(['open']);
const toast = useToast();
const removing = ref('');
const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
const dateTimeOptions = { month: 'numeric', day: 'numeric', ...timeOptions };

// 暫存區會跨日留著，不是今天放進來的要帶日期，否則「09:30」看不出是哪一天。
function pinnedAtLabel(value) {
  return formatDateTime(value, clinicDateInput(value) === clinicDateInput() ? timeOptions : dateTimeOptions);
}

function pinnedByLabel(item) {
  const who = item.pinnedBy === 'front_desk' ? '櫃台' : '醫師';
  return item.source === 'mention' ? `${who}在聊天標記` : `${who}加入`;
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
  <ul v-if="store.items.length" class="divide-y divide-border">
    <li v-for="item in store.items" :key="item._id" class="group relative">
      <button
        type="button"
        class="flex w-full flex-col gap-1 px-5 py-3 pr-14 text-left transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
        :aria-label="`查看 ${item.pet.name} 的病歷`"
        @click="emit('open', item.petId)"
      >
        <span class="flex items-baseline gap-2">
          <span class="truncate text-base font-semibold text-primary">{{ item.pet.name }}</span>
          <span v-if="item.pet.breed || item.pet.species" class="truncate text-sm text-subtle-foreground">{{ item.pet.breed || item.pet.species }}</span>
        </span>
        <span v-if="item.pet.owner?.name || item.pet.owner?.phone" class="flex items-baseline gap-3 text-sm">
          <span class="truncate text-foreground">{{ item.pet.owner?.name }}</span>
          <span v-if="item.pet.owner?.phone" class="num shrink-0 text-muted-foreground">{{ item.pet.owner.phone }}</span>
        </span>
        <span class="flex items-center gap-1 text-xs text-subtle-foreground">
          <Hash v-if="item.source === 'mention'" class="size-3 shrink-0" stroke-width="2" aria-hidden="true" />
          {{ pinnedByLabel(item) }}<span class="num ml-1">{{ pinnedAtLabel(item.pinnedAt) }}</span>
        </span>
      </button>
      <Button
        type="button"
        variant="secondary"
        size="icon-xs"
        class="absolute top-3 right-4"
        :disabled="removing === String(item.petId)"
        :aria-label="`從暫存區移除 ${item.pet.name}`"
        @click="remove(item)"
      >
        <X stroke-width="1.75" />
      </Button>
    </li>
  </ul>
</template>

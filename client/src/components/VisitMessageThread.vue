<script setup>
import { ref } from 'vue';
import { Send } from '@lucide/vue';
import { Button } from './ui/button';
import { formatDateTime } from '../lib/datetime';
import { visitMessageSenderLabel } from '../lib/visitMessageThread';

const props = defineProps({
  messages: { type: Array, default: () => [] },
  identity: { type: String, required: true },
  disabled: { type: Boolean, default: false },
  sending: { type: Boolean, default: false },
});
const emit = defineEmits(['send']);

const draft = ref('');
const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false };

function submit() {
  const content = draft.value.trim();
  if (!content || props.sending) return;
  emit('send', content);
  draft.value = '';
}
</script>

<template>
  <div class="space-y-3">
    <p class="text-xs text-muted-foreground">醫生與櫃台之間的內部留言，不會出現在健檢報告中</p>

    <div class="max-h-64 space-y-2 overflow-y-auto rounded-lg bg-field/40 p-3">
      <p v-if="!messages.length" class="py-4 text-center text-sm text-muted-foreground">尚無留言</p>
      <div
        v-for="message in messages"
        :key="message._id"
        class="flex flex-col"
        :class="message.sender === identity ? 'items-end' : 'items-start'"
      >
        <div
          class="max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap"
          :class="message.sender === identity ? 'bg-accent text-accent-foreground' : 'bg-muted text-foreground'"
        >{{ message.content }}</div>
        <span class="mt-0.5 px-1 text-xs text-muted-foreground">
          {{ visitMessageSenderLabel(message.sender) }}・{{ formatDateTime(message.createdAt, timeOptions) }}
        </span>
      </div>
    </div>

    <form v-if="!disabled" class="flex items-end gap-2" @submit.prevent="submit">
      <textarea
        v-model="draft"
        rows="2"
        placeholder="輸入留言…"
        class="flex-1 rounded-lg border border-input bg-field px-3 py-2 text-sm text-foreground"
        @keydown.enter.exact.prevent="submit"
      ></textarea>
      <Button type="submit" size="icon" :disabled="!draft.trim() || sending" aria-label="送出留言">
        <Send class="h-4 w-4" stroke-width="1.75" />
      </Button>
    </form>
    <p v-else class="text-xs text-muted-foreground">此狀態的掛號無法留言</p>
  </div>
</template>

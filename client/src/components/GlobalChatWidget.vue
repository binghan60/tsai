<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { MessageCircle, Send, Settings, X } from '@lucide/vue';
import { http } from '../api/http';
import { useChatStore } from '../stores/chat';
import { useStaffIdentity } from '../composables/useStaffIdentity';
import { useToast } from '../composables/useToast';
import { formatDateTime } from '../lib/datetime';
import { useAppointmentNotificationPreferences } from '../lib/appointmentNotificationPreferences';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import ChatChangeSnapshot from './ChatChangeSnapshot.vue';

// 全站即時聊天的浮動視窗：右下角常駐泡泡，任何頁面都叫得出來，不綁任何
// 掛號／病患。身分在設定選單中選擇並記住，聊天室只顯示目前身分。
const store = useChatStore();
const { identity } = useStaffIdentity();
const toast = useToast();
const {
  options: notificationOptions,
  preferences: notificationPreferences,
  enabledCount: notificationEnabledCount,
  setPreference: setNotificationPreference,
  enableAll: enableAllNotifications,
  disableAll: disableAllNotifications,
} = useAppointmentNotificationPreferences();

const draft = ref('');
const sending = ref(false);
const listEl = ref(null);
const settingsOpen = ref(false);
const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false };

const badgeLabel = computed(() => (store.unreadCount > 9 ? '9+' : String(store.unreadCount)));

function toggleNotificationPreference(key) {
  setNotificationPreference(key, notificationPreferences.value[key] === false);
}

function senderLabel(sender) {
  return sender === 'front_desk' ? '櫃台' : '醫生';
}

function toggle() {
  if (store.isOpen) store.close();
  else store.open();
}

async function scrollToBottom() {
  await nextTick();
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
}

watch(() => store.messages.length, scrollToBottom);
watch(
  () => store.isOpen,
  (open) => { if (open) scrollToBottom(); }
);

async function submit() {
  const content = draft.value.trim();
  if (!content || sending.value) return;
  sending.value = true;
  try {
    // 送出成功後不用自己塞進 store——伺服器的 chat:new 廣播（見 useGlobalChat）
    // 會送回同一個連線，包含發話者自己，讓所有裝置走同一條路徑更新畫面。
    await http.post('/chat/messages', { sender: identity.value, content });
    draft.value = '';
  } catch (err) {
    toast.error(err.response?.data?.message || '訊息送出失敗，請稍後再試', '傳送失敗');
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3">
    <div v-if="store.isOpen" class="flex h-[34rem] w-[22rem] max-h-[calc(100vh-6rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-lg sm:w-[28rem]">
      <div class="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div class="min-w-0">
          <p class="text-sm font-semibold text-foreground">內部聊天</p>
          <p class="mt-0.5 text-xs text-muted-foreground">目前身分：{{ senderLabel(identity) }}</p>
        </div>
        <div class="flex items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="icon-xs"
            :aria-label="settingsOpen ? '關閉通知設定' : '開啟通知設定'"
            :aria-pressed="settingsOpen"
            @click="settingsOpen = !settingsOpen"
          >
            <Settings class="h-4 w-4" stroke-width="1.75" />
          </Button>
          <Button type="button" variant="secondary" size="icon-xs" aria-label="關閉聊天視窗" @click="store.close()">
            <X class="h-4 w-4" stroke-width="1.75" />
          </Button>
        </div>
      </div>
      <div v-if="settingsOpen" class="flex-1 overflow-y-auto px-4 py-3">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-foreground">自動通知</p>
            <p class="mt-0.5 text-xs text-muted-foreground">已開啟 {{ notificationEnabledCount }} / {{ notificationOptions.length }} 項</p>
          </div>
          <div class="flex shrink-0 gap-2">
            <Button type="button" variant="secondary" size="xs" @click="enableAllNotifications">全選</Button>
            <Button type="button" variant="secondary" size="xs" @click="disableAllNotifications">全關</Button>
          </div>
        </div>
        <div class="space-y-1.5">
          <div
            v-for="option in notificationOptions"
            :key="option.key"
            class="flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-lg bg-field px-3 py-2 text-sm hover:bg-muted"
            role="button"
            tabindex="0"
            :aria-pressed="notificationPreferences[option.key] !== false"
            @click="toggleNotificationPreference(option.key)"
            @keydown.enter.prevent="toggleNotificationPreference(option.key)"
            @keydown.space.prevent="toggleNotificationPreference(option.key)"
          >
            <span class="text-foreground">{{ option.label }}</span>
            <Switch
              size="sm"
              :model-value="notificationPreferences[option.key] !== false"
              :aria-label="`${option.label}通知`"
              @click.stop
              @update:model-value="value => setNotificationPreference(option.key, value)"
            />
          </div>
        </div>
      </div>
      <div v-else ref="listEl" class="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        <p v-if="!store.messages.length" class="py-8 text-center text-sm text-muted-foreground">還沒有訊息，開始聊聊吧</p>
        <div
          v-for="message in store.messages"
          :key="message._id"
          class="flex flex-col"
          :class="message.sender === identity ? 'items-end' : 'items-start'"
        >
          <div
            class="max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap"
            :class="message.sender === identity ? 'bg-accent text-accent-foreground' : 'bg-muted text-foreground'"
          >{{ message.content }}<div v-if="message.snapshot"><ChatChangeSnapshot :snapshot="message.snapshot" /></div></div>
          <span class="mt-0.5 px-1 text-xs text-muted-foreground">
            <span v-if="message.auto" class="mr-1 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">自動通知</span>
            {{ senderLabel(message.sender) }}・{{ formatDateTime(message.createdAt, timeOptions) }}
          </span>
        </div>
      </div>
      <form class="flex items-end gap-2 border-t border-border p-3" @submit.prevent="submit">
        <textarea
          v-model="draft"
          rows="1"
          placeholder="輸入訊息…"
          class="flex-1 rounded-lg border border-input bg-field px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          @keydown.enter.exact.prevent="submit"
        ></textarea>
        <Button type="submit" size="icon" :disabled="!draft.trim() || sending" aria-label="送出訊息">
          <Send class="h-4 w-4" stroke-width="1.75" />
        </Button>
      </form>
    </div>

    <button
      type="button"
      class="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
      :aria-label="store.isOpen ? '關閉聊天視窗' : '開啟聊天視窗'"
      @click="toggle"
    >
      <component :is="store.isOpen ? X : MessageCircle" class="h-6 w-6" stroke-width="1.75" />
      <span
        v-if="!store.isOpen && store.unreadCount"
        class="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-bold text-white ring-2 ring-background"
      >{{ badgeLabel }}</span>
    </button>
  </div>
</template>

<script setup>
import { nextTick, onActivated, ref, watch } from 'vue';
import { Bell, BellOff, Send } from '@lucide/vue';
import { useAppointmentNotificationPreferences } from '../../lib/appointmentNotificationPreferences';
import NotificationSettingsDialog from '../NotificationSettingsDialog.vue';
import { http } from '../../api/http';
import { useChatStore } from '../../stores/chat';
import { usePinnedPetsStore } from '../../stores/pinnedPets';
import { useUtilityPanelStore } from '../../stores/utilityPanel';
import { useStaffIdentity } from '../../composables/useStaffIdentity';
import { useToast } from '../../composables/useToast';
import { usePetMentionPicker } from '../../composables/usePetMentionPicker';
import { formatDateTime } from '../../lib/datetime';
import { splitMentionSegments } from '../../lib/chatMentions';
import SidePanel from './SidePanel.vue';
import ChatChangeSnapshot from '../ChatChangeSnapshot.vue';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';

// 全站內部聊天，右側工具欄的最後一個面板。不綁任何掛號或病患（「今天下午提早關診」）。
// 身分跟著這台裝置（設定選單切換）。自動通知的開關就放在這個面板的標頭（設定選單也有同一個入口）：
// 改版時曾經只留在設定選單，使用者在聊天室找不到開關。
const store = useChatStore();
const { options: notificationOptions, enabledCount: notificationEnabledCount } = useAppointmentNotificationPreferences();
const notificationsOpen = ref(false);
const pinned = usePinnedPetsStore();
const panel = useUtilityPanelStore();
const { identity } = useStaffIdentity();
const toast = useToast();

const draft = ref('');
const sending = ref(false);
const listEl = ref(null);
const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false };

function senderLabel(sender) {
  return sender === 'front_desk' ? '櫃台' : '醫師';
}

async function scrollToBottom() {
  await nextTick();
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
}
watch(() => store.messages.length, scrollToBottom);
onActivated(scrollToBottom);

// # 標記貓咪：被標記的會由伺服器放進暫存區。候選清單邏輯跟待辦共用。
const composerEl = ref(null);
const { mention, candidates, highlighted, updateMention, closeMention, selectCandidate, handleKeydown, mentionIdsIn, reset: resetMentions } = usePetMentionPicker({
  text: draft,
  getElement: () => composerEl.value?.querySelector('textarea') ?? null,
});

function onComposerKeydown(event) {
  if (handleKeydown(event)) return;
  // 中文輸入法選字時的 Enter 不是送出。
  if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing) {
    event.preventDefault();
    submit();
  }
}

async function submit() {
  const content = draft.value.trim();
  if (!content || sending.value) return;
  sending.value = true;
  try {
    const mentions = mentionIdsIn(content);
    // 不自己塞進 store：伺服器的 chat:new 廣播會送回同一條連線（包含發話者自己）。
    await http.post('/chat/messages', { sender: identity.value, content, ...(mentions.length ? { mentions } : {}) });
    draft.value = '';
    resetMentions();
  } catch (err) {
    toast.error(err.response?.data?.message || '訊息送出失敗，請稍後再試', '傳送失敗');
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <!-- KeepAlive 底下的根節點要是普通元素：直接放元件（還用 v-if 切換）收起時 Vue 會出錯。 -->
  <div class="h-full min-h-0">
    <SidePanel title="內部聊天" :description="`目前身分：${senderLabel(identity)}`" flush @close="panel.close()">
      <template #actions>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          :aria-label="`自動通知設定，已開啟 ${notificationEnabledCount} / ${notificationOptions.length} 項`"
          @click="notificationsOpen = true"
        >
          <component :is="notificationEnabledCount ? Bell : BellOff" stroke-width="1.75" />通知<span class="num text-xs text-muted-foreground">{{ notificationEnabledCount }}/{{ notificationOptions.length }}</span>
        </Button>
      </template>
      <div class="flex h-full min-h-0 flex-col">
        <div ref="listEl" class="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <p v-if="!store.messages.length" class="py-10 text-center text-muted-foreground">還沒有訊息</p>
          <div
            v-for="message in store.messages"
            :key="message._id"
            class="flex flex-col"
            :class="message.sender === identity ? 'items-end' : 'items-start'"
          >
            <div
              class="max-w-[88%] rounded-xl px-3.5 py-2 text-base whitespace-pre-wrap wrap-anywhere"
              :class="message.sender === identity ? 'rounded-br-sm bg-accent text-accent-foreground' : 'rounded-bl-sm bg-sunken text-foreground'"
            ><template v-for="(segment, index) in splitMentionSegments(message.content, message.mentions)" :key="index"
                ><button
                  v-if="segment.type === 'mention'"
                  type="button"
                  class="mx-0.5 inline-flex items-center rounded-full px-1.5 font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  :class="message.sender === identity ? 'bg-card' : 'bg-accent'"
                  v-tip="segment.mention.ownerName ? `飼主：${segment.mention.ownerName}` : undefined"
                  @click="pinned.openQuickView(segment.mention.petId)"
                >#{{ segment.mention.petName }}</button
                ><template v-else>{{ segment.text }}</template></template
            ><div v-if="message.snapshot"><ChatChangeSnapshot :snapshot="message.snapshot" /></div></div>
            <span class="mt-1 flex items-center gap-1.5 px-1 text-xs text-subtle-foreground">
              <span v-if="message.auto" class="rounded-sm bg-sunken px-1.5 py-0.5 font-semibold">自動通知</span>
              {{ senderLabel(message.sender) }}<span class="num">{{ formatDateTime(message.createdAt, timeOptions) }}</span>
            </span>
          </div>
        </div>

        <form ref="composerEl" class="relative flex shrink-0 items-end gap-2 border-t border-border px-4 py-3" @submit.prevent="submit">
          <ul
            v-if="mention && candidates.length"
            class="absolute inset-x-4 bottom-full mb-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-menu"
            role="listbox"
            aria-label="標記貓咪"
          >
            <li
              v-for="(candidate, index) in candidates"
              :key="candidate.petId"
              role="option"
              :aria-selected="index === highlighted"
              class="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2"
              :class="index === highlighted ? 'bg-hover' : ''"
              @mousedown.prevent="selectCandidate(candidate)"
              @mouseenter="highlighted = index"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate font-semibold">{{ candidate.petName }}</span>
                <span class="flex gap-3 text-sm text-muted-foreground"><span v-if="candidate.ownerName" class="truncate">{{ candidate.ownerName }}</span><span v-if="candidate.ownerPhone" class="num shrink-0">{{ candidate.ownerPhone }}</span></span>
              </span>
              <span v-if="candidate.today" class="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">今日掛號</span>
            </li>
          </ul>
          <Textarea
            v-model="draft"
            rows="1"
            placeholder="輸入訊息，打 # 標記貓咪"
            class="min-h-10 flex-1 resize-none"
            @keydown="onComposerKeydown"
            @input="updateMention"
            @click="updateMention"
            @keyup.left="updateMention"
            @keyup.right="updateMention"
            @blur="closeMention"
          />
          <Button type="submit" size="icon" :disabled="!draft.trim() || sending" aria-label="送出訊息">
            <Send stroke-width="1.75" />
          </Button>
        </form>
      </div>
    </SidePanel>
    <NotificationSettingsDialog v-model:open="notificationsOpen" />
  </div>
</template>

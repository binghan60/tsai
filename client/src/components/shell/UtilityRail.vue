<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { ClipboardPlus, ListTodo, MessageCircle, Pill, Pin } from '@lucide/vue';
import { medicationTodoCount } from '../../../../shared/medicationWorkflow.js';
import { useStaffIdentity } from '../../composables/useStaffIdentity';
import { useChatStore } from '../../stores/chat';
import { usePinnedPetsStore } from '../../stores/pinnedPets';
import { useTodosStore } from '../../stores/todos';
import { useUtilityPanelStore } from '../../stores/utilityPanel';
import { useWorkCountsStore } from '../../stores/workCounts';

// 右側 64px 工具欄：開側滑面板的按鈕。數字只有兩種讀法——
//   灰色（neutral）＝狀態讀數：暫存區裡有幾隻，0 也照顯示；
//   紅色（todo）＝要人動手：藥單、待辦、初診、聊天未讀，0 就不畫。
// 初診只在掛號台出現（只有櫃台在審）；聊天放在最下面。
const route = useRoute();
const panel = useUtilityPanelStore();
const pinned = usePinnedPetsStore();
const todos = useTodosStore();
const chat = useChatStore();
const counts = useWorkCountsStore();
const { identity } = useStaffIdentity();

const items = computed(() => [
  // 暫存區有東西＝有人丟了一隻貓過來要對方看，使用者要求跟其他待辦一樣用紅色徽章（0 就不畫）。
  { key: 'pinned', icon: Pin, short: '暫存', label: '暫存區', count: pinned.items.length, tone: 'todo' },
  {
    key: 'medications',
    icon: Pill,
    short: '藥單',
    label: identity.value === 'vet' ? '藥單（待醫師確認）' : '藥單（待包藥與待領藥）',
    count: medicationTodoCount(counts.medications, identity.value === 'vet' ? 'doctor' : 'reception'),
    tone: 'todo',
  },
  { key: 'todos', icon: ListTodo, short: '待辦', label: '院內待辦（未完成）', count: todos.openCount, tone: 'todo' },
  ...(route.path.startsWith('/reception') ? [{ key: 'intake', icon: ClipboardPlus, short: '初診', label: '初診表（待審核）', count: counts.intake, tone: 'todo' }] : []),
]);
const chatItem = computed(() => ({ key: 'chat', icon: MessageCircle, short: '聊天', label: '內部聊天（未讀）', count: chat.unreadCount, tone: 'todo' }));

function countText(count) {
  return count > 99 ? '99+' : String(count);
}
function showCount(item) {
  return item.tone === 'todo' ? item.count > 0 : item.count != null;
}
</script>

<template>
  <aside aria-label="工具欄" class="relative z-30 flex h-full w-16 shrink-0 flex-col items-center gap-1 border-l border-border bg-card py-3">
    <template v-for="item in [...items, null, chatItem]" :key="item?.key || 'spacer'">
      <span v-if="!item" class="flex-1"></span>
      <button
        v-else
        type="button"
        class="relative flex h-[3.625rem] w-[3.375rem] flex-col items-center justify-center gap-1 rounded-[10px] transition-colors"
        :class="panel.active === item.key ? 'bg-accent text-accent-foreground dark:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--primary)_40%,transparent)]' : 'text-muted-foreground hover:bg-hover hover:text-foreground'"
        :aria-pressed="panel.active === item.key"
        :aria-label="showCount(item) ? `${item.label} ${item.count}` : item.label"
        @click="panel.toggle(item.key)"
      >
        <component :is="item.icon" class="size-5" :stroke-width="panel.active === item.key ? 2 : 1.75" />
        <span class="text-2xs leading-none" :class="panel.active === item.key ? 'font-semibold' : 'font-medium'">{{ item.short }}</span>
        <span
          v-if="showCount(item)"
          class="num absolute top-0.5 right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-2xs leading-none font-bold"
          :class="item.tone === 'todo' ? 'bg-badge text-badge-foreground ring-2 ring-card' : 'bg-sunken text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]'"
          aria-hidden="true"
        >{{ countText(item.count) }}</span>
      </button>
    </template>
  </aside>
</template>

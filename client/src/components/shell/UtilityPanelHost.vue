<script setup>
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useChatStore } from '../../stores/chat';
import { useUtilityPanelStore } from '../../stores/utilityPanel';
import PinnedPanel from '../panels/PinnedPanel.vue';
import MedicationsPanel from '../panels/MedicationsPanel.vue';
import TodosPanel from '../panels/TodosPanel.vue';
import IntakePanel from '../panels/IntakePanel.vue';
import ChatPanel from '../panels/ChatPanel.vue';

// 工具欄面板的容器，460px 寬，貼在工具欄左邊。
// 1600px 以上是版面裡的一欄，會把工作區往左推（並排看）；更窄時浮在工作區上面、不推版面。
// 兩種情況都不加遮罩、不鎖背景：面板是「一邊做事一邊查」的工具。
// KeepAlive：關掉再打開時藥單表單、聊天草稿、捲動位置都還在。
const PANELS = { pinned: PinnedPanel, medications: MedicationsPanel, todos: TodosPanel, intake: IntakePanel, chat: ChatPanel };
const panel = useUtilityPanelStore();
const chat = useChatStore();
const route = useRoute();
const current = computed(() => PANELS[panel.active] || null);

// 聊天面板開著才算「已讀」；未讀數字由 chat store 自己依 isOpen 判斷。
watch(() => panel.active === 'chat', (open) => (open ? chat.open() : chat.close()), { immediate: true });
// 初診面板只屬於掛號台；離開掛號台就收起來，免得工具欄上已經沒有它的按鈕卻還開著。
watch(() => route.path, (path) => {
  if (panel.active === 'intake' && !path.startsWith('/reception')) panel.close();
});

function onKeydown(event) {
  if (event.key === 'Escape' && !event.defaultPrevented) panel.close();
}
</script>

<template>
  <div
    v-show="current"
    class="z-20 flex h-full w-[28.75rem] max-w-[calc(100vw-4rem)] shrink-0 flex-col border-l border-border bg-card max-[1599px]:fixed max-[1599px]:top-0 max-[1599px]:right-16 max-[1599px]:bottom-0 max-[1599px]:shadow-pop"
    @keydown="onKeydown"
  >
    <!-- key 一定要給：v-if 分支會被編譯成固定的 key 0，不給的話每個面板共用同一個快取格，切換面板就拿到別人的實例。
         （註解不能放進 KeepAlive 裡面：它只收一個子節點，註解也算一個。） -->
    <KeepAlive>
      <component :is="current" v-if="current" :key="panel.active" />
    </KeepAlive>
  </div>
</template>

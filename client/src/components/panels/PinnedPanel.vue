<script setup>
import { computed, ref, watch } from 'vue';
import { Pin } from '@lucide/vue';
import { usePinnedPetsStore } from '../../stores/pinnedPets';
import { useUtilityPanelStore } from '../../stores/utilityPanel';
import SidePanel from './SidePanel.vue';
import PetQuickView from './PetQuickView.vue';
import PinnedPetsList from '../PinnedPetsList.vue';
import EmptyState from '../EmptyState.vue';
import Pagination from '../Pagination.vue';

// 暫存區：首頁是暫存清單，點一隻貓在面板內推入病歷速覽。
const pinned = usePinnedPetsStore();
const panel = useUtilityPanelStore();
const view = computed(() => (panel.active === 'pinned' ? panel.view : (panel.stacks.pinned || []).at(-1) || null));

// 暫存區不會自己清空，堆多了就分頁（store 拿到的是整份，前端切）。頁碼列固定在面板底部，跟其他面板一樣。
const PAGE_SIZE = 20;
const page = ref(1);
const listTop = ref(null);
const totalPages = computed(() => Math.max(1, Math.ceil(pinned.items.length / PAGE_SIZE)));
const pageItems = computed(() => pinned.items.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
// 移除讓最後一頁空掉時退回新的最後一頁。
watch(totalPages, (value) => { if (page.value > value) page.value = value; });
function goToPage(value) {
  page.value = value;
  listTop.value?.scrollIntoView({ block: 'start' });
}
</script>

<template>
  <!-- KeepAlive 底下的根節點要是普通元素：直接放元件（還用 v-if 切換）收起時 Vue 會出錯。 -->
  <div class="h-full min-h-0">
    <PetQuickView
      v-if="view?.type === 'pet'"
      :key="view.petId"
      :pet-id="view.petId"
      :can-back="true"
      @back="panel.back()"
      @close="panel.close()"
    />
    <SidePanel v-else title="暫存區" description="在聊天打 # 標記的貓咪會放進來" flush @close="panel.close()">
      <span ref="listTop" aria-hidden="true"></span>
      <PinnedPetsList :items="pageItems" @open="panel.openPet" />
      <EmptyState v-if="!pinned.items.length" :icon="Pin" title="暫存區是空的" description="在聊天打 # 加上貓咪名字，或在貓咪資料頁按「加入暫存區」。" inset />
      <template v-if="totalPages > 1" #footer>
        <Pagination class="w-full" :page="page" :total-pages="totalPages" @update:page="goToPage" />
      </template>
    </SidePanel>
  </div>
</template>

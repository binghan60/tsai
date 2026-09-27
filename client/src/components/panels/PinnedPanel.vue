<script setup>
import { computed } from 'vue';
import { Pin } from '@lucide/vue';
import { usePinnedPetsStore } from '../../stores/pinnedPets';
import { useUtilityPanelStore } from '../../stores/utilityPanel';
import SidePanel from './SidePanel.vue';
import PetQuickView from './PetQuickView.vue';
import PinnedPetsList from '../PinnedPetsList.vue';
import EmptyState from '../EmptyState.vue';

// 暫存區：首頁是暫存清單，點一隻貓在面板內推入病歷速覽。
const pinned = usePinnedPetsStore();
const panel = useUtilityPanelStore();
const view = computed(() => (panel.active === 'pinned' ? panel.view : (panel.stacks.pinned || []).at(-1) || null));
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
      <PinnedPetsList @open="panel.openPet" />
      <EmptyState v-if="!pinned.items.length" :icon="Pin" title="暫存區是空的" description="在聊天打 # 加上貓咪名字，或在貓咪資料頁按「加入暫存區」。" inset />
    </SidePanel>
  </div>
</template>

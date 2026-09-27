<script setup>
import { useUtilityPanelStore } from '../../stores/utilityPanel';
import SidePanel from './SidePanel.vue';
import TodoPanel from '../TodoPanel.vue';

const panel = useUtilityPanelStore();
</script>

<template>
  <!-- KeepAlive 底下的根節點要是普通元素：直接放元件（還用 v-if 切換）收起時 Vue 會出錯。 -->
  <div class="h-full min-h-0">
    <SidePanel title="待辦" description="院內共用，醫師與櫃台即時同步" @close="panel.close()">
      <TodoPanel />
    </SidePanel>
  </div>
</template>

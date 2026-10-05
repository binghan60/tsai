<script setup>
import { ref } from 'vue';
import { useUtilityPanelStore } from '../../stores/utilityPanel';
import SidePanel from './SidePanel.vue';
import TodoPanel from '../TodoPanel.vue';
import Pagination from '../Pagination.vue';

const panel = useUtilityPanelStore();
// 頁碼列跟其他面板一樣固定在底部，分頁狀態在 TodoPanel 裡。
const list = ref(null);
</script>

<template>
  <!-- KeepAlive 底下的根節點要是普通元素：直接放元件（還用 v-if 切換）收起時 Vue 會出錯。 -->
  <div class="h-full min-h-0">
    <SidePanel title="待辦" description="院內共用，醫師與櫃台即時同步" @close="panel.close()">
      <TodoPanel ref="list" />
      <template v-if="list?.totalPages > 1" #footer>
        <Pagination class="w-full" :page="list.page" :total-pages="list.totalPages" @update:page="list.goToPage" />
      </template>
    </SidePanel>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useStaffIdentity } from '../../composables/useStaffIdentity';
import { useUtilityPanelStore } from '../../stores/utilityPanel';
import { useWorkCountsStore } from '../../stores/workCounts';
import SidePanel from './SidePanel.vue';
import MedicationWorkspace from '../MedicationWorkspace.vue';

// 藥單面板：清單＋單筆詳情在同一層切換（MedicationWorkspace 自己管），
// 「新增藥單」是推入的一層，有自己的返回鈕。醫師與櫃台看的階段不同，依這台裝置的身分決定。
const panel = useUtilityPanelStore();
const counts = useWorkCountsStore();
const { identity } = useStaffIdentity();
const doctor = computed(() => identity.value === 'vet');
const view = computed(() => (panel.stacks.medications || []).at(-1) || null);
// 從新增表單按返回：交給表單自己的 close()，有未儲存內容時會先問要不要捨棄，確定後它 emit('close') 才真的退回清單。
// 右上角的關閉只是收起面板（KeepAlive 留著），不會丟掉草稿。
const createForm = ref(null);
function backFromCreate() {
  if (createForm.value) createForm.value.close();
  else panel.back();
}
</script>

<template>
  <!-- KeepAlive 底下的根節點要是普通元素：直接放元件（還用 v-if 切換）收起時 Vue 會出錯。 -->
  <div class="h-full min-h-0">
    <SidePanel v-if="view?.type === 'create'" title="新增藥單" description="送交醫師確認後才會包藥" :can-back="true" back-label="返回藥單" @back="backFromCreate" @close="panel.close()">
      <MedicationWorkspace ref="createForm" mode="reception" compact create-only @close="panel.back()" />
    </SidePanel>
    <SidePanel v-else title="藥單" :description="doctor ? '待醫師確認的藥單在最前面' : '包藥與領藥'" @close="panel.close()">
      <MedicationWorkspace
        :key="identity"
        :mode="doctor ? 'doctor' : 'reception'"
        :initial-filter="doctor ? 'review' : 'approved'"
        :stages="['review', 'approved', 'ready', 'collected']"
        compact
        @counts="counts.setMedications"
        @create="panel.push({ type: 'create' }, 'medications')"
      />
    </SidePanel>
  </div>
</template>

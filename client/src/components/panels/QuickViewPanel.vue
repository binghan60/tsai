<script setup>
import { computed } from 'vue';
import { useUtilityPanelStore } from '../../stores/utilityPanel';
import VisitQuickView from './VisitQuickView.vue';
import HospitalQuickView from './HospitalQuickView.vue';

// 掛號台的速覽面板：點在院的卡片開看診速覽，點「住院中」一列開住院速覽。只看不改，要動手到診療台或住院專區。
const panel = useUtilityPanelStore();
const view = computed(() => (panel.stacks.quickview || []).at(-1) || null);
</script>

<template>
  <!-- KeepAlive 底下的根節點要是普通元素：直接放元件（還用 v-if 切換）收起時 Vue 會出錯。 -->
  <div class="h-full min-h-0">
    <VisitQuickView v-if="view?.type === 'visit'" :key="`visit-${view.appointmentId}`" :appointment-id="view.appointmentId" @close="panel.close()" />
    <HospitalQuickView v-else-if="view?.type === 'hospital'" :key="`hospital-${view.hospitalizationId}`" :hospitalization-id="view.hospitalizationId" @close="panel.close()" />
  </div>
</template>

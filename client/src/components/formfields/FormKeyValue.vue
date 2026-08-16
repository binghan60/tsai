<script setup>
import { computed } from 'vue';
import FieldControl from './FieldControl.vue';
import SelectableItem from './SelectableItem.vue';
import { sectionRuns } from '../../lib/sectionRuns';
import { spanClass } from '../../lib/fieldSpan';

const props = defineProps({ section: { type: Object, required: true } });
// 一般欄位三欄一排、長文字兩欄一排，但照使用者排定的順序切段落。
const runs = computed(() => sectionRuns(props.section.items, (item) => item.type !== 'textarea'));
</script>

<template>
  <div class="@container space-y-4">
    <div
      v-for="run in runs"
      :key="run.key"
      class="grid gap-x-4 gap-y-4"
      :class="run.kind === 'primary' ? '@sm:grid-cols-2 @2xl:grid-cols-3' : '@xl:grid-cols-2'"
    >
      <div v-for="item in run.items" :key="item.key" :class="spanClass(item, run.kind === 'primary' ? 'sm' : 'xl')">
        <SelectableItem :item-key="item.key">
          <FieldControl :item="item" :section="section" />
        </SelectableItem>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import FieldControl from './FieldControl.vue';
import PreviousValue from './PreviousValue.vue';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import SelectableItem from './SelectableItem.vue';
import { useRecordForm } from './context';
import { sectionRuns } from '../../lib/sectionRuns';
import { spanClass } from '../../lib/fieldSpan';

const props = defineProps({ section: { type: Object, required: true } });
const { valueFor, setValue, autoJudgeMeasurement } = useRecordForm();

// 量測值排成數值卡片、其餘欄位排成兩欄，但照使用者排定的順序切段落。
const runs = computed(() => sectionRuns(props.section.items, (item) => item.type === 'measurement'));
</script>

<template>
  <div class="@container space-y-5">
    <template v-for="run in runs" :key="run.key">
      <div v-if="run.kind === 'primary'" class="grid gap-5 @sm:grid-cols-2 @3xl:grid-cols-5">
        <div v-for="metric in run.items" :key="metric.key" :class="spanClass(metric, 'sm')">
          <SelectableItem :item-key="metric.key">
          <div>
            <Label :for="`record-${metric.key}`" class="text-xs font-medium text-muted-foreground">
              {{ metric.label }}<span v-if="metric.unit" class="text-muted-foreground"> ({{ metric.unit }})</span>
            </Label>
            <Input
              :id="`record-${metric.key}`"
              :model-value="valueFor(metric)"
              class="measurement-field mt-1.5"
              type="text"
              inputmode="decimal"
              @update:model-value="setValue(metric, $event); autoJudgeMeasurement(metric, $event)"
            />
            <PreviousValue :item="metric" compact />
          </div>
          </SelectableItem>
        </div>
      </div>
      <div v-else class="grid gap-x-4 gap-y-4 @xl:grid-cols-2">
        <div v-for="item in run.items" :key="item.key" :class="spanClass(item, 'xl')">
          <SelectableItem :item-key="item.key">
            <FieldControl :item="item" :section="section" />
          </SelectableItem>
        </div>
      </div>
    </template>
  </div>
</template>

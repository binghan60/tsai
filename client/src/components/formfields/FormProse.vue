<script setup>
import { computed } from 'vue';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import FieldControl from './FieldControl.vue';
import SelectableItem from './SelectableItem.vue';
import TextTemplateTrigger from './TextTemplateTrigger.vue';
import { useRecordForm } from './context';
import { sectionRuns } from '../../lib/sectionRuns';
import { spanClass } from '../../lib/fieldSpan';

const props = defineProps({ section: { type: Object, required: true } });
const { valueFor, setValue } = useRecordForm();

const items = computed(() => props.section.items ?? []);
// 長文字一行一個、其餘欄位兩欄一排，但照使用者排定的順序切段落。
const runs = computed(() => sectionRuns(items.value, (item) => item.type === 'textarea'));

// 結論與照護建議是「擇一必填」，兩邊都空的時候各自標示提醒。
</script>

<template>
  <div class="@container space-y-4">
    <template v-for="run in runs" :key="run.key">
      <div v-if="run.kind === 'primary'" class="space-y-4">
        <SelectableItem v-for="item in run.items" :key="item.key" :item-key="item.key">
          <div class="space-y-1.5">
            <Label :for="`record-${item.key}`" class="text-xs font-medium text-muted-foreground">
              {{ item.label }}
              <span v-if="item.required" class="text-danger" aria-hidden="true">*</span>
            </Label>
            <div class="relative">
              <Textarea
              :id="`record-${item.key}`"
              :model-value="valueFor(item)"
              :rows="item.rows || 4"
              :placeholder="item.placeholder"
              class="pr-20"
              @update:model-value="setValue(item, $event)"
            />
            <TextTemplateTrigger
              :item-key="item.key"
              :label="item.label"
              :model-value="valueFor(item)"
              @update:model-value="setValue(item, $event)"
            />
            </div>
          </div>
        </SelectableItem>
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

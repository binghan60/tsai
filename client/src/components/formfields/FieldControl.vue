<script setup>
import { computed } from 'vue';
import ScalarField from './ScalarField.vue';
import StatusToggle from './StatusToggle.vue';
import FieldShell from './FieldShell.vue';
import TextTemplateTrigger from './TextTemplateTrigger.vue';
import DentalChart from './DentalChart.vue';
import QuickSelectField from './QuickSelectField.vue';
import ImageUploadField from './ImageUploadField.vue';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { useRecordForm } from './context';
import { familyOf } from '../../lib/fieldFamily';

// 任何欄位型別都能放進任何版式的區塊。這裡是「不在原生版式裡」時的精簡控制項：
// 理學檢查／檢驗／量測值各有自己的簽名排版（整列的三態清單、分組表格、數值卡片），
// 那些排版塞不進網格的一格，所以這裡改用縱向堆疊的緊湊版本，資料綁定完全相同。
const props = defineProps({
  item: { type: Object, required: true },
  section: { type: Object, required: true },
});

const {
  valueFor, setValue, findingsFor, labsFor, labRangeLabel,
  setLabStatus, autoJudgeLab, autoJudgeLabText, autoJudgeMeasurement,
  preview,
} = useRecordForm();

const family = computed(() => familyOf(props.item));
const inputId = computed(() => `record-${props.item.key}`);

// 作答列是另一份資料，用 key 對回來；找不到就不渲染，避免半殘的控制項。
const entry = computed(() => {
  if (family.value === 'finding') return findingsFor(props.section).find((row) => row.key === props.item.key) ?? null;
  if (family.value === 'lab') return labsFor(props.section).find((row) => row.key === props.item.key) ?? null;
  return null;
});

const referenceText = computed(() => labRangeLabel(props.item));
const imageValue = computed(() => {
  const value = valueFor(props.item);
  return Array.isArray(value) ? value : [];
});
</script>

<template>
  <!-- 理學檢查：三態切換 + 備註 -->
  <div v-if="family === 'finding'">
    <FieldShell v-if="entry" :item="item" :input-id="`record-exam-note-${item.key}`">
      <div :id="`record-exam-row-${item.key}`" class="scroll-mt-40 space-y-2">
        <StatusToggle :finding="entry" :aria-label="`${item.label}檢查結果`" @select="entry.status = $event" />
        <div class="relative">
          <Textarea
            :id="`record-exam-note-${item.key}`"
            v-model="entry.note"
            :aria-label="`${item.label}備註`"
            rows="2"
            :placeholder="entry.status === 'abnormal' ? '請描述異常（選填）' : '備註（選填）'"
            class="min-h-16 resize-y scroll-mt-40 border-border bg-field pr-20 text-foreground focus-visible:border-belle-500"
          />
          <TextTemplateTrigger v-model="entry.note" :item-key="item.key" :label="`${item.label}備註`" :input-id="`record-exam-note-${item.key}`" />
        </div>
      </div>
    </FieldShell>
  </div>

  <!-- 檢驗項目：三態切換 + 數值 + 備註 -->
  <div v-else-if="family === 'lab'">
    <FieldShell v-if="entry" :item="item" :input-id="`record-lab-value-${item.key}`">
      <div :id="`record-lab-row-${item.key}`" class="scroll-mt-40 space-y-2">
        <StatusToggle :finding="entry" :aria-label="`${item.label}檢驗結果`" show-auto-badge @select="setLabStatus(entry, $event)" />
        <div class="relative">
          <Textarea
            :id="`record-lab-value-${item.key}`"
            v-model="entry.value"
            type="text"
            inputmode="decimal"
            :aria-label="`${item.label}數值`"
            :placeholder="entry.numeric === false ? '結果描述（選填）' : '檢驗數值'"
            class="min-h-11 w-full scroll-mt-40 rounded-xl border border-border bg-field px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            :class="entry.numeric === false ? 'pr-20' : ''"
            @input="entry.numeric !== false ? autoJudgeLab(entry, $event.target.value) : autoJudgeLabText(entry, $event.target.value)"
          />
          <TextTemplateTrigger
            v-if="entry.numeric === false"
            v-model="entry.value"
            :item-key="`${item.key}:value`"
            :label="`${item.label}結果描述`"
            :input-id="`record-lab-value-${item.key}`"
          />
        </div>
        <div class="relative">
          <Textarea
            :id="`record-lab-note-${item.key}`"
            v-model="entry.note"
            :aria-label="`${item.label}備註`"
            rows="2"
            :placeholder="entry.status === 'abnormal' ? '請描述異常（選填）' : '備註（選填）'"
            class="min-h-16 resize-y scroll-mt-40 border-border bg-field pr-20 text-foreground focus-visible:border-belle-500"
          />
          <TextTemplateTrigger v-model="entry.note" :item-key="item.key" :label="`${item.label}備註`" :input-id="`record-lab-note-${item.key}`" />
        </div>
        <p v-if="referenceText" class="text-xs text-success">參考 {{ referenceText }}</p>
      </div>
    </FieldShell>
  </div>

  <!-- 量測值：數值輸入 -->
  <FieldShell v-else-if="family === 'measurement'" :item="item" :input-id="inputId">
    <Input
      :id="inputId"
      :model-value="valueFor(item)"
      class="measurement-field"
      type="text"
      inputmode="decimal"
      @update:model-value="setValue(item, $event); autoJudgeMeasurement(item, $event)"
    />
  </FieldShell>

  <FieldShell v-else-if="family === 'dental'" :item="item" :input-id="inputId">
    <DentalChart :id="inputId" :model-value="valueFor(item)" :readonly="preview" @update:model-value="setValue(item, $event)" />
  </FieldShell>

  <QuickSelectField v-else-if="item.type === 'quickSelect'" :item="item" :model-value="valueFor(item)" @update:model-value="setValue(item, $event)" />

  <ImageUploadField v-else-if="item.type === 'image'" :item="item" :model-value="imageValue" @update:model-value="setValue(item, $event)" />

  <ScalarField v-else :item="item" :model-value="valueFor(item)" @update:model-value="setValue(item, $event)" />
</template>

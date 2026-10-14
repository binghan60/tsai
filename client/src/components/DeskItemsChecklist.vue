<script setup>
import { computed } from 'vue';
import { Checkbox } from './ui/checkbox';
import { DESK_ITEM_GROUPS, toggleDeskItem } from '../../../shared/deskItems.js';

// 「處理事項」勾選框（shared/deskItems.js）：櫃台處理視窗與病歷日誌的修改模式共用，兩邊長一樣。
// 病歷日誌的檢視模式不用它：只列有勾的項目（ClinicalNoteRowValue.vue）。
// 影像、收據兩組一次只能選一個（勾新的會取消同組原本那個）；「上傳影像」有自己的欄位（imageUpload，會新增待辦），
// 在畫面上屬於影像那一組，所以它跟影像USB／NO影像互相取消。
const props = defineProps({
  items: { type: Array, default: () => [] },
  imageUpload: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  // 同一頁可能有好幾個（日誌每一則各一個），id 要不同。
  idPrefix: { type: String, default: 'desk' },
});
const emit = defineEmits(['update:items', 'update:imageUpload']);

const IMAGE_ITEM_KEYS = DESK_ITEM_GROUPS.find((group) => group.key === 'image').items.map((item) => item.key);

function setImageUpload(checked) {
  emit('update:imageUpload', checked);
  if (checked) emit('update:items', props.items.filter((key) => !IMAGE_ITEM_KEYS.includes(key)));
}

function setItem(key, checked) {
  emit('update:items', toggleDeskItem(props.items, key, checked));
  if (checked && IMAGE_ITEM_KEYS.includes(key) && props.imageUpload) emit('update:imageUpload', false);
}

const groups = computed(() => DESK_ITEM_GROUPS.map((group) => ({
  key: group.key,
  label: group.label,
  items: [
    ...(group.key === 'image' ? [{ key: 'image_upload', id: `${props.idPrefix}-image-upload`, label: '上傳影像', checked: props.imageUpload, change: setImageUpload }] : []),
    ...group.items.map((item) => ({
      key: item.key,
      id: `${props.idPrefix}-item-${item.key}`,
      label: item.label,
      checked: props.items.includes(item.key),
      change: (checked) => setItem(item.key, checked),
    })),
  ],
})));
</script>

<template>
  <div class="space-y-1">
    <div v-for="group in groups" :key="group.key" class="flex items-start gap-3">
      <p class="spec-label w-9 shrink-0 pt-[0.6rem]">{{ group.label }}</p>
      <div class="flex min-w-0 flex-1 flex-wrap gap-x-5 gap-y-0">
        <template v-for="item in group.items" :key="item.key">
          <label :for="item.id" class="flex min-h-9 cursor-pointer items-center gap-2 text-sm font-medium">
            <Checkbox :id="item.id" :model-value="item.checked" :disabled="disabled" @update:model-value="item.change($event === true)" />
            {{ item.label }}
          </label>
        </template>
      </div>
    </div>
  </div>
</template>

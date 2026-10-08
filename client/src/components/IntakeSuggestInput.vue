<script setup>
import { computed, useAttrs } from 'vue';
import { ChevronDown } from '@lucide/vue';
import { AutocompleteAnchor, AutocompleteContent, AutocompleteInput, AutocompleteItem, AutocompletePortal, AutocompleteRoot, AutocompleteTrigger } from 'reka-ui';

// 公開初診頁的「可以自由寫、也可以從建議挑」欄位（花色）。外觀跟品種下拉同一套（style.css 的 intake-combobox-*）；
// 差別在品種只能從清單選，這裡打什麼就存什麼，清單只是建議。
// 不用原生 <datalist>：它的清單由瀏覽器自己畫，跟品種下拉擺在一起差很多，手機上也常常不出現。
// id、aria-*、class 等屬性會落在輸入框上，外面的 <label for> 才接得到。
defineOptions({ inheritAttrs: false });
const props = defineProps({
  modelValue: { type: String, default: '' },
  suggestions: { type: Array, default: () => [] },
  placeholder: { type: String, default: '' },
  triggerLabel: { type: String, default: '展開建議' },
});
const emit = defineEmits(['update:modelValue']);
const attrs = useAttrs();
const inputAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});

const value = computed({
  get: () => props.modelValue ?? '',
  set: (next) => emit('update:modelValue', next ?? ''),
});
// 欄位裡已經是清單上的某一項（剛選完、或重新點開）時列出整份，不然點開只剩自己那一項；打了別的字才篩。
const options = computed(() => {
  const keyword = value.value.trim();
  if (!keyword || props.suggestions.includes(keyword)) return props.suggestions;
  return props.suggestions.filter((option) => option.includes(keyword));
});
</script>

<template>
  <div class="intake-combobox">
    <AutocompleteRoot v-model="value" ignore-filter open-on-click>
      <AutocompleteAnchor class="relative block">
        <AutocompleteInput
          v-bind="inputAttrs"
          autocomplete="off"
          :placeholder="placeholder"
          :class="['intake-combobox-input', attrs.class]"
        />
        <AutocompleteTrigger :aria-label="triggerLabel" class="intake-combobox-trigger">
          <ChevronDown class="size-4" :stroke-width="1.75" aria-hidden="true" />
        </AutocompleteTrigger>
      </AutocompleteAnchor>
      <AutocompletePortal>
        <!-- 打的字清單上沒有就不出清單：寫什麼都收，不必提示「找不到」。 -->
        <AutocompleteContent v-if="options.length" position="popper" side="bottom" align="start" :side-offset="4" class="intake-combobox-content">
          <AutocompleteItem v-for="option in options" :key="option" :value="option" class="intake-combobox-item">
            {{ option }}
          </AutocompleteItem>
        </AutocompleteContent>
      </AutocompletePortal>
    </AutocompleteRoot>
  </div>
</template>

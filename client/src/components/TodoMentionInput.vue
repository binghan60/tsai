<script setup>
import { ref } from 'vue';
import { usePetMentionPicker } from '../composables/usePetMentionPicker';
import RichTextEditor from './RichTextEditor.vue';

// 待辦內容的單行輸入框：可以上色、加粗（格式標記見 shared/richText.js），打 # 會跳出寵物候選清單
// （跟聊天室同一套，邏輯在 composables/usePetMentionPicker.js）。v-model 是帶格式標記的內文；
// v-model:mentions 是選過的標記 [{ petId, petName }]，父元件送出時用 mentionsStillInContent 濾掉已從內文刪掉的。
// 候選清單開著時 Enter 是選人；沒開時 Enter 發出 submit——編輯器不是 <input>，不會自己觸發外層 <form>。
const text = defineModel({ type: String, default: '' });
const mentions = defineModel('mentions', { type: Array, default: () => [] });
defineProps({
  placeholder: { type: String, default: '' },
  ariaLabel: { type: String, default: undefined },
  maxlength: { type: [Number, String], default: undefined },
});
const emit = defineEmits(['submit']);

const editor = ref(null);
const { mention, candidates, highlighted, updateMention, closeMention, selectCandidate, handleKeydown } = usePetMentionPicker({
  text,
  richEditor: () => editor.value,
  pendingMentions: mentions,
});
</script>

<template>
  <div class="relative">
    <RichTextEditor
      ref="editor"
      v-model="text"
      single-line
      :placeholder="placeholder"
      :aria-label="ariaLabel"
      :maxlength="maxlength"
      @keydown="handleKeydown"
      @cursor="updateMention"
      @blur="closeMention"
      @submit="emit('submit')"
    />
    <ul
      v-if="mention && candidates.length"
      class="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg"
      role="listbox"
      aria-label="標記寵物"
    >
      <li
        v-for="(candidate, index) in candidates"
        :key="candidate.petId"
        role="option"
        :aria-selected="index === highlighted"
        class="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm"
        :class="index === highlighted ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-field'"
        @mousedown.prevent="selectCandidate(candidate)"
        @mouseenter="highlighted = index"
      >
        <span class="min-w-0 flex-1 truncate">
          <span class="font-medium">{{ candidate.petName }}</span>
          <span class="text-xs text-muted-foreground"><template v-if="candidate.species"> · {{ candidate.species }}</template><template v-if="candidate.ownerName"> · {{ candidate.ownerName }}</template><template v-if="candidate.ownerPhone"> · <span class="tabular-nums">{{ candidate.ownerPhone }}</span></template></span>
        </span>
        <span v-if="candidate.today" class="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">今日掛號</span>
      </li>
    </ul>
  </div>
</template>

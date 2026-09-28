<script setup>
import { computed } from 'vue'

// 貓咪名、飼主名一律是超連結，連到貓咪詳情頁。飼主沒有自己的頁面（見 CLAUDE.md 第六節），
// 飼主資料就在貓咪詳情頁的右半邊，所以飼主名也連到那一隻貓。
// 沒有 petId（初診還沒建檔、貓咪已刪除）就只是文字。
// 放在整張可點的卡片裡也沒問題：點名字不會連帶觸發卡片（@click.stop）。
// 名字本身在按鈕或選項裡（點下去做別的事）時不要用它——連結不能放進按鈕。
const props = defineProps({
  // 字串 id，或已 populate 的貓咪文件
  petId: { type: [String, Object], default: null },
  // 沿用周圍字色、只加一條細底線：飼主名、警示列裡的貓咪名。預設是主色字、滑過出底線。
  quiet: { type: Boolean, default: false },
})
const id = computed(() => String((props.petId && typeof props.petId === 'object' ? props.petId._id : props.petId) || ''))
</script>

<template>
  <router-link
    v-if="id"
    :to="`/pets/${id}`"
    :class="quiet
      ? 'underline decoration-current/35 underline-offset-4 transition-colors hover:decoration-current'
      : 'text-primary underline-offset-4 hover:underline'"
    @click.stop
  ><slot /></router-link>
  <span v-else><slot /></span>
</template>

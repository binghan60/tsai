<script setup>
import { Copy, SearchX } from '@lucide/vue'
import { useCopy } from '../composables/useCopy'
import { weekdayLabel } from '../lib/datetime'
import { workflowState } from '../../../shared/appointmentWorkflow.js'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import EmptyState from './EmptyState.vue'
import ListSkeleton from './ListSkeleton.vue'
import PatientLink from './PatientLink.vue'
import SurgeryBadge from './SurgeryBadge.vue'

// 掛號台的跨日搜尋結果：一列一筆掛號，不限日期、新到舊（還沒到的排最上面），分頁由頁面接 ListFooter。
// 時間軸一次只看一天，電話裡問「我約哪一天」「上次什麼時候來的」時不知道日期，
// 所以有關鍵字時整塊換成這張表；點一列回到那一天的時間軸。
defineProps({
  items: { type: Array, required: true },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  keyword: { type: String, default: '' },
  today: { type: String, required: true },
})
const emit = defineEmits(['open'])

const { copyPhone } = useCopy()

// 結果跨年，日期一律帶年份。
function dayLabel(date) {
  const [year, month, day] = String(date).split('-')
  return `${year}/${Number(month)}/${Number(day)}`
}
function statusMeta(item) {
  if (item.status === 'cancelled') return { label: '已取消', class: 'bg-sunken text-muted-foreground' }
  if (item.status === 'no_show') return { label: '未到診', class: 'bg-warning-surface text-warning' }
  const state = workflowState(item)
  if (state.completed) return { label: '已完成', class: 'bg-success-surface text-success' }
  if (state.handedOff) return { label: '待櫃台處理', class: 'bg-warning-surface text-warning' }
  if (item.status === 'arrived') return { label: state.started ? '看診中' : '候診中', class: 'bg-accent text-accent-foreground' }
  return { label: '待報到', class: 'bg-info-surface text-info' }
}
</script>

<template>
  <div style="--data-columns: 12.5rem 4.5rem minmax(10rem, 1.4fr) minmax(7rem, 1fr) 10.5rem minmax(10rem, 2fr) 8rem 5rem">
    <Alert v-if="error" variant="destructive" class="m-4"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <!-- 查詢中、換頁中舊結果先留著，只有還沒有任何結果時才出骨架。 -->
    <ListSkeleton v-else-if="loading && !items.length" :rows="5" :avatar="false" inset />
    <EmptyState v-else-if="!items.length" :icon="SearchX" :title="`找不到「${keyword}」的掛號`" inset />
    <template v-else>
      <div class="hidden xl:block">
        <div class="desktop-data-header">
          <span>日期</span><span>時間</span><span>貓咪</span><span>飼主</span><span>電話</span><span>來院原因</span><span>狀態</span><span></span>
        </div>
        <div v-for="item in items" :key="item._id" class="desktop-data-row cursor-pointer hover:bg-hover" @click="emit('open', item)">
          <span class="desktop-data-cell flex items-center gap-2">
            <span class="num font-semibold">{{ dayLabel(item.date) }}</span>
            <span class="text-sm text-muted-foreground">{{ weekdayLabel(item.date) }}</span>
            <Badge v-if="item.date === today" variant="status" class="bg-accent text-accent-foreground">今天</Badge>
          </span>
          <span class="desktop-data-cell num">{{ item.time }}</span>
          <span class="desktop-data-cell flex items-center gap-2">
            <span class="truncate font-semibold" @click.stop><PatientLink :pet-id="item.petId">{{ item.petName }}</PatientLink></span>
            <Badge v-if="item.visitType === 'new'" variant="status" class="bg-info-surface text-info">初診</Badge>
            <SurgeryBadge v-if="item.isSurgery" :name="item.surgeryName" />
          </span>
          <span class="desktop-data-cell truncate" @click.stop><PatientLink v-if="item.ownerName" :pet-id="item.petId" quiet>{{ item.ownerName }}</PatientLink></span>
          <span class="desktop-data-cell">
            <span v-if="item.ownerPhone" class="flex items-center gap-1">
              <span class="num truncate">{{ item.ownerPhone }}</span>
              <button type="button" class="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:bg-secondary-hover hover:text-foreground" :aria-label="`複製 ${item.ownerName || item.petName} 的電話`" @click.stop="copyPhone(item.ownerPhone)"><Copy class="size-4" stroke-width="1.75" /></button>
            </span>
          </span>
          <span class="desktop-data-cell truncate text-sm text-muted-foreground" v-tip.overflow="item.reason">{{ item.reason }}</span>
          <span class="desktop-data-cell"><Badge variant="status" :class="statusMeta(item).class">{{ statusMeta(item).label }}</Badge></span>
          <span class="desktop-data-cell flex justify-end"><Button variant="soft" size="sm" :aria-label="`前往 ${item.petName} ${dayLabel(item.date)} 的掛號`" @click.stop="emit('open', item)">前往</Button></span>
        </div>
      </div>

      <!-- 窄螢幕：一筆一張小卡。 -->
      <ul class="divide-y divide-border xl:hidden">
        <li v-for="item in items" :key="item._id" class="cursor-pointer space-y-1 px-4 py-3 hover:bg-hover" @click="emit('open', item)">
          <div class="flex flex-wrap items-center gap-2">
            <span class="num font-semibold">{{ dayLabel(item.date) }}</span>
            <span class="text-sm text-muted-foreground">{{ weekdayLabel(item.date) }}</span>
            <span class="num">{{ item.time }}</span>
            <Badge v-if="item.date === today" variant="status" class="bg-accent text-accent-foreground">今天</Badge>
            <Badge variant="status" class="ml-auto" :class="statusMeta(item).class">{{ statusMeta(item).label }}</Badge>
          </div>
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <span class="truncate font-semibold text-primary">{{ item.petName }}</span>
            <Badge v-if="item.visitType === 'new'" variant="status" class="bg-info-surface text-info">初診</Badge>
            <SurgeryBadge v-if="item.isSurgery" :name="item.surgeryName" />
          </div>
          <div class="flex gap-3 text-sm text-muted-foreground"><span class="truncate">{{ item.ownerName }}</span><span v-if="item.ownerPhone" class="num shrink-0">{{ item.ownerPhone }}</span></div>
          <p v-if="item.reason" class="truncate text-sm text-muted-foreground">{{ item.reason }}</p>
        </li>
      </ul>
    </template>
  </div>
</template>

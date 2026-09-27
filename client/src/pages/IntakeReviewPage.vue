<script setup>
import { onMounted, ref } from 'vue'
import { ClipboardList, RefreshCw } from '@lucide/vue'
import { http } from '../api/http'
import { formatDateTime } from '../lib/datetime'
import IntakeReview from '../components/IntakeReview.vue'
import EmptyState from '../components/EmptyState.vue'
import ListSkeleton from '../components/ListSkeleton.vue'
import PageHeader from '../components/PageHeader.vue'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'

// 待審初診表的全頁版：左邊清單、右邊逐欄審核。日常在掛號台右側的「初診」面板就能審，
// 這一頁留給一次要審好幾份的時候。
const items = ref([])
const loading = ref(true)
const error = ref('')
const selectedId = ref('')

async function refresh() {
  loading.value = true
  try {
    const { data } = await http.get('/intake-submissions')
    items.value = data.items || []
    error.value = ''
    if (selectedId.value && !items.value.some((item) => item._id === selectedId.value)) selectedId.value = ''
    if (!selectedId.value && items.value.length) selectedId.value = items.value[0]._id
  } catch {
    error.value = '待審核初診表載入失敗，請重試。'
  } finally {
    loading.value = false
  }
}

function onDecided() {
  items.value = items.value.filter((item) => item._id !== selectedId.value)
  selectedId.value = items.value[0]?._id || ''
}

onMounted(refresh)
</script>

<template>
  <section class="flex flex-col gap-5">
    <PageHeader title="初診表審核" back-to="/reception" back-label="返回掛號台" description="飼主送出的初診表，掛號後才建立正式飼主與貓咪資料。">
      <template #actions>
        <Button variant="secondary" :disabled="loading" @click="refresh"><RefreshCw stroke-width="1.75" />重新載入</Button>
      </template>
    </PageHeader>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <ListSkeleton v-if="loading && !items.length" :rows="4" />
    <EmptyState v-else-if="!items.length" :icon="ClipboardList" title="目前沒有待審核的初診表" description="飼主在公開初診頁送出後會出現在這裡。" />

    <div v-else class="grid items-start gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <Card class="gap-0 p-0">
        <div class="desktop-data-header">待審核 <span class="num ml-1">{{ items.length }}</span></div>
        <button
          v-for="item in items"
          :key="item._id"
          type="button"
          class="flex w-full items-center gap-3 border-b border-border px-5 py-3 text-left last:border-b-0 hover:bg-hover"
          :class="item._id === selectedId ? 'bg-accent' : ''"
          :aria-current="item._id === selectedId ? 'true' : undefined"
          @click="selectedId = item._id"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate font-semibold" :class="item._id === selectedId ? 'text-accent-foreground' : 'text-primary'">{{ item.pet.name }}</span>
            <span class="block truncate text-sm text-muted-foreground">{{ item.owner.name }}</span>
          </span>
          <span class="num shrink-0 text-xs text-subtle-foreground">{{ formatDateTime(item.createdAt) }}</span>
        </button>
      </Card>

      <Card v-if="selectedId" class="px-6">
        <IntakeReview :key="selectedId" :submission-id="selectedId" @decided="onDecided" />
      </Card>
    </div>
  </section>
</template>

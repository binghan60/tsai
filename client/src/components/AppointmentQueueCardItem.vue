<script setup>
import { Pencil, Phone } from '@lucide/vue';
import { formatDateTime } from '../lib/datetime';
import { visitTypeMeta } from '../lib/appointmentTimeline';

// 候診卡片與待結帳卡片的清單列共用同一套外殼：號碼牌／身分徽章／姓名／飼主聯絡方式／
// 時間戳記／狀態徽章／操作列／展開區塊。兩張卡片先前各寫一份幾乎相同的 markup，只有
// 顏色語意（主色／warning）跟展開區塊內容不同，抽出來後之後要改外觀只要改一處。
const CHECKIN_TIME_OPTIONS = { hour: '2-digit', minute: '2-digit', hour12: false };

const VARIANT_CLASSES = {
  primary: {
    badge: 'bg-primary text-primary-foreground',
    status: 'bg-accent text-accent-foreground ring-primary/20',
    timestamp: 'text-primary',
  },
  warning: {
    badge: 'bg-warning-surface text-warning',
    status: 'bg-warning-surface text-warning ring-warning/20',
    timestamp: 'text-warning',
  },
};

const props = defineProps({
  appointment: { type: Object, required: true },
  highlighted: { type: Boolean, default: false },
  variant: { type: String, default: 'primary' }, // 'primary' | 'warning'
  statusLabel: { type: String, required: true },
  timestampValue: { type: [String, Date, null], default: null },
  timestampLabel: { type: String, default: '' },
  timestampIcon: { type: [Object, Function], default: null },
  editingCardNumber: { type: Boolean, default: false },
  cardNumberDraft: { type: String, default: '' },
  cardNumberBusy: { type: Boolean, default: false },
  expanded: { type: Boolean, default: false },
});

const emit = defineEmits(['begin-edit-card-number', 'update:cardNumberDraft', 'submit-card-number', 'cancel-card-number']);

const variantClasses = VARIANT_CLASSES[props.variant] ?? VARIANT_CLASSES.primary;
</script>

<template>
  <li
    class="rounded-xl border border-border/80 bg-card p-3 shadow-xs transition-all duration-150 hover:border-primary/40 hover:shadow-sm"
    :class="highlighted ? 'ring-2 ring-warning' : ''"
  >
    <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3">
      <input
        v-if="editingCardNumber"
        :value="cardNumberDraft"
        autofocus
        type="text"
        class="h-9 w-9 appearance-none rounded-lg border-2 border-primary bg-card text-center text-sm font-bold tabular-nums text-foreground outline-none focus-visible:ring-3 focus-visible:ring-primary/25 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        aria-label="輸入新的實體號碼牌編號"
        :disabled="cardNumberBusy"
        @input="emit('update:cardNumberDraft', $event.target.value)"
        @focus="$event.currentTarget.select()"
        @keydown.enter.prevent="$event.currentTarget.blur()"
        @keydown.esc.prevent="emit('cancel-card-number')"
        @blur="emit('submit-card-number')"
      />
      <button
        v-else
        type="button"
        class="group/number relative flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-sm font-bold tabular-nums shadow-xs transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring"
        :class="variantClasses.badge"
        :aria-label="`目前持有 ${appointment.checkinNumber} 號牌，點擊修改`"
        title="修改實體號碼牌"
        :disabled="cardNumberBusy"
        @click="emit('begin-edit-card-number')"
      >
        {{ appointment.checkinNumber }}
        <span class="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-card text-primary ring-1 ring-border shadow-xs" aria-hidden="true">
          <Pencil class="h-2.5 w-2.5" stroke-width="2" />
        </span>
      </button>

      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-1.5">
          <span
            v-if="visitTypeMeta(appointment)"
            class="inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-semibold ring-1 shadow-2xs"
            :class="visitTypeMeta(appointment).classes"
          >{{ visitTypeMeta(appointment).label }}</span>
          <span class="truncate text-sm font-semibold text-foreground">{{ appointment.petName || '—' }}</span>
        </div>
        <div class="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span class="truncate">{{ appointment.ownerName || '—' }}</span>
          <span v-if="appointment.ownerPhone" class="inline-flex items-center gap-1">
            <Phone class="h-3 w-3 shrink-0" stroke-width="1.75" />{{ appointment.ownerPhone }}
          </span>
          <span v-if="timestampValue" class="inline-flex items-center gap-1 font-medium" :class="variantClasses.timestamp">
            <component :is="timestampIcon" v-if="timestampIcon" class="h-3 w-3 shrink-0" stroke-width="1.75" />{{ formatDateTime(timestampValue, CHECKIN_TIME_OPTIONS) }} {{ timestampLabel }}
          </span>
        </div>
      </div>

      <span class="inline-flex h-7 shrink-0 items-center rounded-md px-2 text-xs font-semibold ring-1" :class="variantClasses.status">{{ statusLabel }}</span>
    </div>

    <div class="mt-2.5 flex flex-wrap items-center justify-end gap-1.5 border-t border-border/60 pt-2.5">
      <slot name="actions" />
    </div>

    <div v-if="expanded" class="mt-3.5 space-y-3.5 border-t border-border/60 pt-3.5">
      <slot name="expanded" />
    </div>
  </li>
</template>

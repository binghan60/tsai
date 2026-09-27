<script setup>
import { useAppointmentNotificationPreferences } from '../lib/appointmentNotificationPreferences';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Switch } from './ui/switch';

// 自動通知的開關：診療台與掛號台每個動作都會在聊天室補一則系統訊息，這裡決定這台裝置要看哪些。
// 原本藏在聊天視窗的齒輪裡，現在跟身分、主題一起放在設定選單。
defineProps({ open: { type: Boolean, default: false } });
const emit = defineEmits(['update:open']);
const { options, preferences, enabledCount, setPreference, enableAll, disableAll } = useAppointmentNotificationPreferences();
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent size="md" class="flex max-h-[85vh] flex-col">
      <DialogHeader>
        <DialogTitle>自動通知</DialogTitle>
        <DialogDescription>這台裝置的聊天室要顯示哪些系統訊息。已開啟 <span class="num">{{ enabledCount }}</span> / <span class="num">{{ options.length }}</span> 項。</DialogDescription>
      </DialogHeader>
      <ul class="min-h-0 flex-1 divide-y divide-border overflow-y-auto border-y border-border">
        <li v-for="option in options" :key="option.key">
          <label class="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-6 hover:bg-hover">
            <span>{{ option.label }}</span>
            <Switch :model-value="preferences[option.key] !== false" :aria-label="`${option.label}通知`" @update:model-value="(value) => setPreference(option.key, value)" />
          </label>
        </li>
      </ul>
      <DialogFooter class="border-t-0">
        <Button variant="secondary" class="sm:mr-auto" @click="disableAll">全部關閉</Button>
        <Button variant="secondary" @click="enableAll">全部開啟</Button>
        <Button @click="emit('update:open', false)">完成</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

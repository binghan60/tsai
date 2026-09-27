<script setup>
import { useAppointmentNotificationPreferences } from '../lib/appointmentNotificationPreferences';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Switch } from './ui/switch';

// 自動通知的開關：診療台與掛號台的動作完成後，會自動在聊天室補一則系統訊息。
// 這裡決定「這台裝置」做哪些動作時要發（見 composables/useAppointmentNotifier.js）——
// 發出去的訊息所有人都看得到，所以關掉是「這台不發」，不是「這台不看」。
// 入口有兩個：聊天面板標頭的「通知」鈕、設定選單的「自動通知設定」。
defineProps({ open: { type: Boolean, default: false } });
const emit = defineEmits(['update:open']);
const { options, preferences, enabledCount, setPreference, enableAll, disableAll } = useAppointmentNotificationPreferences();
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent size="md" class="flex max-h-[85vh] flex-col">
      <DialogHeader>
        <DialogTitle>自動通知</DialogTitle>
        <DialogDescription>在這台裝置做下列動作時，自動在聊天室發一則訊息告訴對方。已開啟 <span class="num">{{ enabledCount }}</span> / <span class="num">{{ options.length }}</span> 項。</DialogDescription>
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

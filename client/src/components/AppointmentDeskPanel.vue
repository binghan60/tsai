<script setup>
import { computed, ref, watch } from 'vue';
import { CalendarClock, Check, ChevronDown, ClipboardCheck, CreditCard, Banknote, Landmark, PawPrint, Phone, Wallet, X } from '@lucide/vue';
import { http } from '../api/http';
import { useToast } from '../composables/useToast';
import { workflowState } from '../../../shared/appointmentWorkflow.js';
import AppointmentMilestones from './AppointmentMilestones.vue';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { DatePicker } from './ui/date-picker';
import { TimePicker } from './ui/time-picker';
import { APPOINTMENT_TIME_RANGES, APPOINTMENT_TIME_MINUTE_STEP } from '../lib/appointmentTime';
import ConfirmDialog from './ConfirmDialog.vue';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from './ui/sheet';
import SegmentedControl from './SegmentedControl.vue';
import RowActions from './RowActions.vue';

const props = defineProps({ appointment: { type: Object, required: true }, initialSection: { type: String, default: 'payment' } });
const emit = defineEmits(['updated', 'admin', 'close']);
const toast = useToast();
const state = computed(() => workflowState(props.appointment));
const busy = ref(false);
const error = ref('');
const total = ref(props.appointment.billingSubtotal ?? 0);
const adjustment = ref('');
const method = ref('cash');
const date = ref(props.appointment.followUpDate || '');
const time = ref(props.appointment.followUpTime || '');
const billingChanged = ref(false);
const confirmPayment = ref(false);
const pendingPayment = ref(null);
const active = computed(() => ['arrived', 'pending_checkout', 'completed'].includes(props.appointment.status));
const section = ref(props.initialSection);
const showAdjustment = ref(false);
const expandedItems = ref(true);
const paymentMethods = [{ value: 'cash', label: '現金', icon: Banknote }, { value: 'card', label: '刷卡', icon: CreditCard }, { value: 'transfer', label: '轉帳', icon: Landmark }];
const tabs = computed(() => [
  { value: 'payment', label: state.value.paid ? '收款紀錄' : '收款明細' },
  { value: 'handoff', label: '交接事項' },
  { value: 'followup', label: '回診安排' },
]);
const hasHandoff = computed(() => Boolean(props.appointment.handoffNote || props.appointment.specialCareNote));
const needsFollowUp = computed(() => Boolean(props.appointment.followUpRecommendation || props.appointment.followUpReason));
watch(() => props.initialSection, value => section.value = value);
function close() { if (!busy.value) emit('close'); }
watch(() => [props.appointment.billingRevision, props.appointment.billingSubtotal, state.value.billed], (next, previous) => {
  if (next.every((value, index) => value === previous[index])) return;
  billingChanged.value = true;
  confirmPayment.value = false;
});
function reviewBilling() {
  total.value = props.appointment.billingSubtotal;
  adjustment.value = '';
  billingChanged.value = false;
}
function requestPayment() {
  if (!Number.isFinite(Number(total.value)) || total.value === '' || Number(total.value) < 0) { error.value = '請填寫有效的實收金額'; return; }
  if (Number(total.value) !== props.appointment.billingSubtotal && !adjustment.value.trim()) { showAdjustment.value = true; error.value = '實收金額與批價不同，請填寫調整原因'; return; }
  pendingPayment.value = { version: props.appointment.__v ?? 0, billingRevision: props.appointment.billingRevision || (props.appointment.workflowVersion === 1 ? 0 : 1), checkoutTotal: total.value, checkoutAdjustmentNote: adjustment.value, paymentMethod: method.value };
  confirmPayment.value = true;
}
async function run(action, values = {}) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const { data } = await http.post(`/appointments/${props.appointment._id}/workflow/${action}`, { version: props.appointment.__v ?? 0, ...values });
    emit('updated', data);
    confirmPayment.value = false;
    toast.success({ pay: '收款完成', followup: '回診已預約', handoff: '交辦狀態已更新' }[action]);
  } catch (err) {
    error.value = err.response?.data?.message || '操作失敗，請稍後重試';
    if (err.response?.status === 409) {
      confirmPayment.value = false;
      const { data } = await http.get(`/appointments/${props.appointment._id}`).catch(() => ({ data: null }));
      if (data) emit('updated', data);
    }
  } finally { busy.value = false; }
}
</script>

<template>
  <Sheet :open="true" @update:open="value => !value && close()">
    <SheetContent :show-close-button="false" class="gap-0 bg-card data-[side=right]:w-full data-[side=right]:sm:max-w-[36rem]" @escape-key-down="event => busy && event.preventDefault()" @interact-outside="event => busy && event.preventDefault()">
      <aside class="flex h-full min-h-0 flex-col" aria-label="病患行政處理">
        <header class="shrink-0 border-b border-border px-5 pb-5 pt-5 sm:px-6">
          <div class="mb-4 flex items-center justify-between">
            <SheetDescription class="text-xs">就診詳情 · {{ appointment.date }} {{ appointment.time }}</SheetDescription>
            <Button variant="secondary" size="icon-sm" aria-label="關閉就診詳情" :disabled="busy" @click="close"><X class="h-4 w-4" /></Button>
          </div>
          <div class="flex items-center gap-3">
            <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"><PawPrint class="h-5 w-5" stroke-width="1.6" /></span>
            <div class="min-w-0 flex-1"><SheetTitle class="text-xl font-semibold">{{ appointment.petName }}<span class="ml-2 text-sm font-normal text-muted-foreground">{{ appointment.species }}</span></SheetTitle><p class="mt-1 text-xs text-muted-foreground">{{ appointment.ownerName || '飼主待確認' }}<template v-if="appointment.checkinNumber"> · {{ appointment.checkinNumber }} 號</template></p></div>
            <a v-if="appointment.ownerPhone" :href="`tel:${appointment.ownerPhone}`" class="inline-flex items-center gap-1.5 rounded-lg bg-field px-3 py-2 text-xs tabular-nums text-primary"><Phone class="h-3.5 w-3.5" /><span class="hidden sm:inline">{{ appointment.ownerPhone }}</span><span class="sm:hidden">聯絡</span></a>
          </div>
          <p v-if="appointment.reason" class="mt-3 text-sm text-muted-foreground">{{ appointment.reason }}</p>
          <div class="mt-3"><AppointmentMilestones :appointment="appointment" /></div>
        </header>
        <div v-if="active" class="shrink-0 px-5 pt-4 sm:px-6"><SegmentedControl v-model="section" :options="tabs" aria-label="就診詳細處理" full-width /></div>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          <p v-if="error" role="alert" class="mb-4 rounded-lg bg-danger-surface p-3 text-sm text-danger">{{ error }}</p>
          <template v-if="!active">
            <dl class="space-y-5 text-sm"><div class="flex justify-between gap-4"><dt class="text-muted-foreground">預約時間</dt><dd class="tabular-nums">{{ appointment.date }} {{ appointment.time || '未指定' }}</dd></div><div class="flex justify-between gap-4"><dt class="text-muted-foreground">聯絡電話</dt><dd class="tabular-nums">{{ appointment.ownerPhone || '未留電話' }}</dd></div><div class="flex justify-between gap-4"><dt class="text-muted-foreground">就診類型</dt><dd>{{ appointment.visitType === 'new' ? '初診' : appointment.visitType === 'return' ? '回診' : '未記錄' }}</dd></div></dl>
            <p v-if="appointment.cancelReason" class="mt-5 rounded-lg bg-field p-3 text-sm">取消原因：{{ appointment.cancelReason }}</p>
          </template>
          <template v-else-if="section === 'payment'">
            <div v-if="!state.billed" class="flex flex-col items-center gap-3 py-12 text-center"><span class="flex h-12 w-12 items-center justify-center rounded-full bg-field"><Wallet class="h-5 w-5 text-muted-foreground" /></span><h3 class="font-medium">等候醫師批價</h3><p class="max-w-xs text-sm text-muted-foreground">醫師送出批價後，費用明細與應收金額會自動顯示在這裡。</p></div>
            <template v-else>
              <div class="flex items-end justify-between gap-3 rounded-xl bg-field p-5"><div><p class="mb-1 text-xs text-muted-foreground">{{ state.paid ? '本次實收' : '本次應收' }}</p><p class="text-3xl font-semibold tracking-tight tabular-nums"><span class="mr-1.5 text-base font-normal text-muted-foreground">NT$</span>{{ Number(state.paid ? appointment.checkoutTotal : appointment.billingSubtotal).toLocaleString() }}</p></div><span v-if="state.paid" class="inline-flex items-center gap-1 rounded-full bg-success-surface px-2.5 py-1 text-xs text-success"><Check class="h-3.5 w-3.5" />收款完成</span><span v-else class="text-xs text-muted-foreground">醫師已確認批價</span></div>
              <div v-if="billingChanged && !state.paid" role="alert" class="mt-4 space-y-2 rounded-lg bg-warning-surface p-3 text-sm text-warning"><p>醫師已更新批價，請重新核對金額。</p><Button variant="secondary" size="sm" @click="reviewBilling">已核對，帶入最新金額</Button></div>
              <section class="mt-5">
                <button type="button" class="flex w-full items-center justify-between rounded-lg bg-field/60 px-3 py-2 text-sm" :aria-expanded="expandedItems" @click="expandedItems = !expandedItems"><span class="font-medium">費用與藥品 <span class="ml-1 font-normal text-muted-foreground">{{ appointment.billingItems?.length || 0 }} 項</span></span><ChevronDown class="h-4 w-4 transition-transform" :class="{ '-rotate-90': !expandedItems }" /></button>
                <ul v-show="expandedItems" class="divide-y divide-border text-sm"><li v-for="(item, index) in appointment.billingItems" :key="item._id || index" class="py-3"><div class="flex items-start justify-between gap-3"><div><span>{{ item.name }}</span><span class="ml-2 text-xs text-muted-foreground">× {{ item.quantity }}</span><p v-if="item.kind === 'medication'" class="mt-1 text-xs text-muted-foreground">{{ item.dosage }} {{ item.instructions }}</p></div><span class="shrink-0 tabular-nums">{{ Number(item.amount).toLocaleString() }}</span></div></li></ul>
              </section>
              <template v-if="!state.paid">
                <section class="mt-5 space-y-3 border-t border-border pt-5"><h3 class="text-sm font-medium">付款方式</h3><SegmentedControl v-model="method" :options="paymentMethods" aria-label="付款方式" full-width /></section>
                <section class="mt-5 space-y-3"><div class="flex items-center justify-between"><label for="checkout-total" class="text-sm font-medium">實收金額</label><Button variant="secondary" size="sm" @click="showAdjustment = !showAdjustment">{{ showAdjustment ? '收起調整說明' : '折讓／調整' }}</Button></div><div class="relative"><span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">NT$</span><Input id="checkout-total" v-model="total" type="number" min="0" class="pl-12 text-lg tabular-nums" :disabled="busy || billingChanged" /></div><label v-if="showAdjustment || Number(total) !== appointment.billingSubtotal" class="block space-y-2 text-sm">調整原因<Textarea v-model="adjustment" :disabled="busy" placeholder="例如：醫師同意折讓、免收本次診察費" /></label></section>
              </template>
              <dl v-else class="mt-5 space-y-3 border-t border-border pt-5 text-sm"><div class="flex justify-between"><dt class="text-muted-foreground">付款方式</dt><dd>{{ { cash: '現金', card: '信用卡', transfer: '轉帳' }[appointment.paymentMethod] || '未記錄' }}</dd></div><div v-if="appointment.checkoutAdjustmentNote"><dt class="mb-1 text-muted-foreground">調整說明</dt><dd>{{ appointment.checkoutAdjustmentNote }}</dd></div></dl>
            </template>
          </template>
          <template v-else-if="section === 'handoff'">
            <div v-if="!hasHandoff" class="flex flex-col items-center gap-3 py-12 text-center"><ClipboardCheck class="h-7 w-7 text-muted-foreground/60" /><h3 class="font-medium">目前沒有交辦事項</h3><p class="text-sm text-muted-foreground">醫師新增的交辦與照護提醒會同步顯示。</p></div>
            <div v-else class="space-y-5"><section v-if="appointment.handoffNote"><h3 class="mb-2 text-xs font-medium text-muted-foreground">醫師交辦</h3><p class="whitespace-pre-wrap rounded-xl bg-field p-4 text-sm leading-relaxed">{{ appointment.handoffNote }}</p></section><section v-if="appointment.specialCareNote"><h3 class="mb-2 text-xs font-medium text-muted-foreground">請轉告飼主</h3><p class="whitespace-pre-wrap rounded-xl border border-warning/20 bg-warning-surface p-4 text-sm leading-relaxed">{{ appointment.specialCareNote }}</p></section><p v-if="appointment.handoffAcknowledgedAt" class="flex items-center gap-2 text-sm text-success"><Check class="h-4 w-4" />櫃台已完成交辦</p></div>
          </template>
          <template v-else-if="section === 'followup'">
            <div v-if="!needsFollowUp && !appointment.followUpAppointmentId" class="flex flex-col items-center gap-3 py-12 text-center"><CalendarClock class="h-7 w-7 text-muted-foreground/60" /><h3 class="font-medium">醫師未指定回診</h3><p class="text-sm text-muted-foreground">需要回診時，醫師會提供建議期間與原因。</p></div>
            <template v-else>
              <div class="mb-5 rounded-xl bg-field p-4"><p class="mb-2 text-xs font-medium text-muted-foreground">醫師回診建議</p><p class="font-medium">{{ appointment.followUpRecommendation || '請與飼主確認回診時間' }}</p><p v-if="appointment.followUpReason" class="mt-1 text-sm text-muted-foreground">{{ appointment.followUpReason }}</p></div>
              <div v-if="appointment.followUpAppointmentId" class="space-y-4"><p class="flex items-center gap-2 text-sm text-success"><Check class="h-4 w-4" />已安排回診</p><p class="text-xl font-semibold tabular-nums">{{ appointment.followUpDate }} <span class="ml-2">{{ appointment.followUpTime }}</span></p><Button as-child variant="secondary"><router-link :to="{ path: '/reception', query: { date: appointment.followUpDate, selected: String(appointment.followUpAppointmentId) } }">查看回診預約</router-link></Button></div>
              <div v-else class="space-y-5"><label class="block space-y-2 text-sm font-medium">回診日期<DatePicker v-model="date" aria-label="回診日期" /></label><label class="block space-y-2 text-sm font-medium">回診時間<TimePicker v-model="time" :ranges="APPOINTMENT_TIME_RANGES" :minute-step="APPOINTMENT_TIME_MINUTE_STEP" aria-label="回診時間" /></label><p class="text-xs leading-relaxed text-muted-foreground">尚未約定可稍後處理，這筆就診會保留在「待安排回診」。</p></div>
            </template>
          </template>
        </div>
        <footer class="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-card px-5 py-4 sm:px-6">
          <template v-if="appointment.status === 'scheduled'"><div class="flex gap-2"><Button variant="secondary" :disabled="busy" @click="emit('admin', 'edit')">修改預約</Button><RowActions :actions="[{ key: 'check-in-late', label: '遲到報到' }, { key: 'no-show', label: '標記未到' }, { key: 'cancel', label: '取消掛號', danger: true }]" label="預約其他操作" @select="key => emit('admin', key)" /></div><Button :disabled="busy" @click="emit('admin', 'check-in')">確認報到</Button></template>
          <template v-else-if="!active"><Button variant="secondary" @click="close">關閉</Button><Button variant="secondary" :disabled="busy" @click="emit('admin', 'restore')">恢復預約</Button></template>
          <template v-else-if="section === 'payment' && state.billed && !state.paid"><span class="text-xs text-muted-foreground">核對金額後確認收款</span><Button :disabled="busy || billingChanged" @click="requestPayment">確認收款</Button></template>
          <template v-else-if="section === 'handoff' && hasHandoff"><Button variant="secondary" @click="close">稍後處理</Button><Button :variant="appointment.handoffAcknowledgedAt ? 'secondary' : 'default'" :disabled="busy" @click="run('handoff', { acknowledged: !appointment.handoffAcknowledgedAt })">{{ appointment.handoffAcknowledgedAt ? '取消完成標記' : '標記交辦已完成' }}</Button></template>
          <template v-else-if="section === 'followup' && needsFollowUp && !appointment.followUpAppointmentId"><Button variant="secondary" @click="close">稍後安排</Button><Button :disabled="busy || !date || !time" @click="run('followup', { followUpDate: date, followUpTime: time })">確認回診預約</Button></template>
          <template v-else><p class="text-xs text-muted-foreground">{{ state.paid && section === 'payment' ? '款項已記錄，醫師端同步更新' : '資訊與醫師端同步' }}</p><Button variant="secondary" @click="close">完成</Button></template>
        </footer>
      </aside>
    </SheetContent>
  </Sheet>
  <ConfirmDialog v-if="confirmPayment" :open="true" title="確認已收到款項？" :description="`已向 ${appointment.petName} 的飼主收取 NT$${pendingPayment.checkoutTotal}，確認後會記錄收款完成。`" confirm-label="確認收款完成" :loading="busy" @confirm="run('pay', pendingPayment)" @cancel="confirmPayment = false" />
</template>

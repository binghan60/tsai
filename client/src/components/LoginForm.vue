<script setup>
import { ref } from 'vue';
import { useField, useForm } from 'vee-validate';
import { AlertTriangle, LockKeyhole, LogIn } from '@lucide/vue';
import { useAuth } from '../composables/useAuth';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

// 登入頁與「登入已過期」對話框共用同一份表單。
defineProps({
  // 對話框是蓋在其他頁面上的，欄位 id 不能跟底下的頁面撞到。
  idPrefix: { type: String, default: 'login' },
  submitLabel: { type: String, default: '登入' },
});
const emit = defineEmits(['success']);

const { login } = useAuth();

const { handleSubmit } = useForm({ initialValues: { password: '' } });
const { value: password, errorMessage: passwordError } = useField(
  'password',
  (value) => (value && String(value).trim() !== '') || '請輸入密碼'
);
const submitting = ref(false);
const errorMessage = ref('');
// 密碼錯 3 次會鎖 1 天（伺服器端 routes/auth.js）。還有機會時伺服器回 warning，
// 鎖上之後回 locked；兩者都要跟「密碼不正確」分開畫，才不會被當成同一句話略過。
const warningMessage = ref('');
const locked = ref(false);

const onSubmit = handleSubmit(async (values) => {
  submitting.value = true;
  errorMessage.value = '';
  warningMessage.value = '';
  locked.value = false;
  try {
    await login(values.password);
    emit('success');
  } catch (err) {
    const data = err.response?.data;
    // 沒有 response 代表請求根本沒到伺服器（斷線、逾時），那不是密碼錯。
    errorMessage.value = data?.message ?? '無法連線到伺服器，請確認網路後再試';
    warningMessage.value = data?.warning ?? '';
    locked.value = Boolean(data?.locked);
  } finally {
    submitting.value = false;
  }
});
</script>

<template>
  <form class="space-y-4" @submit.prevent="onSubmit">
    <!-- 只有密碼欄的表單，密碼管理員不知道該把它存在哪個帳號底下；給一個固定的名稱。 -->
    <input type="text" name="username" autocomplete="username" value="admin" hidden readonly />

    <div class="space-y-1.5">
      <Label :for="`${idPrefix}-password`" class="text-xs font-medium text-foreground">密碼</Label>
      <Input
        :id="`${idPrefix}-password`"
        v-model="password"
        type="password"
        name="password"
        autocomplete="current-password"
        class="border-border focus:border-brand-500"
        :aria-invalid="passwordError ? 'true' : undefined"
        autofocus
      />
      <p v-if="passwordError" class="text-xs font-medium text-destructive">{{ passwordError }}</p>
    </div>

    <!-- 鎖定時不停用送出鈕：解鎖與否以伺服器為準（重啟服務就會提前解除），再送一次也不會延長鎖定。 -->
    <Alert v-if="errorMessage" variant="destructive">
      <LockKeyhole v-if="locked" stroke-width="1.75" />
      <AlertTitle v-if="locked">登入已鎖定</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <Alert v-if="warningMessage" variant="warning">
      <AlertTriangle stroke-width="1.75" />
      <AlertDescription>{{ warningMessage }}</AlertDescription>
    </Alert>

    <Button type="submit" class="w-full" :disabled="submitting">
      <LogIn stroke-width="1.75" />
      {{ submitting ? '登入中…' : submitLabel }}
    </Button>
  </form>
</template>

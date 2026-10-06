<script setup>
import { ref } from 'vue';
import { useField, useForm } from 'vee-validate';
import { LogIn } from '@lucide/vue';
import { useAuth } from '../composables/useAuth';
import { Alert, AlertDescription } from './ui/alert';
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

const onSubmit = handleSubmit(async (values) => {
  submitting.value = true;
  errorMessage.value = '';
  try {
    await login(values.password);
    emit('success');
  } catch (err) {
    // 沒有 response 代表請求根本沒到伺服器（斷線、逾時），那不是密碼錯。
    errorMessage.value = err.response?.data?.message ?? '無法連線到伺服器，請確認網路後再試';
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

    <Alert v-if="errorMessage" variant="destructive">
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <Button type="submit" class="w-full" :disabled="submitting">
      <LogIn stroke-width="1.75" />
      {{ submitting ? '登入中…' : submitLabel }}
    </Button>
  </form>
</template>

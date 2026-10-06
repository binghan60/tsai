<script setup>
import { useAuth } from '../composables/useAuth';
import LoginForm from './LoginForm.vue';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

// 用到一半登入失效時蓋在當前頁面上的對話框（何時開啟見 useAuth.js 的攔截器）。
const { auth } = useAuth();

// 只能靠登入關閉。底下的頁面還在，但所有請求都會被擋，
// 讓人按 Esc 或點旁邊關掉它，只會留下一個什麼都做不了的畫面。
function keepOpen(event) {
  event.preventDefault();
}
</script>

<template>
  <Dialog :open="auth.reloginOpen">
    <DialogContent
      size="sm"
      :show-close-button="false"
      @escape-key-down="keepOpen"
      @pointer-down-outside="keepOpen"
      @interact-outside="keepOpen"
    >
      <div class="space-y-5 p-6 sm:p-7">
        <div class="space-y-1.5">
          <DialogTitle>登入已過期</DialogTitle>
          <DialogDescription>請重新輸入密碼。畫面上的內容都還在，登入後會接著完成剛才的操作。</DialogDescription>
        </div>
        <LoginForm id-prefix="relogin" submit-label="重新登入" />
      </div>
    </DialogContent>
  </Dialog>
</template>

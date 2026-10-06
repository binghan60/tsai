import { copyText } from '../lib/clipboard';
import { useToast } from './useToast';

// 「複製＋提示」：電話旁的複製鈕、初診驗證碼都是同一個動作，提示文案只差在複製的是什麼。
export function useCopy() {
  const toast = useToast();

  async function copy(value, { copied, failed }) {
    if (await copyText(value)) toast.success(value, copied);
    else toast.error(failed);
  }

  return {
    copyPhone: (phone) => copy(phone, { copied: '已複製電話', failed: '無法複製，請手動選取電話' }),
    copyIntakeCode: (code) => copy(code, { copied: '已複製驗證碼', failed: '無法複製，請手動抄下驗證碼' }),
  };
}

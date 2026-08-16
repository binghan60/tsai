import { inject, provide } from 'vue';

// 表單頁把作答與共用行為（標準值、自動判讀、批次標記）注入給各版式元件，
// 避免一層層傳 prop。
export const RECORD_FORM_KEY = Symbol('recordForm');

export function provideRecordForm(context) {
  provide(RECORD_FORM_KEY, context);
}

export function useRecordForm() {
  const context = inject(RECORD_FORM_KEY, null);
  if (!context) throw new Error('表單欄位元件必須放在 RecordFormPage 之內');
  return context;
}

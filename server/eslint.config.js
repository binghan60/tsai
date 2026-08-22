// 只開最低限度、能抓到「執行才會爆」的規則。
// node --check 只驗語法，抓不到未宣告的變數（例如刪掉宣告卻留著使用處），
// 這種錯誤要等實際打到那條 API 才會 500。
export default [
  {
    files: ['src/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      // 未使用的變數多半是重構後的殘留，順手抓出來；參數不檢查以免誤報 Express 的 next。
      'no-unused-vars': ['warn', { args: 'none' }],
    },
  },
  {
    // page.evaluate() 裡的程式碼跑在無頭瀏覽器裡，不是 Node，用得到 DOM 全域物件。
    files: ['src/lib/pdf.js'],
    languageOptions: { globals: { document: 'readonly', window: 'readonly' } },
  },
];

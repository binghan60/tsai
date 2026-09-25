// 格式標記的四個顏色在畫面上的樣子。class 名字要完整寫出來 Tailwind 才掃得到，
// 所以不能用 `text-${token}` 拼字串。顏色名與語意 token 的對應在 shared/richText.js。
export const TINT_OPTIONS = [
  { color: 'red', label: '紅色', textClass: 'text-danger', swatchClass: 'bg-danger' },
  { color: 'orange', label: '橙色', textClass: 'text-warning', swatchClass: 'bg-warning' },
  { color: 'green', label: '綠色', textClass: 'text-success', swatchClass: 'bg-success' },
  { color: 'blue', label: '藍色', textClass: 'text-info', swatchClass: 'bg-info' },
];

const TEXT_CLASS = Object.fromEntries(TINT_OPTIONS.map((option) => [option.color, option.textClass]));

export function tintClass(color) {
  return TEXT_CLASS[color] ?? '';
}

// 編輯器與唯讀顯示用同一個粗體字重，看到的跟存下來的一樣。
export const BOLD_CLASS = 'font-semibold';

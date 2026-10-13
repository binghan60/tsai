// 待辦的顏色標記（Todo.color）：使用者自己選，意義自己決定。空字串＝沒標。
// 跟內文可用的顏色（shared/richText.js）同一組六色，所以待辦的標記色與內文的字色可以搭著用。
import { RICH_TEXT_COLORS } from './richText.js';

export const TODO_COLOR_KEYS = Object.freeze(Object.keys(RICH_TEXT_COLORS));

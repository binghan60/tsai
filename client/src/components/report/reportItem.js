import { familyOf } from '../../lib/fieldFamily';

// 報告區塊共用的取值與標籤邏輯。
// 這個資料夾底下的元件固定用淺色配色（stone / brand），不套 dark: variant ——
// 報告頁同時是 Puppeteer 產 PDF 的來源，深色底列印會看不見字。

export function hasValue(item) {
  return item?.value !== null && item?.value !== undefined && String(item.value).trim() !== '';
}

// 「這個項目該不該印在報告上」。任何型別都可能出現在任何版式的區塊裡，
// 所以判斷要放在這裡共用：finding／lab 的內容在 status 而不在 value，
// 只看 hasValue() 會把「正常」的理學檢查整個漏掉。備註也算內容 ——
// ReportField 會把它印出來，沒有理由因為狀態是「未檢查」就把它丟掉。
export function hasContent(item) {
  const family = familyOf(item);
  if (family === 'finding' || family === 'lab') {
    return item.status !== 'not_checked' || hasValue(item) || String(item.note ?? '').trim() !== '';
  }
  return hasValue(item);
}

// 複選的作答是字串陣列，直接印會變成「a,b」。
export function valueText(item) {
  return Array.isArray(item?.value) ? item.value.join('、') : item?.value;
}

// 量測值後面接單位，例如「4.2 kg」「5 / 9」。
export function measurementLabel(item) {
  if (!hasValue(item)) return null;
  return `${item.value}${item.unit ? ` ${item.unit}` : ''}`;
}

export function labValueLabel(item) {
  if (!hasValue(item)) return '';
  return `${item.value}${item.unit ? ` ${item.unit}` : ''}`;
}

export function referenceLabel(item) {
  const hasMin = item?.referenceMin != null;
  const hasMax = item?.referenceMax != null;
  if (!hasMin && !hasMax) return '';
  const bounds = hasMin && hasMax
    ? `${item.referenceMin}–${item.referenceMax}`
    : hasMin
      ? `≥ ${item.referenceMin}`
      : `≤ ${item.referenceMax}`;
  return `${bounds}${item.unit ? ` ${item.unit}` : ''}`;
}

export function statusText(status) {
  if (status === 'abnormal') return '異常';
  if (status === 'normal') return '正常';
  return '未檢查';
}

export function hasPreviousValue(item) {
  return item?.previousValue !== null && item?.previousValue !== undefined && String(item.previousValue).trim() !== '';
}

export function previousMeasurementLabel(item) {
  if (!hasPreviousValue(item)) return null;
  const unit = item.previousUnit || item.unit || '';
  return `${item.previousValue}${unit ? ` ${unit}` : ''}`;
}

export function previousLabValueLabel(item) {
  if (!hasPreviousValue(item)) return '';
  const unit = item.previousUnit || item.unit || '';
  return `${item.previousValue}${unit ? ` ${unit}` : ''}`;
}

// 只留月／日、不印年份——這欄語境已經是「上一次看診」，年份多數時候可以推斷，
// 換來窄欄位裡不會被日期硬撐寬。
export function previousDateLabel(item) {
  if (!item?.previousVisitDate) return '';
  const date = new Date(item.previousVisitDate);
  if (Number.isNaN(date.getTime())) return '';
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${m}/${d}`;
}


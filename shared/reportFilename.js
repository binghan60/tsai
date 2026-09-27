// 健檢報告 PDF 的檔名：下載與 Email 附件共用，飼主收到的附件名稱要看得出是哪隻貓、哪一天。
// 日期以診所時區換算——資料庫存的是 UTC 時間點，台北凌晨的健檢在 UTC 還是前一天。
const CLINIC_TIME_ZONE = 'Asia/Taipei';

// Windows／macOS 檔名不接受的字元與控制字元一律換成底線。
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

function clinicDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function reportPdfFilename({ petName, visitDate } = {}) {
  const name = String(petName ?? '').replace(UNSAFE_FILENAME_CHARS, '_').trim();
  return `${[name, '健檢報告', clinicDate(visitDate)].filter(Boolean).join('_')}.pdf`;
}

import { clinicDateInput, clinicTimeInput } from './datetime.js';
import { instrumentLabel } from './labResults.js';

// IDEXX 檢驗結果「填入狀態」燈號：這次看診連到的每一份結果，哪些數值進了健檢報告、哪些沒進。
// 匯入當下的 toast 只講一次；這裡是事後隨時查得到的版本（診療台「檢驗報告」標題旁、健檢報告填寫頁「引用本次看診」）。
//
// 燈號（先符合的為準）：
//   warning  有還沒處理的數值差異／看診沒選健檢表單／填入時報告已結案
//   success  有填入、沒有上面的情況
//   info     一項都沒填、也沒有上面的情況（全部沒有對應欄位，或報告上本來就是同樣的值）
//   null     沒有任何連到這次看診的結果——不畫
// 「IDEXX 有驗、表單沒有對應欄位」不算黃燈（使用者的決定）：全血檢二十幾項、表單只列幾項是常態，算進去每一隻都是黃的。
//
// results：GET /lab-results?petId=&appointmentId= 的結果；conflictGroups：GET /lab-results/conflicts?appointmentId= 的結果。
// 差異一律用 conflictGroups（伺服器用看診現在的值重算過），不用結果上存的 conflicts（可能已經過時）。
export function labFillStatus({ results = [], conflictGroups = [], appointmentId = '', baseDate = '' } = {}) {
  const visitId = String(appointmentId ?? '');
  const linked = results
    .filter((result) => visitId && String(result.appointmentId ?? '') === visitId)
    .sort((a, b) => new Date(a.runAt ?? 0) - new Date(b.runAt ?? 0));
  if (!linked.length) return { tone: null, text: '', sections: [] };

  const groupById = new Map(conflictGroups.map((group) => [String(group.id), group]));
  const sections = linked.map((result) => {
    const { purpose, name } = instrumentLabel(result.instrument);
    const group = groupById.get(String(result._id)) ?? null;
    const day = result.runAt ? clinicDateInput(result.runAt) : '';
    return {
      id: String(result._id),
      title: [purpose, name].filter(Boolean).join(' '),
      // 跟檢驗報告表格同一個寫法：當天驗的只寫時間，別天的連日期一起寫。
      time: !result.runAt ? '' : baseDate && day === baseDate ? clinicTimeInput(result.runAt) : `${day} ${clinicTimeInput(result.runAt)}`,
      filled: (result.filled ?? []).map((entry) => ({ key: entry.key, label: entry.label || entry.key, value: entry.value })),
      conflicts: group?.items ?? [],
      unmapped: result.unmappedCodes ?? [],
      // 連上看診了卻還沒填：這次看診沒選健檢表單。
      noTemplate: !result.appliedAt,
      finalized: result.fillClosed === 'record_finalized',
      group,
    };
  });

  const count = (key) => sections.reduce((sum, section) => sum + section[key].length, 0);
  const conflicts = count('conflicts');
  const filled = count('filled');
  if (conflicts) return { tone: 'warning', text: `${conflicts} 項跟報告不同`, sections };
  if (sections.some((section) => section.noTemplate)) return { tone: 'warning', text: '沒選健檢表單，數值沒有進報告', sections };
  if (sections.some((section) => section.finalized)) return { tone: 'warning', text: '報告已結案，數值沒有進報告', sections };
  if (filled) return { tone: 'success', text: `已填入 ${filled} 項`, sections };
  return { tone: 'info', text: '沒有填入新的數值', sections };
}

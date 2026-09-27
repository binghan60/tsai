// 預填模板清單頁的左欄（表單清單）：搜尋、排序、分組都在這裡，頁面只負責畫。
//
// 表單一多，一整條「每份表單一段」的清單很難找，而且大部分是「還沒有模板」的空段落。
// 所以：有模板的排前面（同一組內維持表單原本的順序，位置才不會因為多加一組模板而亂跳）、
// 已停用的另外收一組（不會拿來填報告），搜尋同時比對表單名稱與模板名稱——
// 記得「牙齒」卻忘了它掛在哪份表單底下，打「牙齒」也找得到。

function presetCount(form) {
  return form?.presets?.length || 0;
}

function matches(form, keyword) {
  if (!keyword) return true;
  const needle = keyword.toLowerCase();
  if (String(form.name ?? '').toLowerCase().includes(needle)) return true;
  return (form.presets ?? []).some((preset) => String(preset.name ?? '').toLowerCase().includes(needle));
}

export function presetFormGroups(forms, query = '') {
  const keyword = String(query ?? '').trim();
  const visible = (forms ?? []).filter((form) => matches(form, keyword));
  const byPresence = (list) => [...list.filter((form) => presetCount(form)), ...list.filter((form) => !presetCount(form))];
  return {
    active: byPresence(visible.filter((form) => form.enabled !== false)),
    disabled: byPresence(visible.filter((form) => form.enabled === false)),
  };
}

// 網址沒指定、或指定的表單已經不在時，預設選第一份有模板的啟用中表單；都沒有就選第一份啟用中的。
export function defaultPresetFormId(forms, requestedId = '') {
  const list = forms ?? [];
  if (requestedId && list.some((form) => String(form._id) === String(requestedId))) return String(requestedId);
  const { active, disabled } = presetFormGroups(list);
  const first = active[0] ?? disabled[0];
  return first ? String(first._id) : '';
}

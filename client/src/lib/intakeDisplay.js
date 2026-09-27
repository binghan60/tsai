// 公開初診表（飼主填的）送進來的內容，在櫃台審核時怎麼讀。
// 審核畫面、初診面板、初診審核頁共用這份，不要各自再寫一次對照表。

const blank = (value) => value === null || value === undefined || value === '';

function birthMonth(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : `西元 ${date.getUTCFullYear()} 年 ${date.getUTCMonth() + 1} 月生`;
}

function feeding(pet) {
  if (pet?.feedingType === 'free') return '任食';
  if (pet?.feedingType === 'scheduled') return `定食定量${pet.mealsPerDay ? `，一日 ${pet.mealsPerDay} 餐` : ''}`;
  return '';
}

function joined(list, other, separator = '、') {
  return [list?.join(separator), other].filter(Boolean).join('；');
}

// 回傳 [{ title, rows: [{ label, value }] }]；沒填的欄位值是空字串，畫面顯示「未填寫」。
export function intakeSections(submission) {
  const pet = submission?.pet ?? {};
  const owner = submission?.owner ?? {};
  return [
    {
      key: 'pet',
      title: '貓咪',
      rows: [
        { label: '名字', value: pet.name },
        { label: '性別', value: { male: '公', female: '母' }[pet.sex] },
        { label: '結紮', value: { yes: '已結紮', no: '未結紮' }[pet.neutered] },
        { label: '出生', value: birthMonth(pet.birthDate) },
        { label: '品種', value: pet.breed },
        { label: '花色', value: pet.color },
        { label: '家中貓口', value: blank(pet.householdCatCount) ? '' : `${pet.householdCatCount} 隻` },
        { label: '主餐配菜', value: [pet.foods?.join('、'), pet.foodsOther ? `（${pet.foodsOther}）` : ''].filter(Boolean).join('') },
        { label: '放飯頻率', value: feeding(pet) },
      ],
    },
    {
      key: 'medical',
      title: '醫療紀錄',
      rows: [
        { label: '疫苗', value: pet.vaccineStatus === 'done' ? `已注射 ${pet.vaccineDate || ''}`.trim() : pet.vaccineStatus === 'none' ? '未注射' : '' },
        { label: '病史', value: joined(pet.medicalHistory, pet.medicalHistoryOther) },
        { label: '藥物過敏', value: pet.allergyStatus === 'yes' ? `有${pet.allergyType ? `：${pet.allergyType}` : ''}` : pet.allergyStatus === 'none' ? '無過敏' : '' },
        { label: '健檢', value: pet.checkupStatus === 'done' ? `有 ${pet.checkupDate || ''}`.trim() : pet.checkupStatus === 'none' ? '未健檢' : '' },
      ],
    },
    {
      key: 'owner',
      title: '飼主',
      rows: [
        { label: '姓名', value: owner.name },
        { label: '手機', value: owner.phone, mono: true },
        { label: '市話', value: owner.landline, mono: true },
        { label: 'Email', value: owner.email },
        { label: '地址', value: owner.address },
      ],
    },
  ].map((section) => ({ ...section, rows: section.rows.map((row) => ({ ...row, value: blank(row.value) ? '' : String(row.value) })) }));
}

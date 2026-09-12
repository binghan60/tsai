<script setup>
import { computed, reactive, ref } from 'vue'
import { useForm } from 'vee-validate'
import { http } from '../api/http'

const submitting = ref(false)
const submitted = ref(false)
const attemptedSubmit = ref(false)
const error = ref('')
const owner = reactive({ name: '', phone: '', landline: '', email: '', address: '' })
const pet = reactive({
  name: '',
  sex: 'unknown',
  ageYears: '',
  ageMonths: '',
  breed: '',
  color: '',
  householdCatCount: '',
  diet: '',
  foods: [],
  feedingType: 'unknown',
  mealsPerDay: '',
  neutered: 'unknown',
  vaccineStatus: 'unknown',
  vaccineDate: '',
  medicalHistory: [],
  medicalHistoryOther: '',
  allergyStatus: 'unknown',
  allergyType: '',
  checkupStatus: 'unknown',
  checkupDate: '',
})
const historyOptions = ['心臟病', '腎臟病', '糖尿病', '愛滋病', '白血病', '貓瘟', '冠狀病毒', '泌尿系統問題']
const foodOptions = ['主食罐', '副食罐', '鮮食', '生肉', '乾糧']
const hasAge = computed(() => pet.ageYears !== '' || pet.ageMonths !== '')
const requiredText = (value) => String(value ?? '').trim() ? true : '此欄位必填'
const optionalNonNegativeInteger = (value) => value === '' || value === null || value === undefined || /^\d+$/.test(String(value)) ? true : '請填寫 0 或正整數'
const monthAge = (value) => value === '' || value === null || value === undefined || /^(?:[0-9]|1[01])$/.test(String(value)) ? true : '月齡需為 0–11'
const email = (value) => !String(value ?? '').trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim()) ? true : 'Email 格式不正確'
const { validate, setValues, errors } = useForm({
  validationSchema: {
    petName: requiredText,
    ownerName: requiredText,
    ownerPhone: requiredText,
    ownerEmail: email,
    ageYears: optionalNonNegativeInteger,
    ageMonths: monthAge,
    householdCatCount: optionalNonNegativeInteger,
    mealsPerDay: (value) => pet.feedingType !== 'scheduled' || /^([1-9]\d*)$/.test(String(value ?? '')) || '請填寫每日餐次',
  },
})

function estimatedBirthDate() {
  if (!hasAge.value) return null
  const years = Number(pet.ageYears || 0)
  const months = Number(pet.ageMonths || 0)
  if (!Number.isInteger(years) || !Number.isInteger(months) || years < 0 || months < 0 || months > 11) return null
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setMonth(date.getMonth() - years * 12 - months)
  return date.toISOString()
}

async function submit() {
  attemptedSubmit.value = true
  error.value = ''
  setValues({ petName: pet.name, ownerName: owner.name, ownerPhone: owner.phone, ownerEmail: owner.email, ageYears: pet.ageYears, ageMonths: pet.ageMonths, householdCatCount: pet.householdCatCount, mealsPerDay: pet.mealsPerDay })
  const { valid } = await validate()
  if (!valid) { error.value = Object.values(errors.value)[0] || '請檢查填寫內容'; return }
  submitting.value = true
  try {
    await http.post('/public/intake-submissions', {
      owner,
      pet: {
        name: pet.name,
        species: '貓',
        breed: pet.breed,
        color: pet.color,
        sex: pet.sex,
        neutered: pet.neutered,
        birthDate: estimatedBirthDate(),
        birthDateEstimated: hasAge.value,
        householdCatCount: pet.householdCatCount === '' ? null : Number(pet.householdCatCount),
        diet: pet.diet,
        foods: pet.foods,
        feedingType: pet.feedingType,
        mealsPerDay: pet.mealsPerDay === '' ? null : Number(pet.mealsPerDay),
        vaccineStatus: pet.vaccineStatus,
        vaccineDate: pet.vaccineDate,
        medicalHistory: pet.medicalHistory,
        medicalHistoryOther: pet.medicalHistoryOther,
        allergyStatus: pet.allergyStatus,
        allergyType: pet.allergyType,
        checkupStatus: pet.checkupStatus,
        checkupDate: pet.checkupDate,
      },
    })
    submitted.value = true
  } catch (err) {
    error.value = err.response?.data?.message || '送出失敗，請確認網路後再試。'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="intake-page">
    <div class="container">
      <div v-if="submitted" class="submitted">
        <h1>已送出初診資料</h1>
        <p>櫃台人員會先核對資料，審核完成後才會建立正式病歷。謝謝您的填寫。</p>
      </div>
      <form v-else @submit.prevent="submit">
        <div class="header">
          <h1>初診掛號單</h1>
        </div>
        <div class="section">
          <div class="section-title">貓孩兒</div>
          <div class="grid">
            <div>
              <div class="field-group-title section-emphasis">基本資料</div>
              <div class="field"><label><span class="required-mark" aria-hidden="true">*</span>名字：</label><input v-model="pet.name" class="input-medium" :aria-invalid="attemptedSubmit && !!errors.petName" /><span v-if="attemptedSubmit && errors.petName" class="field-error">{{ errors.petName }}</span></div>
              <div class="field">
                <label>性別：</label><label class="option-label"><input v-model="pet.sex" type="radio" value="male" />男生</label><label class="option-label"><input v-model="pet.sex" type="radio" value="female" />女生</label>
              </div>
              <div class="field"><label>年齡：</label><input v-model="pet.ageYears" class="input-short" inputmode="numeric" /> 年 <input v-model="pet.ageMonths" class="input-short" inputmode="numeric" /> 個月<span v-if="attemptedSubmit && (errors.ageYears || errors.ageMonths)" class="field-error">{{ errors.ageYears || errors.ageMonths }}</span></div>
              <div class="field"><label>品種：</label><input v-model="pet.breed" class="input-medium" /></div>
              <div class="field"><label>花色：</label><input v-model="pet.color" class="input-medium" /></div>
            </div>
            <div>
              <div class="field-group-title section-emphasis">生活狀況</div>
              <div class="field"><label>家中貓口：</label><input v-model="pet.householdCatCount" class="input-short" inputmode="numeric" /> 隻<span v-if="attemptedSubmit && errors.householdCatCount" class="field-error">{{ errors.householdCatCount }}</span></div>
              <div class="field"><label>飲食：</label><input v-model="pet.diet" class="input-medium" /></div>
              <div class="field">
                <label>主餐配菜：</label><label v-for="option in foodOptions" :key="option" class="option-label"><input v-model="pet.foods" type="checkbox" :value="option" />{{ option }}</label
                ><span class="hint">(以上可複選)</span>
              </div>
              <div class="field">
                <label>放飯頻率：</label><label class="option-label"><input v-model="pet.feedingType" type="radio" value="free" />任食</label><label class="option-label"><input v-model="pet.feedingType" type="radio" value="scheduled" />定食定量：一日 <input v-model="pet.mealsPerDay" class="input-short" inputmode="numeric" /> 餐</label><span v-if="attemptedSubmit && errors.mealsPerDay" class="field-error">{{ errors.mealsPerDay }}</span>
              </div>
            </div>
          </div>
          <div class="medical">
            <div class="field-group-title section-emphasis">醫療紀錄</div>
            <div class="field">
              <label>結紮：</label><label class="option-label"><input v-model="pet.neutered" type="radio" value="no" />未結紮</label><label class="option-label"><input v-model="pet.neutered" type="radio" value="yes" />已結紮</label>
            </div>
            <div class="field">
              <label>疫苗：</label><label class="option-label"><input v-model="pet.vaccineStatus" type="radio" value="none" />未注射</label><label class="option-label"><input v-model="pet.vaccineStatus" type="radio" value="done" />已注射：最後注射時間</label><input v-model="pet.vaccineDate" class="input-medium" placeholder="例：8/10" />
            </div>
            <div class="field">
              <label>病史：</label><label v-for="option in historyOptions" :key="option" class="option-label"><input v-model="pet.medicalHistory" type="checkbox" :value="option" />{{ option }}</label
              ><label class="option-label">其他</label><input v-model="pet.medicalHistoryOther" class="input-medium" />
            </div>
            <div class="field">
              <label>藥物過敏：</label><label class="option-label"><input v-model="pet.allergyStatus" type="radio" value="none" />無過敏</label><label class="option-label"><input v-model="pet.allergyStatus" type="radio" value="yes" />有：過敏類別</label><input v-model="pet.allergyType" class="input-medium" />
            </div>
            <div class="field">
              <label>健檢：</label><label class="option-label"><input v-model="pet.checkupStatus" type="radio" value="none" />未健檢</label><label class="option-label"><input v-model="pet.checkupStatus" type="radio" value="done" />有：上次健檢時間</label><input v-model="pet.checkupDate" class="input-medium" />
            </div>
          </div>
        </div>
        <div class="section owner-section">
          <div class="section-title">家長</div>
          <div class="field-group-title section-emphasis">基本資料</div>
          <div class="field"><label><span class="required-mark" aria-hidden="true">*</span>姓名：</label><input v-model="owner.name" class="input-medium" autocomplete="name" :aria-invalid="attemptedSubmit && !!errors.ownerName" /><span v-if="attemptedSubmit && errors.ownerName" class="field-error">{{ errors.ownerName }}</span></div>
          <div class="field"><label>市話：</label><input v-model="owner.landline" class="input-medium" type="tel" /><label class="mobile-label"><span class="required-mark" aria-hidden="true">*</span>手機：</label><input v-model="owner.phone" class="input-medium" type="tel" autocomplete="tel" :aria-invalid="attemptedSubmit && !!errors.ownerPhone" /><span v-if="attemptedSubmit && errors.ownerPhone" class="field-error">{{ errors.ownerPhone }}</span></div>
          <div class="field"><label>地址：</label><input v-model="owner.address" class="input-long" autocomplete="street-address" /></div>
          <div class="field"><label>Email：</label><input v-model="owner.email" class="input-long" inputmode="email" autocomplete="email" :aria-invalid="attemptedSubmit && !!errors.ownerEmail" /><span v-if="attemptedSubmit && errors.ownerEmail" class="field-error">{{ errors.ownerEmail }}</span></div>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <div class="submit-btn-container">
          <button class="submit-btn" type="submit" :disabled="submitting">{{ submitting ? '送出中…' : '送出' }}</button>
        </div>
        <div class="footer">
          <div class="hospital-info">
            <img src="/chien-hua-logo-mark-v2.png" alt="謙華動物醫院 Logo" class="hospital-logo" />
            <div>
              <h2>謙華動物醫院 CHIEN HUA Animal Hospital</h2>
              <p>門診時間：9:00-11:30, 14:00-20:30 / 電話：035619595</p>
              <p>地址：新竹市東區公園路226號</p>
            </div>
          </div>
        </div>
      </form>
    </div>
  </main>
</template>

<style scoped>
.intake-page {
  min-height: 100vh;
  background: var(--intake-white);
  padding: 20px;
  color: var(--intake-text);
  font-family: 'PingFang TC', 'Microsoft JhengHei', sans-serif;
}
.container {
  max-width: 750px;
  margin: 0 auto;
  background: var(--intake-white);
  padding: 30px;
  border-radius: 8px;
  box-shadow: 0 4px 10px var(--intake-shadow);
}
.header {
  position: relative;
  margin-bottom: 20px;
  border-bottom: 2px solid var(--intake-border);
  padding-bottom: 15px;
  text-align: center;
}
.logo {
  color: var(--intake-red);
  font-size: 16px;
  font-weight: bold;
  letter-spacing: 2px;
}
.header h1 {
  margin: 10px 0 0;
  font-size: 24px;
  letter-spacing: 2px;
}
.section {
  margin-bottom: 25px;
}
.section-title {
  margin-bottom: 12px;
  color: var(--intake-heading);
  font-size: 18px;
  font-weight: bold;
}
.section-title span {
  margin-left: 10px;
  color: var(--intake-muted);
  font-size: 14px;
  font-weight: normal;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.medical {
  margin-top: 15px;
}
.field-group-title {
  margin-bottom: 10px;
  border-bottom: 1px dashed var(--intake-dash);
  padding-bottom: 4px;
  color: var(--intake-secondary);
  font-weight: bold;
}
.section-emphasis, .section-title.section-emphasis span, .section-title .section-emphasis { color: var(--intake-orange); }
.field {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
  line-height: 1.8;
}
.field > label:first-child {
  color: var(--intake-label);
  font-weight: bold;
}
.field input[type='text'],
.field input[type='number'],
.field input[type='email'],
.field input[type='tel'] {
  border: none;
  border-bottom: 1px solid var(--intake-secondary);
  border-radius: 0;
  padding: 2px 5px;
  background: transparent;
  color: var(--intake-text);
  font-family: inherit;
  font-size: 14px;
  outline: none;
}
.field input:focus {
  border-bottom: 2px solid var(--intake-focus);
  background-color: var(--intake-focus-surface);
}
.input-short {
  width: 50px;
  text-align: center;
}
.input-medium {
  width: 130px;
}
.input-long {
  min-width: 200px;
  flex: 1;
}
.option-label {
  display: inline-flex;
  align-items: center;
  margin-right: 6px;
  cursor: pointer;
  font-size: 14px;
  user-select: none;
}
.option-label input {
  width: 16px;
  height: 16px;
  margin-right: 4px;
  cursor: pointer;
}
.hint {
  color: var(--intake-hint);
  font-size: 11px;
}
.field-error { color: var(--intake-red); font-size: 12px; }
.required-mark { color: var(--intake-red); }
.owner-section {
  border-top: 1px dashed var(--intake-dash);
  padding-top: 15px;
}
.mobile-label {
  margin-left: 20px;
}
.submit-btn-container {
  margin-top: 25px;
  text-align: center;
}
.submit-btn {
  border: none;
  border-radius: 4px;
  padding: 10px 24px;
  background-color: var(--intake-focus);
  color: var(--intake-white);
  cursor: pointer;
  font-size: 16px;
  transition: background 0.2s;
}
.submit-btn:hover:not(:disabled) {
  background-color: var(--intake-focus-hover);
}
.submit-btn:disabled {
  cursor: wait;
  opacity: 0.7;
}
.footer {
  margin-top: 30px;
  border-top: 2px solid var(--intake-border);
  padding-top: 15px;
  color: var(--intake-secondary);
  font-size: 12px;
}
.hospital-info h2 {
  margin: 0;
  color: var(--intake-text);
  font-size: 16px;
}
.hospital-info { display: flex; align-items: center; gap: 12px; }
.hospital-logo { width: 44px; height: 44px; flex: 0 0 auto; object-fit: contain; }
.hospital-info p {
  margin: 3px 0;
}
.error {
  margin: 12px 0;
  color: var(--intake-red);
  text-align: center;
}
.submitted {
  padding: 80px 20px;
  text-align: center;
}
.submitted h1 {
  font-size: 24px;
}
.submitted p {
  color: var(--intake-secondary);
  line-height: 1.8;
}
@media (max-width: 640px) {
  .intake-page {
    padding: 0;
  }
  .container {
    min-height: 100vh;
    border-radius: 0;
    box-shadow: none;
    padding: 20px 16px;
  }
  .grid {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .header h1 {
    font-size: 22px;
  }
  .field {
    align-items: flex-start;
    gap: 5px;
  }
  .field > label:first-child {
    min-width: 70px;
  }
  .option-label {
    margin-right: 8px;
  }
  .mobile-label {
    margin-left: 0 !important;
  }
  .input-long {
    min-width: 150px;
  }
  .medical {
    margin-top: 10px;
  }
}
</style>

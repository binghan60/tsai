<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useField, useForm } from 'vee-validate'
import { http } from '../api/http'
import { Checkbox } from '../components/ui/checkbox'
import { Input } from '../components/ui/input'
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group'
import { Button } from '../components/ui/button'

const submitting = ref(false)
const submitted = ref(false)
const attemptedSubmit = ref(false)
const highlightedField = ref('')
const error = ref('')
const verificationCode = ref('')
const verifying = ref(false)
const verified = ref(false)
const required = value => String(value ?? '').trim() ? true : '此欄位必填'
const integer = (value, min, max) => /^\d+$/.test(String(value)) && Number(value) >= min && Number(value) <= max
const optionalInteger = (value, min, max) => value === '' || value == null || integer(value, min, max) || `請填寫 ${min}–${max} 的整數`
const { validate, errors } = useForm({
  validationSchema: {
    petName: required,
    petSex: value => ['male', 'female'].includes(value) || '請選擇性別',
    ageYears: value => optionalInteger(value, 0, 99),
    ageMonths: value => optionalInteger(value, 0, 11),
    petAge: value => value || '請填寫歲數或月數',
    petBreed: required,
    householdCatCount: value => optionalInteger(value, 0, 99),
    mealsPerDay: value => pet.feedingType !== 'scheduled' || integer(value, 1, 20) || '請填寫每日 1–20 餐的整數',
    petNeutered: value => ['yes', 'no'].includes(value) || '請選擇結紮狀態',
    ownerName: required,
    ownerPhone: required,
    ownerAddress: required,
    ownerEmail: value => required(value) !== true ? '此欄位必填' : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim()) || 'Email 格式不正確',
  },
})
const field = (name, initialValue = '') => useField(name, undefined, { initialValue }).value
const owner = reactive({ name: field('ownerName'), phone: field('ownerPhone'), landline: '', email: field('ownerEmail'), address: field('ownerAddress') })
const pet = reactive({
  name: field('petName'),
  sex: field('petSex', 'unknown'),
  ageYears: field('ageYears'),
  ageMonths: field('ageMonths'),
  breed: field('petBreed'),
  color: '',
  householdCatCount: field('householdCatCount'),
  foods: [],
  foodsOther: '',
  feedingType: 'unknown',
  mealsPerDay: field('mealsPerDay'),
  neutered: field('petNeutered', 'unknown'),
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
const foodOptions = ['主食罐', '副食罐', '鮮食', '生肉', '乾糧', '其他']
const hasAge = computed(() => pet.ageYears !== '' || pet.ageMonths !== '')
const agePresent = field('petAge', false)
watch(hasAge, value => { agePresent.value = value }, { flush: 'sync' })
watch(() => pet.feedingType, () => { if (attemptedSubmit.value) validate() })
const fieldTargets = {
  petName: 'pet-name', petSex: 'pet-sex', petAge: 'pet-age', ageYears: 'pet-age', ageMonths: 'pet-age',
  petBreed: 'pet-breed', householdCatCount: 'household-count', mealsPerDay: 'meals',
  petNeutered: 'pet-neutered', ownerName: 'owner-name', ownerPhone: 'owner-phone',
  ownerAddress: 'owner-address', ownerEmail: 'owner-email',
}
const estimatedBirthLabel = computed(() => {
  const date = estimatedBirthDate()
  if (!date) return ''
  const value = new Date(date)
  return `西元 ${value.getUTCFullYear()} 年 ${value.getUTCMonth() + 1} 月生`
})

function estimatedBirthDate() {
  if (!hasAge.value || errors.value.petAge) return null
  const years = Number(pet.ageYears || 0)
  const months = Number(pet.ageMonths || 0)
  if (!Number.isInteger(years) || !Number.isInteger(months) || years < 0 || months < 0 || months > 11) return null
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setMonth(date.getMonth() - years * 12 - months)
  return date.toISOString()
}

function toggleList(list, option, checked) {
  const next = new Set(list)
  if (checked) next.add(option)
  else next.delete(option)
  return [...next]
}

let cancelScrollFocus = () => {}
onBeforeUnmount(() => cancelScrollFocus())

async function jumpToIssue() {
  cancelScrollFocus()
  const key = Object.keys(fieldTargets).find(key => errors.value[key])
  const fieldId = key && `intake-${fieldTargets[key]}-field`
  if (!fieldId) return

  highlightedField.value = fieldId
  await nextTick()
  const field = document.getElementById(fieldId)
  if (!field) return
  // 等平滑捲動結束再聚焦，避免手機鍵盤或焦點行為打斷滑動。
  const finish = () => {
    cancelScrollFocus()
    if (field.isConnected) field.querySelector('input:not([type=hidden]):not(:disabled), [role=radio]')?.focus({ preventScroll: true })
  }
  const fallback = window.setTimeout(finish, 1200)
  document.addEventListener('scrollend', finish, { once: true })
  cancelScrollFocus = () => {
    window.clearTimeout(fallback)
    document.removeEventListener('scrollend', finish)
  }
  field?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  window.setTimeout(() => {
    if (highlightedField.value === fieldId) highlightedField.value = ''
  }, 1600)
}

watch(verificationCode, () => { verified.value = false })

async function verifyCode() {
  if (verifying.value) return
  error.value = ''
  const code = verificationCode.value.replace(/\D/g, '')
  if (code.length !== 4) {
    error.value = '請輸入櫃台提供的 4 位驗證碼'
    return
  }
  verifying.value = true
  try {
    await http.post('/public/intake-submissions/verify', { verificationCode: code })
    verificationCode.value = code
    verified.value = true
  } catch (err) {
    error.value = err.response?.data?.message || '驗證失敗，請確認驗證碼後再試。'
  } finally {
    verifying.value = false
  }
}

async function submit() {
  if (submitting.value || !verified.value) return
  attemptedSubmit.value = true
  error.value = ''
  const { valid } = await validate()
  if (!valid) {
    await jumpToIssue()
    return
  }
  submitting.value = true
  try {
    await http.post('/public/intake-submissions', {
      verificationCode: verificationCode.value,
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
        foods: pet.foods,
        foodsOther: pet.foods.includes('其他') ? pet.foodsOther : '',
        feedingType: pet.feedingType,
        mealsPerDay: pet.feedingType === 'scheduled' ? Number(pet.mealsPerDay) : null,
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
    if (err.response?.status === 409) verified.value = false
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="intake-page" :class="{ 'is-verification': !submitted && !verified }">
    <div class="container">
      <div v-if="submitted" class="submitted">
        <h1>已送出初診資料</h1>
        <p>櫃台人員會先核對資料，審核完成後才會建立正式病歷。謝謝您的填寫。</p>
      </div>
      <section v-else-if="!verified" class="verification-card" aria-labelledby="intake-verification-title">
        <h1 id="intake-verification-title">初診掛號單</h1>
        <div class="verification-content">
          <form class="verification-form" @submit.prevent="verifyCode">
            <label for="intake-verification-code">請輸入驗證碼</label>
            <Input id="intake-verification-code" v-model="verificationCode" inputmode="numeric" autocomplete="one-time-code" maxlength="4" placeholder="4 位數字" class="verification-input" />
            <p v-if="error" class="error">{{ error }}</p>
            <Button type="submit" :disabled="verifying">{{ verifying ? '驗證中…' : '開始填寫' }}</Button>
          </form>
        </div>
        <div class="verification-hospital-info">
          <img src="/chien-hua-logo-mark-v2.png" alt="謙華動物醫院 Logo" />
          <div>
            <h2>謙華動物醫院</h2>
            <p>CHIEN HUA Animal Hospital</p>
            <p>門診時間：9:00–11:30、14:00–20:30</p>
            <p>03-561-9595 · 新竹市東區公園路 226 號</p>
          </div>
        </div>
      </section>
      <form v-else novalidate @submit.prevent="submit">
        <div class="header">
          <h1>初診掛號單</h1>
        </div>
        <p class="hint">標示 * 的欄位必填；年齡可填歲數或月數，未滿一歲可填 0 歲。</p>
        <div class="section">
          <div class="section-title">貓孩兒</div>
          <div class="grid">
            <div>
              <div class="field-group-title section-emphasis">基本資料</div>
              <div id="intake-pet-name-field" class="field" :class="{ 'field-highlight': highlightedField === 'intake-pet-name-field' }"><label><span class="required-mark" aria-hidden="true">*</span>名字：</label><Input v-model="pet.name" class="input-medium" aria-required="true" :aria-invalid="attemptedSubmit && !!errors.petName" /><span v-if="attemptedSubmit && errors.petName" class="field-error">{{ errors.petName }}</span></div>
              <div id="intake-pet-sex-field" class="field" :class="{ 'field-highlight': highlightedField === 'intake-pet-sex-field' }">
                <label><span class="required-mark" aria-hidden="true">*</span>性別：</label><RadioGroup v-model="pet.sex" aria-required="true" class="contents"><label class="option-label"><RadioGroupItem value="male" />男生</label><label class="option-label"><RadioGroupItem value="female" />女生</label></RadioGroup><span v-if="attemptedSubmit && errors.petSex" class="field-error">{{ errors.petSex }}</span>
              </div>
              <div id="intake-pet-age-field" class="field" :class="{ 'field-highlight': highlightedField === 'intake-pet-age-field' }"><label><span class="required-mark" aria-hidden="true">*</span>年齡：</label><Input v-model="pet.ageYears" aria-required="true" class="input-short" type="number" min="0" step="1" inputmode="numeric" /> 年 <Input v-model="pet.ageMonths" class="input-short" type="number" min="0" max="11" step="1" inputmode="numeric" /> 個月<span class="hint">（月齡 0–11）</span><span v-if="estimatedBirthLabel" class="hint">（{{ estimatedBirthLabel }}）</span><span v-if="attemptedSubmit && (errors.petAge || errors.ageYears || errors.ageMonths)" class="field-error">{{ errors.petAge || errors.ageYears || errors.ageMonths }}</span></div>
              <div id="intake-pet-breed-field" class="field" :class="{ 'field-highlight': highlightedField === 'intake-pet-breed-field' }"><label><span class="required-mark" aria-hidden="true">*</span>品種：</label><Input v-model="pet.breed" aria-required="true" class="input-medium" /><span v-if="attemptedSubmit && errors.petBreed" class="field-error">{{ errors.petBreed }}</span></div>
              <div class="field"><label>花色：</label><Input v-model="pet.color" class="input-medium" /></div>
            </div>
            <div>
              <div class="field-group-title section-emphasis">生活狀況</div>
              <div id="intake-household-count-field" class="field"><label>家中貓口：</label><Input v-model="pet.householdCatCount" class="input-short" type="number" min="0" step="1" inputmode="numeric" /> 隻<span v-if="attemptedSubmit && errors.householdCatCount" class="field-error">{{ errors.householdCatCount }}</span></div>
              <div class="field">
                <label>主餐配菜：</label><label v-for="option in foodOptions" :key="option" class="option-label"><Checkbox :model-value="pet.foods.includes(option)" @update:model-value="pet.foods = toggleList(pet.foods, option, $event === true)" />{{ option }}<template v-if="option === '其他'">：</template></label
                ><Input v-if="pet.foods.includes('其他')" v-model="pet.foodsOther" class="input-medium" placeholder="請填寫" /><span class="hint">(以上可複選)</span>
              </div>
              <div id="intake-meals-field" class="field">
                <label>放飯頻率：</label><RadioGroup v-model="pet.feedingType" class="contents"><label class="option-label"><RadioGroupItem value="free" />任食</label><label class="option-label"><RadioGroupItem value="scheduled" />定食定量：一日 <Input v-model="pet.mealsPerDay" :disabled="pet.feedingType !== 'scheduled'" class="input-short" type="number" min="1" max="20" step="1" inputmode="numeric" /> 餐</label></RadioGroup><span v-if="attemptedSubmit && errors.mealsPerDay" class="field-error">{{ errors.mealsPerDay }}</span>
              </div>
            </div>
          </div>
          <div class="medical">
            <div class="field-group-title section-emphasis">醫療紀錄</div>
            <div id="intake-pet-neutered-field" class="field" :class="{ 'field-highlight': highlightedField === 'intake-pet-neutered-field' }">
              <label><span class="required-mark" aria-hidden="true">*</span>結紮：</label><RadioGroup v-model="pet.neutered" aria-required="true" class="contents"><label class="option-label"><RadioGroupItem value="no" />未結紮</label><label class="option-label"><RadioGroupItem value="yes" />已結紮</label></RadioGroup><span v-if="attemptedSubmit && errors.petNeutered" class="field-error">{{ errors.petNeutered }}</span>
            </div>
            <div class="field">
              <label>疫苗：</label><RadioGroup v-model="pet.vaccineStatus" class="contents"><label class="option-label"><RadioGroupItem value="none" />未注射</label><label class="option-label"><RadioGroupItem value="done" />已注射：最後注射時間</label></RadioGroup><Input v-model="pet.vaccineDate" class="input-medium" placeholder="例：8/10" />
            </div>
            <div class="field">
              <label>病史：</label><label v-for="option in historyOptions" :key="option" class="option-label"><Checkbox :model-value="pet.medicalHistory.includes(option)" @update:model-value="pet.medicalHistory = toggleList(pet.medicalHistory, option, $event === true)" />{{ option }}</label
              ><label class="option-label">其他</label><Input v-model="pet.medicalHistoryOther" class="input-medium" />
            </div>
            <div class="field">
              <label>藥物過敏：</label><RadioGroup v-model="pet.allergyStatus" class="contents"><label class="option-label"><RadioGroupItem value="none" />無過敏</label><label class="option-label"><RadioGroupItem value="yes" />有：過敏類別</label></RadioGroup><Input v-model="pet.allergyType" class="input-medium" />
            </div>
            <div class="field">
              <label>健檢：</label><RadioGroup v-model="pet.checkupStatus" class="contents"><label class="option-label"><RadioGroupItem value="none" />未健檢</label><label class="option-label"><RadioGroupItem value="done" />有：上次健檢時間</label></RadioGroup><Input v-model="pet.checkupDate" class="input-medium" />
            </div>
          </div>
        </div>
        <div class="section owner-section">
          <div class="section-title">家長</div>
          <div class="field-group-title section-emphasis">基本資料</div>
          <div id="intake-owner-name-field" class="field" :class="{ 'field-highlight': highlightedField === 'intake-owner-name-field' }"><label><span class="required-mark" aria-hidden="true">*</span>姓名：</label><Input v-model="owner.name" class="input-medium" autocomplete="name" aria-required="true" :aria-invalid="attemptedSubmit && !!errors.ownerName" /><span v-if="attemptedSubmit && errors.ownerName" class="field-error">{{ errors.ownerName }}</span></div>
          <div class="field contact-field">
            <div class="contact-item"><label>市話：</label><Input v-model="owner.landline" class="input-medium" type="tel" /></div>
            <div id="intake-owner-phone-field" class="contact-item" :class="{ 'field-highlight': highlightedField === 'intake-owner-phone-field' }"><label><span class="required-mark" aria-hidden="true">*</span>手機：</label><Input v-model="owner.phone" class="input-medium" type="tel" autocomplete="tel" aria-required="true" :aria-invalid="attemptedSubmit && !!errors.ownerPhone" /><span v-if="attemptedSubmit && errors.ownerPhone" class="field-error">{{ errors.ownerPhone }}</span></div>
          </div>
          <div id="intake-owner-address-field" class="field" :class="{ 'field-highlight': highlightedField === 'intake-owner-address-field' }"><label><span class="required-mark" aria-hidden="true">*</span>地址：</label><Input v-model="owner.address" aria-required="true" class="input-long" autocomplete="street-address" /><span v-if="attemptedSubmit && errors.ownerAddress" class="field-error">{{ errors.ownerAddress }}</span></div>
          <div id="intake-owner-email-field" class="field" :class="{ 'field-highlight': highlightedField === 'intake-owner-email-field' }"><label><span class="required-mark" aria-hidden="true">*</span>Email：</label><Input v-model="owner.email" aria-required="true" class="input-long" inputmode="email" autocomplete="email" :aria-invalid="attemptedSubmit && !!errors.ownerEmail" /><span v-if="attemptedSubmit && errors.ownerEmail" class="field-error">{{ errors.ownerEmail }}</span></div>
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
.intake-page.is-verification {
  display: flex;
  align-items: center;
  justify-content: center;
}
.intake-page.is-verification .container {
  display: flex;
  min-height: calc(100vh - 40px);
}
.container {
  max-width: 750px;
  margin: 0 auto;
  background: var(--intake-white);
  padding: 30px;
  border-radius: 8px;
  box-shadow: 0 4px 10px var(--intake-shadow);
}
.verification-card {
  margin: 0 auto;
  max-width: 420px;
  display: flex;
  width: 100%;
  flex: 1;
  flex-direction: column;
  text-align: center;
}
.verification-content {
  margin-top: auto;
  margin-bottom: auto;
}
.verification-card h1 {
  margin: 0;
  font-size: 24px;
  letter-spacing: 2px;
}
.verification-card > p {
  margin: 14px 0 24px;
  color: var(--intake-secondary);
  line-height: 1.7;
}
.verification-form {
  display: grid;
  gap: 10px;
  text-align: left;
}
.verification-form > label {
  color: var(--intake-label);
  font-weight: bold;
}
.verification-input {
  text-align: center;
  font-size: 20px;
  letter-spacing: 0.3em;
}
.verification-hospital-info {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 0;
  border-top: 1px solid var(--intake-border);
  padding-top: 20px;
  text-align: left;
  color: var(--intake-secondary);
  font-size: 12px;
  line-height: 1.65;
}
.verification-hospital-info img {
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  object-fit: contain;
}
.verification-hospital-info h2,
.verification-hospital-info p {
  margin: 0;
}
.verification-hospital-info h2 {
  color: var(--intake-text);
  font-size: 14px;
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
.field input[data-slot='input'] {
  border: none;
  border-bottom: 1px solid var(--intake-secondary);
  border-radius: 0;
  padding: 2px 5px;
  background: transparent;
  color: var(--intake-text);
  font-family: inherit;
  font-size: 14px;
  height: auto;
  min-height: 0;
  box-shadow: none;
  outline: none;
}
.field input[data-slot='input']:focus {
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
.option-label [data-slot='checkbox'],
.option-label [data-slot='radio-group-item'] {
  width: 16px;
  height: 16px;
  margin-right: 4px;
  cursor: pointer;
}
.option-label :deep([data-slot='checkbox'][data-state='checked']) {
  border-color: var(--intake-orange) !important;
  background-color: var(--intake-orange) !important;
}
.option-label :deep([data-slot='radio-group-item'][data-state='checked']) {
  border-color: var(--intake-orange) !important;
  background-color: var(--intake-orange) !important;
}
.option-label :deep([data-slot='radio-group-indicator']) {
  display: none !important;
}
.hint {
  color: var(--intake-hint);
  font-size: 11px;
}
.field-error { color: var(--intake-red); font-size: 12px; }
.required-mark { color: var(--intake-red); }
.field-highlight {
  animation: required-field-flash 0.55s ease-in-out 3;
  border-radius: 4px;
}
@keyframes required-field-flash {
  50% { background: var(--intake-focus-surface); box-shadow: 0 0 0 3px var(--intake-focus-surface); }
}
.required-summary {
  margin: 0 0 18px;
  border: 1px solid var(--intake-red);
  border-radius: 4px;
  padding: 9px 12px;
  color: var(--intake-red);
  font-size: 14px;
  line-height: 1.5;
}
.owner-section {
  border-top: 1px dashed var(--intake-dash);
  padding-top: 15px;
}
.contact-field {
  align-items: flex-start;
  gap: 12px 20px;
}
.contact-item {
  display: flex;
  min-width: 0;
  flex: 1 1 240px;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.contact-item > label {
  color: var(--intake-label);
  font-weight: bold;
}
.contact-item .field-error {
  flex-basis: 100%;
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
@media (prefers-reduced-motion: reduce) {
  .field-highlight { animation: none; background: var(--intake-focus-surface); }
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
  .intake-page.is-verification .container {
    min-height: 100vh;
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
  .input-long {
    min-width: 150px;
  }
  .medical {
    margin-top: 10px;
  }
}
</style>

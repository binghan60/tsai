<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useField, useForm } from 'vee-validate'
import { Check } from '@lucide/vue'
import { http } from '../api/http'
import { Checkbox } from '../components/ui/checkbox'
import { Input } from '../components/ui/input'
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group'
import { MOBILE_PHONE_ERROR, normalizeMobilePhone } from '../../../shared/phone.js'
import YearMonthSelect from '../components/YearMonthSelect.vue'
import { INTAKE_BREED_SUGGESTIONS, INTAKE_COLOR_SUGGESTIONS, INTAKE_FOOD_OPTIONS, INTAKE_HISTORY_OPTIONS } from '../lib/intakeDisplay'

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
    ownerPhone: value => required(value) !== true ? '此欄位必填' : !!normalizeMobilePhone(value) || MOBILE_PHONE_ERROR,
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
const historyOptions = INTAKE_HISTORY_OPTIONS
const foodOptions = INTAKE_FOOD_OPTIONS
const breedSuggestions = INTAKE_BREED_SUGGESTIONS
const colorSuggestions = INTAKE_COLOR_SUGGESTIONS
const historyOther = ref(false)
const hospital = {
  name: '謙華動物醫院',
  nameEn: 'CHIEN HUA Animal Hospital',
  hours: '10:00–12:00、14:00–20:00',
  phone: '03-561-9595',
  phoneHref: 'tel:+88635619595',
  address: '新竹市東區公園路 226 號',
  mapHref: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('新竹市東區公園路226號 謙華動物醫院'),
}

// 選項後面的補充欄（注射時間、過敏類別…）跟選項綁在一起：在補充欄打字就自動選「有」，
// 改選「無」就清空補充欄。否則飼主直接在空格裡寫過敏藥物卻沒勾「有」，送出的資料會自相矛盾。
function linkDetail(isOn, turnOn, getText, clearText) {
  watch(getText, text => { if (String(text ?? '').trim() && !isOn()) turnOn() })
  watch(isOn, on => { if (!on) clearText() })
}
linkDetail(() => pet.feedingType === 'scheduled', () => { pet.feedingType = 'scheduled' }, () => pet.mealsPerDay, () => { pet.mealsPerDay = '' })
linkDetail(() => pet.vaccineStatus === 'done', () => { pet.vaccineStatus = 'done' }, () => pet.vaccineDate, () => { pet.vaccineDate = '' })
linkDetail(() => pet.allergyStatus === 'yes', () => { pet.allergyStatus = 'yes' }, () => pet.allergyType, () => { pet.allergyType = '' })
linkDetail(() => pet.checkupStatus === 'done', () => { pet.checkupStatus = 'done' }, () => pet.checkupDate, () => { pet.checkupDate = '' })
linkDetail(() => historyOther.value, () => { historyOther.value = true }, () => pet.medicalHistoryOther, () => { pet.medicalHistoryOther = '' })

const errorId = name => `intake-${name}-error`
// 「沒填」等送出時才提醒；數字欄一打錯（例如月齡打 15）就立刻提示，不必等到送出才發現。
// Email、手機不即時提示——打到一半就跳「格式不正確」只會干擾。
const liveNumberKeys = { ageYears: () => pet.ageYears, ageMonths: () => pet.ageMonths, householdCatCount: () => pet.householdCatCount, mealsPerDay: () => pet.mealsPerDay }
const showsError = key => attemptedSubmit.value || (key in liveNumberKeys && String(liveNumberKeys[key]() ?? '') !== '')
const errorFor = (...keys) => keys.filter(showsError).map(key => errors.value[key]).find(Boolean) || ''
// 欄位出錯時讓報讀器知道、並唸出錯誤訊息。
function invalidAttrs(name, ...keys) {
  if (!errorFor(...keys)) return {}
  return { 'aria-invalid': 'true', 'aria-describedby': errorId(name) }
}
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
// 年齡有三條規則但只算一格；送出後才顯示，跟欄位旁的錯誤訊息同步。
const issueCount = computed(() => attemptedSubmit.value
  ? new Set(Object.keys(fieldTargets).filter(key => errors.value[key]).map(key => fieldTargets[key])).size
  : 0)
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

// 數字欄（年齡、貓口、餐數）打字當下就擋：非數字、或打完會超過上限（月齡 11、餐數 20…）的那一鍵直接不收。
// 用 text＋inputmode=numeric 而不是 type=number：number 欄位讀不到游標位置，也會收 e、小數點與負號。
// 自動填入等擋不到的情況，還有欄位下方即時出現的錯誤訊息墊底。
function blockOutOfRange(event, max) {
  if (!event.inputType?.startsWith('insert') || event.isComposing) return
  const input = event.target
  const data = event.data ?? event.dataTransfer?.getData('text/plain') ?? ''
  const start = input.selectionStart ?? input.value.length
  const end = input.selectionEnd ?? start
  const next = input.value.slice(0, start) + data + input.value.slice(end)
  if (!/^\d*$/.test(next) || (next !== '' && Number(next) > max)) event.preventDefault()
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

// 只收數字；打滿 4 碼就直接驗證，不必再按按鈕。
watch(verificationCode, code => {
  const digits = String(code ?? '').replace(/\D/g, '').slice(0, 4)
  if (digits !== code) {
    verificationCode.value = digits
    return
  }
  verified.value = false
  error.value = ''
  if (digits.length === 4) verifyCode()
})

async function verifyCode() {
  if (verifying.value) return
  error.value = ''
  const code = verificationCode.value
  if (code.length !== 4) {
    error.value = '請輸入櫃台提供的 4 位驗證碼'
    return
  }
  verifying.value = true
  let message = ''
  try {
    await http.post('/public/intake-submissions/verify', { verificationCode: code })
  } catch (err) {
    message = err.response?.data?.message || '驗證失敗，請確認驗證碼後再試。'
  } finally {
    verifying.value = false
  }
  // 驗證途中又改了驗證碼：這次的結果不算數，改驗新的那組。
  if (verificationCode.value !== code) {
    if (verificationCode.value.length === 4) verifyCode()
    return
  }
  if (message) error.value = message
  else verified.value = true
}

// ── 草稿：飼主在現場用手機填，常被打斷（切去相簿找疫苗紀錄、螢幕鎖定、不小心下拉重新整理）。
// 存在這個分頁的 sessionStorage：重新整理還在、關掉分頁就沒了，不會留下舊資料；送出後清掉。
// 已驗證過的驗證碼一起存，重新整理後自動再驗一次，飼主不必重打。
// 接回來時不另外提示——飼主只會覺得資料本來就還在。
const DRAFT_KEY = 'intake-draft'

function formData() {
  return JSON.parse(JSON.stringify({ owner: { ...owner }, pet: { ...pet }, historyOther: historyOther.value }))
}
function applyFormData(data) {
  for (const key of Object.keys(owner)) if (data?.owner?.[key] !== undefined) owner[key] = data.owner[key]
  for (const key of Object.keys(pet)) if (data?.pet?.[key] !== undefined) pet[key] = data.pet[key]
  historyOther.value = !!data?.historyOther
}
function readDraft() {
  try { return JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || 'null') } catch { return null }
}
function writeDraft(value) {
  try {
    if (value) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(value))
    else window.sessionStorage.removeItem(DRAFT_KEY)
  } catch { /* 無痕模式等情況存不進去就算了，表單照常能填 */ }
}

const storedDraft = readDraft()
if (storedDraft?.data) applyFormData(storedDraft.data)
watch(() => [JSON.stringify(formData()), verified.value], () => {
  if (submitted.value) return
  writeDraft({ savedAt: Date.now(), code: verified.value ? verificationCode.value : '', data: formData() })
})
if (storedDraft?.code) verificationCode.value = storedDraft.code

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
      owner: { ...owner, phone: normalizeMobilePhone(owner.phone) },
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
        vaccineDate: pet.vaccineStatus === 'done' ? pet.vaccineDate : '',
        medicalHistory: pet.medicalHistory,
        medicalHistoryOther: historyOther.value ? pet.medicalHistoryOther : '',
        allergyStatus: pet.allergyStatus,
        allergyType: pet.allergyStatus === 'yes' ? pet.allergyType : '',
        checkupStatus: pet.checkupStatus,
        checkupDate: pet.checkupStatus === 'done' ? pet.checkupDate : '',
      },
    })
    submitted.value = true
    writeDraft(null)
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
        <div class="submitted-icon" aria-hidden="true"><Check :size="34" :stroke-width="2.25" /></div>
        <h1>已送出初診資料</h1>
        <p class="submitted-lead">櫃台已收到您的資料，<br>請在候診區稍候叫號。</p>
        <p class="submitted-note"><strong>資料填錯了？</strong>直接告訴櫃台人員就可以更正。</p>
      </div>
      <section v-else-if="!verified" class="verification-card" aria-labelledby="intake-verification-title">
        <h1 id="intake-verification-title">初診掛號單</h1>
        <div class="verification-content">
          <form class="verification-form" @submit.prevent="verifyCode">
            <label for="intake-verification-code">請輸入驗證碼</label>
            <p id="intake-verification-hint" class="verification-hint">驗證碼是 4 位數字，請向櫃台人員索取。</p>
            <Input id="intake-verification-code" v-model="verificationCode" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="4" placeholder="0000" aria-describedby="intake-verification-hint" :aria-invalid="error ? 'true' : undefined" class="verification-input num" />
            <p v-if="error" class="error" role="alert">{{ error }}</p>
            <button class="primary-btn" type="submit" :disabled="verifying">{{ verifying ? '驗證中…' : '開始填寫' }}</button>
          </form>
        </div>
        <div class="verification-hospital-info">
          <img src="/chien-hua-logo-mark-v2.png" :alt="`${hospital.name} Logo`" />
          <div>
            <h2>{{ hospital.name }}</h2>
            <p>{{ hospital.nameEn }}</p>
            <p>門診時間：{{ hospital.hours }}</p>
            <p>電話：<a :href="hospital.phoneHref">{{ hospital.phone }}</a></p>
            <p>地址：<a :href="hospital.mapHref" target="_blank" rel="noopener">{{ hospital.address }}</a></p>
          </div>
        </div>
      </section>
      <form v-else novalidate @submit.prevent="submit">
        <div class="header">
          <div class="header-brand">
            <img src="/chien-hua-logo-mark-v2.png" alt="" class="header-logo" />
            <span>{{ hospital.name }}</span>
          </div>
          <h1>初診掛號單</h1>
        </div>
        <p class="hint">標示 * 的欄位必填；年齡可填歲數或月數，未滿一歲可填 0 歲。</p>
        <div class="section">
          <div class="section-title">貓孩兒</div>
          <div class="grid">
            <div>
              <div class="field-group-title section-emphasis">基本資料</div>
              <div id="intake-pet-name-field" class="field" :class="{ 'field-highlight': highlightedField === 'intake-pet-name-field' }"><label for="intake-pet-name" class="field-label"><span class="required-mark" aria-hidden="true">*</span>名字：</label><Input id="intake-pet-name" v-model="pet.name" class="input-medium" aria-required="true" v-bind="invalidAttrs('pet-name', 'petName')" /><span v-if="errorFor('petName')" :id="errorId('pet-name')" class="field-error">{{ errorFor('petName') }}</span></div>
              <div id="intake-pet-sex-field" class="field" :class="{ 'field-highlight': highlightedField === 'intake-pet-sex-field' }">
                <span id="intake-pet-sex-label" class="field-label"><span class="required-mark" aria-hidden="true">*</span>性別：</span><RadioGroup v-model="pet.sex" aria-labelledby="intake-pet-sex-label" aria-required="true" v-bind="invalidAttrs('pet-sex', 'petSex')" class="contents"><label class="option-label"><RadioGroupItem value="male" />男生</label><label class="option-label"><RadioGroupItem value="female" />女生</label></RadioGroup><span v-if="errorFor('petSex')" :id="errorId('pet-sex')" class="field-error">{{ errorFor('petSex') }}</span>
              </div>
              <div id="intake-pet-age-field" class="field" :class="{ 'field-highlight': highlightedField === 'intake-pet-age-field' }"><label for="intake-pet-age-years" class="field-label"><span class="required-mark" aria-hidden="true">*</span>年齡：</label><Input id="intake-pet-age-years" v-model="pet.ageYears" aria-label="年齡（年）" aria-required="true" v-bind="invalidAttrs('pet-age', 'petAge', 'ageYears', 'ageMonths')" class="input-short" inputmode="numeric" pattern="[0-9]*" maxlength="2" @beforeinput="blockOutOfRange($event, 99)" /> 年 <Input v-model="pet.ageMonths" aria-label="年齡（個月）" v-bind="invalidAttrs('pet-age', 'petAge', 'ageYears', 'ageMonths')" class="input-short" inputmode="numeric" pattern="[0-9]*" maxlength="2" @beforeinput="blockOutOfRange($event, 11)" /> 個月<span class="hint">（月齡 0–11）</span><span v-if="estimatedBirthLabel" class="hint">（{{ estimatedBirthLabel }}）</span><span v-if="errorFor('petAge', 'ageYears', 'ageMonths')" :id="errorId('pet-age')" class="field-error">{{ errorFor('petAge', 'ageYears', 'ageMonths') }}</span></div>
              <div id="intake-pet-breed-field" class="field" :class="{ 'field-highlight': highlightedField === 'intake-pet-breed-field' }"><label for="intake-pet-breed" class="field-label"><span class="required-mark" aria-hidden="true">*</span>品種：</label><Input id="intake-pet-breed" v-model="pet.breed" list="intake-breed-suggestions" autocomplete="off" aria-required="true" v-bind="invalidAttrs('pet-breed', 'petBreed')" class="input-medium" /><span v-if="errorFor('petBreed')" :id="errorId('pet-breed')" class="field-error">{{ errorFor('petBreed') }}</span></div>
              <div class="field"><label for="intake-pet-color" class="field-label">花色：</label><Input id="intake-pet-color" v-model="pet.color" list="intake-color-suggestions" autocomplete="off" class="input-medium" /></div>
              <datalist id="intake-breed-suggestions"><option v-for="option in breedSuggestions" :key="option" :value="option" /></datalist>
              <datalist id="intake-color-suggestions"><option v-for="option in colorSuggestions" :key="option" :value="option" /></datalist>
            </div>
            <div>
              <div class="field-group-title section-emphasis">生活狀況</div>
              <div id="intake-household-count-field" class="field"><label for="intake-household-count" class="field-label">家中貓口：</label><Input id="intake-household-count" v-model="pet.householdCatCount" v-bind="invalidAttrs('household-count', 'householdCatCount')" class="input-medium" inputmode="numeric" pattern="[0-9]*" maxlength="2" @beforeinput="blockOutOfRange($event, 99)" /> 隻<span v-if="errorFor('householdCatCount')" :id="errorId('household-count')" class="field-error">{{ errorFor('householdCatCount') }}</span></div>
              <div class="field" role="group" aria-labelledby="intake-foods-label">
                <span id="intake-foods-label" class="field-label">主餐配菜：</span><label v-for="option in foodOptions" :key="option" class="option-label"><Checkbox :model-value="pet.foods.includes(option)" @update:model-value="pet.foods = toggleList(pet.foods, option, $event === true)" />{{ option }}<template v-if="option === '其他'">：</template></label
                ><Input v-if="pet.foods.includes('其他')" v-model="pet.foodsOther" aria-label="其他主餐配菜" class="input-medium" placeholder="請填寫" /><span class="hint">(以上可複選)</span>
              </div>
              <div id="intake-meals-field" class="field">
                <span id="intake-feeding-label" class="field-label">放飯頻率：</span><RadioGroup v-model="pet.feedingType" aria-labelledby="intake-feeding-label" class="contents"><label class="option-label"><RadioGroupItem value="free" />任食</label><label class="option-label"><RadioGroupItem value="scheduled" />定食定量：一日 <Input v-model="pet.mealsPerDay" aria-label="一日幾餐" v-bind="invalidAttrs('meals', 'mealsPerDay')" class="input-short" inputmode="numeric" pattern="[0-9]*" maxlength="2" @beforeinput="blockOutOfRange($event, 20)" /> 餐</label></RadioGroup><span v-if="errorFor('mealsPerDay')" :id="errorId('meals')" class="field-error">{{ errorFor('mealsPerDay') }}</span>
              </div>
            </div>
          </div>
          <div class="medical">
            <div class="field-group-title section-emphasis">醫療紀錄</div>
            <div id="intake-pet-neutered-field" class="field" :class="{ 'field-highlight': highlightedField === 'intake-pet-neutered-field' }">
              <span id="intake-neutered-label" class="field-label"><span class="required-mark" aria-hidden="true">*</span>結紮：</span><RadioGroup v-model="pet.neutered" aria-labelledby="intake-neutered-label" aria-required="true" v-bind="invalidAttrs('pet-neutered', 'petNeutered')" class="contents"><label class="option-label"><RadioGroupItem value="no" />未結紮</label><label class="option-label"><RadioGroupItem value="yes" />已結紮</label></RadioGroup><span v-if="errorFor('petNeutered')" :id="errorId('pet-neutered')" class="field-error">{{ errorFor('petNeutered') }}</span>
            </div>
            <div class="field">
              <span id="intake-vaccine-label" class="field-label">疫苗：</span><RadioGroup v-model="pet.vaccineStatus" aria-labelledby="intake-vaccine-label" class="contents"><label class="option-label"><RadioGroupItem value="none" />未注射</label><label class="option-label"><RadioGroupItem value="done" />已注射：最後注射時間</label></RadioGroup><YearMonthSelect v-model="pet.vaccineDate" label="最後注射時間" appearance="intake" />
            </div>
            <div class="field" role="group" aria-labelledby="intake-history-label">
              <span id="intake-history-label" class="field-label">病史：</span><label v-for="option in historyOptions" :key="option" class="option-label"><Checkbox :model-value="pet.medicalHistory.includes(option)" @update:model-value="pet.medicalHistory = toggleList(pet.medicalHistory, option, $event === true)" />{{ option }}</label
              ><label class="option-label"><Checkbox v-model="historyOther" />其他：</label><Input v-model="pet.medicalHistoryOther" aria-label="其他病史" class="input-medium" />
            </div>
            <div class="field">
              <span id="intake-allergy-label" class="field-label">藥物過敏：</span><RadioGroup v-model="pet.allergyStatus" aria-labelledby="intake-allergy-label" class="contents"><label class="option-label"><RadioGroupItem value="none" />無過敏</label><label class="option-label"><RadioGroupItem value="yes" />有：過敏類別</label></RadioGroup><Input v-model="pet.allergyType" aria-label="過敏類別" class="input-medium" />
            </div>
            <div class="field">
              <span id="intake-checkup-label" class="field-label">健檢：</span><RadioGroup v-model="pet.checkupStatus" aria-labelledby="intake-checkup-label" class="contents"><label class="option-label"><RadioGroupItem value="none" />未健檢</label><label class="option-label"><RadioGroupItem value="done" />有：上次健檢時間</label></RadioGroup><YearMonthSelect v-model="pet.checkupDate" label="上次健檢時間" appearance="intake" />
            </div>
          </div>
        </div>
        <div class="section owner-section">
          <div class="section-title">家長</div>
          <div class="field-group-title section-emphasis">基本資料</div>
          <div id="intake-owner-name-field" class="field" :class="{ 'field-highlight': highlightedField === 'intake-owner-name-field' }"><label for="intake-owner-name" class="field-label"><span class="required-mark" aria-hidden="true">*</span>姓名：</label><Input id="intake-owner-name" v-model="owner.name" class="input-medium" autocomplete="name" aria-required="true" v-bind="invalidAttrs('owner-name', 'ownerName')" /><span v-if="errorFor('ownerName')" :id="errorId('owner-name')" class="field-error">{{ errorFor('ownerName') }}</span></div>
          <div class="field contact-field">
            <div class="contact-item"><label for="intake-owner-landline" class="field-label">市話：</label><Input id="intake-owner-landline" v-model="owner.landline" class="input-medium" type="tel" /></div>
            <div id="intake-owner-phone-field" class="contact-item" :class="{ 'field-highlight': highlightedField === 'intake-owner-phone-field' }"><label for="intake-owner-phone" class="field-label"><span class="required-mark" aria-hidden="true">*</span>手機：</label><Input id="intake-owner-phone" v-model="owner.phone" class="input-medium" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="例：0912-345-678" aria-required="true" v-bind="invalidAttrs('owner-phone', 'ownerPhone')" /><span v-if="errorFor('ownerPhone')" :id="errorId('owner-phone')" class="field-error">{{ errorFor('ownerPhone') }}</span></div>
          </div>
          <div id="intake-owner-address-field" class="field" :class="{ 'field-highlight': highlightedField === 'intake-owner-address-field' }"><label for="intake-owner-address" class="field-label"><span class="required-mark" aria-hidden="true">*</span>地址：</label><Input id="intake-owner-address" v-model="owner.address" aria-required="true" v-bind="invalidAttrs('owner-address', 'ownerAddress')" class="input-long" autocomplete="street-address" /><span v-if="errorFor('ownerAddress')" :id="errorId('owner-address')" class="field-error">{{ errorFor('ownerAddress') }}</span></div>
          <div id="intake-owner-email-field" class="field" :class="{ 'field-highlight': highlightedField === 'intake-owner-email-field' }"><label for="intake-owner-email" class="field-label"><span class="required-mark" aria-hidden="true">*</span>Email：</label><Input id="intake-owner-email" v-model="owner.email" aria-required="true" v-bind="invalidAttrs('owner-email', 'ownerEmail')" class="input-long" inputmode="email" autocomplete="email" /><span v-if="errorFor('ownerEmail')" :id="errorId('owner-email')" class="field-error">{{ errorFor('ownerEmail') }}</span></div>
        </div>
        <div v-if="issueCount" class="required-summary" aria-live="polite">
          <span>還有 {{ issueCount }} 個欄位需要填寫或修正</span>
          <button type="button" class="summary-jump" @click="jumpToIssue">前往填寫</button>
        </div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="submit-btn-container">
          <button class="primary-btn submit-btn" type="submit" :disabled="submitting">{{ submitting ? '送出中…' : '送出' }}</button>
        </div>
        <div class="footer">
          <div class="hospital-info">
            <img src="/chien-hua-logo-mark-v2.png" :alt="`${hospital.name} Logo`" class="hospital-logo" />
            <div>
              <h2>{{ hospital.name }} {{ hospital.nameEn }}</h2>
              <p>門診時間：{{ hospital.hours }}</p>
              <p>電話：<a :href="hospital.phoneHref">{{ hospital.phone }}</a></p>
              <p>地址：<a :href="hospital.mapHref" target="_blank" rel="noopener">{{ hospital.address }}</a></p>
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
  font-family: var(--font-sans);
  font-size: 16px;
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
.verification-form {
  display: grid;
  gap: 10px;
  text-align: left;
}
.verification-form > label {
  color: var(--intake-label);
  font-weight: bold;
}
.verification-hint {
  margin: -4px 0 4px;
  color: var(--intake-secondary);
  font-size: 14px;
}
.verification-input {
  height: 52px;
  text-align: center;
  font-size: 24px;
  letter-spacing: 0.4em;
}
.verification-input:focus-visible {
  border-color: var(--intake-accent);
  box-shadow: 0 0 0 3px var(--intake-accent-surface);
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
  font-size: 14px;
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
  font-size: 16px;
}
.header {
  position: relative;
  margin-bottom: 20px;
  border-bottom: 2px solid var(--intake-border);
  padding-bottom: 15px;
  text-align: center;
}
.header-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--intake-secondary);
  font-size: 15px;
  font-weight: bold;
  letter-spacing: 1px;
}
.header-logo {
  width: 36px;
  height: 36px;
  object-fit: contain;
}
.header h1 {
  margin: 6px 0 0;
  font-size: 24px;
  letter-spacing: 2px;
}
.section {
  margin-bottom: 25px;
}
.section-title {
  margin-bottom: 12px;
  color: var(--intake-heading);
  font-size: 20px;
  font-weight: bold;
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
  font-weight: bold;
}
.section-emphasis { color: var(--intake-accent); }
.field {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
  line-height: 1.5;
}
/* 電腦版與手機版同一套外觀：標籤獨佔一行、輸入框有外框、選項是整塊可點的膠囊（至少 44px 高）。 */
.field-label {
  color: var(--intake-label);
  font-weight: bold;
}
.field > .field-label,
.contact-item > .field-label {
  flex-basis: 100%;
}
.field input[data-slot='input'] {
  min-height: 44px;
  border: 1px solid var(--intake-dash);
  border-radius: 8px;
  padding: 8px 12px;
  background: var(--intake-white);
  color: var(--intake-text);
  font-family: inherit;
  /* 小於 16px 時 iOS Safari 一聚焦就放大整頁，飼主填完每一格都要自己縮回來。 */
  font-size: 16px;
  height: auto;
  box-shadow: none;
  outline: none;
}
.field input[data-slot='input']:focus {
  border: 1px solid var(--intake-accent);
  box-shadow: 0 0 0 3px var(--intake-accent-surface);
}
.input-short {
  width: 64px;
  text-align: center;
}
.input-medium,
.input-long {
  min-width: 0;
  flex: 1 1 180px;
}
.option-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  border: 1px solid var(--intake-dash);
  border-radius: 999px;
  padding: 6px 14px;
  cursor: pointer;
  user-select: none;
}
.option-label:has([data-state='checked']) {
  border-color: var(--intake-accent);
  background: var(--intake-accent-surface);
}
/* 「定食定量：一日 □ 餐」的輸入框在膠囊裡面，縮小一點才不會把膠囊撐高。 */
.field .option-label input[data-slot='input'] {
  min-height: 32px;
  padding: 2px 6px;
}
.option-label [data-slot='checkbox'],
.option-label [data-slot='radio-group-item'] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}
.option-label :deep([data-slot='checkbox'][data-state='checked']),
.option-label :deep([data-slot='radio-group-item'][data-state='checked']) {
  border-color: var(--intake-accent) !important;
  background-color: var(--intake-accent) !important;
}
.option-label :deep([data-slot='checkbox']:focus-visible),
.option-label :deep([data-slot='radio-group-item']:focus-visible) {
  border-color: var(--intake-accent) !important;
  box-shadow: 0 0 0 3px var(--intake-accent-surface);
}
.option-label :deep([data-slot='radio-group-indicator']) {
  display: none !important;
}
.hint {
  color: var(--intake-secondary);
  font-size: 14px;
}
.field-error { flex-basis: 100%; color: var(--intake-red); font-size: 14px; }
.required-mark { color: var(--intake-red); }
.field-highlight {
  animation: required-field-flash 0.55s ease-in-out 3;
  border-radius: 4px;
}
@keyframes required-field-flash {
  50% { background: var(--intake-accent-surface); box-shadow: 0 0 0 3px var(--intake-accent-surface); }
}
.required-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  margin: 20px 0 0;
  border: 1px solid var(--intake-red);
  border-radius: 8px;
  padding: 10px 14px;
  background: var(--intake-red-surface);
  color: var(--intake-red);
  font-weight: bold;
  line-height: 1.5;
}
.summary-jump {
  border: none;
  background: none;
  padding: 4px 0;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
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
.contact-item .field-error {
  flex-basis: 100%;
}
.submit-btn-container {
  margin-top: 25px;
  text-align: center;
}
.primary-btn {
  min-height: 48px;
  border: none;
  border-radius: 8px;
  padding: 10px 32px;
  background-color: var(--intake-accent);
  color: var(--intake-white);
  cursor: pointer;
  font-family: inherit;
  font-size: 17px;
  font-weight: bold;
  letter-spacing: 1px;
  transition: background 0.2s;
}
.primary-btn:hover:not(:disabled) {
  background-color: var(--intake-accent-hover);
}
.primary-btn:focus-visible {
  outline: 3px solid var(--intake-accent-surface);
  outline-offset: 2px;
  box-shadow: 0 0 0 2px var(--intake-accent);
}
.primary-btn:disabled {
  cursor: wait;
  opacity: 0.7;
}
.footer {
  margin-top: 30px;
  border-top: 2px solid var(--intake-border);
  padding-top: 15px;
  color: var(--intake-secondary);
  font-size: 14px;
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
.hospital-info a,
.verification-hospital-info a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.error {
  margin: 12px 0;
  color: var(--intake-red);
  text-align: center;
}
.submitted {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 72px 20px;
  text-align: center;
}
.submitted-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 999px;
  background: var(--intake-accent-surface);
  color: var(--intake-accent);
}
.submitted h1 {
  margin: 0;
  font-size: 24px;
  letter-spacing: 1px;
}
.submitted-lead {
  margin: 0;
  font-size: 18px;
  line-height: 1.7;
}
.submitted-note {
  margin: 12px 0 0;
  border: 1px solid var(--intake-border);
  border-radius: 12px;
  padding: 12px 16px;
  color: var(--intake-secondary);
  line-height: 1.6;
}
.submitted-note strong {
  display: block;
  color: var(--intake-text);
}
@media (prefers-reduced-motion: reduce) {
  .field-highlight { animation: none; background: var(--intake-accent-surface); }
}
/* 手機：頁面貼齊螢幕、欄位改成單欄，送出鈕滿寬。外觀跟電腦版相同。 */
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
  .medical {
    margin-top: 10px;
  }
  .submit-btn {
    width: 100%;
  }
}
</style>

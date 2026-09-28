import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const DashboardPage = () => import('../pages/DashboardPage.vue');
const VetConsolePage = () => import('../pages/VetConsolePage.vue');
const ReceptionPage = () => import('../pages/ReceptionPage.vue');
const MedicationPickupPage = () => import('../pages/MedicationPickupPage.vue');
const PetsListPage = () => import('../pages/PetsListPage.vue');
const PetCreatePage = () => import('../pages/PetCreatePage.vue');
const PetDetailPage = () => import('../pages/PetDetailPage.vue');
const RecordFormPage = () => import('../pages/RecordFormPage.vue');
const RecordsListPage = () => import('../pages/RecordsListPage.vue');
const DeliveryLogsPage = () => import('../pages/DeliveryLogsPage.vue');
const ReportViewPage = () => import('../pages/ReportViewPage.vue');
const FormTemplateListPage = () => import('../pages/FormTemplateListPage.vue');
const FormTemplateEditPage = () => import('../pages/FormTemplateEditPage.vue');
const TextTemplateListPage = () => import('../pages/TextTemplateListPage.vue');
const PresetTemplatesPage = () => import('../pages/PresetTemplatesPage.vue');
const PresetEditPage = () => import('../pages/PresetEditPage.vue');
const LoginPage = () => import('../pages/LoginPage.vue');
const PublicIntakePage = () => import('../pages/PublicIntakePage.vue');
const IntakeReviewPage = () => import('../pages/IntakeReviewPage.vue');

const router = createRouter({
  history: createWebHistory(),
  // 返回時回到原本的捲動位置。列表可以捲很長，點進詳情再返回卻彈回頂端的話，
  // 每次都要重新找回自己剛剛看到哪一筆。
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition;
    // 同一頁只是查詢字串變動（列表搜尋把關鍵字同步成 ?q=），不算換頁，
    // 不要把畫面拉回頂端——不然使用者捲到一半改搜尋條件就會被彈上去。
    if (to.path === from.path) return false;
    return { top: 0 };
  },
  routes: [
    { path: '/login', component: LoginPage, meta: { bare: true, public: true, title: '登入' } },
    { path: '/intake', component: PublicIntakePage, meta: { bare: true, public: true, title: '初診資料填寫' } },
    { path: '/', component: DashboardPage, meta: { title: '總覽' } },
    { path: '/appointments', component: VetConsolePage, meta: { title: '診療台' } },
    { path: '/reception', component: ReceptionPage, meta: { title: '掛號台' } },
    { path: '/medications', component: MedicationPickupPage, meta: { title: '領藥' } },
    { path: '/reception/intakes', component: IntakeReviewPage, meta: { title: '初診表審核', nav: '/reception' } },
    // 舊書籤：看診不再是獨立頁面，改成診療台右欄的工作區。
    { path: '/appointments/:id/visit', redirect: '/appointments' },
    { path: '/pets', component: PetsListPage, meta: { title: '貓咪' } },
    // 靜態路由要排在 /pets/:id 前面，不然 "new" 會被吃成動態參數 id。
    { path: '/pets/new', component: PetCreatePage, meta: { title: '新增貓咪' } },
    { path: '/pets/:id', component: PetDetailPage, meta: { title: '貓咪資料' } },
    { path: '/records', component: RecordsListPage, meta: { title: '健檢報告' } },
    // 寄送流水帳。掛在 /records 底下是因為它講的是報告的事，但它不依附任何一份報告——
    // 報告被刪除後，這裡仍然查得到當初寄給了誰。
    { path: '/records/deliveries', component: DeliveryLogsPage, meta: { title: '寄送歷程', nav: '/records/deliveries' } },
    // 舊書籤不再開啟已移除的稽核快照功能，直接回到健檢清單。
    { path: '/records/deleted', redirect: '/records' },
    // 表單管理：清單決定「有哪幾份表單」，設計頁決定「每份表單有哪些項目」。
    { path: '/settings', redirect: '/settings/forms' },
    { path: '/settings/forms', component: FormTemplateListPage, meta: { title: '表單管理' } },
    { path: '/settings/forms/:id', component: FormTemplateEditPage, meta: { title: '表單設計' } },
    { path: '/settings/text-templates', component: TextTemplateListPage, meta: { title: '文字模板' } },
    { path: '/settings/presets', component: PresetTemplatesPage, meta: { title: '預填模板' } },
    { path: '/settings/presets/:formId/:presetKey', component: PresetEditPage, meta: { title: '預填模板' } },
    // transient：不列入「使用者從哪來」的紀錄。存檔後這頁會 replace 成 /records/:id/edit，
    // 之後再回到這個 new 網址只會又開一份新草稿。
    // nav：這頁的網址掛在 /pets 底下，但它做的是健檢報告，側邊欄該亮的是那一項。
    { path: '/pets/:petId/records/new', component: RecordFormPage, meta: { title: '新增健檢', transient: true, nav: '/records' } },
    { path: '/records/:id/edit', component: RecordFormPage, meta: { title: '編輯健檢' } },
    { path: '/records/:id/preview', name: 'record-preview', component: ReportViewPage, meta: { bare: true, title: '報告預覽' } },
    // 公開頁面：無後台導覽列，飼主查看用 + Puppeteer PDF 截圖來源
    { path: '/report/:token', component: ReportViewPage, meta: { bare: true, public: true, title: '健檢報告' } },
  ],
});

router.beforeEach(async (to) => {
  // 登入後不應再停留在登入頁；避免重新整理或手動輸入網址時看到無法使用的登入表單。
  if (to.path === '/login') {
    const auth = useAuthStore();
    await auth.initialize();
    return auth.isAuthenticated ? { path: '/' } : true;
  }
  if (to.meta.public) return true;
  const auth = useAuthStore();
  await auth.initialize();
  if (auth.isAuthenticated) return true;
  return { path: '/login', query: { redirect: to.fullPath } };
});

router.afterEach((to) => {
  document.title = `${to.meta.title || '總覽'}｜謙華動物醫院`;
});

export default router;

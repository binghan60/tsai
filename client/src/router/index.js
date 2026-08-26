import { ref } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';

const DashboardPage = () => import('../pages/DashboardPage.vue');
const AppointmentsPage = () => import('../pages/AppointmentsPage.vue');
const OwnersListPage = () => import('../pages/OwnersListPage.vue');
const OwnerDetailPage = () => import('../pages/OwnerDetailPage.vue');
const PetsListPage = () => import('../pages/PetsListPage.vue');
const PetDetailPage = () => import('../pages/PetDetailPage.vue');
const RecordFormPage = () => import('../pages/RecordFormPage.vue');
const RecordsListPage = () => import('../pages/RecordsListPage.vue');
const DeliveryLogsPage = () => import('../pages/DeliveryLogsPage.vue');
const ReportViewPage = () => import('../pages/ReportViewPage.vue');
const FormTemplateListPage = () => import('../pages/FormTemplateListPage.vue');
const FormTemplateEditPage = () => import('../pages/FormTemplateEditPage.vue');
const TextTemplateListPage = () => import('../pages/TextTemplateListPage.vue');

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
    { path: '/', component: DashboardPage, meta: { title: '工作台' } },
    { path: '/appointments', component: AppointmentsPage, meta: { title: '電話預約' } },
    { path: '/owners', component: OwnersListPage, meta: { title: '飼主' } },
    { path: '/owners/:id', component: OwnerDetailPage, meta: { title: '飼主資料' } },
    { path: '/pets', component: PetsListPage, meta: { title: '寵物' } },
    { path: '/pets/:id', component: PetDetailPage, meta: { title: '寵物資料' } },
    { path: '/records', component: RecordsListPage, meta: { title: '就診紀錄' } },
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
    // transient：不列入「使用者從哪來」的紀錄。存檔後這頁會 replace 成 /records/:id/edit，
    // 之後再回到這個 new 網址只會又開一份新草稿。
    // nav：這頁的網址掛在 /pets 底下，但它做的是就診紀錄，側邊欄該亮的是那一項。
    { path: '/pets/:petId/records/new', component: RecordFormPage, meta: { title: '新增健檢', transient: true, nav: '/records' } },
    { path: '/records/:id/edit', component: RecordFormPage, meta: { title: '編輯健檢' } },
    { path: '/records/:id/preview', name: 'record-preview', component: ReportViewPage, meta: { bare: true, title: '報告預覽' } },
    // 公開頁面：無後台導覽列，飼主查看用 + Puppeteer PDF 截圖來源
    { path: '/report/:token', component: ReportViewPage, meta: { bare: true, title: '健檢報告' } },
  ],
});

// 記住使用者是從哪一頁進到目前這頁的，讓各頁的返回鍵能回到真正的出發點，
// 而不是一律回到寫死的上層網址（從工作台點進健檢編輯，返回卻跑去寵物頁）。
//
// 兩份紀錄各有用途：returnPath 這個 ref 供 useBackTarget 直接讀（元件重用時也會跟著更新），
// history.state 那份則是為了撐過重新整理與上一頁／下一頁——每筆歷史紀錄各自記各自的來源。
const returnPath = ref('');
let lastStablePath = '';

export function useReturnPath() {
  return returnPath;
}

router.afterEach((to, from) => {
  // 同一頁只是查詢字串變動（例如列表搜尋同步 ?q=）不算換頁：來源維持不變，
  // 否則返回鍵會指向使用者「剛剛還站著的同一頁」，等於原地打轉。
  const samePage = from.matched.length > 0 && from.path === to.path;

  if (!samePage) {
    // transient 的路由不能當來源。/pets/:petId/records/new 存檔後會 replace 成
    // /records/:id/edit，之後再回到那個 new 網址只會又開一份新草稿。
    if (from.matched.length && !from.meta.transient && !from.meta.bare) {
      lastStablePath = from.fullPath;
    }
    // 上一頁／下一頁回到既有紀錄時，那筆紀錄自己記著來源，比當下推算的準。
    const stored = window.history.state?.chFrom;
    returnPath.value = typeof stored === 'string' && stored ? stored : lastStablePath;
  }

  if (returnPath.value && returnPath.value !== to.fullPath && window.history.state?.chFrom !== returnPath.value) {
    window.history.replaceState({ ...window.history.state, chFrom: returnPath.value }, '');
  }

  document.title = `${to.meta.title || '工作台'}｜謙華動物醫院`;
});

export default router;

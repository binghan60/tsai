import { createRouter, createWebHistory } from 'vue-router';

const DashboardPage = () => import('../pages/DashboardPage.vue');
const OwnersListPage = () => import('../pages/OwnersListPage.vue');
const OwnerDetailPage = () => import('../pages/OwnerDetailPage.vue');
const PetsListPage = () => import('../pages/PetsListPage.vue');
const PetDetailPage = () => import('../pages/PetDetailPage.vue');
const RecordFormPage = () => import('../pages/RecordFormPage.vue');
const ReportViewPage = () => import('../pages/ReportViewPage.vue');
const FormTemplateListPage = () => import('../pages/FormTemplateListPage.vue');
const FormTemplateEditPage = () => import('../pages/FormTemplateEditPage.vue');

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: DashboardPage, meta: { title: '工作台' } },
    { path: '/owners', component: OwnersListPage, meta: { title: '飼主' } },
    { path: '/owners/:id', component: OwnerDetailPage, meta: { title: '飼主資料' } },
    { path: '/pets', component: PetsListPage, meta: { title: '寵物' } },
    { path: '/pets/:id', component: PetDetailPage, meta: { title: '寵物資料' } },
    // 健檢表單管理：清單決定「有哪幾份表單」，設計頁決定「每份表單有哪些項目」。
    { path: '/settings', redirect: '/settings/forms' },
    { path: '/settings/forms', component: FormTemplateListPage, meta: { title: '健檢表單' } },
    { path: '/settings/forms/:id', component: FormTemplateEditPage, meta: { title: '表單設計' } },
    { path: '/pets/:petId/records/new', component: RecordFormPage, meta: { title: '新增健檢' } },
    { path: '/records/:id/edit', component: RecordFormPage, meta: { title: '編輯健檢' } },
    { path: '/records/:id/preview', name: 'record-preview', component: ReportViewPage, meta: { bare: true, title: '報告預覽' } },
    // 公開頁面：無後台導覽列，飼主查看用 + Puppeteer PDF 截圖來源
    { path: '/report/:token', component: ReportViewPage, meta: { bare: true, title: '健檢報告' } },
  ],
});

router.afterEach((to) => {
  document.title = `${to.meta.title || '工作台'}｜謙華動物醫院`;
});

export default router;

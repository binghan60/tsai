import { createRouter, createWebHistory } from 'vue-router';

const DashboardPage = () => import('../pages/DashboardPage.vue');
const OwnersListPage = () => import('../pages/OwnersListPage.vue');
const OwnerDetailPage = () => import('../pages/OwnerDetailPage.vue');
const PetsListPage = () => import('../pages/PetsListPage.vue');
const PetDetailPage = () => import('../pages/PetDetailPage.vue');
const RecordFormPage = () => import('../pages/RecordFormPage.vue');
const ReportViewPage = () => import('../pages/ReportViewPage.vue');
const SettingsPage = () => import('../pages/SettingsPage.vue');

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: DashboardPage, meta: { title: '工作台' } },
    { path: '/owners', component: OwnersListPage, meta: { title: '飼主' } },
    { path: '/owners/:id', component: OwnerDetailPage, meta: { title: '飼主資料' } },
    { path: '/pets', component: PetsListPage, meta: { title: '寵物' } },
    { path: '/pets/:id', component: PetDetailPage, meta: { title: '寵物資料' } },
    { path: '/settings', component: SettingsPage, meta: { title: '標準值' } },
    { path: '/pets/:petId/records/new', component: RecordFormPage, meta: { title: '新增健檢' } },
    { path: '/records/:id/edit', component: RecordFormPage, meta: { title: '編輯健檢' } },
    { path: '/records/:id/preview', name: 'record-preview', component: ReportViewPage, meta: { bare: true, title: '報告預覽' } },
    // 公開頁面：無後台導覽列，飼主查看用 + Puppeteer PDF 截圖來源
    { path: '/report/:token', component: ReportViewPage, meta: { bare: true, title: '健檢報告' } },
  ],
});

router.afterEach((to) => {
  document.title = `${to.meta.title || '寵物健康管理'}｜寵物健康管理`;
});

export default router;

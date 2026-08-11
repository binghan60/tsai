import { createRouter, createWebHistory } from 'vue-router';
import DashboardPage from '../pages/DashboardPage.vue';
import OwnersListPage from '../pages/OwnersListPage.vue';
import OwnerDetailPage from '../pages/OwnerDetailPage.vue';
import PetsListPage from '../pages/PetsListPage.vue';
import PetDetailPage from '../pages/PetDetailPage.vue';
import RecordFormPage from '../pages/RecordFormPage.vue';
import ReportViewPage from '../pages/ReportViewPage.vue';
import SettingsPage from '../pages/SettingsPage.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: DashboardPage },
    { path: '/owners', component: OwnersListPage },
    { path: '/owners/:id', component: OwnerDetailPage },
    { path: '/pets', component: PetsListPage },
    { path: '/pets/:id', component: PetDetailPage },
    { path: '/settings', component: SettingsPage },
    { path: '/pets/:petId/records/new', component: RecordFormPage },
    { path: '/records/:id/edit', component: RecordFormPage },
    { path: '/records/:id/preview', name: 'record-preview', component: ReportViewPage, meta: { bare: true } },
    // 公開頁面：無後台導覽列，飼主查看用 + Puppeteer PDF 截圖來源
    { path: '/report/:token', component: ReportViewPage, meta: { bare: true } },
  ],
});

export default router;

import { defineStore } from 'pinia';
import { http } from '../api/http';
import { clinicDateInput } from '../lib/datetime';

// 工具欄上的兩個待辦數字：藥單各階段筆數、待審初診表筆數。
// 原本各頁自己抓一次（面板關掉後數字就凍住），現在全站一份，由 useGlobalChat 那條連線
// 在 medication:updated／intake:updated 時重讀。藥單的「待辦」口徑依這台裝置的身分決定
// （醫師看待確認、櫃台看待包藥＋待領藥），見 shared/medicationWorkflow.js。
let medicationRequest = 0;
let intakeRequest = 0;
let labResultsRequest = 0;

// 另有 IDEXX 檢驗結果的待確認筆數（lab-results:updated 時重讀）。
export const useWorkCountsStore = defineStore('workCounts', {
  // bridges：診所電腦上 IDEXX 抓檔程式的心跳狀態。離線沒有事件可以通知（就是沒消息），所以由 useGlobalChat 每分鐘讀一次。
  // labRequestEnabled：伺服器有沒有開「送 IDEXX」（IDEXX_CENSUS_MODE）；沒開時診療台與掛號台不出「送 IDEXX」。
  state: () => ({ medications: {}, intake: 0, labResults: 0, bridges: [], labRequestEnabled: false }),
  getters: {
    // 從來沒有抓檔程式回報過（診所還沒裝）不算離線。
    bridgeOffline: (state) => state.bridges.some((bridge) => !bridge.online),
  },
  actions: {
    async loadMedications() {
      const id = ++medicationRequest;
      try {
        const { data } = await http.get('/medications', { params: { status: 'active', limit: 1 } });
        if (id === medicationRequest) this.medications = data.counts || {};
      } catch {
        // 保留目前數字，下一次即時事件或重新連線會再同步。
      }
    },
    setMedications(counts) {
      medicationRequest += 1;
      this.medications = counts || {};
    },
    async loadIntake() {
      const id = ++intakeRequest;
      try {
        const { data } = await http.get('/intake-submissions');
        if (id === intakeRequest) this.intake = (data.items || []).length;
      } catch {
        // 同上。
      }
    },
    // 「檢驗」的數字＝近七天驗的待確認（選貓）＋數值跟報告不同還沒處理的。
    // 只算近七天：IDEXX 主機補傳歷史紀錄時會進來幾百筆，全部算進去徽章永遠是紅的、等於沒有提醒；更早的在面板裡照樣看得到。
    async loadLabResults() {
      const id = ++labResultsRequest;
      try {
        const [unmatched, conflicts] = await Promise.all([
          http.get('/lab-results', { params: { limit: 1, since: clinicDateInput(new Date(Date.now() - 6 * 86_400_000)) } }),
          http.get('/lab-results/conflicts'),
        ]);
        if (id === labResultsRequest) this.labResults = (unmatched.data.total ?? 0) + (conflicts.data.items?.length ?? 0);
      } catch {
        // 同上。
      }
    },
    async loadBridges() {
      try {
        const { data } = await http.get('/lab-results/bridge-status');
        this.bridges = data.items || [];
        this.labRequestEnabled = Boolean(data.labRequest?.enabled);
      } catch {
        // 同上。
      }
    },
    load() {
      this.loadMedications();
      this.loadIntake();
      this.loadLabResults();
      this.loadBridges();
    },
    reset() {
      medicationRequest += 1;
      intakeRequest += 1;
      labResultsRequest += 1;
      this.medications = {};
      this.intake = 0;
      this.labResults = 0;
      this.bridges = [];
      this.labRequestEnabled = false;
    },
  },
});

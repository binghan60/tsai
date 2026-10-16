import { clinicTimeInput, elapsedLabel } from './datetime.js';

// 掛號台看診速覽的進度條：一次看診的四個里程碑（報到、開始看診、送交櫃台、完成處理），時間照掛號上記的。
// 最後一個寫了時間、後面還沒到的那一步是「現在在這一步」（active）：標籤換成進行式（候診中、看診中、待櫃台處理），
// 底下加這一步已經過多久（當天才寫，跟卡片的進度欄同一套 elapsedLabel）。四步都有時間就全部是完成。
// 取消看診、取回會把里程碑清回 null，進度條跟著退回去。
const MILESTONES = [
  { key: 'checkin', field: 'checkedInAt', label: '報到', activeLabel: '候診中' },
  { key: 'start', field: 'visitStartedAt', label: '開始看診', activeLabel: '看診中' },
  { key: 'handoff', field: 'handoffAt', label: '送交櫃台', activeLabel: '待櫃台處理' },
  { key: 'complete', field: 'deskCompletedAt', label: '完成處理', activeLabel: '完成處理' },
];

export function visitMilestones(appointment, now = new Date()) {
  // 前面幾步連續有時間的才算走過：里程碑一定依序寫入，中間斷掉的（理論上不會有）後面一律當還沒到。
  let reached = 0;
  while (reached < MILESTONES.length && appointment?.[MILESTONES[reached].field]) reached += 1;
  const activeIndex = reached > 0 && reached < MILESTONES.length ? reached - 1 : -1;
  return MILESTONES.map((milestone, index) => {
    const at = index < reached ? appointment[milestone.field] : null;
    const state = index === activeIndex ? 'active' : index < reached ? 'done' : 'pending';
    const elapsed = state === 'active' ? elapsedLabel(at, now) : null;
    return {
      key: milestone.key,
      label: state === 'active' ? milestone.activeLabel : milestone.label,
      state,
      time: at ? clinicTimeInput(at) : '',
      elapsed: elapsed && !elapsed.clock ? elapsed.text : '',
    };
  });
}

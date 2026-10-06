import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { stowageApi, type Cargo, type CargoType } from './api';

// === 靠港许可 / 压载水舱 / 码头潮窗 ===
export type PortCall = { name: string; order: number };

export type BallastTank = {
  id: string;
  name: string;
  capacity: number; // 吨
  current: number;  // 当前压载水量 吨
};

export type TidalWindow = {
  id: string;
  port: string;
  start: string;
  end: string;
  tideHeight: number; // 潮高 m
  chartDepth: number; // 海图水深 m
  status: '可用' | '已占用' | '替代';
  occupiedBy: string | null;
  confirmedAt: number | null;
};

export type PermitStatus = '有效' | '失效' | '过期' | '计算中';

export type PortPermit = {
  port: string;
  status: PermitStatus;
  expectedDraft: number | null;
  windowId: string | null;
  batchNo: string | null;
  version: number;
  computedAt: number | null;
  expiresAt: number | null;
  message: string | null;
  alternativeWindowId: string | null;
};

export type Submission = {
  id: string;
  port: string;
  windowId: string;
  permitId: string;
  time: number;
  status: '已确认' | '未确认';
  alternativeWindowId: string | null;
};

export type StowageComment = {
  id: string;
  cargoId: string;
  author: string;
  role: '船长' | '码头' | '货主';
  content: string;
  status: '待确认' | '已接受' | '已退回';
};

type State = {
  cargo: Cargo[];
  activeCargoId: string;
  planRevision: number;
  comments: StowageComment[];
  acceptedLimits: string[];
  locked: boolean;
  viewMode: '3d' | 'section';
  draftSavedAt: string;
  // 靠港许可相关
  voyagePlan: PortCall[];
  ballastTanks: BallastTank[];
  ballastBackfilled: boolean;
  tidalWindows: TidalWindow[];
  permits: Record<string, PortPermit>;
  reconciliation: {
    status: 'idle' | 'writing' | 'failed' | 'done';
    batchNo: string | null;
    lastCompletedVersion: number;
    error: string | null;
    retryCount: number;
  };
  submissions: Submission[];
};

const initialCargo: Cargo[] = [
  { id: 'BL-88214', bill: 'SEA-88214', type: '集装箱', bay: 12, row: 4, tier: 2, deck: '主甲板', weight: 24.6, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '已绑扎', color: '#2b7c75' },
  { id: 'BL-88219', bill: 'SEA-88219', type: '集装箱', bay: 13, row: 4, tier: 2, deck: '主甲板', weight: 28.1, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: 'UN 1263', lashing: '需复核', color: '#c77835' },
  { id: 'BL-88231', bill: 'SEA-88231', type: '集装箱', bay: 10, row: 6, tier: 1, deck: '主甲板', weight: 18.2, dimension: '20 × 8 × 8.6 ft', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#366d94' },
  { id: 'BL-88240', bill: 'SEA-88240', type: '集装箱', bay: 8, row: 2, tier: 2, deck: '货舱', weight: 31.4, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '待绑扎', color: '#6d528d' },
  { id: 'BL-88247', bill: 'SEA-88247', type: '重大件', bay: 15, row: 0, tier: 1, deck: '主甲板', weight: 112.5, dimension: '18.4 × 4.2 × 4.8 m', port: '温哥华', hazmat: '无', lashing: '需复核', color: '#b64f49' },
  { id: 'BL-88254', bill: 'SEA-88254', type: '散货', bay: 5, row: 0, tier: 0, deck: '货舱', weight: 286.0, dimension: '散装 / 420 m³', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#9a7836' }
];

// === 默认数据工厂（旧草稿补录 / 初始化用）===
const defaultVoyagePlan: PortCall[] = [
  { name: '上海', order: 0 },
  { name: '釜山', order: 1 },
  { name: '温哥华', order: 2 }
];

const createDefaultBallastTanks = (): BallastTank[] => [
  { id: 'BT-1', name: '左压载舱 1号', capacity: 180, current: 90 },
  { id: 'BT-2', name: '右压载舱 1号', capacity: 180, current: 90 },
  { id: 'BT-3', name: '左压载舱 2号', capacity: 140, current: 60 },
  { id: 'BT-4', name: '右压载舱 2号', capacity: 140, current: 60 },
  { id: 'BT-5', name: '艏尖舱', capacity: 90, current: 30 },
  { id: 'BT-6', name: '艉尖舱', capacity: 90, current: 20 }
];

const createDefaultTidalWindows = (): TidalWindow[] => [
  { id: 'TW-SH-1', port: '上海', start: '2026-10-02 13:00', end: '2026-10-02 16:00', tideHeight: 3.1, chartDepth: 11.0, status: '可用', occupiedBy: null, confirmedAt: null },
  { id: 'TW-BS-1', port: '釜山', start: '2026-10-05 06:00', end: '2026-10-05 09:00', tideHeight: 2.4, chartDepth: 9.5, status: '可用', occupiedBy: null, confirmedAt: null },
  { id: 'TW-BS-2', port: '釜山', start: '2026-10-05 18:00', end: '2026-10-05 21:00', tideHeight: 2.1, chartDepth: 9.5, status: '可用', occupiedBy: null, confirmedAt: null },
  { id: 'TW-BS-3', port: '釜山', start: '2026-10-06 07:00', end: '2026-10-06 10:00', tideHeight: 2.6, chartDepth: 9.5, status: '可用', occupiedBy: null, confirmedAt: null },
  { id: 'TW-VR-1', port: '温哥华', start: '2026-10-12 08:00', end: '2026-10-12 11:00', tideHeight: 1.9, chartDepth: 10.2, status: '可用', occupiedBy: null, confirmedAt: null },
  { id: 'TW-VR-2', port: '温哥华', start: '2026-10-12 20:00', end: '2026-10-12 23:00', tideHeight: 1.7, chartDepth: 10.2, status: '可用', occupiedBy: null, confirmedAt: null }
];

const createDefaultPermits = (): Record<string, PortPermit> => {
  const permits: Record<string, PortPermit> = {};
  defaultVoyagePlan.forEach((pc) => {
    permits[pc.name] = {
      port: pc.name, status: '失效', expectedDraft: null, windowId: null,
      batchNo: null, version: 0, computedAt: null, expiresAt: null,
      message: null, alternativeWindowId: null
    };
  });
  return permits;
};

const createDefaultState = (): State => ({
  cargo: initialCargo,
  activeCargoId: 'BL-88247',
  planRevision: 5,
  comments: [
    { id: 'CM-21', cargoId: 'BL-88219', author: '港方配载', role: '码头', content: '危险品箱与船员生活区保持隔离，请在最终图中标注危险品隔离线。', status: '待确认' },
    { id: 'CM-22', cargoId: 'BL-88247', author: '周船长', role: '船长', content: '重大件横向支撑需增加两组绑扎点，检查甲板局部强度。', status: '待确认' },
    { id: 'CM-23', cargoId: 'BL-88254', author: '货主代表', role: '货主', content: '釜山港卸货前不得覆盖散货舱口，已接受当前安排。', status: '已接受' }
  ],
  acceptedLimits: [],
  locked: false,
  viewMode: '3d',
  draftSavedAt: '09:52',
  voyagePlan: defaultVoyagePlan,
  ballastTanks: [],
  ballastBackfilled: false,
  tidalWindows: createDefaultTidalWindows(),
  permits: createDefaultPermits(),
  reconciliation: { status: 'idle', batchNo: null, lastCompletedVersion: 0, error: null, retryCount: 0 },
  submissions: []
});

const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('yy62-stowage-plan') : null;
const saved = raw ? JSON.parse(raw) : null;
const initialState: State = saved
  ? {
      ...saved,
      // 旧草稿缺少靠港许可相关字段时补默认值
      voyagePlan: saved.voyagePlan ?? defaultVoyagePlan,
      ballastTanks: saved.ballastTanks ?? [],
      ballastBackfilled: saved.ballastBackfilled ?? false,
      tidalWindows: saved.tidalWindows ?? createDefaultTidalWindows(),
      permits: saved.permits ?? createDefaultPermits(),
      reconciliation: saved.reconciliation ?? { status: 'idle', batchNo: null, lastCompletedVersion: 0, error: null, retryCount: 0 },
      submissions: saved.submissions ?? []
    }
  : createDefaultState();

// 释放许可引用的潮窗（货位/压载/顺序变化导致许可失效时调用）
function releasePermitWindow(state: State, permit: PortPermit) {
  if (permit.windowId) {
    const window = state.tidalWindows.find((w) => w.id === permit.windowId);
    if (window && window.occupiedBy?.startsWith('PERMIT-')) {
      window.status = '可用';
      window.occupiedBy = null;
      window.confirmedAt = null;
    }
    permit.windowId = null;
  }
}

const slice = createSlice({
  name: 'stowage',
  initialState,
  reducers: {
    selectCargo(state, action: PayloadAction<string>) { state.activeCargoId = action.payload; },
    moveCargo(state, action: PayloadAction<{ id: string; bay: number; row: number; tier: number }>) {
      const cargo = state.cargo.find((item) => item.id === action.payload.id);
      if (cargo) {
        Object.assign(cargo, action.payload);
        state.planRevision += 1;
        state.draftSavedAt = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        // 货位变化 → 该货在船期间挂靠港的许可失效重算，其他港沿用
        const dischargeOrder = state.voyagePlan.findIndex((p) => p.name === cargo.port);
        state.voyagePlan.forEach((pc) => {
          const pcOrder = state.voyagePlan.findIndex((p) => p.name === pc.name);
          if (pcOrder <= dischargeOrder) {
            const permit = state.permits[pc.name];
            if (permit && permit.status !== '过期') {
              releasePermitWindow(state, permit);
              permit.status = '失效';
              permit.message = null;
              permit.alternativeWindowId = null;
            }
          }
        });
      }
    },
    updateLashing(state, action: PayloadAction<{ id: string; lashing: Cargo['lashing'] }>) {
      const cargo = state.cargo.find((item) => item.id === action.payload.id);
      if (cargo) cargo.lashing = action.payload.lashing;
    },
    addComment(state, action: PayloadAction<{ cargoId: string; author: string; role: StowageComment['role']; content: string }>) {
      state.comments.unshift({ ...action.payload, id: `CM-${Date.now()}`, status: '待确认' });
    },
    acceptComment(state, action: PayloadAction<string>) {
      const comment = state.comments.find((item) => item.id === action.payload);
      if (comment) comment.status = '已接受';
    },
    rejectComment(state, action: PayloadAction<string>) {
      const comment = state.comments.find((item) => item.id === action.payload);
      if (comment) comment.status = '已退回';
    },
    acceptLimit(state, action: PayloadAction<string>) {
      if (!state.acceptedLimits.includes(action.payload)) state.acceptedLimits.push(action.payload);
    },
    setViewMode(state, action: PayloadAction<'3d' | 'section'>) { state.viewMode = action.payload; },
    lockPlan(state) { state.locked = true; state.planRevision += 1; },

    // === 压载水舱 ===
    backfillBallast(state) {
      state.ballastTanks = createDefaultBallastTanks();
      state.ballastBackfilled = true;
    },
    updateBallast(state, action: PayloadAction<{ id: string; current: number }>) {
      const tank = state.ballastTanks.find((t) => t.id === action.payload.id);
      if (tank) tank.current = Math.max(0, Math.min(tank.capacity, action.payload.current));
      // 压载水量变化 → 所有港许可失效
      state.voyagePlan.forEach((pc) => {
        const permit = state.permits[pc.name];
        if (permit && permit.status !== '过期') {
          releasePermitWindow(state, permit);
          permit.status = '失效';
          permit.message = null;
          permit.alternativeWindowId = null;
        }
      });
    },

    // === 航次计划 / 卸货顺序 ===
    reorderPortCall(state, action: PayloadAction<{ name: string; direction: -1 | 1 }>) {
      const idx = state.voyagePlan.findIndex((p) => p.name === action.payload.name);
      const swap = idx + action.payload.direction;
      if (idx < 0 || swap < 0 || swap >= state.voyagePlan.length) return;
      const tmp = state.voyagePlan[idx];
      state.voyagePlan[idx] = state.voyagePlan[swap];
      state.voyagePlan[swap] = tmp;
      state.voyagePlan.forEach((pc, i) => { pc.order = i; });
      // 卸货顺序变化 → 所有港许可失效
      state.voyagePlan.forEach((pc) => {
        const permit = state.permits[pc.name];
        if (permit && permit.status !== '过期') {
          releasePermitWindow(state, permit);
          permit.status = '失效';
          permit.message = null;
          permit.alternativeWindowId = null;
        }
      });
    },

    // === 靠港许可计算 ===
    recalcPermit(state, action: PayloadAction<string>) {
      const port = action.payload;
      const permit = state.permits[port];
      if (!permit || !state.ballastBackfilled) return;
      releasePermitWindow(state, permit);
      permit.expectedDraft = calculateExpectedDraft(state.cargo, state.ballastTanks, port, state.voyagePlan);
      permit.status = '失效';
      permit.version += 1;
      permit.computedAt = Date.now();
      permit.expiresAt = Date.now() + 4 * 3600 * 1000;
      permit.message = null;
      permit.alternativeWindowId = null;
    },
    recalcAllPermits(state) {
      if (!state.ballastBackfilled) return;
      state.voyagePlan.forEach((pc) => {
        const permit = state.permits[pc.name];
        if (!permit) return;
        releasePermitWindow(state, permit);
        permit.expectedDraft = calculateExpectedDraft(state.cargo, state.ballastTanks, pc.name, state.voyagePlan);
        permit.status = '失效';
        permit.version += 1;
        permit.computedAt = Date.now();
        permit.expiresAt = Date.now() + 4 * 3600 * 1000;
        permit.message = null;
        permit.alternativeWindowId = null;
      });
    },
    refreshPermitStatuses(state) {
      state.voyagePlan.forEach((pc) => {
        const permit = state.permits[pc.name];
        if (permit && permit.expiresAt !== null && Date.now() > permit.expiresAt && permit.status !== '过期') {
          permit.status = '过期';
        }
      });
    },

    // === 码头潮窗 ===
    confirmWindow(state, action: PayloadAction<{ port: string; windowId: string; permitId: string }>) {
      const { port, windowId, permitId } = action.payload;
      const window = state.tidalWindows.find((w) => w.id === windowId);
      const permit = state.permits[port];
      if (!window || !permit) return;
      if (window.status === '已占用' && window.occupiedBy !== permitId) {
        // 后到者：保留报文，给替代窗口
        state.submissions.push({
          id: `SUB-${Date.now()}`, port, windowId, permitId,
          time: Date.now(), status: '未确认', alternativeWindowId: null
        });
        const sub = state.submissions[state.submissions.length - 1];
        const alternative = state.tidalWindows.find((w) => w.port === port && w.status === '可用' && w.id !== windowId);
        if (alternative) {
          alternative.status = '替代';
          sub.alternativeWindowId = alternative.id;
        }
        permit.message = `潮窗 ${windowId} 已被 ${window.occupiedBy} 占用，报文已保留，请改用替代窗口${alternative ? ` ${alternative.id}` : ''}。`;
        permit.alternativeWindowId = alternative?.id ?? null;
        permit.status = '失效';
        return;
      }
      // 先确认者占用
      // 释放该许可之前占用的潮窗
      if (permit.windowId && permit.windowId !== windowId) {
        const oldWindow = state.tidalWindows.find((w) => w.id === permit.windowId);
        if (oldWindow && oldWindow.occupiedBy === permitId) {
          oldWindow.status = '可用';
          oldWindow.occupiedBy = null;
          oldWindow.confirmedAt = null;
        }
      }
      window.status = '已占用';
      window.occupiedBy = permitId;
      window.confirmedAt = Date.now();
      permit.windowId = windowId;
      permit.status = '有效';
      permit.message = null;
      permit.alternativeWindowId = null;
      state.submissions.push({
        id: `SUB-${Date.now()}`, port, windowId, permitId,
        time: Date.now(), status: '已确认', alternativeWindowId: null
      });
    },
    // 模拟另一码头同时提交同一潮窗（先到者占用，本码头后到）
    simulateConcurrentConfirm(state, action: PayloadAction<{ port: string; windowId: string }>) {
      const { port, windowId } = action.payload;
      const window = state.tidalWindows.find((w) => w.id === windowId);
      const permit = state.permits[port];
      if (!window || !permit) return;
      const otherPermitId = `PERMIT-${port}-OTHER`;
      // 若本许可已占用该窗，先释放，模拟另一码头抢先确认
      if (window.occupiedBy === `PERMIT-${port}`) {
        window.status = '可用';
        window.occupiedBy = null;
        window.confirmedAt = null;
        permit.windowId = null;
      }
      if (window.status === '可用') {
        window.status = '已占用';
        window.occupiedBy = otherPermitId;
        window.confirmedAt = Date.now();
      }
      state.submissions.push({
        id: `SUB-${Date.now()}`, port, windowId,
        permitId: `PERMIT-${port}-SELF`, time: Date.now(),
        status: '未确认', alternativeWindowId: null
      });
      const sub = state.submissions[state.submissions.length - 1];
      const alternative = state.tidalWindows.find((w) => w.port === port && w.status === '可用' && w.id !== windowId);
      if (alternative) {
        alternative.status = '替代';
        sub.alternativeWindowId = alternative.id;
      }
      permit.message = `潮窗 ${windowId} 已被 ${otherPermitId} 占用，报文已保留，请改用替代窗口${alternative ? ` ${alternative.id}` : ''}。`;
      permit.alternativeWindowId = alternative?.id ?? null;
      permit.status = '失效';
    },

    // === 对账写入 ===
    reconcilePermits(state) {
      if (!state.ballastBackfilled) return;
      const isRetry = state.reconciliation.status === 'failed';
      const batchNo = isRetry && state.reconciliation.batchNo ? state.reconciliation.batchNo : `BATCH-${Date.now()}`;
      state.reconciliation.status = 'writing';
      state.reconciliation.batchNo = batchNo;
      state.reconciliation.error = null;
    },
    failReconcile(state, action: PayloadAction<string>) {
      state.reconciliation.status = 'failed';
      state.reconciliation.error = action.payload;
      // 回滚到最后完成版本：许可失效（不留半条许可），潮窗保留占用（不能重复占窗）
      state.voyagePlan.forEach((pc) => {
        const permit = state.permits[pc.name];
        if (permit) {
          permit.status = '失效';
        }
      });
    },
    retryReconcile(state) {
      if (!state.reconciliation.batchNo) return;
      state.reconciliation.status = 'writing';
      state.reconciliation.error = null;
      state.reconciliation.retryCount += 1;
      // 从最后完成版本按原批次号重算（保留潮窗占用，不重复占窗）
      state.voyagePlan.forEach((pc) => {
        const permit = state.permits[pc.name];
        if (!permit) return;
        permit.expectedDraft = calculateExpectedDraft(state.cargo, state.ballastTanks, pc.name, state.voyagePlan);
        permit.status = '失效';
        permit.version += 1;
        permit.computedAt = Date.now();
        permit.expiresAt = Date.now() + 4 * 3600 * 1000;
      });
    },
    completeReconcile(state) {
      state.reconciliation.status = 'done';
      state.reconciliation.lastCompletedVersion = state.planRevision;
      state.reconciliation.error = null;
      state.voyagePlan.forEach((pc) => {
        const permit = state.permits[pc.name];
        if (permit && permit.windowId) {
          permit.status = '有效';
          permit.batchNo = state.reconciliation.batchNo;
        }
      });
    }
  }
});

export const {
  selectCargo, moveCargo, updateLashing, addComment, acceptComment, rejectComment,
  acceptLimit, setViewMode, lockPlan,
  backfillBallast, updateBallast,
  reorderPortCall,
  recalcPermit, recalcAllPermits, refreshPermitStatuses,
  confirmWindow, simulateConcurrentConfirm,
  reconcilePermits, failReconcile, retryReconcile, completeReconcile
} = slice.actions;

export const store = configureStore({
  reducer: { stowage: slice.reducer, [stowageApi.reducerPath]: stowageApi.reducer },
  middleware: (getDefault) => getDefault().concat(stowageApi.middleware)
});

store.subscribe(() => {
  if (typeof localStorage !== 'undefined') localStorage.setItem('yy62-stowage-plan', JSON.stringify(store.getState().stowage));
});

export type RootState = ReturnType<typeof store.getState>;

export function calculateStability(cargo: Cargo[]) {
  const total = cargo.reduce((sum, item) => sum + item.weight, 0);
  const longitudinal = cargo.reduce((sum, item) => sum + item.weight * item.bay, 0) / Math.max(total, 1);
  const vertical = cargo.reduce((sum, item) => sum + item.weight * (item.tier + 1), 0) / Math.max(total, 1);
  const deckLoad = cargo.filter((item) => item.deck === '主甲板').reduce((sum, item) => sum + item.weight, 0);
  const stability = Math.max(0, 92 - Math.abs(longitudinal - 10.8) * 2.2 - Math.max(0, vertical - 1.75) * 8);
  return {
    total,
    longitudinal,
    vertical,
    deckLoad,
    stability,
    trim: (longitudinal - 10.8) < -0.4 ? '艉倾' : (longitudinal - 10.8) > 0.4 ? '艏倾' : '正平'
  };
}

export function detectConflicts(cargo: Cargo[]) {
  const issues: { id: string; cargoId: string; level: 'high' | 'medium'; title: string; detail: string }[] = [];
  const slots = new Map<string, Cargo>();
  cargo.forEach((item) => {
    const key = `${item.deck}-${item.bay}-${item.row}-${item.tier}`;
    const existing = slots.get(key);
    if (existing) issues.push({ id: `${item.id}-overlap`, cargoId: item.id, level: 'high', title: '货位重叠', detail: `${item.id} 与 ${existing.id} 占用相同二维货位。` });
    slots.set(key, item);
    if (item.hazmat !== '无' && item.deck === '主甲板' && item.row <= 1) issues.push({ id: `${item.id}-hazmat`, cargoId: item.id, level: 'high', title: '危险品隔离不足', detail: `${item.id} 与船体边界距离小于方案要求。` });
    if (item.weight > 100 && item.lashing !== '已绑扎') issues.push({ id: `${item.id}-lashing`, cargoId: item.id, level: 'medium', title: '重大件绑扎未完成', detail: `${item.id} 重量 ${item.weight}t，绑扎状态为“${item.lashing}”。` });
    if (item.type === '集装箱' && item.weight > 30 && item.tier >= 3) issues.push({ id: `${item.id}-stack`, cargoId: item.id, level: 'medium', title: '上层堆重超限', detail: `${item.id} 不应放在第 ${item.tier} 层。` });
  });
  return issues;
}

// === 吃水 / 许可辅助 ===
export function calculateExpectedDraft(cargo: Cargo[], ballastTanks: BallastTank[], port: string, voyagePlan: PortCall[]): number {
  const portOrder = voyagePlan.findIndex((p) => p.name === port);
  const onboardCargo = cargo.filter((c) => {
    const order = voyagePlan.findIndex((p) => p.name === c.port);
    return order >= portOrder; // 到港时仍在船的货
  });
  const cargoWeight = onboardCargo.reduce((sum, c) => sum + c.weight, 0);
  const ballastWeight = ballastTanks.reduce((sum, t) => sum + t.current, 0);
  // 简化模型：吃水与排水量线性相关
  const draft = 5.0 + ((cargoWeight + ballastWeight) / 3560) * 4.8;
  return Math.round(draft * 100) / 100;
}

export function isPermitExpired(permit: PortPermit): boolean {
  return permit.expiresAt !== null && Date.now() > permit.expiresAt;
}

export function hasExpiredPermits(permits: Record<string, PortPermit>): boolean {
  return Object.values(permits).some((p) => isPermitExpired(p));
}

// 潮窗可提供的水深 = 海图水深 + 潮高
export function windowAvailableDepth(w: TidalWindow): number {
  return w.chartDepth + w.tideHeight;
}

// 许可是否满足潮窗水深要求（富余 0.3m）
export function permitFitsWindow(permit: PortPermit, window: TidalWindow): boolean {
  if (permit.expectedDraft === null) return false;
  return permit.expectedDraft <= windowAvailableDepth(window) - 0.3;
}

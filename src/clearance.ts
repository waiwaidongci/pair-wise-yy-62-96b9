import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Cargo } from './api';

export type PortId = 'PUS' | 'YVR';

export const PORTS: Record<PortId, { id: PortId; name: string; terminal: string; eta: string }> = {
  PUS: { id: 'PUS', name: '釜山', terminal: '釜山港务 BCT', eta: '2026-10-07T05:30' },
  YVR: { id: 'YVR', name: '温哥华', terminal: '温哥华 DP World', eta: '2026-10-12T18:00' }
};

export const portIdOf = (portName: string): PortId => (portName === '釜山' ? 'PUS' : 'YVR');

export type BallastTank = { id: string; name: string; capacity: number; level: number | null; recordedAt: string | null };
export type TideWindow = { id: string; label: string; ports: PortId[]; start: string; end: string; maxDraft: number; occupiedBy: PortId | null };
export type WindowRequest = { id: string; portId: PortId; terminal: string; windowId: string; submittedAt: string; status: '已确认' | '冲突'; note: string; alternatives: string[] };
export type StoredPermit = { portId: PortId; windowId: string; basisHash: string; draftMax: number; issuedAt: string; expiresAt: string; batchNo: string };
export type ReconcileBatch = { batchNo: string; version: number; committedAt: string; entries: string[] };
export type PendingBatch = { batchNo: string; portId: PortId; windowId: string; version: number; attempts: number; lastError: string | null };

export type ClearanceState = {
  clock: string;
  portOrder: PortId[];
  ballast: BallastTank[];
  windows: TideWindow[];
  requests: WindowRequest[];
  permits: Partial<Record<PortId, StoredPermit>>;
  dischargeOrder: Record<PortId, string[]>;
  reconcile: { committed: ReconcileBatch[]; pending: PendingBatch | null; failNext: boolean; counter: number };
  version: number;
};

const TPC = 26; // 每厘米吃水吨数
const LIGHT_DRAFT = 4.6; // 空船基准吃水（米）

const pad = (value: number) => String(value).padStart(2, '0');
const toLocalIso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

export function fmtTime(iso: string) {
  const date = new Date(iso);
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ballastMissing(state: ClearanceState) {
  return state.ballast.filter((tank) => tank.level === null);
}

export function ballastTotal(state: ClearanceState) {
  return state.ballast.reduce((sum, tank) => sum + (tank.level ?? 0), 0);
}

export function cargoAboardAt(cargo: Cargo[], state: ClearanceState, portId: PortId) {
  const seq = state.portOrder.indexOf(portId);
  return cargo.filter((item) => state.portOrder.indexOf(portIdOf(item.port)) >= seq);
}

export function estimateDraft(aboard: Cargo[], ballastTonnes: number) {
  const weight = aboard.reduce((sum, item) => sum + item.weight, 0);
  const mean = LIGHT_DRAFT + (weight + ballastTonnes) / (TPC * 100);
  const lcg = aboard.reduce((sum, item) => sum + item.weight * item.bay, 0) / Math.max(weight, 1);
  const trim = (lcg - 10.8) * 0.28;
  const bow = mean + trim / 2;
  const stern = mean - trim / 2;
  return { mean, bow, stern, max: Math.max(bow, stern) + 0.2, weight };
}

function hash(input: string) {
  let value = 0;
  for (let index = 0; index < input.length; index += 1) value = (value * 31 + input.charCodeAt(index)) >>> 0;
  return value.toString(36);
}

// 许可基准指纹：靠港顺序、在船货票与货位、压载水量、该港卸货顺序、已选潮窗共同决定。
// 任一变化都会改变指纹，使对应港口的许可立即失效；指纹不变的港口许可继续沿用。
export function basisHash(state: ClearanceState, cargo: Cargo[], portId: PortId) {
  const aboard = cargoAboardAt(cargo, state, portId).map((item) => `${item.id}@${item.bay}/${item.row}/${item.tier}=${item.weight}`).join('|');
  const tanks = state.ballast.map((tank) => `${tank.id}:${tank.level ?? 'NA'}`).join('|');
  const discharge = state.dischargeOrder[portId].join(',');
  const windowId = state.requests.find((request) => request.portId === portId)?.windowId ?? state.permits[portId]?.windowId ?? '';
  return hash(`${state.portOrder.join('>')}#${portId}#${aboard}#${tanks}#${discharge}#${windowId}`);
}

export type PermitView = { code: '待补录' | '未签发' | '已失效' | '已过期' | '有效'; permit: StoredPermit | null; hash: string };

export function resolvePermit(state: ClearanceState, cargo: Cargo[], portId: PortId): PermitView {
  const current = basisHash(state, cargo, portId);
  const permit = state.permits[portId] ?? null;
  if (ballastMissing(state).length > 0) return { code: '待补录', permit, hash: current };
  if (!permit) return { code: '未签发', permit, hash: current };
  if (permit.basisHash !== current) return { code: '已失效', permit, hash: current };
  if (state.clock > permit.expiresAt) return { code: '已过期', permit, hash: current };
  return { code: '有效', permit, hash: current };
}

export function clearanceGate(state: ClearanceState, cargo: Cargo[]) {
  const views = state.portOrder.map((portId) => ({ portId, view: resolvePermit(state, cargo, portId) }));
  const blocked = views.filter((item) => item.view.code !== '有效');
  return { open: blocked.length === 0, blocked };
}

export function gateReasons(state: ClearanceState, cargo: Cargo[]) {
  return clearanceGate(state, cargo).blocked.map(({ portId, view }) => `${PORTS[portId].name}许可${view.code}`);
}

const initialState: ClearanceState = {
  clock: '2026-10-06T09:00',
  portOrder: ['PUS', 'YVR'],
  ballast: [
    { id: 'TK-1F', name: '艏尖舱', capacity: 620, level: 410, recordedAt: '2026-10-06T07:40' },
    { id: 'TK-2P', name: 'No.2 边舱（左）', capacity: 480, level: null, recordedAt: null },
    { id: 'TK-3S', name: 'No.3 边舱（右）', capacity: 480, level: 265, recordedAt: '2026-10-06T07:40' },
    { id: 'TK-4A', name: '艉尖舱', capacity: 540, level: null, recordedAt: null }
  ],
  windows: [
    { id: 'TW-1', label: '釜山早潮', ports: ['PUS'], start: '2026-10-07T06:10', end: '2026-10-07T08:40', maxDraft: 5.7, occupiedBy: null },
    { id: 'TW-2', label: '引航站共用潮窗', ports: ['PUS', 'YVR'], start: '2026-10-12T18:30', end: '2026-10-12T21:00', maxDraft: 6.9, occupiedBy: null },
    { id: 'TW-3', label: '釜山午潮', ports: ['PUS'], start: '2026-10-08T07:00', end: '2026-10-08T09:20', maxDraft: 7.1, occupiedBy: null },
    { id: 'TW-4', label: '温哥华晚潮', ports: ['YVR'], start: '2026-10-12T19:10', end: '2026-10-12T21:30', maxDraft: 7.0, occupiedBy: null },
    { id: 'TW-5', label: '温哥华早潮', ports: ['YVR'], start: '2026-10-13T07:40', end: '2026-10-13T09:50', maxDraft: 6.6, occupiedBy: null }
  ],
  requests: [],
  permits: {},
  dischargeOrder: {
    PUS: ['BL-88231', 'BL-88254'],
    YVR: ['BL-88214', 'BL-88219', 'BL-88240', 'BL-88247']
  },
  reconcile: {
    committed: [{ batchNo: 'RC-2610-004', version: 4, committedAt: '2026-09-28T16:20', entries: ['V4 基线对账', '历史潮窗占用已归档'] }],
    pending: null,
    failNext: false,
    counter: 5
  },
  version: 4
};

export const CLEARANCE_STORAGE_KEY = 'yy62-clearance';

function loadState(): ClearanceState {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CLEARANCE_STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as ClearanceState;
      if (parsed && Array.isArray(parsed.ballast) && Array.isArray(parsed.windows) && parsed.reconcile) return parsed;
    }
  } catch {
    // 旧版本草稿缺少许可字段时回退到初始状态（其中压载记录缺失，触发补录流程）
  }
  return initialState;
}

// 潮窗报文处理：先确认者占用；窗口已被占用或吃水超限时保留报文并给出替代窗口。
function applyWindowRequest(state: ClearanceState, cargo: Cargo[], portId: PortId, windowId: string, concurrent: boolean) {
  const window = state.windows.find((item) => item.id === windowId);
  if (!window || !window.ports.includes(portId)) return;
  const terminal = PORTS[portId].terminal;
  const required = ballastMissing(state).length ? null : estimateDraft(cargoAboardAt(cargo, state, portId), ballastTotal(state)).max;
  const alternatives = () => state.windows
    .filter((item) => item.ports.includes(portId) && item.id !== windowId && !item.occupiedBy && (required === null || item.maxDraft >= required))
    .map((item) => item.id);
  let status: WindowRequest['status'] = '已确认';
  let note = `${terminal} 确认占用潮窗 ${windowId}（${window.label}）。`;
  const occupiedByOther = window.occupiedBy !== null && window.occupiedBy !== portId;
  if (occupiedByOther) {
    status = '冲突';
    note = `潮窗 ${windowId} 已由 ${PORTS[window.occupiedBy as PortId].terminal} 先确认占用，本报文保留，请改选替代窗口。`;
  } else if (required !== null && window.maxDraft < required) {
    status = '冲突';
    note = `预计最大吃水 ${required.toFixed(2)}m 超过潮窗 ${windowId} 限制 ${window.maxDraft}m，本报文保留。`;
  }
  if (status === '已确认') {
    state.windows.forEach((item) => { if (item.occupiedBy === portId && item.id !== windowId) item.occupiedBy = null; });
    window.occupiedBy = portId;
  }
  if (concurrent) note = `并发提交 · ${note}`;
  const existing = state.requests.find((request) => request.portId === portId);
  const patch = { windowId, status, note, alternatives: status === '冲突' ? alternatives() : [], submittedAt: state.clock };
  if (existing) Object.assign(existing, patch);
  else state.requests.push({ id: `REQ-${state.requests.length + 1}`, portId, terminal, ...patch });
}

// 对账提交：窗口占用与许可记录作为同一批次原子写入。
// 失败时不落任何半条记录；按原批次号重试时若该批次已入账则直接跳过，绝不重复占窗。
function attemptCommit(state: ClearanceState, cargo: Cargo[], batch: PendingBatch) {
  if (state.reconcile.committed.some((item) => item.batchNo === batch.batchNo)) {
    state.reconcile.pending = null;
    return;
  }
  if (state.reconcile.failNext) {
    state.reconcile.failNext = false;
    batch.lastError = '对账写入失败：许可账务存储不可用（模拟故障），未写入任何记录。';
    state.reconcile.pending = batch;
    return;
  }
  const window = state.windows.find((item) => item.id === batch.windowId);
  if (!window || (window.occupiedBy !== null && window.occupiedBy !== batch.portId)) {
    const request = state.requests.find((item) => item.portId === batch.portId);
    if (request) {
      request.status = '冲突';
      request.note = `潮窗 ${batch.windowId} 在对账确认时已被其他码头占用，报文保留，请改选替代窗口。`;
      request.alternatives = state.windows.filter((item) => item.ports.includes(batch.portId) && !item.occupiedBy).map((item) => item.id);
    }
    state.reconcile.pending = null;
    return;
  }
  state.windows.forEach((item) => { if (item.occupiedBy === batch.portId && item.id !== batch.windowId) item.occupiedBy = null; });
  window.occupiedBy = batch.portId;
  const draft = estimateDraft(cargoAboardAt(cargo, state, batch.portId), ballastTotal(state));
  state.permits[batch.portId] = {
    portId: batch.portId,
    windowId: batch.windowId,
    basisHash: basisHash(state, cargo, batch.portId),
    draftMax: draft.max,
    issuedAt: state.clock,
    expiresAt: window.end,
    batchNo: batch.batchNo
  };
  const request = state.requests.find((item) => item.portId === batch.portId);
  if (request) {
    request.status = '已确认';
    request.note = `潮窗 ${window.id} 已随批次 ${batch.batchNo} 对账确认。`;
    request.alternatives = [];
  }
  state.reconcile.committed.push({
    batchNo: batch.batchNo,
    version: batch.version,
    committedAt: state.clock,
    entries: [`${PORTS[batch.portId].name}靠港许可`, `潮窗 ${window.id} 占用`, `预计最大吃水 ${draft.max.toFixed(2)}m`]
  });
  state.version = batch.version;
  state.reconcile.pending = null;
}

const clearanceSlice = createSlice({
  name: 'clearance',
  initialState: loadState(),
  reducers: {
    advanceClock(state, action: PayloadAction<number>) {
      const date = new Date(state.clock);
      date.setHours(date.getHours() + action.payload);
      state.clock = toLocalIso(date);
    },
    setBallastLevel(state, action: PayloadAction<{ id: string; level: number }>) {
      const tank = state.ballast.find((item) => item.id === action.payload.id);
      if (!tank) return;
      tank.level = Math.max(0, Math.min(tank.capacity, action.payload.level));
      tank.recordedAt = state.clock;
    },
    backfillBallast(state, action: PayloadAction<{ levels: Record<string, number> }>) {
      state.ballast.forEach((tank) => {
        const level = action.payload.levels[tank.id];
        if (tank.level === null && level !== undefined) {
          tank.level = Math.max(0, Math.min(tank.capacity, level));
          tank.recordedAt = state.clock;
        }
      });
    },
    movePortOrder(state, action: PayloadAction<{ portId: PortId; direction: -1 | 1 }>) {
      const index = state.portOrder.indexOf(action.payload.portId);
      const target = index + action.payload.direction;
      if (index < 0 || target < 0 || target >= state.portOrder.length) return;
      [state.portOrder[index], state.portOrder[target]] = [state.portOrder[target], state.portOrder[index]];
    },
    moveDischarge(state, action: PayloadAction<{ portId: PortId; cargoId: string; direction: -1 | 1 }>) {
      const order = state.dischargeOrder[action.payload.portId];
      const index = order.indexOf(action.payload.cargoId);
      const target = index + action.payload.direction;
      if (index < 0 || target < 0 || target >= order.length) return;
      [order[index], order[target]] = [order[target], order[index]];
    },
    requestWindow(state, action: PayloadAction<{ portId: PortId; windowId: string; cargo: Cargo[] }>) {
      applyWindowRequest(state, action.payload.cargo, action.payload.portId, action.payload.windowId, false);
    },
    simulateContention(state, action: PayloadAction<{ windowId: string; cargo: Cargo[] }>) {
      const window = state.windows.find((item) => item.id === action.payload.windowId);
      if (!window || window.ports.length < 2) return;
      window.ports.forEach((portId) => applyWindowRequest(state, action.payload.cargo, portId, window.id, true));
    },
    issuePermit(state, action: PayloadAction<{ portId: PortId; cargo: Cargo[] }>) {
      if (state.reconcile.pending || ballastMissing(state).length > 0) return;
      const request = state.requests.find((item) => item.portId === action.payload.portId && item.status === '已确认');
      if (!request) return;
      const batch: PendingBatch = {
        batchNo: `RC-2610-${String(state.reconcile.counter).padStart(3, '0')}`,
        portId: action.payload.portId,
        windowId: request.windowId,
        version: state.version + 1,
        attempts: 1,
        lastError: null
      };
      state.reconcile.counter += 1;
      attemptCommit(state, action.payload.cargo, batch);
    },
    retryReconcile(state, action: PayloadAction<{ cargo: Cargo[] }>) {
      const pending = state.reconcile.pending;
      if (!pending) return;
      pending.attempts += 1;
      attemptCommit(state, action.payload.cargo, pending);
    },
    toggleFailNext(state) {
      state.reconcile.failNext = !state.reconcile.failNext;
    }
  }
});

export const {
  advanceClock,
  setBallastLevel,
  backfillBallast,
  movePortOrder,
  moveDischarge,
  requestWindow,
  simulateContention,
  issuePermit,
  retryReconcile,
  toggleFailNext
} = clearanceSlice.actions;

export const clearanceReducer = clearanceSlice.reducer;

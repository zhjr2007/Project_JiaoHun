/**
 * 生成「选择节点」用的章节快照（levels/<slug>/nodes.json）。
 * 每个节点都是通关路径上该章开始时的完整状态，直接用 decodeSave 恢复即可。
 * 内容改动后需重跑本脚本，使快照的 contentSha256 与新 content 一致。
 * 用法：node 04_Code/tools/nodes.mjs
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createGame, dispatch, getView } from '../core/engine.mjs';
import { encodeSave, decodeSave } from '../core/save.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const slug = 'xiaoshan-demo';
const path = resolve(project, `levels/${slug}/content.json`);
const raw = fs.readFileSync(path, 'utf8');
const content = JSON.parse(raw);
const contentSha256 = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');

const meta = {
  prologue: { label: '序幕 · 茶馆传闻', detail: '叫魂恐慌与萧山剪辫案的由来，从开场的「风声入案」开始。' },
  investigation: { label: '查办勘审 · 萧山县', detail: '现场调查：走遍地点、询问证人、比对物证。' },
  round1: { label: '第一轮 · 四把剪刀', detail: '首次会审，从和尚的证词里找出与凭据相悖之处。' },
  round2: { label: '第二轮 · 辫子材质', detail: '追问辫子的来历与材质，核对纤维的说法。' },
  round3: { label: '第三轮 · 索钱', detail: '追查蔡瑞向和尚索钱的经过。' },
  round4: { label: '第四轮 · 行踪与行李', detail: '核对行李与行踪上的说法，找出隐瞒之处。' },
  hat_investigation: { label: '再查办 · 蔡瑞的帽子', detail: '拦住蔡瑞，查他帽檐上的纤维与那截辫子。' },
  final_cut: { label: '最终会审 · 帽檐纤维', detail: '两件凭据合并比对，收束全案并结案。' },
};
const targets = Object.keys(meta);

let state = createGame(content);
const shots = new Map();
const capture = () => {
  const v = getView(content, state);
  if (!targets.includes(v.stageId) || shots.has(v.stageId)) return;
  shots.set(v.stageId, { save: encodeSave(content, state), kind: v.kind, pending: Boolean(v.dialogue) });
};
const step = action => {
  const result = dispatch(content, state, action);
  if (!result.ok) throw new Error(`${action.type} 失败：${result.error}`);
  state = result.state;
  capture();
};
const drain = () => { let guard = 0; while (state.dialogue.length && guard++ < 800) step({ type: 'NEXT_DIALOGUE' }); };
const investigate = () => {
  const stage = content.stages[state.stageId];
  for (const loc of stage.locations) {
    step({ type: 'MOVE', locationId: loc.id });
    for (const item of loc.interactions) {
      if (!getView(content, state).interactions.some(x => x.id === item.id)) continue;
      step({ type: 'INTERACT', interactionId: item.id });
      drain();
    }
  }
};

capture();
drain();
investigate();
step({ type: 'ADVANCE_STAGE' });
drain();

for (let guard = 0; guard < 80; guard++) {
  const v = getView(content, state);
  if (v.kind === 'ending') break;
  if (v.kind === 'investigation') { investigate(); step({ type: 'ADVANCE_STAGE' }); drain(); continue; }
  if (v.kind === 'hearing') {
    const stage = content.stages[v.stageId];
    const rule = stage.rules.find(r => r.onceFlag && !state.flags.includes(r.onceFlag));
    if (!rule) { step({ type: 'ADVANCE_STAGE' }); drain(); continue; }
    step({ type: 'SELECT_STATEMENT', statementId: rule.statementId });
    step({ type: 'PRESENT', ...(rule.evidenceIds ? { evidenceIds: rule.evidenceIds } : { evidenceId: rule.evidenceId }) });
    drain();
    continue;
  }
  if (v.dialogue) { drain(); continue; }
  break;
}

const missing = targets.filter(t => !shots.has(t));
if (missing.length) throw new Error(`未捕获节点：${missing.join('、')}`);

const nodes = targets.map(id => {
  const shot = shots.get(id);
  const restored = decodeSave(content, shot.save);
  const v = getView(content, restored);
  if (v.stageId !== id) throw new Error(`节点 ${id} 还原后阶段为 ${v.stageId}`);
  return {
    id,
    label: meta[id].label,
    detail: meta[id].detail,
    stageKind: shot.kind,
    opensWithDialogue: shot.pending,
    evidence: v.evidence.length,
    save: shot.save,
  };
});

const out = {
  level: slug,
  contentVersion: content.version,
  contentSha256,
  generatedAt: new Date().toISOString(),
  nodes,
};
const target = resolve(project, `levels/${slug}/nodes.json`);
fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
const bytes = fs.statSync(target).size;
console.log(`写出 levels/${slug}/nodes.json：${nodes.length} 个节点，${bytes} 字节`);
for (const node of nodes) {
  console.log(`  ${node.id.padEnd(18)} ${node.stageKind.padEnd(13)} 凭据 ${String(node.evidence).padStart(2)} ${node.opensWithDialogue ? '开场对白' : '直接操作'}  ${node.label}`);
}

// 自检：每个节点都能一路打到成功结局
const playFrom = start => {
  let s = start, actions = 0;
  const act = action => {
    const result = dispatch(content, s, action);
    if (!result.ok) throw new Error(`${action.type} 失败：${result.error}`);
    s = result.state;
    actions++;
  };
  const flush = () => { let guard = 0; while (s.dialogue.length && guard++ < 800) act({ type: 'NEXT_DIALOGUE' }); };
  const walk = () => {
    const stage = content.stages[s.stageId];
    for (const loc of stage.locations) {
      act({ type: 'MOVE', locationId: loc.id });
      for (const item of loc.interactions) {
        if (!getView(content, s).interactions.some(x => x.id === item.id)) continue;
        act({ type: 'INTERACT', interactionId: item.id });
        flush();
      }
    }
  };
  flush();
  for (let guard = 0; guard < 120; guard++) {
    const v = getView(content, s);
    if (v.kind === 'ending') break;
    if (v.dialogue) { flush(); continue; }
    if (v.kind === 'investigation') { walk(); act({ type: 'ADVANCE_STAGE' }); flush(); continue; }
    if (v.kind === 'hearing') {
      const stage = content.stages[v.stageId];
      const rule = stage.rules.find(r => r.onceFlag && !s.flags.includes(r.onceFlag));
      if (!rule) { act({ type: 'ADVANCE_STAGE' }); flush(); continue; }
      act({ type: 'SELECT_STATEMENT', statementId: rule.statementId });
      act({ type: 'PRESENT', ...(rule.evidenceIds ? { evidenceIds: rule.evidenceIds } : { evidenceId: rule.evidenceId }) });
      flush();
      continue;
    }
    throw new Error(`节点 ${v.stageId} 卡住：${v.kind}`);
  }
  const end = getView(content, s);
  if (end.kind !== 'ending' || end.outcome !== 'success') throw new Error(`自检失败：结束于 ${end.stageId}/${end.kind}/${end.outcome}`);
  return actions;
};
for (const node of nodes) {
  const actions = playFrom(decodeSave(content, node.save));
  console.log(`  自检 ${node.id.padEnd(18)} 可一路通关，${actions} 个动作`);
}

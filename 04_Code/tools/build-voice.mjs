// 由关卡内容派生配音所需的三份清单，避免手工维护：
//   lines.json       台词清单（id / speaker / stage / sid / field / text / isInner）
//   voice-index.json 「说话人|台词」→ 台词 id，供游戏运行时按对白查音频
//   voice-scene.json  stageId → 场景背景图，供检修核查页显示画面
//
// id 规则必须与音频文件名一致（SY-001 / ZRL-001 / CR-001 …），由角色前缀 + 该角色出现顺序生成。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const PREFIX = {
  沈砚: 'SY', 曾日理: 'ZRL', 蔡瑞: 'CR', 正一: 'ZY', 超凡: 'CF',
  巨成: 'JC', 净心: 'JX', 围观者: 'WGZ', 案情: 'AQ', 旁白: 'PB',
};

// 阶段语义 → 场景背景（与 levels/<slug>/assets/background_*.webp 对应）
function sceneFor(title) {
  if (/序幕|前情/.test(title)) return 'background_exterior.webp';
  if (/最终会审|会审|堂上/.test(title)) return 'background_court.webp';
  if (/查办|勘审|查验/.test(title)) return 'background_inspection_table.webp';
  if (/候查处/.test(title)) return 'background_waiting_room.webp';
  if (/廊下|门外/.test(title)) return 'background_corridor.webp';
  return 'background_court.webp';
}

function collect(node, meta, field, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const item of node) collect(item, meta, field, out); return; }
  if (typeof node.speaker === 'string' && typeof node.text === 'string') {
    out.push({ ...meta, field, speaker: node.speaker, text: node.text });
  }
  for (const [key, value] of Object.entries(node)) collect(value, meta, key === 'press' ? '追问' : field, out);
}

export function buildVoiceData({ site }) {
  const catalogPath = resolve(site, 'levels', 'index.json');
  if (!existsSync(catalogPath)) return { lines: 0, index: 0, scenes: 0, skipped: 'no-catalog' };
  // 必须包含归档关：ID 按全量出现顺序生成，少一个关卡会导致后续编号整体错位
  const levels = (JSON.parse(readFileSync(catalogPath, 'utf8')).levels || []);
  const raw = [];
  for (const level of levels) {
    const contentPath = resolve(site, 'levels', level.slug, 'content.json');
    if (!existsSync(contentPath)) continue;
    const content = JSON.parse(readFileSync(contentPath, 'utf8'));
    for (const [sid, stage] of Object.entries(content.stages || {})) {
      const meta = { levelSlug: level.slug, sid, stage: stage.title || sid };
      for (const [field, value] of Object.entries(stage)) collect(value, meta, field, raw);
    }
  }

  const counters = {};
  const lines = raw.map(item => {
    const prefix = PREFIX[item.speaker] || 'X';
    counters[prefix] = (counters[prefix] || 0) + 1;
    return {
      id: `${prefix}-${String(counters[prefix]).padStart(3, '0')}`,
      speaker: item.speaker,
      level: item.levelSlug,
      sid: item.sid,
      stage: item.stage,
      field: item.field,
      text: item.text,
      isInner: /^[（(]/.test(item.text),
    };
  });

  const index = {};
  const scenes = {};
  for (const line of lines) {
    const key = `${line.speaker}|${line.text.trim()}`;
    if (!(key in index)) index[key] = line.id;
    if (!scenes[line.sid]) scenes[line.sid] = { title: line.stage, bg: sceneFor(line.stage) };
  }

  writeFileSync(resolve(site, 'lines.json'), JSON.stringify(lines), 'utf8');
  writeFileSync(resolve(site, 'voice-index.json'), JSON.stringify(index), 'utf8');
  writeFileSync(resolve(site, 'voice-scene.json'), JSON.stringify(scenes), 'utf8');
  return { lines: lines.length, index: Object.keys(index).length, scenes: Object.keys(scenes).length };
}

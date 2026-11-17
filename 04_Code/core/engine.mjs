/**
 * 萧山剪辫案 Demo — deterministic, UI-independent game runtime.
 * No I/O, browser globals, external packages, or generated dialogue.
 */

const KINDS = new Set(['dialogue', 'investigation', 'hearing', 'ending']);
const POOLS = new Set(['ordinary', 'final']);
const OUTCOMES = new Set(['success', 'ordinary_failure', 'final_failure']);
const EVIDENCE_KINDS = new Set(['物证', '证言', '调查记录']);
const INTERACTION_KINDS = new Set(['调查', '交谈', '比对']);
const HISTORY_LIMIT = 200;
const STATE_KEYS = new Set(['schemaVersion', 'contentId', 'contentVersion', 'stageId',
  'locationId', 'statementIndex', 'ordinaryWill', 'finalWill', 'flags', 'evidence',
  'completedInteractions', 'pressed', 'dialogue', 'pendingStage', 'checkpoints', 'history']);
const SNAPSHOT_KEYS = new Set([...STATE_KEYS].filter(key => key !== 'checkpoints' && key !== 'history'));

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const id = value => nonempty(value) && !value.includes(':') && value.length <= 160;
const clone = value => JSON.parse(JSON.stringify(value));
const satisfied = (state, requirements = []) => requirements.every(flag => state.flags.includes(flag));
const marker = (stageId, itemId) => `${stageId}:${itemId}`;
const lookup = (dictionary, key) => object(dictionary) && own(dictionary, key) ? dictionary[key] : undefined;
const allInteractions = stage => (stage.locations ?? []).flatMap(location => location.interactions ?? []);

/** A statement is retired once its rebuttal rule has been burned. */
const retired = (stage, statementId, state) => (stage.rules ?? []).some(rule =>
  rule.statementId === statementId && rule.onceFlag && state.flags.includes(rule.onceFlag));
const openStatements = (stage, state) => (stage.statements ?? []).filter(item => !retired(stage, item.id, state));
/** Cycle to the next statement the player has not yet disproved; keep position when all are done. */
function stepStatement(stage, state, step) {
  const all = stage.statements ?? [];
  let index = state.statementIndex;
  for (let hop = 0; hop < all.length; hop++) {
    index = (index + step + all.length) % all.length;
    if (!retired(stage, all[index].id, state)) return index;
  }
  return state.statementIndex;
}

function collectModel(content) {
  const flags = new Set();
  const declaredFlags = new Set();
  const completed = new Set();
  const pressed = new Set();
  const visit = value => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (object(value)) {
      for (const [key, child] of Object.entries(value)) {
        if ((key === 'flags' || key === 'requires') && Array.isArray(child)) {
          child.filter(nonempty).forEach(flag => flags.add(flag));
          if (key === 'flags') child.filter(nonempty).forEach(flag => declaredFlags.add(flag));
        } else visit(child);
      }
    }
  };
  visit(content);
  for (const stage of Object.values(content.stages ?? {})) {
    if (!object(stage)) continue;
    allInteractions(stage).forEach(item => completed.add(marker(stage.id, item.id)));
    (stage.statements ?? []).forEach(item => pressed.add(marker(stage.id, item.id)));
  }
  return { flags, declaredFlags, completed, pressed };
}

/** Return authoring errors without throwing on malformed JSON-shaped input. */
export function validateContent(content) {
  const errors = [];
  const fail = message => errors.push(message);
  if (!object(content)) return ['剧情数据必须是对象。'];
  try { JSON.stringify(content); } catch { return ['剧情数据必须能够序列化为 JSON，且不能循环引用。']; }
  if (!id(content.id)) fail('剧情 id 无效。');
  if (!Number.isInteger(content.version) || content.version < 1) fail('剧情 version 必须为正整数。');
  if (!nonempty(content.title)) fail('剧情缺少标题。');
  if (!object(content.evidence)) fail('evidence 必须是证物字典。');
  if (!object(content.stages) || !Object.keys(content.stages).length) fail('stages 必须包含至少一个阶段。');
  if (!id(content.startStage) || !lookup(content.stages, content.startStage)) fail('起始阶段不存在。');
  if (errors.length) return errors;

  const asset = (value, path) => {
    if (value !== undefined && (typeof value !== 'string' || !/^(background|character|evidence|detail)\.[a-z0-9_]+(?:\.[a-z0-9_]+)?$/.test(value))) fail(`${path} 资源 ID 无效。`);
  };
  if (content.characters !== undefined) {
    if (!object(content.characters)) fail('characters 必须是人物字典。');
    else for (const [key, character] of Object.entries(content.characters)) {
      if (!/^[a-z0-9_]+$/.test(key) || !object(character) || !nonempty(character.name)
        || !Array.isArray(character.expressions) || !character.expressions.includes('neutral')
        || character.expressions.some(value => typeof value !== 'string' || !/^[a-z0-9_]+$/.test(value))) fail(`characters.${key} 人物表现定义无效。`);
    }
  }
  const presentationLine = (entry, path) => {
    asset(entry.focusAssetId, `${path}.focusAssetId`);
    if (entry.expression !== undefined && (typeof entry.expression !== 'string' || !/^[a-z0-9_]+$/.test(entry.expression))) fail(`${path}.expression 无效。`);
    if (entry.expression !== undefined && object(content.characters)) {
      const character = Object.values(content.characters).find(item => object(item) && item.name === entry.speaker);
      if (!Array.isArray(character?.expressions) || !character.expressions.includes(entry.expression)) fail(`${path}.expression 未在发言人物中定义。`);
    }
  };
  const requirements = [];
  const declared = new Set();
  const stringArray = (value, path, { optional = true, refs } = {}) => {
    if (value === undefined && optional) return;
    if (!Array.isArray(value) || value.some(item => !nonempty(item))) {
      fail(`${path} 必须是非空字符串数组。`); return;
    }
    if (new Set(value).size !== value.length) fail(`${path} 不能包含重复项。`);
    if (refs) value.forEach(item => { if (!own(refs, item)) fail(`${path} 引用了不存在的项目：${item}。`); });
  };
  const condition = (value, path) => {
    stringArray(value, path);
    if (Array.isArray(value)) value.filter(nonempty).forEach(flag => requirements.push([flag, path]));
  };
  const reward = (value, path) => {
    if (value === undefined) return;
    if (!object(value)) { fail(`${path} 必须是对象。`); return; }
    stringArray(value.flags, `${path}.flags`);
    if (Array.isArray(value.flags)) value.flags.filter(nonempty).forEach(flag => declared.add(flag));
    stringArray(value.evidence, `${path}.evidence`, { refs: content.evidence });
  };
  const lines = (value, path) => {
    if (!Array.isArray(value)) { fail(`${path} 必须是对白数组。`); return; }
    if (value.length > 200) fail(`${path} 对白过多，请拆分事件。`);
    value.forEach((line, index) => {
      if (!object(line) || !nonempty(line.speaker) || !nonempty(line.text)) fail(`${path}[${index}] 缺少发言者或正文。`);
      else if (line.text.length > 10000) fail(`${path}[${index}] 正文过长。`);
      if (object(line)) presentationLine(line, `${path}[${index}]`);
    });
  };
  const stageRef = (value, path, required = false) => {
    if (value === undefined && !required) return;
    if (!id(value) || !lookup(content.stages, value)) fail(`${path} 引用了不存在的阶段。`);
  };
  const unique = (items, path) => {
    const used = new Set();
    items.forEach((item, index) => {
      if (!object(item) || !id(item.id)) fail(`${path}[${index}] 缺少有效 id。`);
      else if (used.has(item.id)) fail(`${path} id 重复：${item.id}。`);
      else used.add(item.id);
    });
  };

  stringArray(content.initialEvidence, 'initialEvidence', { refs: content.evidence });
  if (content.profiles !== undefined && !Array.isArray(content.profiles)) fail('profiles 必须是数组。');
  else {
    unique(content.profiles ?? [], 'profiles');
    (content.profiles ?? []).forEach((profile, index) => {
      if (!object(profile)) return;
      if (!nonempty(profile.name) || !nonempty(profile.description)) fail(`profiles[${index}] 缺少姓名或简介。`);
      condition(profile.requires, `profiles[${index}].requires`);
      asset(profile.assetId, `profiles[${index}].assetId`);
    });
  }
  for (const [key, evidence] of Object.entries(content.evidence)) {
    const path = `evidence.${key}`;
    if (!object(evidence)) { fail(`${path} 必须是对象。`); continue; }
    if (!id(key) || evidence.id !== key) fail(`${path} 的键与 id 不一致。`);
    if (!nonempty(evidence.name) || !nonempty(evidence.description)) fail(`${path} 缺少名称或说明。`);
    asset(evidence.assetId, `${path}.assetId`);
    if (!EVIDENCE_KINDS.has(evidence.kind)) fail(`${path}.kind 无效。`);
    if (evidence.variants !== undefined && !Array.isArray(evidence.variants)) fail(`${path}.variants 必须是数组。`);
    else (evidence.variants ?? []).forEach((variant, index) => {
      if (!object(variant)) { fail(`${path}.variants[${index}] 必须是对象。`); return; }
      condition(variant.requires, `${path}.variants[${index}].requires`);
      asset(variant.assetId, `${path}.variants[${index}].assetId`);
      for (const field of ['name', 'description']) if (variant[field] !== undefined && !nonempty(variant[field])) fail(`${path}.variants[${index}].${field} 无效。`);
    });
  }
  for (const [key, stage] of Object.entries(content.stages)) {
    const path = `stages.${key}`;
    if (!object(stage)) { fail(`${path} 必须是对象。`); continue; }
    if (!id(key) || stage.id !== key) fail(`${path} 的键与 id 不一致。`);
    asset(stage.backgroundAssetId, `${path}.backgroundAssetId`);
    if (!nonempty(stage.title)) fail(`${path} 缺少标题。`);
    if (!KINDS.has(stage.kind)) fail(`${path}.kind 无效。`);
    if (stage.pool !== undefined && !POOLS.has(stage.pool)) fail(`${path}.pool 无效。`);
    if (stage.resetPool !== undefined && typeof stage.resetPool !== 'boolean') fail(`${path}.resetPool 必须是布尔值。`);
    if (stage.resetPool && (stage.kind !== 'hearing' || !POOLS.has(stage.pool))) fail(`${path} 只能在会审入口刷新威信。`);
    if (stage.kind === 'hearing' && !POOLS.has(stage.pool)) fail(`${path} 会审缺少威信池。`);
    lines(stage.intro, `${path}.intro`);
    reward(stage.entry, `${path}.entry`);
    condition(stage.requires, `${path}.requires`);
    stageRef(stage.next, `${path}.next`, stage.kind === 'dialogue' || stage.kind === 'investigation');
    stageRef(stage.failure, `${path}.failure`, stage.kind === 'hearing');
    stageRef(stage.retryStage, `${path}.retryStage`);
    if (stage.failure && lookup(content.stages, stage.failure)?.kind !== 'ending') fail(`${path}.failure 必须指向结局。`);
    if (stage.kind === 'ending' && !OUTCOMES.has(stage.outcome)) fail(`${path} 结局类型无效。`);
    if (stage.kind !== 'ending' && stage.outcome !== undefined) fail(`${path} 只有结局能设置 outcome。`);
    if (stage.retryStage) {
      const retry = lookup(content.stages, stage.retryStage);
      if (stage.kind !== 'ending' || stage.outcome === 'success' || !retry?.resetPool) fail(`${path}.retryStage 必须是失败结局的会审入口。`);
      const expectedPool = stage.outcome === 'ordinary_failure' ? 'ordinary' : 'final';
      if (retry?.pool !== expectedPool) fail(`${path}.retryStage 与失败阶段不一致。`);
    }
    if (stage.hint !== undefined && !nonempty(stage.hint)) fail(`${path}.hint 必须是文字。`);
    if (stage.kind === 'investigation') {
      if (!Array.isArray(stage.locations) || !stage.locations.length) fail(`${path} 调查阶段至少需要一个地点。`);
      else {
        unique(stage.locations, `${path}.locations`);
        const interactions = [];
        stage.locations.forEach((location, index) => {
          if (!object(location)) return;
          asset(location.backgroundAssetId, `${path}.locations[${index}].backgroundAssetId`);
          if (!nonempty(location.name) || !nonempty(location.description)) fail(`${path}.locations[${index}] 缺少名称或说明。`);
          if (!Array.isArray(location.interactions)) { fail(`${path}.locations[${index}].interactions 必须是数组。`); return; }
          interactions.push(...location.interactions);
          location.interactions.forEach((item, itemIndex) => {
            const ipath = `${path}.locations[${index}].interactions[${itemIndex}]`;
            if (!object(item)) return;
            if (!nonempty(item.label) || !INTERACTION_KINDS.has(item.kind)) fail(`${ipath} 缺少有效 label/kind。`);
            if (item.hotspot !== undefined && (!object(item.hotspot)
              || ['x', 'y', 'w', 'h'].some(key => !Number.isFinite(item.hotspot[key]) || item.hotspot[key] < 0 || item.hotspot[key] > 1)
              || item.hotspot.w <= 0 || item.hotspot.h <= 0 || item.hotspot.x + item.hotspot.w > 1 || item.hotspot.y + item.hotspot.h > 1)) fail(`${ipath}.hotspot 必须为画面内的归一化矩形。`);
            if (item.actor !== undefined && !nonempty(item.actor)) fail(`${ipath}.actor 无效。`);
            asset(item.objectAssetId, `${ipath}.objectAssetId`);
            condition(item.requires, `${ipath}.requires`);
            reward(item, ipath);
            lines(item.lines, `${ipath}.lines`);
          });
        });
        unique(interactions, `${path}.interactions`);
      }
    }
    if (stage.kind === 'hearing') {
      if (!Array.isArray(stage.statements) || !stage.statements.length) fail(`${path} 会审至少需要一句证词。`);
      else {
        unique(stage.statements, `${path}.statements`);
        stage.statements.forEach((statement, index) => {
          if (!object(statement)) return;
          const spath = `${path}.statements[${index}]`;
          presentationLine(statement, spath);
          if (!nonempty(statement.speaker) || !nonempty(statement.text)) fail(`${spath} 缺少发言者或正文。`);
          if (!object(statement.press)) fail(`${spath} 缺少固定追问。`);
          else {
            lines(statement.press.lines, `${spath}.press.lines`);
            reward(statement.press, `${spath}.press`);
          }
        });
      }
      if (!Array.isArray(stage.rules) || !stage.rules.length) fail(`${path} 会审缺少举证规则。`);
      else {
        unique(stage.rules, `${path}.rules`);
        stage.rules.forEach((rule, index) => {
          const rpath = `${path}.rules[${index}]`;
          if (!object(rule)) return;
          if (!Array.isArray(stage.statements) || !stage.statements.some(statement => statement?.id === rule.statementId)) fail(`${rpath} 引用了不存在的证词。`);
          if (rule.evidenceIds !== undefined) {
            stringArray(rule.evidenceIds, `${rpath}.evidenceIds`, { optional: false, refs: content.evidence });
            if (!Array.isArray(rule.evidenceIds) || rule.evidenceIds.length !== 2 || rule.evidenceId !== undefined) fail(`${rpath} 双证物规则必须恰好两件，且不能同时设置 evidenceId。`);
          } else if (!lookup(content.evidence, rule.evidenceId)) fail(`${rpath} 引用了不存在的证物。`);
          if (rule.onceFlag !== undefined && (!nonempty(rule.onceFlag) || !rule.flags?.includes(rule.onceFlag))) fail(`${rpath}.onceFlag 必须由本规则授予。`);
          condition(rule.requires, `${rpath}.requires`);
          reward(rule, rpath);
          lines(rule.lines, `${rpath}.lines`);
          stageRef(rule.next, `${rpath}.next`, !stage.next);
        });
      }
    }
    if (stage.presentResponses !== undefined && !Array.isArray(stage.presentResponses)) fail(`${path}.presentResponses 必须是数组。`);
    else (stage.presentResponses ?? []).forEach((response, index) => {
      const rpath = `${path}.presentResponses[${index}]`;
      if (!object(response)) { fail(`${rpath} 必须是对象。`); return; }
      if (response.actor !== undefined && !nonempty(response.actor)) fail(`${rpath}.actor 无效。`);
      if (!lookup(content.evidence, response.evidenceId)) fail(`${rpath} 引用了不存在的证物。`);
      condition(response.requires, `${rpath}.requires`);
      reward(response, rpath);
      lines(response.lines, `${rpath}.lines`);
    });
  }
  for (const [flag, path] of requirements) if (!declared.has(flag)) fail(`${path} 的条件从未被任何事件授予：${flag}。`);

  // An empty automatic dialogue chain must terminate rather than loop forever.
  for (const stage of Object.values(content.stages)) {
    if (!object(stage)) continue;
    const visited = new Set();
    let cursor = stage;
    while (cursor?.kind === 'dialogue' && Array.isArray(cursor.intro) && cursor.intro.length === 0) {
      if (visited.has(cursor.id)) { fail(`空对白阶段构成自动循环：${cursor.id}。`); break; }
      visited.add(cursor.id);
      cursor = lookup(content.stages, cursor.next);
    }
  }
  return [...new Set(errors)];
}

/** Structural and reference validation for untrusted JSON save data. */
export function validateState(content, state) {
  const contentErrors = validateContent(content);
  if (contentErrors.length) return ['剧情数据不可用。', ...contentErrors];
  const errors = [];
  const model = collectModel(content);
  const check = (value, path, snapshot = false, pool = null) => {
    if (!object(value)) { errors.push(`${path} 必须是状态对象。`); return; }
    const allowed = snapshot ? SNAPSHOT_KEYS : STATE_KEYS;
    for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path} 包含未知字段：${key}。`);
    for (const key of allowed) if (!own(value, key)) errors.push(`${path} 缺少字段：${key}。`);
    if (value.schemaVersion !== 1) errors.push(`${path} 状态格式版本不兼容。`);
    if (value.contentId !== content.id || value.contentVersion !== content.version) errors.push(`${path} 与当前剧情版本不匹配。`);
    const stage = lookup(content.stages, value.stageId);
    if (!stage) errors.push(`${path} 引用了未知阶段。`);
    for (const field of ['ordinaryWill', 'finalWill']) if (!Number.isInteger(value[field]) || value[field] < 0 || value[field] > 5) errors.push(`${path}.${field} 必须在 0—5 之间。`);
    const references = { flags: model.flags, evidence: new Set(Object.keys(content.evidence)), completedInteractions: model.completed, pressed: model.pressed };
    for (const [field, known] of Object.entries(references)) {
      const items = value[field];
      if (!Array.isArray(items) || items.length > known.size || items.some(item => typeof item !== 'string' || !known.has(item)) || new Set(items).size !== items.length) errors.push(`${path}.${field} 含有无效、未知或重复项目。`);
    }
    const validFlags = Array.isArray(value.flags) && value.flags.every(flag => typeof flag === 'string');
    const validEvidence = Array.isArray(value.evidence) && value.evidence.every(item => typeof item === 'string');
    if (stage && validFlags && validEvidence) {
      for (const flag of stage.entry?.flags ?? []) if (!value.flags.includes(flag)) errors.push(`${path} 缺少阶段入口状态。`);
      for (const evidence of stage.entry?.evidence ?? []) if (!value.evidence.includes(evidence)) errors.push(`${path} 缺少阶段入口证物。`);
      for (const evidence of content.initialEvidence ?? []) if (!value.evidence.includes(evidence)) errors.push(`${path} 缺少初始证物。`);
    }
    if (!Array.isArray(value.dialogue) || value.dialogue.length > 200 || value.dialogue.some(line => !object(line) || !nonempty(line.speaker) || !nonempty(line.text) || line.text.length > 10000)) errors.push(`${path}.dialogue 无效。`);
    if (value.pendingStage !== null && !lookup(content.stages, value.pendingStage)) errors.push(`${path}.pendingStage 引用了未知阶段。`);
    if (stage) {
      if (stage.kind === 'investigation') {
        if (!(stage.locations ?? []).some(location => location.id === value.locationId)) errors.push(`${path} 调查地点不属于当前阶段。`);
      } else if (value.locationId !== null) errors.push(`${path} 非调查阶段不能设置地点。`);
      const max = stage.kind === 'hearing' ? stage.statements.length - 1 : 0;
      if (!Number.isInteger(value.statementIndex) || value.statementIndex < 0 || value.statementIndex > max) errors.push(`${path} 证词下标越界。`);
      if (value.pendingStage !== null) {
        const targets = new Set(stage.kind === 'dialogue' ? [stage.next] : stage.kind === 'hearing' ? [...stage.rules.map(rule => rule.next), stage.next, stage.failure] : []);
        if (!targets.has(value.pendingStage)) errors.push(`${path} 的待跳转阶段不符合当前剧情。`);
        if (!Array.isArray(value.dialogue) || !value.dialogue.length) errors.push(`${path} 待跳转阶段缺少待播放对白。`);
      }
      if (stage.kind === 'dialogue' && value.pendingStage !== stage.next) errors.push(`${path} 自动对白阶段的后续状态无效。`);
      if (stage.kind === 'hearing') {
        const will = stage.pool === 'ordinary' ? value.ordinaryWill : value.finalWill;
        if (will === 0 && value.pendingStage !== stage.failure) errors.push(`${path} 威信耗尽后必须进入对应失败结局。`);
        if (will > 0 && value.pendingStage === stage.failure) errors.push(`${path} 威信未耗尽却进入失败结局。`);
        if (!snapshot && (!object(value.checkpoints) || !own(value.checkpoints, stage.pool))) errors.push(`${path} 缺少会审入口检查点。`);
      }
      if (stage.outcome === 'ordinary_failure' && value.ordinaryWill !== 0) errors.push(`${path} 普通失败结局的威信不一致。`);
      if (stage.outcome === 'final_failure' && value.finalWill !== 0) errors.push(`${path} 最终失败结局的威信不一致。`);
      if (pool && (!stage.resetPool || stage.pool !== pool || value[pool === 'ordinary' ? 'ordinaryWill' : 'finalWill'] !== 5)) errors.push(`${path} 不是有效的会审入口检查点。`);
    }
    if (!snapshot) {
      if (!object(value.checkpoints) || Object.keys(value.checkpoints).some(key => !POOLS.has(key))) errors.push(`${path}.checkpoints 无效。`);
      else for (const [key, point] of Object.entries(value.checkpoints)) check(point, `${path}.checkpoints.${key}`, true, key);
      if (!Array.isArray(value.history) || value.history.length > HISTORY_LIMIT || value.history.some(event => !object(event) || !nonempty(event.type) || !lookup(content.stages, event.stageId))) errors.push(`${path}.history 无效。`);
    }
  };
  check(state, '存档');
  return [...new Set(errors)];
}

function grant(state, effect = {}, events) {
  for (const flag of effect.flags ?? []) if (!state.flags.includes(flag)) {
    state.flags.push(flag);
    events.push({ type: 'flag_added', flag });
  }
  for (const evidenceId of effect.evidence ?? []) if (!state.evidence.includes(evidenceId)) {
    state.evidence.push(evidenceId);
    events.push({ type: 'evidence_added', evidenceId });
  }
}

function record(state, event) {
  state.history.push({ ...event, stageId: state.stageId });
  if (state.history.length > HISTORY_LIMIT) state.history.splice(0, state.history.length - HISTORY_LIMIT);
}

function snapshot(state) {
  return Object.fromEntries([...SNAPSHOT_KEYS].map(key => [key, clone(state[key])]));
}

function enterStage(content, state, stageId, events) {
  let nextId = stageId;
  for (let hops = 0; hops <= Object.keys(content.stages).length; hops++) {
    const stage = content.stages[nextId];
    state.stageId = stage.id;
    state.locationId = stage.kind === 'investigation' ? stage.locations[0].id : null;
    state.statementIndex = 0;
    state.dialogue = clone(stage.intro);
    state.pendingStage = stage.kind === 'dialogue' ? stage.next : null;
    grant(state, stage.entry, events);
    if (stage.resetPool) state[stage.pool === 'ordinary' ? 'ordinaryWill' : 'finalWill'] = 5;
    events.push({ type: 'stage_entered', stageId: stage.id });
    record(state, { type: 'stage_entered' });
    if (stage.resetPool) state.checkpoints[stage.pool] = snapshot(state);
    if (!state.dialogue.length && state.pendingStage) {
      nextId = state.pendingStage;
      continue;
    }
    return;
  }
  throw new Error('剧情自动跳转次数过多。');
}

function queue(state, lines, next = null) {
  state.dialogue = clone(lines);
  state.pendingStage = next;
}

/** Create a serializable fresh game. */
export function createGame(content) {
  const errors = validateContent(content);
  if (errors.length) throw new Error(`剧情数据校验失败：\n${errors.join('\n')}`);
  const state = {
    schemaVersion: 1, contentId: content.id, contentVersion: content.version,
    stageId: content.startStage, locationId: null, statementIndex: 0,
    ordinaryWill: 5, finalWill: 5, flags: [], evidence: [...(content.initialEvidence ?? [])],
    completedInteractions: [], pressed: [], dialogue: [], pendingStage: null,
    checkpoints: {}, history: [],
  };
  enterStage(content, state, content.startStage, []);
  return state;
}

class InvalidAction extends Error {}
const requireAction = (condition, message) => { if (!condition) throw new InvalidAction(message); };

/** Apply one player action without mutating either input. */
export function dispatch(content, state, action) {
  const errors = validateState(content, state);
  if (errors.length) return { ok: false, state, events: [], error: `游戏状态无效：${errors[0]}` };
  if (!object(action) || !nonempty(action.type)) return { ok: false, state, events: [], error: '操作格式无效。' };
  const next = clone(state);
  const events = [];
  try {
    const stage = content.stages[next.stageId];
    requireAction(!next.dialogue.length || action.type === 'NEXT_DIALOGUE', '请先读完当前对白。');
    switch (action.type) {
      case 'NEXT_DIALOGUE': {
        requireAction(next.dialogue.length > 0, '当前没有待播放的对白。');
        next.dialogue.shift();
        if (!next.dialogue.length && next.pendingStage) {
          const target = next.pendingStage;
          next.pendingStage = null;
          enterStage(content, next, target, events);
        } else if (!next.dialogue.length && stage.kind === 'hearing') {
          const current = stage.statements[next.statementIndex];
          if (current && retired(stage, current.id, next)) next.statementIndex = stepStatement(stage, next, 1);
        }
        break;
      }
      case 'MOVE': {
        requireAction(stage.kind === 'investigation', '当前不能移动。');
        requireAction(stage.locations.some(location => location.id === action.locationId), '无法前往该地点。');
        next.locationId = action.locationId;
        events.push({ type: 'location_changed', locationId: action.locationId });
        break;
      }
      case 'INTERACT': {
        requireAction(stage.kind === 'investigation', '当前不能调查或交谈。');
        const location = stage.locations.find(item => item.id === next.locationId);
        const interaction = location.interactions.find(item => item.id === action.interactionId);
        requireAction(interaction && satisfied(next, interaction.requires), '当前无法进行这项调查。');
        const key = marker(stage.id, interaction.id);
        if (!next.completedInteractions.includes(key)) {
          grant(next, interaction, events);
          next.completedInteractions.push(key);
        }
        queue(next, interaction.lines);
        events.push({ type: 'interaction', interactionId: interaction.id });
        break;
      }
      case 'ADVANCE_STAGE': {
        requireAction(stage.kind === 'investigation', '当前阶段不能直接结束。');
        requireAction(satisfied(next, stage.requires), '尚有需要核查的事项。');
        enterStage(content, next, stage.next, events);
        break;
      }
      case 'NEXT_STATEMENT':
      case 'PREV_STATEMENT':
      case 'SELECT_STATEMENT': {
        requireAction(stage.kind === 'hearing', '当前没有可切换的证词。');
        if (action.type === 'SELECT_STATEMENT') {
          const index = stage.statements.findIndex(statement => statement.id === action.statementId);
          requireAction(index >= 0, '该证词不存在。');
          next.statementIndex = index;
        } else {
          const step = action.type === 'NEXT_STATEMENT' ? 1 : -1;
          next.statementIndex = stepStatement(stage, next, step);
        }
        break;
      }
      case 'PRESS': {
        requireAction(stage.kind === 'hearing', '当前不能追问。');
        const statement = stage.statements[next.statementIndex];
        const key = marker(stage.id, statement.id);
        if (!next.pressed.includes(key)) {
          grant(next, statement.press, events);
          next.pressed.push(key);
        }
        queue(next, statement.press.lines);
        events.push({ type: 'pressed', statementId: statement.id });
        break;
      }
      case 'PRESENT': {
        requireAction(stage.kind === 'hearing' || stage.kind === 'investigation', '当前不能出示证物。');
        const presented = action.evidenceIds === undefined ? [action.evidenceId] : action.evidenceIds;
        requireAction(Array.isArray(presented) && presented.length >= 1 && presented.length <= 2 && new Set(presented).size === presented.length && presented.every(id => typeof id === 'string' && next.evidence.includes(id)) && !(action.evidenceIds !== undefined && action.evidenceId !== undefined), '请选择已取得的一项或两项不同证物。');
        if (stage.kind === 'investigation') {
          requireAction(presented.length === 1, '调查时请单独向人物出示证物。');
          action = { ...action, evidenceId: presented[0] };
          const location = stage.locations.find(item => item.id === next.locationId);
          const availableActors = (location.interactions ?? []).filter(item => satisfied(next, item.requires)).map(item => item.actor).filter(Boolean);
          if (action.actor !== undefined) requireAction(typeof action.actor === 'string' && availableActors.includes(action.actor), '这位人物当前不在场，无法向其出示。');
          const response = (stage.presentResponses ?? []).find(item => item.evidenceId === action.evidenceId
            && (action.actor === undefined || item.actor === undefined || item.actor === action.actor)
            && satisfied(next, item.requires));
          if (response) {
            grant(next, response, events);
            queue(next, response.lines);
          } else {
            const name = resolveEvidence(content, next, action.evidenceId).name;
            const who = action.actor ?? null;
            if (!who) {
              queue(next, [{ speaker: '沈砚', text: `（「${name}」在这里问不出什么。还是先问明该问的人。）` }]);
            } else {
              const puzzled = who === '曾日理'
                ? [{ speaker: '曾日理', text: '这等物件，你去问当事人便好。我看不出它与你所问之事有何干系。' }]
                : [{ speaker: who, text: '这个……小人看不出它与小人方才说的话有什么关连。' }];
              queue(next, [
                { speaker: '沈砚', text: `（将「${name}」递到${who}面前。）` },
                ...puzzled,
                { speaker: '沈砚', text: `（${who}似乎对这件东西并不知情，也提不起兴致。此处再问也是白费。）` },
              ]);
            }
          }
          events.push({ type: 'evidence_presented', evidenceId: action.evidenceId, ...(action.actor ? { actor: action.actor } : {}) });
          break;
        }
        const statement = stage.statements[next.statementIndex];
        const rule = stage.rules.find(item => { const expected = item.evidenceIds ?? [item.evidenceId]; return item.statementId === statement.id && expected.length === presented.length && expected.every(id => presented.includes(id)) && satisfied(next, item.requires); });
        requireAction(!rule?.onceFlag || !next.flags.includes(rule.onceFlag), '这处疑点已经举证，请继续核查其他证词。');
        if (rule) {
          grant(next, rule, events);
          const target = rule.next ?? (stage.next && satisfied(next, stage.requires) ? stage.next : null);
          queue(next, rule.lines, target);
          // Empty feedback is supported without leaving a dead pending transition.
          if (!next.dialogue.length && target) enterStage(content, next, target, events);
          events.push({ type: 'presentation_correct', evidenceId: presented[0], evidenceIds: presented, statementId: statement.id });
        } else {
          const item = { name: presented.map(id => resolveEvidence(content, next, id).name).join('、') };
          const field = stage.pool === 'ordinary' ? 'ordinaryWill' : 'finalWill';
          const after = next[field] - 1;
          const quote = statement.text.length > 20 ? `${statement.text.slice(0, 20)}……` : statement.text;
          queue(next, [
            { speaker: '蔡瑞', text: `「${item.name}」？小人方才说的是「${quote}」——这东西与那句话如何对得上？` },
            { speaker: '蔡瑞', text: '大人明鉴，小人句句照实回话，并未改口。' },
            { speaker: '曾日理', text: `沈砚，举证须指实矛盾在何处。你举「${item.name}」，却没有说明它怎样驳倒这句证词。` },
            { speaker: '曾日理', text: '此次举证不妥，威信减一。', cue: 'will_penalty' },
            { speaker: '沈砚', text: '（确实对不上……我得再仔细想一想。）' },
            { speaker: '曾日理', text: after > 1 ? '回到方才的证词，想清楚再问。' : '举证至此，已不足以支持继续查问。' },
          ]);
          next[field] -= 1;
          if (next[field] === 0) next.pendingStage = stage.failure;
          events.push({ type: 'presentation_wrong', evidenceId: presented[0], evidenceIds: presented, statementId: statement.id });
          events.push({ type: 'will_changed', pool: stage.pool, value: next[field] });
        }
        break;
      }
      case 'RETRY': {
        requireAction(stage.kind === 'ending' && stage.outcome !== 'success' && stage.retryStage, '当前不能从阶段入口重试。');
        const retry = content.stages[stage.retryStage];
        const point = next.checkpoints[retry.pool];
        requireAction(point && point.stageId === retry.id, '缺少对应阶段的重试记录。');
        const checkpoints = clone(next.checkpoints);
        // Restarting the ordinary phase must not preserve a later final-phase point.
        if (retry.pool === 'ordinary') delete checkpoints.final;
        Object.assign(next, clone(point), { checkpoints, history: next.history });
        events.push({ type: 'retried', stageId: next.stageId });
        break;
      }
      default:
        throw new InvalidAction('未知操作。');
    }
    record(next, { type: action.type, ...(typeof action.evidenceId === 'string' ? { evidenceId: action.evidenceId } : {}), ...(typeof action.interactionId === 'string' ? { interactionId: action.interactionId } : {}), ...(typeof action.actor === 'string' ? { actor: action.actor } : {}) });
    return { ok: true, state: next, events };
  } catch (error) {
    if (!(error instanceof InvalidAction)) throw error;
    return { ok: false, state, events: [], error: error.message };
  }
}

function resolveEvidence(content, state, evidenceId) {
  const base = content.evidence[evidenceId];
  const result = { id: base.id, name: base.name, description: base.description, kind: base.kind, ...(base.assetId ? { assetId: base.assetId } : {}) };
  for (const variant of base.variants ?? []) if (satisfied(state, variant.requires)) {
    if (variant.name !== undefined) result.name = variant.name;
    if (variant.description !== undefined) result.description = variant.description;
    if (variant.assetId !== undefined) result.assetId = variant.assetId;
  }
  return result;
}

/** Public player view: never returns rule conditions or undiscovered records. */
export function getView(content, state) {
  const errors = validateState(content, state);
  if (errors.length) throw new Error(`游戏状态无效：${errors[0]}`);
  const stage = content.stages[state.stageId];
  const location = stage.kind === 'investigation' ? stage.locations.find(item => item.id === state.locationId) : null;
  // Retired statements leave the rotation, so a point already disproved never returns.
  const statements = stage.kind === 'hearing'
    ? openStatements(stage, state).map(({ id, speaker, text }) => ({ id, speaker, text })) : [];
  const current = stage.kind === 'hearing' ? stage.statements[state.statementIndex] ?? null : null;
  const checkpoint = stage.retryStage ? state.checkpoints[content.stages[stage.retryStage].pool] : null;
  const busy = state.dialogue.length > 0;
  return {
    title: content.title, stageId: stage.id, stageTitle: stage.title, kind: stage.kind,
    locationId: state.locationId,
    presentation: resolvePresentation(content, state, stage, location),
    dialogue: busy ? clone(state.dialogue[0]) : null,
    dialogueRemaining: state.dialogue.length,
    locations: (stage.kind === 'investigation' ? stage.locations : []).map(({ id, name }) => ({ id, name })),
    locationDescription: location?.description ?? '',
    interactions: (location?.interactions ?? []).filter(item => satisfied(state, item.requires)).map(item => ({
      id: item.id, label: item.label, kind: item.kind,
      ...(item.actor ? { actor: item.actor } : {}),
      ...(item.objectAssetId ? { objectAssetId: item.objectAssetId } : {}),
      ...(item.hotspot ? { hotspot: item.hotspot } : {}),
      completed: state.completedInteractions.includes(marker(stage.id, item.id)),
    })),
    statements, statement: current,
    statementIndex: Math.max(0, statements.findIndex(item => item.id === current?.id)),
    statementCount: statements.length,
    statementNumber: current ? stage.statements.indexOf(current) + 1 : 0,
    statementTotal: (stage.statements ?? []).length,
    statementHasOpenPoint: stage.kind === 'hearing' && Boolean(current)
      && stage.rules.some(rule => rule.statementId === current.id && rule.onceFlag && !state.flags.includes(rule.onceFlag) && satisfied(state, rule.requires)),
    // True only when this statement's open point can be answered by two items at once.
    // The UI uses it to hint at combination presentation after a failed attempt.
    statementNeedsCombination: stage.kind === 'hearing' && Boolean(current)
      && stage.rules.some(rule => rule.statementId === current.id && rule.onceFlag && !state.flags.includes(rule.onceFlag)
        && satisfied(state, rule.requires) && (rule.evidenceIds ?? []).length > 1),
    hearingProgress: stage.kind === 'hearing' ? {
      total: stage.rules.filter(rule => rule.onceFlag).length,
      completed: stage.rules.filter(rule => rule.onceFlag && state.flags.includes(rule.onceFlag)).length,
      currentSolved: stage.rules.some(rule => rule.statementId === current?.id && rule.onceFlag && state.flags.includes(rule.onceFlag)),
      nextStatementId: stage.rules.find(rule => rule.onceFlag && !state.flags.includes(rule.onceFlag) && satisfied(state, rule.requires))?.statementId ?? null,
    } : null,
    evidence: state.evidence.map(evidenceId => resolveEvidence(content, state, evidenceId)),
    profiles: (content.profiles ?? []).filter(profile => satisfied(state, profile.requires)).map(({ id, name, description, assetId }) => ({ id, name, description, ...(assetId ? { assetId } : {}) })),
    will: stage.pool === 'ordinary' ? state.ordinaryWill : stage.pool === 'final' ? state.finalWill : null,
    // Commit arithmetic immediately (so a mid-feedback save cannot undo it),
    // while revealing the UI change only at the third feedback line.
    displayWill: stage.pool ? Math.min(5, (stage.pool === 'ordinary' ? state.ordinaryWill : state.finalWill)
      + (state.dialogue.findIndex(line => line.cue === 'will_penalty') > 0 ? 1 : 0)) : null,
    pool: stage.pool ?? null,
    requirementsMet: stage.kind === 'investigation' && satisfied(state, stage.requires),
    canAdvance: !busy && stage.kind === 'investigation' && satisfied(state, stage.requires),
    canRetry: !busy && stage.kind === 'ending' && stage.outcome !== 'success' && Boolean(checkpoint),
    outcome: stage.outcome ?? null,
    hint: stage.kind === 'investigation' ? stage.hint ?? null : null,
  };
}


function resolvePresentation(content, state, stage, location) {
  const visible = (location?.interactions ?? []).filter(item => satisfied(state, item.requires));
  const dialogue = state.dialogue[0];
  const statement = stage.kind === 'hearing' ? stage.statements[state.statementIndex] : null;
  // Recover authored metadata by the currently spoken line. This also upgrades
  // old v1 saves whose copied dialogue did not yet carry expression/focus fields.
  const authoredLines = [...(stage.intro ?? []), ...allInteractions(stage).flatMap(item => item.lines ?? []),
    ...(stage.rules ?? []).flatMap(item => item.lines ?? []),
    ...(stage.statements ?? []).flatMap(item => item.press?.lines ?? []),
    ...(stage.presentResponses ?? []).flatMap(item => item.lines ?? [])];
  const authored = dialogue ? authoredLines.find(item => item.speaker === dialogue.speaker && item.text === dialogue.text) : statement;
  const speaker = dialogue?.speaker ?? statement?.speaker ?? '沈砚';
  const characterId = Object.entries(content.characters ?? {}).find(([, item]) => item.name === speaker)?.[0] ?? null;
  const knownExpressions = content.characters?.[characterId]?.expressions ?? ['neutral'];
  const expression = knownExpressions.includes(authored?.expression) ? authored.expression : 'neutral';
  return {
    backgroundAssetId: location?.backgroundAssetId ?? stage.backgroundAssetId ?? null,
    characterId,
    expression,
    characterAssetId: characterId ? `character.${characterId}.${expression}` : null,
    focusAssetId: authored?.focusAssetId ?? null,
    actors: [...new Set(visible.map(item => item.actor).filter(Boolean))].map(name => {
      const id = Object.entries(content.characters ?? {}).find(([, item]) => item.name === name)?.[0] ?? null;
      return { id, name, assetId: id ? `character.${id}.neutral` : null };
    }),
    hotspots: visible.filter(item => item.hotspot).map(item => ({
      interactionId: item.id, label: item.label, ...item.hotspot,
      ...(item.objectAssetId ? { objectAssetId: item.objectAssetId } : {}),
      completed: state.completedInteractions.includes(marker(stage.id, item.id))
    }))
  };
}

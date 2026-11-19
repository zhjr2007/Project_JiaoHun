/*
 * 萧山剪辫案 · 音乐调度
 * 依据《音乐与配音插入方案》：
 *  - 底色 BGM：entry / rumor / mist（查案）/ court（升堂，缺档回落 mist）
 *              / final（悬念）/ clash（对决）/ reveal（收束）
 *  - 一次性剧情音乐：settled / prison / residual（结局只播一遍）
 *  - 短促提示音：evidence（发现物证）/ breakthrough（举证成功），叠在 BGM 上
 * 对白不暂停音乐，只做音量渐降（duck）；切曲用 1.6s 交叉淡化。
 * 循环曲换场后再回来会接着上次的位置，不会每次都从 0 秒重来。
 * 本文件不依赖 app.mjs，入口页（注册/展示页）可直接 import 复用：
 *   import {playEntryMusic} from './audio.mjs'; playEntryMusic();
 */

const TRACKS = {
  entry:        {src: './media/bgm/bgm_01_entry.mp3',       loop: true,  gain: 0.32},
  rumor:        {src: './media/bgm/bgm_02_rumor.m4a',       loop: true,  gain: 0.28},
  mist:         {src: './media/bgm/bgm_03_mist.m4a',        loop: true,  gain: 0.30},
  evidence:     {src: './media/bgm/bgm_04_evidence.m4a',    loop: false, gain: 0.44},
  evidenceBed:  {src: './media/bgm/bgm_04_evidence.m4a',    loop: true,  gain: 0.26},   // 案证暂存处底噪
  court:        {src: './media/bgm/bgm_05_court.m4a',       loop: true,  gain: 0.26, fallback: 'mist'},
  clash:        {src: './media/bgm/bgm_06_clash.m4a',       loop: true,  gain: 0.36},
  breakthrough: {src: './media/bgm/bgm_07_breakthrough.m4a', loop: false, gain: 0.46},
  final:        {src: './media/bgm/bgm_08_final.m4a',       loop: true,  gain: 0.30},
  reveal:       {src: './media/bgm/bgm_08b_reveal.m4a',     loop: true,  gain: 0.38},
  settled:      {src: './media/bgm/bgm_09_settled.m4a',     loop: false, gain: 0.40},
  prison:       {src: './media/bgm/bgm_10a_prison.m4a',     loop: false, gain: 0.34},
  residual:     {src: './media/bgm/bgm_10b_residual.m4a',   loop: false, gain: 0.32}
};

const LABELS = {
  entry: '魂影浮世', rumor: '谣言蔓延', mist: '疑云未散', evidence: '物证低语',
  court: '公堂肃听', clash: '言辞交锋', breakthrough: '一线破局',
  final: '帽檐之谜', reveal: '水落石出', evidenceBed: '物证低语',
  settled: '尘埃落定', prison: '冤狱', residual: '未尽之责'
};

const STORE_KEY = 'jiaohun-demo.music.v1';
const FADE_GUARD_MS = 1900;    // 交叉淡化期间的过渡标记
const BGM_DUCK = 0.26;         // 提示音期间 BGM 保留比例
const NARRATION_DUCK = 0.58;   // 旁白压低
const SPEECH_DUCK = 0.72;      // 角色对白压低

const state = {enabled: true, volume: 0.75, unlocked: false};
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  if (saved && typeof saved === 'object') {
    if (typeof saved.enabled === 'boolean') state.enabled = saved.enabled;
    if (Number.isFinite(saved.volume)) state.volume = Math.min(1, Math.max(0, saved.volume));
  }
} catch {}

const channels = [0, 1].map(() => ({el: makeEl(), key: null, src: '', current: 0, dying: false}));
const cueEl = makeEl();
const cue = {key: null, current: 0, stopTimer: 0, stopping: false};
let activeChannel = 0;
let scene = {track: null, duck: 1};
let lastScene = null;
let transitioning = false;
const failed = new Set();
const positions = new Map();    // 循环曲播到的位置：换场回来接着放，避免每次都从头
const lastCueAt = new Map();    // 提示音的最近触发时间，做冷却用
const cuePositions = new Map();  // 提示音播到的位置：下次接着往下放，不重复同一段开头

function makeEl() {
  const el = document.createElement('audio');
  el.preload = 'metadata';
  el.setAttribute('playsinline', '');
  el.style.display = 'none';
  document.body?.append(el);
  return el;
}
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const baseGain = (key) => (TRACKS[key]?.gain ?? 0.3) * state.volume;
const currentChannel = () => channels[activeChannel];

function store() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({enabled: state.enabled, volume: state.volume})); } catch {}
}

/* 目标音量 = 曲目基准 × 主音量 × 对白压低 × (提示音期间 BGM 压低) */
function channelTarget(channel) {
  if (channel.dying || !channel.key) return 0;
  return clamp(baseGain(channel.key) * scene.duck * (cue.key ? BGM_DUCK : 1));
}

const ticker = setInterval(() => {
  const rate = state.enabled ? 0.22 : 0.34;   // 关闭音乐时收得更快
  for (const channel of channels) {
    const goal = channelTarget(channel);
    const diff = goal - channel.current;
    if (Math.abs(diff) > 0.004) {
      channel.current = clamp(channel.current + diff * rate);
      channel.el.volume = channel.current;
    } else if (channel.current !== goal) {
      channel.current = goal;
      channel.el.volume = goal;
    }
    // 淡出结束：停下但保留曲目，重新开启音乐时接着播
    if (channel.dying && channel.current <= 0.002 && !channel.el.paused) channel.el.pause();
  }
  if (cue.key) {
    const goal = cue.stopping ? 0 : (TRACKS[cue.key]?.gain ?? 0.4) * state.volume;
    const diff = goal - cue.current;
    if (Math.abs(diff) > 0.004) { cue.current = clamp(cue.current + diff * 0.25); cueEl.volume = cue.current; }
    if (cue.stopping && cue.current <= 0.001) stopCue();
  }
}, 60);

function safePlay(el) {
  const promise = el.play?.();
  if (promise?.catch) promise.catch(() => { state.unlocked = false; armUnlock(); paintControls(); });
}

/* 浏览器要求用户手势后才能出声：第一次点击/按键时补播。 */
let armed = false;
function armUnlock() {
  if (armed) return;
  armed = true;
  const once = () => {
    armed = false;
    for (const type of ['pointerdown', 'keydown', 'touchstart']) document.removeEventListener(type, once, true);
    unlock();
  };
  for (const type of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(type, once, true);
}

export function unlock() {
  if (!state.enabled) return;
  state.unlocked = true;
  const channel = currentChannel();
  if (channel.key) { channel.dying = false; safePlay(channel.el); }
  if (cue.key) { cue.stopping = false; safePlay(cueEl); }
  paintControls();
}

function resolveTrack(key) {
  let attempt = key;
  for (let guard = 0; attempt && failed.has(attempt) && TRACKS[attempt]?.fallback && guard < 4; guard++) {
    attempt = TRACKS[attempt].fallback;
  }
  return attempt && !failed.has(attempt) ? attempt : null;
}

/** 切换 BGM：旧曲淡出、新曲淡入，形成 1.6 秒交叉；循环曲若之前放过，接上次的位置。 */
export function play(key) {
  const resolved = resolveTrack(key);
  if (!resolved) return;
  const current = currentChannel();
  if (current.key === resolved) {
    if (state.enabled) {
      current.dying = false;
      if (current.el.paused) safePlay(current.el);
    }
    return;
  }
  if (current.key) {
    if (TRACKS[current.key]?.loop) positions.set(current.key, current.el.currentTime);  // 记住位置
    current.dying = true;
  }
  if (cue.key) endCue();   // 换景时提示音一起收，不跨场残留
  activeChannel = activeChannel === 0 ? 1 : 0;
  const channel = currentChannel();
  channel.dying = false;
  channel.key = resolved;
  channel.current = 0;
  channel.el.volume = 0;
  channel.el.loop = Boolean(TRACKS[resolved].loop);
  if (channel.src !== TRACKS[resolved].src) {
    channel.src = TRACKS[resolved].src;
    channel.el.src = TRACKS[resolved].src;
    // 只在这条通道确实要重新载入时才跳位置；通道本来带着这首，就让它自己接着走。
    seekTo(channel, resolved);
  }
  safePlay(channel.el);
  transitioning = true;
  setTimeout(() => { transitioning = false; }, FADE_GUARD_MS);
  paintControls();
}

/* 换场回来：回到上次离开的位置；离结尾太近就从头，免得刚进来就 loop。 */
function seekTo(channel, key) {
  const at = positions.get(key);
  if (!Number.isFinite(at) || at <= 0.5) return;
  const apply = () => {
    const duration = channel.el.duration;
    if (!Number.isFinite(duration) || at > duration - 3) return;
    try { channel.el.currentTime = at; } catch {}
  };
  if (channel.el.readyState >= 1) apply();
  else channel.el.addEventListener('loadedmetadata', apply, {once: true});
}

function fadeOutAll() {
  for (const channel of channels) channel.dying = true;
  stopCue();
}

/** 单次提示音：叠在 BGM 上，BGM 自动压低，播完（或到时）恢复。 */
export function cueOnce(key, {maxMs = 0, minGapMs = 0} = {}) {
  if (!state.enabled) return;
  const track = TRACKS[key];
  if (!track || failed.has(key)) return;
  // 冷却：调查阶段连着取证时，同一首提示音不要每隔十几秒就从头刮一遍
  const now = Date.now();
  if (minGapMs > 0 && now - (lastCueAt.get(key) || 0) < minGapMs) return;
  lastCueAt.set(key, now);
  cue.key = key;
  cue.current = 0;
  cue.stopping = false;
  cueEl.volume = 0;
  cueEl.loop = false;
  if (cueEl.getAttribute('src') !== track.src) cueEl.setAttribute('src', track.src);
  // 同一首提示音再来时，接着上次停下的地方放；快到头了就从头
  const resumeAt = cuePositions.get(key) || 0;
  const applyResume = () => {
    const duration = cueEl.duration;
    if (!Number.isFinite(duration) || resumeAt < 1 || resumeAt > duration - 6) return;
    try { cueEl.currentTime = resumeAt; } catch {}
  };
  if (cueEl.readyState >= 1) applyResume();
  else cueEl.addEventListener('loadedmetadata', applyResume, {once: true});
  safePlay(cueEl);
  clearTimeout(cue.stopTimer);
  if (maxMs > 0) cue.stopTimer = setTimeout(endCue, maxMs);
  paintControls();
}

/* 到时不硬切：先淡到 0 再停，避免打断听感。 */
function endCue() {
  if (!cue.key || cue.stopping) return;
  cue.stopping = true;
  clearTimeout(cue.stopTimer);
}

function stopCue() {
  if (cue.key) cuePositions.set(cue.key, cueEl.currentTime);
  clearTimeout(cue.stopTimer);
  cue.key = null;
  cue.current = 0;
  cue.stopping = false;
  cueEl.volume = 0;
  cueEl.pause();
}

cueEl.addEventListener('ended', stopCue);
cueEl.addEventListener('error', () => { if (cue.key) { failed.add(cue.key); stopCue(); } });
for (const channel of channels) {
  channel.el.addEventListener('error', () => {
    const key = channel.key;
    if (!key || failed.has(key)) return;
    failed.add(key);
    const fallback = TRACKS[key]?.fallback;
    if (fallback) {
      console.warn(`[music] ${LABELS[key] || key} 未能载入，改用 ${LABELS[fallback]}`);
      if (currentChannel() === channel) { channel.dying = true; play(fallback); }
    }
  });
}

/* ---------- 场景判定 ---------- */

/* 会审三档递进：核对供词（查案感）→ 逼近蔡瑞（悬念）→ 最终对决（交锋）。
   追问另起一支更锐的曲，问完回到底噪；最终会审反用「帽檐之谜」，
   因为那一轮的追问正是一层层揭下帽檐纤维。 */
const HEARING_BEDS = {round1: 'court', round2: 'court', round3: 'final', round4: 'final', final_cut: 'clash'};
const HEARING_PRESS = {round1: 'clash', round2: 'clash', round3: 'clash', round4: 'clash', final_cut: 'final'};

/* 调查阶段按地点定底噪：走到哪儿，气氛就是哪儿。
   案证暂存处一进门就是物证低语，候审偏厅进门回到谣言蔓延（外头的传言还没停）。 */
const LOCATION_BEDS = {
  SC_03: 'evidenceBed',   // 绍兴府衙 · 案证暂存处
  SC_05: 'rumor'          // 杭州巡抚衙门 · 候审偏厅
};

/* 个别物件翻看时另起一支，看完回到该地点的底噪。
   纤维编成的辫子状物——"这不是头发"，全案第一处裂缝。 */
const INTERACTION_BEDS = {
  inspect_EV_08: 'clash'
};

function decide(s) {
  if (!s) return {track: null};
  if (s.kind === 'ending') {
    if (s.outcome === 'success') return {track: 'settled'};
    if (s.stageId === 'ending_convicted') return {track: 'prison'};
    return {track: 'residual'};
  }
  if (s.kind === 'hearing') {
    // 最终会审两处疑点全部驳倒：转入沈砚推理与蔡瑞坦白，用水落石出收束
    if (s.stageId === 'final_cut' && s.settled) return {track: 'reveal'};
    const bed = HEARING_BEDS[s.stageId] || 'court';
    // 追问、举证的短交锋另起一支，比底噪更锐，问完自动回到底噪
    if (s.dialogue && !s.inIntro) return {track: HEARING_PRESS[s.stageId] || bed};
    return {track: bed};
  }
  if (s.kind === 'investigation') {
    // 案情的余势还没散：开场两句仍留着「谣言蔓延」，等沈砚交代完再落到地点底噪
    if (s.inIntro) return {track: 'rumor'};
    const overtake = s.interaction && INTERACTION_BEDS[s.interaction];
    if (overtake) return {track: overtake};
    return {track: LOCATION_BEDS[s.locationId] || 'mist'};
  }
  if (s.stageId === 'prologue') {
    if (s.lineIndex < 5) return {track: 'entry'};    // 开场主题：时代背景
    return {track: 'rumor'};                         // 案情复述、曾日理交代，一直连到调查开场
  }
  if (s.stageId === 'confession') return {track: 'reveal'};   // 蔡瑞招供，延续水落石出
  if (s.stageId === 'return_report') return {track: 'mist'};
  return {track: 'rumor'};
}

function duckFor(s) {
  if (!s?.dialogue) return 1;
  const narration = s.speaker === '旁白' || s.speaker === '卷宗记';
  // 调查阶段多在问人：底噪再退一步，只留一层衬底的氛围，把注意力交给对话
  if (s.kind === 'investigation') return narration ? 0.40 : 0.50;
  return narration ? NARRATION_DUCK : SPEECH_DUCK;
}

/** app.mjs 每次重绘都会调用；只有曲目真的变了才切换。 */
export function update(s) {
  if (!s) return;
  lastScene = s;
  scene.duck = duckFor(s);
  if (s.stageId === 'prologue' && !s.lineIndex) positions.clear();   // 新开一局：旧位置作废
  const plan = decide(s);
  if (plan.track && plan.track !== currentChannel().key) play(plan.track);
  paintControls();
}

/* ---------- 开关与音量 ---------- */

export function setEnabled(value) {
  state.enabled = Boolean(value);
  if (!state.enabled) {
    fadeOutAll();
    // 渐降到底后彻底停住，避免只剩一丝底噪占着解码器
    setTimeout(() => { if (!state.enabled) for (const channel of channels) channel.el.pause(); }, 760);
  }
  else { unlock(); if (lastScene) update(lastScene); }
  store();
  paintControls();
}

export function setVolume(value) {
  state.volume = clamp(Number(value));
  store();
  paintControls();
}

export const isEnabled = () => state.enabled;
export const getVolume = () => state.volume;
export const currentTrack = () => (currentChannel().key ? {key: currentChannel().key, label: LABELS[currentChannel().key]} : null);

/* ---------- 控件（游戏页用页面里的元素；入口页自动生成浮动按钮） ---------- */

const controls = {chip: null, button: null, range: null, label: null, toggle: null};

function ensureChip() {
  if (document.getElementById('music-chip') || document.getElementById('music-toggle')) return;
  const chip = document.createElement('button');
  chip.id = 'music-chip';
  chip.type = 'button';
  chip.className = 'music-chip';
  // 入口页不一定加载 style.css，这里给足最小样式，保证按钮可点、不被遮罩挡住。
  Object.assign(chip.style, {
    position: 'fixed', left: 'max(14px,env(safe-area-inset-left))', bottom: 'max(14px,env(safe-area-inset-bottom))',
    zIndex: '90', padding: '10px 18px', borderRadius: '999px', border: '1px solid #ffffff2e',
    background: '#0b1310dc', color: '#f0eadc', font: '13px/1.2 "SimSun",serif', letterSpacing: '1px',
    cursor: 'pointer', backdropFilter: 'blur(6px)'
  });
  document.body.append(chip);
}

function paintControls() {
  const on = state.enabled;
  const track = currentTrack();
  const title = track ? LABELS[track.key] : '静候开场';
  const chipText = `♪ ${title}`;
  if (controls.button) {
    controls.button.classList.toggle('muted', !on);
    controls.button.setAttribute('aria-pressed', String(on));
    controls.button.setAttribute('aria-label', on ? '关闭音乐' : '开启音乐');
    controls.button.title = on ? `音乐开 · ${title} · 点击关闭` : '音乐关 · 点击开启';
  }
  if (controls.chip && controls.chip.textContent !== (on ? chipText : '♪ 音乐已关闭')) {
    controls.chip.textContent = on ? chipText : '♪ 音乐已关闭';
    controls.chip.classList.toggle('muted', !on);
    controls.chip.title = on ? '点击关闭音乐' : '点击开启音乐';
  }
  if (controls.label && controls.label.textContent !== (on ? `${title} · 音量 ${Math.round(state.volume * 100)}%` : '音乐已关闭')) {
    controls.label.textContent = on ? `${title} · 音量 ${Math.round(state.volume * 100)}%` : '音乐已关闭';
  }
  if (controls.toggle) controls.toggle.checked = on;
  if (controls.range && document.activeElement !== controls.range) controls.range.value = String(Math.round(state.volume * 100));
  document.body.dataset.music = on ? 'on' : 'off';
}

function bindControls() {
  controls.button = document.getElementById('music-toggle');
  if (controls.button) controls.button.addEventListener('click', () => setEnabled(!state.enabled));
  controls.chip = document.getElementById('music-chip');
  if (controls.chip) controls.chip.addEventListener('click', () => setEnabled(!state.enabled));
  controls.range = document.getElementById('music-volume');
  if (controls.range) controls.range.addEventListener('input', () => setVolume(Number(controls.range.value) / 100));
  controls.toggle = document.getElementById('music-enabled');
  if (controls.toggle) controls.toggle.addEventListener('change', () => setEnabled(controls.toggle.checked));
  controls.label = document.getElementById('music-track');
  paintControls();
}

export const director = {update, cue: cueOnce, play, unlock, setEnabled, setVolume, isEnabled, getVolume, currentTrack};

function boot() {
  window.__jiaohunMusic = director;
  ensureChip();
  bindControls();
  if (state.enabled) armUnlock();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { boot(); }, {once: true});
else boot();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    for (const channel of channels) channel.el.pause();
    cueEl.pause();
  } else if (state.enabled) {
    const channel = currentChannel();
    if (channel.key) safePlay(channel.el);
  }
});
window.addEventListener('pagehide', () => { for (const channel of channels) channel.el.pause(); cueEl.pause(); });

/* 入口页（注册/展示页）用法 */
export function playEntryMusic() {
  play('entry');
  if (!state.unlocked) armUnlock();
  return director;
}

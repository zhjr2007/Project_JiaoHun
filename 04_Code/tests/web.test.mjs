/**
 * No-network UI integration tests. The real app source runs via node:vm in the
 * host realm against a deliberately small DOM substitute and real game modules.
 * These tests verify event wiring and state changes, not browser layout/rendering.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { demoContent } from '../../05_Content/demo-content.mjs';
import { createGame, dispatch, getView } from '../core/engine.mjs';
import { encodeSave, decodeSave } from '../core/save.mjs';

const STORAGE_KEY = 'jiaohun-demo.autosave.v1';
const source = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
const imports = source.match(/^import .+;\r?$/gm) ?? [];
assert.equal(imports.length, 4, '测试替换实际 app.mjs 的四条模块导入，包括资源清单');
const appBody = source.replace(/^import .+;\r?\n/gm, '');

class NodeStub {
  constructor(tagName, document) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.listeners = new Map();
    this.disabled = false;
    this.open = false;
    this.files = [];
    this.value = '';
    this._text = '';
    this.className = '';
    this.classList = {
      toggle: (name, force) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        const enabled = force === undefined ? !classes.has(name) : force;
        if (enabled) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(' ');
        return enabled;
      },
      add: (...names) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        for (const name of names) classes.add(name);
        this.className = [...classes].join(' ');
      },
      remove: (...names) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        for (const name of names) classes.delete(name);
        this.className = [...classes].join(' ');
      },
      contains: name => this.className.split(/\s+/).filter(Boolean).includes(name)
    };
  }
  set textContent(value) {
    this._text = String(value);
    for (const child of this.children) child.parentNode = null;
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join('');
  }
  append(...nodes) {
    for (const node of nodes) {
      if (!(node instanceof NodeStub)) throw new Error('DOM 替身只接受元素子节点');
      if (node.parentNode) node.remove();
      node.parentNode = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.textContent = '';
    this.append(...nodes);
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  async emit(type, fields = {}) {
    const event = { target: this, preventDefault() {}, ...fields };
    const pending = (this.listeners.get(type) ?? []).map((handler) => handler(event));
    await Promise.all(pending);
  }
  click() {
    if (this.disabled) return Promise.resolve();
    if (this.tagName === 'A' && this.download) {
      this.ownerDocument.downloads.push({ name: this.download, href: this.href });
    }
    return this.emit('click');
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
      this.parentNode = null;
    }
  }
}

function documentStub() {
  const doc = {
    nodes: new Map(), tabs: [], listeners: new Map(), downloads: [], title: '',
    createElement(tagName) { return new NodeStub(tagName, this); },
    getElementById(id) {
      assert.ok(this.nodes.has(id), `实际 HTML 应有 #${id}`);
      return this.nodes.get(id);
    },
    querySelectorAll(selector) {
      assert.equal(selector, '[data-tab]', '若 app 增加 DOM 查询，必须扩展明确的替身行为');
      return this.tabs;
    },
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
  };
  doc.body = doc.createElement('body');
  doc.activeElement = doc.body;
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*\bid="([^"]+)"/gi)) {
    const node = doc.createElement(match[1]);
    node.id = match[2];
    doc.nodes.set(node.id, node);
  }
  for (const value of ['evidence', 'profiles', 'hint']) {
    const tab = doc.createElement('button');
    tab.dataset.tab = value;
    doc.tabs.push(tab);
  }
  return doc;
}

function boot(storage = new Map(), { catalog, frames, content = demoContent } = {}) {
  const document = documentStub();
  const blobs = new Map();
  let blobSerial = 0;
  const timers = [];
  const environment = {
    document,
    window: { confirm: () => true, ...(frames ? { requestAnimationFrame: callback => frames.push(callback) } : {}) },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    Blob,
    URL: {
      createObjectURL: (blob) => {
        const url = `blob:test-${++blobSerial}`;
        blobs.set(url, blob);
        return url;
      },
      revokeObjectURL: (url) => blobs.delete(url)
    },
    setTimeout: (callback) => { timers.push(callback); return timers.length; },
    assetCatalog: catalog ?? new Proxy({}, { get: (_, id) => ({ src: `/assets/${String(id)}.png`, alt: String(id) }) }),
    demoContent:content, createGame, dispatch, getView, encodeSave, decodeSave
  };
  // compileFunction uses the host realm: injected real engine functions and
  // object-literal actions have the same prototypes, just as browser modules do.
  const run = compileFunction(`${appBody}\nreturn () => ({ state, view });`, Object.keys(environment), {
    filename: 'app.mjs (DOM integration test)'
  });
  const inspect = run(...Object.values(environment));
  return {
    document, storage, blobs, timers, window:environment.window,
    node: (id) => document.getElementById(id),
    state: () => structuredClone(inspect().state),
    view: () => structuredClone(inspect().view)
  };
}

test('手机竖屏全屏在锁定不受支持时旋转布局，退出还原，横屏不旋转',async()=>{
 const app=boot();app.window.innerWidth=390;app.window.innerHeight=844;
 await app.node('fullscreen').click();assert.match(app.document.body.className,/fullscreen-landscape/);
 await app.node('fullscreen').click();assert.doesNotMatch(app.document.body.className,/fullscreen-landscape/);
 app.window.innerWidth=844;app.window.innerHeight=390;
 await app.node('fullscreen').click();assert.doesNotMatch(app.document.body.className,/fullscreen-landscape/);
 assert.equal(app.node('fullscreen').attributes['aria-pressed'],'true');
});

function descendants(node) {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

function findButton(app, rootId, label) {
  const matches = descendants(app.node(rootId)).filter((node) => node.tagName === 'BUTTON' &&
    (typeof label === 'string' ? node.textContent === label : label.test(node.textContent)));
  assert.equal(matches.length, 1, `#${rootId} 中应有唯一按钮 ${label}`);
  return matches[0];
}

async function click(app, rootId, label) {
  const node = findButton(app, rootId, label);
  assert.equal(node.disabled, false, `${label} 应可操作`);
  await node.click();
}

async function continueDialogue(app) {
  for (let guard = 0; app.view().dialogue; guard += 1) {
    assert.ok(guard < 300, '界面对白不应进入无限循环');
    await click(app, 'actions', '继续');
  }
}

async function openFirstHearing(app) {
  await continueDialogue(app);
  for (const label of ['查看剪刀', '查看两段辫状物', '细看辫状物的散尾']) {
    await click(app, 'scene-body', label);
    await continueDialogue(app);
  }
  await click(app, 'scene-body', '候审处');
  for (const [actor,label] of [['巨成','询问剪刀与绳带的来历'], ['正一','询问拘捕经过'], ['超凡','询问行李去向']]) {
    await click(app, 'scene-body', actor);
    await click(app, 'scene-body', label);
    await continueDialogue(app);
  }
  await click(app, 'scene-body', '衙门廊下');
  await click(app, 'scene-body', '询问开箱时看见的物件');
  await continueDialogue(app);
  await click(app, 'actions', '继续查办');
  await continueDialogue(app);
  assert.equal(app.view().stageId, 'hearing_scissors');
}

async function importText(app, text) {
  const input = app.node('load-file');
  input.files = [{ size: Buffer.byteLength(text), text: async () => text }];
  await input.emit('change');
}

test('实际 app 脚本启动显示案情，继续按钮推进到初次调查', async () => {
  const app = boot();
  assert.match(app.node('stage-title').textContent, /前情/);
  assert.match(app.node('line').textContent, /乾隆|叫魂/);
  assert.match(app.document.title, /萧山剪辫案/);
  assert.equal(app.view().kind, 'dialogue');
  await continueDialogue(app);
  assert.equal(app.view().stageId, 'investigation');
  assert.match(app.node('scene-label').textContent, /证物/);
  assert.equal(findButton(app, 'actions', '继续查办').disabled, true);
});

test('调查按钮取得实物并更新凭据，浏览与切换资料页不改变进度', async () => {
  const app = boot();
  await continueDialogue(app);
  await click(app, 'scene-body', '查看剪刀');
  assert.ok(app.state().evidence.includes('scissors'));
  const before = app.state();
  await app.node('record').click();
  assert.equal(app.node('records').open, true);
  assert.match(app.node('record-content').textContent, /四把剪刀/);
  assert.equal(app.node('record-actions').children.length, 0, '浏览凭据不得显示提交按钮');
  await app.document.tabs.find((tab) => tab.dataset.tab === 'profiles').click();
  assert.match(app.node('record-content').textContent, /沈砚|曾日理/);
  await app.document.tabs.find((tab) => tab.dataset.tab === 'hint').click();
  assert.match(app.node('record-content').textContent, /证物存放处|查办/);
  await app.node('close-records').click();
  assert.equal(app.node('records').open, false);
  assert.deepEqual(app.state(), before, '凭据只读操作不扣分也不推进对白');
});

test('调查对白期间热点禁用，未完成查办时不能直接进会审', async () => {
  const app = boot();
  await continueDialogue(app);
  const beforeAdvance = app.state();
  await findButton(app, 'actions', '继续查办').click();
  assert.deepEqual(app.state(), beforeAdvance);
  await click(app, 'scene-body', '查看剪刀');
  const beforeLocked = app.state();
  const locked = findButton(app, 'scene-body', '查看两段辫状物');
  assert.equal(locked.disabled, true);
  await locked.click();
  assert.deepEqual(app.state(), beforeLocked);
});

test('可通过界面完成初次查办并进入普通会审', async () => {
  const app = boot();
  await openFirstHearing(app);
  assert.match(app.node('will').textContent, /5\/5/);
  assert.match(app.node('scene-body').textContent, /证词 1 \/ 4/);
  assert.ok(app.state().evidence.includes('testimony_witness'));
  await click(app, 'actions', '下一句 →');
  assert.equal(app.view().statement.id, 'scissors_2');
  await click(app, 'actions', '← 上一句');
  assert.equal(app.view().statement.id, 'scissors_1');
});

test('组合比对必须选满两槽并单独确认，取消和浏览不提交', async () => {
 const content=structuredClone(demoContent);content.startStage='hearing_scissors';content.initialEvidence=['scissors','braids'];
 const rule=content.stages.hearing_scissors.rules[0];delete rule.evidenceId;rule.evidenceIds=['scissors','braids'];rule.requires=[];
 const app=boot(new Map(),{content});await continueDialogue(app);await click(app,'actions','下一句 →');
 await click(app,'actions','出示');await click(app,'record-content','两件组合比对');
 assert.equal(findButton(app,'record-actions','确认组合举证').disabled,true);
 const before=app.state();await click(app,'record-content',/^物证四把剪刀/);assert.deepEqual(app.state(),before);
 assert.equal(findButton(app,'record-actions','确认组合举证').disabled,true);
 await click(app,'record-content',/^物证两段辫子状物/);assert.equal(findButton(app,'record-actions','确认组合举证').disabled,false);
 await click(app,'record-actions','取消');assert.deepEqual(app.state(),before);
 await click(app,'actions','出示');await click(app,'record-content','两件组合比对');await click(app,'record-content',/^物证四把剪刀/);await click(app,'record-content',/^物证两段辫子状物/);await click(app,'record-actions','确认组合举证');
 assert.equal(app.state().ordinaryWill,5);assert.ok(app.state().flags.includes('scissors_contradiction'));assert.equal(app.state().pendingStage,'hearing_braid');
});

test('选择证物不立即判定，确认出示才扣一点且返回原句', async () => {
  const app = boot();
  await openFirstHearing(app);
  const before = app.state();
  await click(app, 'actions', '出示');
  assert.equal(app.node('records').open, true);
  assert.match(app.node('records-title').textContent, /选择/);
  assert.equal(findButton(app, 'record-actions', '确认出示').disabled, true);
  await findButton(app, 'record-actions', '确认出示').click();
  assert.deepEqual(app.state(), before);
  await click(app, 'record-content', /^物证四把剪刀/);
  assert.deepEqual(app.state(), before, '选择卡片尚未提交');
  assert.match(app.node('record-content').textContent, /准备出示：四把剪刀/);
  await click(app, 'record-actions', '确认出示');
  assert.equal(app.node('records').open, false);
  assert.equal(app.state().ordinaryWill, 4);
  assert.equal(decodeSave(demoContent, app.storage.get(STORAGE_KEY)).ordinaryWill, 4, '逻辑扣点已保存');
  assert.match(app.node('will').textContent, /5\/5/, '蔡瑞先反驳，画面暂不扣点');
  assert.equal(app.node('speaker').textContent, '蔡瑞');
  await click(app, 'actions', '继续');
  assert.equal(app.node('speaker').textContent, '蔡瑞', '蔡瑞先辩解两句，再轮到大人');
  assert.match(app.node('will').textContent, /5\/5/, '蔡瑞辩解时仍是原威信');
  await click(app, 'actions', '继续');
  assert.equal(app.node('speaker').textContent, '曾日理');
  assert.match(app.node('will').textContent, /5\/5/, '曾日理制止时仍显示原威信');
  await click(app, 'actions', '继续');
  assert.equal(app.view().dialogue.cue, 'will_penalty');
  assert.match(app.node('will').textContent, /4\/5/, '第三句扣点提示出现时才更新画面');
  await continueDialogue(app);
  assert.equal(app.view().stageId, 'hearing_scissors');
  assert.equal(app.view().statement.id, 'scissors_1');
  assert.equal(app.state().ordinaryWill, 4);
  assert.match(app.node('will').textContent, /4\/5/);
});

test('出示选择可取消，普通凭据浏览不会触发举证', async () => {
  const app = boot();
  await openFirstHearing(app);
  const before = app.state();
  await click(app, 'actions', '出示');
  await click(app, 'record-content', /^物证四把剪刀/);
  await click(app, 'record-actions', '取消');
  assert.equal(app.node('records').open, false);
  await app.node('journal').click();
  assert.equal(app.node('records-title').textContent, '证佐凭据');
  assert.equal(app.node('record-actions').children.length, 0);
  assert.deepEqual(app.state(), before);
});

test('动作后自动保存，下次启动恢复相同对白与阶段', async () => {
  const storage = new Map();
  const first = boot(storage);
  await click(first, 'actions', '继续');
  assert.ok(storage.has(STORAGE_KEY));
  const expected = first.state();
  const restored = boot(storage);
  assert.deepEqual(restored.state(), expected);
  assert.equal(restored.node('line').textContent, first.node('line').textContent);
  assert.match(restored.node('notice').textContent, /已恢复上次进度/);
});

test('导出按钮产生可恢复JSON，导入恢复旧进度并关闭资料窗口', async () => {
  const app = boot();
  await continueDialogue(app);
  await click(app, 'scene-body', '查看剪刀');
  await continueDialogue(app);
  const exportedState = app.state();
  await app.node('save').click();
  assert.equal(app.document.downloads.length, 1);
  const download = app.document.downloads[0];
  assert.match(download.name, /^jiaohun-save-.*\.json$/);
  const json = await app.blobs.get(download.href).text();
  assert.deepEqual(decodeSave(demoContent, json), exportedState);
  await click(app, 'scene-body', '查看两段辫状物');
  assert.notDeepEqual(app.state(), exportedState);
  await app.node('record').click();
  assert.equal(app.node('records').open, true);
  await importText(app, json);
  assert.deepEqual(app.state(), exportedState);
  assert.equal(app.node('records').open, false);
  assert.match(app.node('notice').textContent, /存档已恢复/);
});

test('错误JSON、无效状态或超大导入均不覆盖现有进度和自动存档', async () => {
  const app = boot();
  await continueDialogue(app);
  await click(app, 'scene-body', '查看剪刀');
  const before = app.state();
  const savedBefore = app.storage.get(STORAGE_KEY);
  const badState = JSON.parse(encodeSave(demoContent, before));
  badState.state.ordinaryWill = -1;
  for (const input of ['{broken', JSON.stringify(badState)]) {
    await importText(app, input);
    assert.deepEqual(app.state(), before);
    assert.equal(app.storage.get(STORAGE_KEY), savedBefore);
    assert.match(app.node('notice').textContent, /未载入存档，当前进度已保留/);
  }
  const fileInput = app.node('load-file');
  fileInput.files = [{ size: 2 * 1024 * 1024 + 1, text: async () => { throw new Error('不应读取过大文件'); } }];
  await fileInput.emit('change');
  assert.deepEqual(app.state(), before);
  assert.equal(app.storage.get(STORAGE_KEY), savedBefore);
  assert.match(app.node('notice').textContent, /存档文件过大/);
});

test('损坏的自动存档会暂停覆盖，玩家仍能继续临时游戏', async () => {
  const storage = new Map([[STORAGE_KEY, '{broken']]);
  const app = boot(storage);
  assert.match(app.node('notice').textContent, /原存档尚未覆盖/);
  assert.equal(app.view().stageId, 'prologue');
  await click(app, 'actions', '继续');
  assert.equal(storage.get(STORAGE_KEY), '{broken');
  assert.equal(app.state().dialogue.length, createGame(demoContent).dialogue.length - 1);
});

test('场景热点和调查列表执行同一动作，特写在对白读完后收起', async () => {
  const hotspotApp=boot(),listApp=boot();
  await continueDialogue(hotspotApp);await continueDialogue(listApp);
  await click(hotspotApp,'hotspot-layer','查看两段辫状物');
  await click(listApp,'scene-body','查看两段辫状物');
  assert.deepEqual(hotspotApp.state(),listApp.state());
  assert.ok(descendants(hotspotApp.node('hotspot-layer')).filter(n=>n.tagName==='BUTTON').every(n=>n.disabled));
  await continueDialogue(hotspotApp);
  await click(hotspotApp,'hotspot-layer','细看辫状物的散尾');
  assert.equal(hotspotApp.node('focus-layer').children[0].dataset.assetId,'detail.braid_tail');
  await continueDialogue(hotspotApp);
  assert.equal(hotspotApp.node('focus-layer').children.length,0);
});

test('人物选择只改变交谈对象和话题，向当前人物出示不会串用其他人的回复', async () => {
  const app=boot();await continueDialogue(app);
  await click(app,'scene-body','查看剪刀');await continueDialogue(app);
  await click(app,'scene-body','候审处');
  await click(app,'scene-body','巨成');await click(app,'scene-body','询问剪刀与绳带的来历');await continueDialogue(app);
  const before=app.state();await click(app,'scene-body','正一');
  assert.deepEqual(app.state(),before);
  assert.equal(app.node('character-layer').children[0].dataset.assetId,'character.zhengyi.neutral');
  assert.match(app.node('scene-body').textContent,/与正一交谈/);
  assert.doesNotMatch(app.node('scene-body').textContent,/询问剪刀与绳带的来历/);
  await click(app,'actions','向在场人物出示');await click(app,'record-content',/^物证四把剪刀/);
  assert.match(app.node('record-content').textContent,/准备向正一出示/);
  await click(app,'record-actions','确认出示');
  assert.match(app.node('line').textContent,/递到正一面前/);
  await click(app,'actions','继续');
  assert.equal(app.node('speaker').textContent,'正一');
  // 正一没有关于剪刀的说法，只会以自己的口吻说看不出关连，不会借用别人的应答。
  assert.match(app.node('line').textContent,/看不出它与/);
  assert.equal(app.state().ordinaryWill,before.ordinaryWill);
});

test('凭据大图使用当前公开图片变体，浏览和取消不改变进度', async () => {
  const app=boot();await continueDialogue(app);
  await click(app,'scene-body','查看两段辫状物');await continueDialogue(app);
  await click(app,'scene-body','细看辫状物的散尾');await continueDialogue(app);
  const before=app.state();await app.node('record').click();await click(app,'record-content',/^物证两段辫子状物/);
  const detail=descendants(app.node('record-content')).find(n=>n.className.includes('record-large'));
  assert.equal(detail.dataset.assetId,'detail.braid_tail');
  assert.equal(detail.children[0].src,'/assets/detail.braid_tail.png');
  await app.node('close-records').click();assert.deepEqual(app.state(),before);
});

test('文字先补全再推进，阅读设置持久化，减少动态立即显示', async () => {
  const frames=[],storage=new Map(),app=boot(storage,{frames});
  const before=app.state();assert.equal(app.node('line').textContent,'');
  assert.equal(frames.length,1);
  await click(app,'actions','继续');assert.deepEqual(app.state(),before);
  assert.equal(app.node('line').textContent,before.dialogue[0].text);
  await click(app,'actions','继续');assert.equal(app.state().dialogue.length,before.dialogue.length-1);
  await app.node('settings-open').click();assert.equal(app.node('settings').open,true);
  app.node('reduce-motion').checked=true;await app.node('reduce-motion').emit('change');
  assert.equal(app.node('line').textContent,app.view().dialogue.text);
  assert.equal(JSON.parse(storage.get('jiaohun-demo.reading.v1')).reduceMotion,true);
  const restored=boot(storage,{frames:[]});
  assert.equal(restored.node('line').textContent,restored.view().dialogue.text);
  assert.match(restored.document.body.className,/reduce-motion/);
});

test('缺失和载入失败的素材显示明确提示，不能伪装已完成图片', async () => {
  const missing=boot(new Map(),{catalog:{}});
  assert.match(missing.node('background-layer').textContent,/图像暂缺/);
  const app=boot(),figure=app.node('background-layer').children[0],image=figure.children[0];
  await image.emit('error');assert.match(figure.textContent,/图像未能载入/);
  assert.match(figure.className,/art-error/);
});

test('按钮或对白获得焦点后，左右快捷键仍切换证词；输入及模态框不抢键',async()=>{
 const app=boot();await openFirstHearing(app);
 await continueDialogue(app);
 // 查办途中取得的凭据会弹「获取凭据」提示，先收下再试键盘（与玩家实际操作顺序一致）。
 if(app.node('acquired').open)await app.node('acquired-close').click();
 const handlers=app.document.listeners.get('keydown');
 async function key(value){for(const handler of handlers)await handler({key:value,preventDefault(){}});}
 app.document.activeElement=findButton(app,'actions','追问');
 await key('ArrowRight');
 assert.equal(app.view().statementIndex,1);
 app.document.activeElement=app.node('line');
 await key('ArrowLeft');assert.equal(app.view().statementIndex,0);
 app.document.activeElement=app.node('text-speed');await key('ArrowRight');assert.equal(app.view().statementIndex,0);
 app.document.activeElement=app.document.body;await app.node('record').click();
 await key('ArrowRight');assert.equal(app.view().statementIndex,0);
});

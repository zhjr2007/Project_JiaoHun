import {api,node} from './player.mjs';
import {avatarImage} from './avatars.mjs';
const $=id=>document.getElementById(id);let timer=null;
// 台词核查状态：必须在 loadVoice() 调用前初始化（let 有暂时性死区，函数提升无效）
let voiceLines=null,voiceChecks={},voiceScenes={},voiceFilter='fail',voiceShown=40;
const voiceAudio=new Audio();voiceAudio.preload='none';
let operatorName='';
const readableChecks=value=>(value.checks||[]).map(check=>(check.ok?'✓ ':'需处理 · ')+check.name).join('\n');
const runText=value=>[(value.status==='passed'?'验证通过':value.status==='failed'?'发现需要处理的问题':'验证进行中'),value.createdAt?'时间：'+new Date(value.createdAt).toLocaleString('zh-CN'):'',value.isolated?'使用隔离测试数据':'',readableChecks(value)].filter(Boolean).join('\n');
const inspectorApi=(path,options={})=>api(path,{...options,headers:{...options.headers,'X-Operator-Name':encodeURIComponent(operatorName)}});
let accountPage=1,accountRequest=0;
async function accounts(){
 const request=++accountRequest,status=$('account-status');status.textContent='正在读取账号……';
 try{const query=$('account-query').value.trim(),data=await inspectorApi(`diagnostics/players?q=${encodeURIComponent(query)}&page=${accountPage}&pageSize=10`),items=data.items||data.players||[];if(request!==accountRequest)return;const list=$('account-results');list.replaceChildren();
  for(const player of items){const detail=node('details',undefined,'account-row'),summary=node('summary');summary.append(avatarImage(player.avatarId,36),node('span',`${player.name} · ${player.id}`));detail.append(summary);if(player.createdAt)detail.append(node('p','创建时间：'+new Date(player.createdAt).toLocaleString('zh-CN')));const saves=player.progress||player.saves||[];if(!saves.length)detail.append(node('p','尚无服务器存档。'));for(const save of saves){detail.append(node('p',`${save.title||save.slug}：${save.stageTitle||save.stageId||'未知阶段'} · 剧情版本 ${save.contentVersion??save.version??'—'} · 保存修订 ${save.revision??'—'}${save.migrationRequired?' · 待迁移':''}`),node('p',save.updatedAt?new Date(save.updatedAt).toLocaleString('zh-CN'):''));if(save.slug&&!save.migrationRequired){const watch=node('button','查看实机画面'),line=node('p');watch.addEventListener('click',()=>window.open(`./play.html?inspect=${encodeURIComponent(player.id)}&level=${encodeURIComponent(save.slug)}`,'_blank','noopener'));line.append(watch);detail.append(line);}else if(save.migrationRequired)detail.append(node('p','该进度需先在玩家入口确认迁移，检修暂不能直接查看。','small'));}list.append(detail);}
  const pages=data.totalPages||Math.max(1,Math.ceil((data.total??items.length)/10));$('account-page').textContent=`第 ${accountPage} / ${pages} 页`;$('account-prev').disabled=accountPage<=1;$('account-next').disabled=accountPage>=pages;status.textContent=`找到 ${data.total??items.length} 个账号`;
 }catch(error){if(request===accountRequest)status.textContent=error.message;}
}
$('account-search').addEventListener('submit',event=>{event.preventDefault();accountPage=1;accounts();});$('account-prev').addEventListener('click',()=>{accountPage--;accounts();});$('account-next').addEventListener('click',()=>{accountPage++;accounts();});
async function health(){try{const result=await inspectorApi('diagnostics/health');$('health-result').textContent=[result.ok?'服务正常':'服务需要检查','数据存储：'+(result.database==='ready'?'可用':'需检查'),'完整升级备份：'+(result.upgradeBackupReady?'已保存':'尚未生成'),'关卡包：'+result.levels,readableChecks(result)].join('\n');}catch(error){$('health-result').textContent=error.message;if(error.status===401||error.status===403)location.replace('./operator.html?role=inspector');}}
async function poll(id){try{const result=await inspectorApi('diagnostics/runs/'+encodeURIComponent(id));$('run-result').textContent=runText(result);$('inspect-status').textContent=result.status==='running'||result.status==='queued'?'隔离验证进行中……':'验证完成。';if(['running','queued'].includes(result.status))timer=setTimeout(()=>poll(id),1500);else $('inspect-run').disabled=false;}catch(error){$('inspect-status').textContent=error.message;$('inspect-run').disabled=false;}}
$('inspect-run').addEventListener('click',async()=>{$('inspect-run').disabled=true;$('inspect-status').textContent='正在启动隔离验证……';try{const result=await inspectorApi('diagnostics/run',{method:'POST',body:{}});$('run-result').textContent=runText(result);if(result.id)await poll(result.id);else{$('inspect-status').textContent='验证完成。';$('inspect-run').disabled=false;}}catch(error){$('inspect-status').textContent=error.message;$('inspect-run').disabled=false;}});
$('inspect-refresh').addEventListener('click',health);$('inspector-logout').addEventListener('click',async()=>{await inspectorApi('operator/logout',{method:'POST',body:{role:'inspector'}});location.href='./operator.html?role=inspector';});window.addEventListener('pagehide',()=>clearTimeout(timer));
try{const expected=new URL(location.href).searchParams.get('operator');const result=await api('operator/me?role=inspector',{headers:expected?{'X-Operator-Name':encodeURIComponent(expected)}:{}});operatorName=result.operator.name;await health();await accounts();await loadVoice();}catch{location.replace('./operator.html?role=inspector');}

// ---- 台词核查：文本与人声对齐 ----
async function loadVoice(){
 const stats=$('voice-stats');
 try{
  const lines=await fetch('./lines.json',{cache:'no-cache'}).then(r=>r.json());
  const checks=await fetch('./voice-check.json',{cache:'no-cache'}).then(r=>r.json()).catch(()=>({}));
  voiceScenes=await fetch('./voice-scene.json',{cache:'no-cache'}).then(r=>r.json()).catch(()=>({}));
  voiceLines=lines;voiceChecks=checks||{};
  const counts={fail:0,warn:0,pass:0,inner:0};
  for(const line of voiceLines){const check=voiceChecks[line.id];if(check&&counts[check.verdict]!==undefined)counts[check.verdict]++;if(line.isInner)counts.inner++;}
  stats.textContent=`共 ${voiceLines.length} 句 · 返工 ${counts.fail} · 复核 ${counts.warn} · 通过 ${counts.pass}（默认先听返工项，按错误率降序）`;
  const bar=$('voice-filters');bar.replaceChildren();
  for(const [key,label] of [['fail',`返工 ${counts.fail}`],['warn',`复核 ${counts.warn}`],['pass',`通过 ${counts.pass}`],['inner',`心理描写 ${counts.inner}`],['all',`全部 ${voiceLines.length}`]]){
   const button=node('button',label);button.dataset.v=key;if(key===voiceFilter)button.classList.add('active');
   button.addEventListener('click',()=>{voiceFilter=key;voiceShown=40;for(const other of document.querySelectorAll('#voice-filters button'))other.classList.toggle('active',other.dataset.v===key);renderVoice();});
   bar.append(button);
  }
  renderVoice();
 }catch(error){stats.textContent='台词清单读取失败：'+error.message;}
}
function voiceFiltered(){
 if(!voiceLines)return [];
 const list=voiceLines.filter(line=>{
  if(voiceFilter==='all')return true;
  if(voiceFilter==='inner')return Boolean(line.isInner);
  return (voiceChecks[line.id]?.verdict||'')===voiceFilter;
 });
 return list.slice().sort((a,b)=>(voiceChecks[b.id]?.cer??-1)-(voiceChecks[a.id]?.cer??-1));
}
function renderVoice(){
 const list=voiceFiltered(),box=$('voice-list'),items=list.slice(0,voiceShown);
 box.replaceChildren();
 if(!items.length){box.append(node('p','这一类没有条目。','small'));$('voice-more').hidden=true;return;}
 for(const line of items){
  const check=voiceChecks[line.id];
  const row=node('div',undefined,'voice-row'+(check?' '+check.verdict:''));
  const meta=node('div',undefined,'voice-meta');
  meta.append(node('span',line.id,'vid'),node('span',line.speaker),node('span',line.stage+' · '+line.field),
   node('span',check?`CER ${check.cer}%`:'未核验'),
   node('span',check?(check.verdict==='pass'?'通过':check.verdict==='warn'?'复核':'返工'):''));
  const text=node('div',line.text,'voice-text'+(line.isInner?' inner':''));
  const hyp=node('div',check?('ASR 识别：'+(check.hyp||'（无）')):'ASR 识别：未核验','voice-hyp');
  const acts=node('div',undefined,'voice-actions'),play=node('button','▶ 播放'),state=node('span','','playing');
  play.addEventListener('click',()=>{
   voiceAudio.src='./audio/'+line.id+'.wav';
   for(const other of document.querySelectorAll('.voice-actions .playing'))other.textContent='';
   state.textContent='正在播放 '+line.id;
   voiceAudio.play().catch(error=>{state.textContent='无法播放：'+error.message;});
  });
  acts.append(play,state);
  const main=node('div',undefined,'voice-main');main.append(meta,text,hyp,acts);row.append(main);
  const scene=voiceScenes[line.sid];
  if(scene&&scene.bg){const shot=document.createElement('img');shot.className='voice-shot';shot.loading='lazy';shot.alt=line.stage||'场景';shot.src='./levels/xiaoshan-demo/assets/'+scene.bg;row.append(shot);}
  box.append(row);
 }
 const more=$('voice-more');more.hidden=items.length>=list.length;
 more.textContent=`加载更多（已显示 ${items.length} / ${list.length}）`;
}
$('voice-more').addEventListener('click',()=>{voiceShown+=40;renderVoice();});
voiceAudio.addEventListener('ended',()=>{for(const el of document.querySelectorAll('.voice-actions .playing'))el.textContent='';});

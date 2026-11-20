import {requirePlayer,api,startRoomPresence,leaveRoom,roomId,node,action} from './player.mjs';
import {connectProgress} from './cloud-progress.mjs';
import {levelSlug,demoContent} from './level-loader.mjs';
import {decodeSave} from './core/save.mjs';
import {previewMigration} from './core/migrate.mjs';
const params=new URL(location.href).searchParams,observe=params.get('observe'),inspect=params.get('inspect'),demo=params.get('demo')==='1';
let identity,cloud,stopPresence=()=>{},source;
const sandboxHistory=[];
async function importProgress(raw){
 try{decodeSave(demoContent,raw);return raw;}catch(error){if(error.code!=='CONTENT_VERSION')throw error;}
 const indexResponse=await fetch('./levels/index.json',{cache:'no-cache'});if(!indexResponse.ok)throw Error('旧版卷宗目录暂不可用');
 const entries=(await indexResponse.json()).levels,legacy=entries.find(item=>item.archived&&item.version<demoContent.version&&item.slug===levelSlug.replace(/-demo$/,'-legacy'));
 if(!legacy)throw Error('未找到可校验的旧版本卷宗，原存档未改变');
 const response=await fetch(`./levels/${legacy.slug}/content.json`,{cache:'no-cache'});if(!response.ok)throw Error('旧版卷宗暂不可用');const text=await response.text();
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 if(hash!==legacy.contentSha256)throw Error('旧版卷宗校验失败，请刷新后重试');
 const oldContent=JSON.parse(text),preview=previewMigration(oldContent,demoContent,raw);
 const consent=await new Promise(resolve=>{const dialog=node('dialog'),title=node('h2','导入旧版进度前，请确认迁移'),buttons=node('div',undefined,'actions');dialog.setAttribute('aria-label','旧存档迁移预览');dialog.append(title,node('p',`原进度：${oldContent.stages[preview.oldStage]?.title||preview.oldStage} · v${preview.fromVersion}`),node('p',`新版起点：${demoContent.stages[preview.targetStage]?.title||preview.targetStage} · v${preview.toVersion}`),node('p',preview.summary),node('p','同意后会替换本次正在游玩的进度，旧 JSON 原件另存本机备份；取消则保留当前进度。'));const finish=value=>{dialog.close();dialog.remove();resolve(value);};buttons.append(action('取消，保留当前进度',()=>finish(false)),action('同意迁移并导入',()=>finish(true)));dialog.append(buttons);dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});document.getElementById('game').append(dialog);dialog.showModal();});
 if(!consent)return null;
 localStorage.setItem(`jiaohun.migration-original.${identity.id}.${levelSlug}.${Date.now()}`,raw);
 return preview.convertedSave;
}
if(observe||demo){
 try{const result=await api('operator/me?role=presenter');identity={id:'presenter:'+result.operator.name,name:result.operator.name};}
 catch{location.replace('./operator.html?role=presenter');await new Promise(()=>{});}
}else if(inspect){
 try{const result=await api('operator/me?role=inspector');identity={id:'inspector:'+result.operator.name,name:result.operator.name};}
 catch{location.replace('./operator.html?role=inspector');await new Promise(()=>{});}
}else identity=await requirePlayer();
export const gamePlatform={
 ready:false,readOnly:Boolean(observe),sandbox:false,
 storageKey:`jiaohun.play.v2.${identity.id}.${demo?'demo':observe?'observer':inspect?'inspector':'player'}.${levelSlug}.${demoContent.version}`,
 restartMessage:demo?'重新开始这份独立演示？真实玩家的存档不受影响。':inspect?'重新载入该玩家存档起点？不会影响玩家本人进度。':'重新开始会替换当前账号此关的进度。需要保留时请先导出备用存档。',
 onSave:save=>cloud?.queue(save),flush:()=>cloud?.flush(),
 onBeforeAct:state=>{if(!gamePlatform.sandbox)return;try{sandboxHistory.push(structuredClone(state));if(sandboxHistory.length>400)sandboxHistory.shift();}catch{}},
 importSave:importProgress,
 async onReady(controller){
  const status=document.getElementById('cloud-status');
  try{
   if(inspect){
    // 检修沙盒：载入玩家存档副本，用本地引擎自由前后推进；只在本标签页，不写回玩家。
    if(!/^\d+$/.test(inspect))throw Error('检修查看参数无效');
    try{
     const pack=await api(`diagnostics/players/${encodeURIComponent(inspect)}/save?slug=${encodeURIComponent(levelSlug)}`);
     if(pack.slug&&pack.slug!==levelSlug){const next=new URL(location.href);next.searchParams.set('level',pack.slug);location.replace(next.href);return;}
     controller.restore(pack.save);
     gamePlatform.ready=true;gamePlatform.readOnly=false;gamePlatform.sandbox=true;
     gamePlatform.undo=()=>{const previous=sandboxHistory.pop();if(!previous)return false;controller.setState(previous);return true;};
     status.textContent=`检修沙盒 · 玩家 #${pack.playerId} · ${pack.stageTitle||''} · 可自由推进，改动不会写回玩家存档`;
     const sandboxKey=event=>{
      if(event.target&&['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName))return;
      if(event.key!=='Backspace'||event.metaKey||event.ctrlKey||event.altKey)return;
      const previous=sandboxHistory.pop();
      if(previous){event.preventDefault();controller.setState(previous);status.textContent='检修沙盒 · 已回退一步（Backspace 可连续回退）';}
      else status.textContent='检修沙盒 · 已经回到载入时的状态';
     };
     addEventListener('keydown',sandboxKey);
     addEventListener('pagehide',()=>removeEventListener('keydown',sandboxKey),{once:true});
    }catch(error){
     const text=node('p',error.status===401?'检修登录已失效，请返回检修入口。':'无法载入该进度：'+(error.message||'未知原因'),'observer-message');
     text.setAttribute('role','status');document.getElementById('game').replaceChildren(text);
    }
   }else if(observe){
    const room=params.get('room');if(!room||!/^\d+$/.test(observe))throw Error('观察参数无效');
    let busy=false,again=false,last=-1,stopped=false;
    function stop(message){if(stopped)return;stopped=true;gamePlatform.stopped=true;source?.close();const text=node('p',message,'observer-message');text.setAttribute('role','status');document.getElementById('game').replaceChildren(text);}
    async function refresh(){
     if(stopped)return;if(busy){again=true;return;}busy=true;
     try{const result=await api(`rooms/${encodeURIComponent(room)}/observe/${encodeURIComponent(observe)}`);if(result.migrationRequired){stop('该玩家需先在入口确认旧进度迁移。');return;}if(result.slug!==levelSlug){const next=new URL(location.href);next.searchParams.set('level',result.slug);location.replace(next.href);return;}if(result.revision!==last){last=result.revision;controller.showView(result.view);}status.textContent='只读观察 · 操作由玩家完成';}
     catch(error){stop(error.status===401?'展示登录已失效，请返回大屏入口。':'当前玩家已退出展示、尚未开始或此场次已结束。');}
     finally{busy=false;if(again){again=false;refresh();}}
    }
    await refresh();if(stopped)return;
    source=new EventSource(new URL(`./api/v2/rooms/${encodeURIComponent(room)}/events`,location.href),{withCredentials:true});
    const update=event=>{try{const value=JSON.parse(event.data);if(value.room?.closed||!value.members?.some(m=>String(m.id)===observe&&m.status!=='left')){stop('本次观察已结束，玩家存档保持不变。');return;}refresh();}catch{refresh();}};
    source.addEventListener('snapshot',update);source.addEventListener('change',update);source.addEventListener('error',()=>{status.textContent='观察连接中断，正在重连……';});
   }else{
    cloud=await connectProgress({slug:levelSlug,identity,contentVersion:demoContent.version,mode:demo?'demo':'player',status,onBlocked:()=>{gamePlatform.ready=false;controller.notice("旧版存档需要在入口确认迁移；本机进度保留，可先导出备用。");},onRestore:save=>controller.restore(save)});
    gamePlatform.ready=true;
    if(!demo){stopPresence=startRoomPresence(levelSlug,identity.id);const leave=document.getElementById('leave-room');leave.hidden=!roomId();leave.addEventListener('click',async()=>{try{await leaveRoom(identity.id);stopPresence();leave.hidden=true;controller.notice('已退出本次展示，可继续私下游玩。');}catch(error){controller.notice(error.message);}});}
   }
  }catch(error){status.textContent=error.message;if(error.code==='MIGRATION_REQUIRED'||error.status===428){controller.notice(error.message);gamePlatform.ready=false;const back=node('a','返回入口查看迁移说明');back.href='./';status.replaceChildren(back);return;}controller.notice('网络暂不可用，请保留本机进度或导出备份。');if(!observe&&!inspect)gamePlatform.ready=true;}
 }
};
window.addEventListener('pagehide',()=>{cloud?.flush(true);stopPresence();source?.close();});

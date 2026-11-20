import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeSave,encodeSave} from './core/save.mjs';
import {previewMigration} from './core/migrate.mjs';
import {getView,createGame,dispatch,validateContent} from './core/engine.mjs';
import {openStore,normalize,validName,validSecret,validAvatar,sha,hashSecret,checkSecret,recoveryCode,createOperator} from './network/store.mjs';
export {createOperator} from './network/store.mjs';
const durations={player:7*86400000,presenter:8*3600000,inspector:30*60000},cookieName=role=>'jiaohun_'+role+'_v2';
const safeSlug=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function createSaveService({site,data,allowedOrigins=[],clock=Date.now,secureCookies=true}){
 const db=openStore(data),catalog=JSON.parse(readFileSync(resolve(site,'levels/index.json'),'utf8')).levels;
 const contents=new Map(catalog.map(level=>[level.slug,JSON.parse(readFileSync(resolve(site,'levels',level.slug,'content.json'),'utf8'))]));
 for(const [slug,content] of contents)if(!safeSlug.test(slug)||validateContent(content).length)throw Error('关卡目录不可用');
 const rates=new Map(),subscribers=new Set(),progressCache=new Map();let passwordJobs=0,closed=false;
 const nowISO=()=>new Date(clock()).toISOString();
 function rate(key,max,window=60000){let entry=rates.get(key);if(!entry||clock()-entry.start>window){entry={start:clock(),count:0};rates.set(key,entry);}if(rates.size>10000)for(const [k,v] of rates)if(clock()-v.start>3600000)rates.delete(k);return ++entry.count<=max;}
 function fail(status,error,field){const e=Error(error);Object.assign(e,{status,field});throw e;}
 function auth(req,role,identityRequired=false){
  const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('='))),token=cookies[cookieName(role)];
  if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))fail(401,'请先登录');
  const session=db.prepare('SELECT * FROM sessions WHERE token_hash=? AND role=? AND expires_at>?').get(sha(token),role,clock());
  if(!session)fail(401,'登录已失效，请重新登录');
  const subject=db.prepare(role==='player'?'SELECT * FROM players WHERE id=?':'SELECT * FROM operators WHERE id=? AND role=?').get(...(role==='player'?[session.subject_id]:[session.subject_id,role]));
  if(!subject)fail(401,'登录已失效，请重新登录');
  const expected=req.headers[role==='player'?'x-player-id':'x-operator-name'];
  if(identityRequired&&typeof expected!=='string')fail(401,'页面账号身份缺失，请返回入口重新登录');
  if(expected!==undefined){
   let matches=false;
   if(typeof expected==='string')try{matches=role==='player'?expected===String(subject.id):normalize(decodeURIComponent(expected))===subject.normalized;}catch{}
   if(!matches)fail(401,'账号已在其他标签页切换，请保留本机进度后返回入口重新登录');
  }
  return {...subject,sessionHash:sha(token),expiresAt:session.expires_at};
 }
 function setSession(res,role,id){
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(clock());
  const token=randomBytes(32).toString('base64url');db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sha(token),role,id,clock()+durations[role]);
  res.setHeader('Set-Cookie',`${cookieName(role)}=${token}; Path=/game/; HttpOnly; ${secureCookies?'Secure; ':''}SameSite=${role==='player'?'Lax':'Strict'}; Max-Age=${durations[role]/1000}`);
 }
 function clearSession(req,res,role){const person=auth(req,role,true);db.prepare('DELETE FROM sessions WHERE token_hash=?').run(person.sessionHash);for(const client of subscribers)if(client.sessionHash===person.sessionHash){client.res.end();subscribers.delete(client);}res.setHeader('Set-Cookie',`${cookieName(role)}=; Path=/game/; HttpOnly; ${secureCookies?'Secure; ':''}SameSite=${role==='player'?'Lax':'Strict'}; Max-Age=0`);}
 const playerInfo=p=>({id:p.id,name:p.name,avatarId:p.avatar_id});
 const progress=player=>{
  const rows=db.prepare('SELECT slug,version,revision,updated_at FROM saves WHERE player=? ORDER BY slug').all(player),signature=JSON.stringify(rows),cached=progressCache.get(player);
  if(cached?.signature===signature)return cached.value.map(item=>({...item}));
  const value=rows.map(row=>{let stageTitle='旧版本进度',kind='unknown';try{const saved=db.prepare('SELECT save FROM saves WHERE player=? AND slug=?').get(player,row.slug),active=contents.get(row.slug),matched=active?.version===row.version?active:[...contents.values()].find(c=>c.id===active?.id&&c.version===row.version),view=getView(matched,decodeSave(matched,saved.save));stageTitle=view.stageTitle;kind=view.kind;}catch{}return {slug:row.slug,title:contents.get(row.slug)?.title||row.slug,contentVersion:row.version,version:row.version,migrationRequired:row.version!==contents.get(row.slug)?.version,revision:row.revision,stageTitle,kind,updatedAt:row.updated_at};});
  progressCache.set(player,{signature,value});return value.map(item=>({...item}));
 };
 function getRoom(id){const row=db.prepare('SELECT * FROM rooms WHERE id=?').get(id);if(!row)fail(404,'没有找到本次展示');return row;}
 function ownedRoom(req,id,identityRequired=false){const op=auth(req,'presenter',identityRequired),room=getRoom(id);if(room.owner!==op.id)fail(403,'无权查看此场次');return room;}
 const roomInfo=r=>({id:r.id,title:r.title,closed:Boolean(r.closed)});
 function snapshot(id){
  const room=getRoom(id);
  const members=room.closed?[]:db.prepare('SELECT m.*,p.name,p.avatar_id FROM memberships m JOIN players p ON m.player=p.id WHERE room=? ORDER BY m.joined_at,p.id').all(id).map(m=>{
   let item;if(m.active){const list=progress(m.player);item=(m.slug&&list.find(p=>p.slug===m.slug))||list.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];}else{try{item=JSON.parse(m.last_snapshot||'null');}catch{}}
   return {id:m.player,name:m.name,avatarId:m.avatar_id,status:!m.active?'left':clock()-m.last_seen>90000?'away':'online',stageTitle:item?.stageTitle||'尚未开始',kind:item?.kind||'waiting',slug:item?.slug||null,updatedAt:item?.updatedAt||m.joined_at};
  });
  const events=room.closed?[]:db.prepare('SELECT id,type,name,at FROM room_events WHERE room=? ORDER BY id DESC LIMIT 30').all(id).reverse();return {room:roomInfo(room),members,events};
 }
 function event(room,type,name){db.prepare('INSERT INTO room_events(room,type,name,at) VALUES(?,?,?,?)').run(room,type,name,nowISO());db.prepare('DELETE FROM room_events WHERE room=? AND id NOT IN (SELECT id FROM room_events WHERE room=? ORDER BY id DESC LIMIT 500)').run(room,room);}
 function emitRoom(id){
  const value=snapshot(id),text=JSON.stringify(value);
  for(const client of subscribers)if(client.room===id&&text!==client.last){if(client.expiresAt<=clock()||!db.prepare('SELECT token_hash FROM sessions WHERE token_hash=?').get(client.sessionHash)){client.res.end();subscribers.delete(client);continue;}client.last=text;client.res.write(`event: change\ndata: ${text}\n\n`);if(value.room.closed){client.res.end();subscribers.delete(client);}}
 }
 function playerChanged(id){for(const row of db.prepare('SELECT room FROM memberships WHERE player=? AND active=1').all(id))emitRoom(row.room);}
 async function passwordTask(fn){if(passwordJobs>=4)fail(429,'验证繁忙，请稍后再试');passwordJobs++;try{return await fn();}finally{passwordJobs--;}}
 async function passwordMatch(secret,hash){return passwordTask(()=>checkSecret(secret,hash));}
 function validCredentials(body){if(!validName(body.name))fail(400,'用户名需为2—24字符，不含控制符或尖括号','name');if(!validSecret(body.secret))fail(400,'密码需为8—128字符','secret');}
 async function bodyOf(req){
  if(!['POST','PUT'].includes(req.method))return {};
  if(!req.headers['content-type']?.startsWith('application/json'))fail(415,'仅接受 JSON');
  const parts=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2300000)fail(413,'请求内容过大');parts.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{fail(400,'JSON 格式无效');}
 }
 function saveFor(subject,slug,demo=false){return db.prepare(`SELECT version,revision,save,updated_at FROM ${demo?'demos':'saves'} WHERE ${demo?'operator':'player'}=? AND slug=?`).get(subject,slug);}
 function diagnosticChecks(){
  const checks=[{name:'认证数据结构与隔离角色',ok:['players','operators','sessions','rooms'].every(table=>Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)))},{name:'持久数据库一致性',ok:db.prepare('PRAGMA quick_check').get().quick_check==='ok'}];
  for(const [slug,content] of contents){
   checks.push({name:`${slug} 内容契约`,ok:validateContent(content).length===0});
   try{const initial=createGame(content),moved=dispatch(content,initial,{type:'NEXT_DIALOGUE'}),saved=encodeSave(content,moved.ok?moved.state:initial),restored=decodeSave(content,saved);checks.push({name:`${slug} 隔离存档往返`,ok:restored.contentId===content.id});}catch{checks.push({name:`${slug} 隔离存档往返`,ok:false});}
   try{const manifest=JSON.parse(readFileSync(resolve(site,'levels',slug,'manifest.json'),'utf8'));let ok=true;
    for(const asset of manifest.assets||[]){const file=resolve(site,asset.file);if(!file.startsWith(resolve(site,'levels',slug,'assets')+sep)||!/^levels\/[a-z0-9-]+\/assets\/[A-Za-z0-9_-]+\.(png|jpg|webp)$/.test(asset.file)||!existsSync(file)||statSync(file).size!==asset.bytes||sha(readFileSync(file))!==asset.sha256){ok=false;break;}}
    checks.push({name:`${slug} 资源大小与哈希`,ok});
   }catch{checks.push({name:`${slug} 资源清单`,ok:false});}
  }
  return checks;
 }
 const server=http.createServer(async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(value));};
  try{
   const url=new URL(req.url,'http://localhost'),path=url.pathname;
   if(['/api/v1/health','/api/v2/health'].includes(path)&&req.method==='GET')return send(200,{ok:true,release:'content-v2',contentVersion:contents.get('xiaoshan-demo')?.version??null,upgradeBackupReady:existsSync(resolve(data,'pre-content-v2-backup.sqlite'))});
   if(path.startsWith('/api/v1/'))return send(410,{error:'旧的无密码入口已停用，请刷新后创建或登录账号'});
   if(!path.startsWith('/api/v2/'))return send(404,{error:'没有这个接口'});
   if(req.headers.origin&&!allowedOrigins.includes(req.headers.origin))fail(403,'来源不允许');if(req.headers['sec-fetch-site']==='cross-site')fail(403,'请从游戏页面操作');
   const address=req.socket.remoteAddress||'local';if(!rate('all:'+address,2400))fail(429,'操作过于频繁，请稍后再试');const body=await bodyOf(req);
   if(['/api/v2/auth/register','/api/v2/auth/login','/api/v2/auth/recover','/api/v2/operator/login'].includes(path)&&req.method==='POST')if(!rate('auth-ip:'+address,300,3600000)||!rate('auth-name:'+sha(normalize(body.name)),20,900000))fail(429,'验证次数过多，请稍后再试');
   if(path==='/api/v2/auth/register'&&req.method==='POST'){
    validCredentials(body);if(!validAvatar(body.avatarId))fail(400,'请选择有效头像','avatarId');if(db.prepare('SELECT id FROM players WHERE normalized=?').get(normalize(body.name)))fail(409,'用户名已被使用，请登录或换一个用户名','name');
    if(db.prepare('SELECT COUNT(*) AS count FROM players').get().count>=2000)fail(503,'账号名额已满，请联系维护者');const hash=await passwordTask(()=>hashSecret(body.secret)),recovery=recoveryCode();
    if(db.prepare('SELECT id FROM players WHERE normalized=?').get(normalize(body.name)))fail(409,'用户名已被使用，请登录或换一个用户名','name');if(db.prepare('SELECT COUNT(*) AS count FROM players').get().count>=2000)fail(503,'账号名额已满，请联系维护者');
    const id=Number(db.prepare('INSERT INTO players(name,normalized,avatar_id,secret_hash,recovery_hash,created_at) VALUES(?,?,?,?,?,?)').run(body.name.normalize('NFKC').trim(),normalize(body.name),body.avatarId,hash,sha(recovery),nowISO()).lastInsertRowid);
    setSession(res,'player',id);return send(201,{player:playerInfo(db.prepare('SELECT * FROM players WHERE id=?').get(id)),recoveryCode:recovery});
   }
   if(path==='/api/v2/auth/login'&&req.method==='POST'){
    validCredentials(body);const player=db.prepare('SELECT * FROM players WHERE normalized=?').get(normalize(body.name));if(!await passwordMatch(body.secret,player?.secret_hash)||!player||db.prepare('SELECT secret_hash FROM players WHERE id=?').get(player.id)?.secret_hash!==player.secret_hash)fail(401,'用户名或密码不正确','secret');setSession(res,'player',player.id);return send(200,{player:playerInfo(player)});
   }
   if(path==='/api/v2/auth/recover'&&req.method==='POST'){
    if(!validName(body.name)||!validSecret(body.newSecret)||typeof body.recoveryCode!=='string')fail(400,'请填写用户名、恢复码和8—128字符的新密码');const player=db.prepare('SELECT * FROM players WHERE normalized=?').get(normalize(body.name));
    const supplied=Buffer.from(sha(body.recoveryCode),'hex'),expected=Buffer.from(player?.recovery_hash||'0'.repeat(64),'hex');if(!timingSafeEqual(supplied,expected)||!player)fail(401,'用户名或恢复码不正确');
    const hash=await passwordTask(()=>hashSecret(body.newSecret)),recovery=recoveryCode(),updated=db.prepare('UPDATE players SET secret_hash=?,recovery_hash=? WHERE id=? AND recovery_hash=?').run(hash,sha(recovery),player.id,player.recovery_hash);if(updated.changes!==1)fail(401,'用户名或恢复码不正确');db.prepare("DELETE FROM sessions WHERE role='player' AND subject_id=?").run(player.id);return send(200,{recoveryCode:recovery});
   }
   if(path==='/api/v2/auth/me'&&req.method==='GET'){const player=auth(req,'player');return send(200,{player:playerInfo(player),progress:progress(player.id)});}
   if(path==='/api/v2/auth/logout'&&req.method==='POST'){clearSession(req,res,'player');return send(200,{ok:true});}
   if(path==='/api/v2/auth/secret'&&req.method==='POST'){
    const player=auth(req,'player',true);if(!validSecret(body.oldSecret)||!validSecret(body.newSecret)||!await passwordMatch(body.oldSecret,player.secret_hash))fail(400,'原密码不正确或新密码格式无效');const hash=await passwordTask(()=>hashSecret(body.newSecret)),recovery=recoveryCode();if(db.prepare('UPDATE players SET secret_hash=?,recovery_hash=? WHERE id=? AND secret_hash=?').run(hash,sha(recovery),player.id,player.secret_hash).changes!==1)fail(401,'密码已在其他操作中改变，请重新登录');db.prepare("DELETE FROM sessions WHERE role='player' AND subject_id=?").run(player.id);setSession(res,'player',player.id);return send(200,{recoveryCode:recovery});
   }
   if(path==='/api/v2/operator/login'&&req.method==='POST'){
    if(!['presenter','inspector'].includes(body.role)||!validName(body.name)||!validSecret(body.password))fail(400,'请填写有效角色、账号和密码');const op=db.prepare('SELECT * FROM operators WHERE normalized=? AND role=?').get(normalize(body.name),body.role);if(!await passwordMatch(body.password,op?.secret_hash)||!op||db.prepare('SELECT secret_hash FROM operators WHERE id=?').get(op.id)?.secret_hash!==op.secret_hash)fail(401,'账号或密码不正确');setSession(res,body.role,op.id);return send(200,{operator:{name:op.name,role:body.role}});
   }
   if(path==='/api/v2/operator/me'&&req.method==='GET'){const role=url.searchParams.get('role');if(!['presenter','inspector'].includes(role))fail(400,'角色无效');const op=auth(req,role);return send(200,{operator:{name:op.name,role}});}
   if(path==='/api/v2/operator/logout'&&req.method==='POST'){if(!['presenter','inspector'].includes(body.role))fail(400,'角色无效');clearSession(req,res,body.role);return send(200,{ok:true});}
   const saveMatch=path.match(/^\/api\/v2\/(saves|demo)\/([a-z0-9-]+)$/);
   if(saveMatch){
    const demo=saveMatch[1]==='demo',slug=saveMatch[2],subject=auth(req,demo?'presenter':'player',true);if(!contents.has(slug))fail(404,'没有这个关卡');const current=saveFor(subject.id,slug,demo);
    if(req.method==='GET')return send(200,current?{version:current.version,migrationRequired:current.version!==contents.get(slug).version,revision:current.revision,save:current.save,updatedAt:current.updated_at}:{revision:0,save:null});if(req.method!=='PUT')fail(405,'不支持这项操作');if(current&&current.version!==contents.get(slug).version)return send(428,{error:'旧版本进度必须先预览并明确同意迁移，不能直接覆盖',migrationRequired:true,version:current.version});if(!Number.isSafeInteger(body.revision)||body.revision<0||typeof body.save!=='string')fail(400,'存档请求无效');
    if(body.revision!==(current?.revision??0))return send(409,{error:'另一设备已有新进度，请选择要保留哪一份',revision:current?.revision??0,save:current?.save??null});const content=contents.get(slug);try{decodeSave(content,body.save);}catch{fail(400,'存档未通过格式、剧情版本或状态校验');}
    const revision=body.revision+1,now=nowISO(),table=demo?'demos':'saves',owner=demo?'operator':'player';db.prepare(`INSERT INTO ${table}(${owner},slug,version,revision,save,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(${owner},slug) DO UPDATE SET version=excluded.version,revision=excluded.revision,save=excluded.save,updated_at=excluded.updated_at`).run(subject.id,slug,content.version,revision,body.save,now);if(!demo)playerChanged(subject.id);return send(200,{revision,updatedAt:now});
   }
   if(path==='/api/v2/rooms'&&req.method==='POST'){
    const op=auth(req,'presenter',true);if(typeof body.title!=='string'||!body.title.trim()||body.title.length>60)fail(400,'场次标题需为1—60字符','title');if(db.prepare('SELECT count(*) AS n FROM rooms WHERE owner=? AND closed=0').get(op.id).n>=10)fail(409,'请先结束已有展示场次');const id=randomBytes(16).toString('hex');db.prepare('INSERT INTO rooms(id,title,owner,created_at) VALUES(?,?,?,?)').run(id,body.title.trim(),op.id,nowISO());return send(201,{room:roomInfo(getRoom(id))});
   }
   if(path==='/api/v2/rooms'&&req.method==='GET'){const op=auth(req,'presenter');return send(200,{rooms:db.prepare('SELECT * FROM rooms WHERE owner=? ORDER BY created_at DESC LIMIT 50').all(op.id).map(roomInfo)});}
   const publicRoom=path.match(/^\/api\/v2\/rooms\/public\/([a-f0-9]{32})$/);if(publicRoom&&req.method==='GET')return send(200,roomInfo(getRoom(publicRoom[1])));
   const roomMatch=path.match(/^\/api\/v2\/rooms\/([a-f0-9]{32})(?:\/(close|join|leave|heartbeat|events|observe)(?:\/([0-9]+))?)?$/);
   if(roomMatch){
    const [,id,action,playerId]=roomMatch;
    if(['join','leave','heartbeat'].includes(action)&&req.method==='POST'){
     const player=auth(req,'player',true),room=getRoom(id);if(room.closed)fail(410,'本次展示已结束，个人游戏仍可继续');const member=db.prepare('SELECT * FROM memberships WHERE room=? AND player=?').get(id,player.id);
     if(action==='join'){if(body.consent!==true)fail(400,'请确认加入展示及只读观察说明');db.prepare('INSERT INTO memberships(room,player,joined_at,last_seen,active) VALUES(?,?,?,?,1) ON CONFLICT(room,player) DO UPDATE SET last_seen=excluded.last_seen,active=1,last_snapshot=NULL').run(id,player.id,nowISO(),clock());if(!member?.active)event(id,'joined',player.name);emitRoom(id);return send(200,{room:roomInfo(room)});}
     if(!member?.active)fail(403,'你尚未加入本次展示');if(action==='leave'){const shared=snapshot(id).members.find(m=>m.id===player.id),frozen=JSON.stringify({stageTitle:shared?.stageTitle,kind:shared?.kind,slug:shared?.slug,updatedAt:shared?.updatedAt});db.prepare('UPDATE memberships SET active=0,last_snapshot=? WHERE room=? AND player=?').run(frozen,id,player.id);event(id,'left',player.name);emitRoom(id);return send(200,{ok:true});}
     if(body.slug!==undefined&&!contents.has(body.slug))fail(400,'关卡无效');db.prepare('UPDATE memberships SET last_seen=?,slug=COALESCE(?,slug) WHERE room=? AND player=?').run(clock(),body.slug??null,id,player.id);emitRoom(id);return send(200,{ok:true});
    }
    const room=ownedRoom(req,id,action==='close');if(!action&&req.method==='GET')return send(200,snapshot(id));
    if(action==='close'&&req.method==='POST'){db.prepare('UPDATE rooms SET closed=1 WHERE id=?').run(id);emitRoom(id);return send(200,{room:roomInfo(getRoom(id))});}
    if(action==='observe'&&req.method==='GET'){
     if(room.closed)fail(410,'本次展示已结束');if(!playerId)fail(404,'请指定本场玩家');const member=db.prepare('SELECT * FROM memberships WHERE room=? AND player=? AND active=1').get(id,Number(playerId));if(!member)fail(404,'该玩家未加入本次展示');const items=progress(Number(playerId)),selected=member.slug&&items.find(p=>p.slug===member.slug)||items.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
     if(!selected)return send(200,{view:null,slug:null,revision:0});if(selected.migrationRequired)return send(200,{view:null,slug:selected.slug,revision:selected.revision,migrationRequired:true});const stored=saveFor(Number(playerId),selected.slug),view=getView(contents.get(selected.slug),decodeSave(contents.get(selected.slug),stored.save));return send(200,{view,slug:selected.slug,revision:stored.revision});
    }
    if(action==='events'&&req.method==='GET'){
     if(room.closed)fail(410,'本次展示已结束');if(subscribers.size>=100)fail(503,'展示连接已满');const person=auth(req,'presenter'),value=snapshot(id),text=JSON.stringify(value);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(`event: snapshot\ndata: ${text}\n\n`);const client={room:id,res,last:text,sessionHash:person.sessionHash,expiresAt:person.expiresAt};subscribers.add(client);req.on('close',()=>subscribers.delete(client));return;
    }
    fail(405,'不支持这项操作');
   }
   const migration=path.match(/^\/api\/v2\/migrations\/([a-z0-9-]+)\/(preview|commit)$/);
   if(migration){
    const player=auth(req,'player',true),slug=migration[1],current=saveFor(player.id,slug),newContent=contents.get(slug);
    if(!current||!newContent)fail(404,'没有可迁移进度');
    if(current.version===newContent.version)return send(200,{alreadyMigrated:true,revision:current.revision});
    const oldContent=JSON.parse(readFileSync(resolve(site,'levels/xiaoshan-legacy/content.json'),'utf8'));
    const preview=previewMigration(oldContent,newContent,current.save),previewId=sha(player.id+':'+slug+':'+current.revision+':'+current.save);
    if(migration[2]==='preview'&&req.method==='GET'){const {convertedSave,...summary}=preview;return send(200,{...summary,sourceStageTitle:oldContent.stages[preview.oldStage]?.title,targetStageTitle:newContent.stages[preview.targetStage]?.title,revision:current.revision,previewId});}
    if(migration[2]!=='commit'||req.method!=='POST')fail(405,'不支持此操作');
    if(body.consent!==true||body.revision!==current.revision||body.previewId!==previewId)fail(409,'请重新预览并明确确认迁移');
    db.exec('BEGIN IMMEDIATE');try{
     const fresh=saveFor(player.id,slug);if(fresh.revision!==current.revision||fresh.save!==current.save)fail(409,'进度已改变，请重新预览');
     const archived=db.prepare('SELECT save FROM save_archives WHERE player=? AND slug=? AND version=? AND revision=?').get(player.id,slug,current.version,current.revision);if(archived&&archived.save!==current.save)fail(409,'已有归档与当前原件不一致，停止迁移并保留两者');
     db.prepare('INSERT OR IGNORE INTO save_archives(player,slug,version,revision,save,archived_at) VALUES(?,?,?,?,?,?)').run(player.id,slug,current.version,current.revision,current.save,nowISO());
     db.prepare('UPDATE saves SET version=?,revision=?,save=?,updated_at=? WHERE player=? AND slug=? AND revision=?').run(newContent.version,current.revision+1,preview.convertedSave,nowISO(),player.id,slug,current.revision);db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    playerChanged(player.id);return send(200,{revision:current.revision+1,migrated:true});
   }
   if(path==='/api/v2/diagnostics/players'&&req.method==='GET'){
    auth(req,'inspector',true);const positive=(name,fallback,max)=>{const n=Number(url.searchParams.get(name));return Number.isSafeInteger(n)&&n>0?Math.min(n,max):fallback;},page=positive('page',1,2000),pageSize=positive('pageSize',20,50),q=(url.searchParams.get('q')||'').slice(0,100);
    const rows=db.prepare('SELECT id,name,avatar_id,created_at FROM players WHERE name LIKE ? ORDER BY id LIMIT ? OFFSET ?').all('%'+q+'%',pageSize,(page-1)*pageSize);
    return send(200,{page,pageSize,total:db.prepare('SELECT count(*) AS n FROM players WHERE name LIKE ?').get('%'+q+'%').n,players:rows.map(p=>({id:p.id,name:p.name,avatarId:p.avatar_id,createdAt:p.created_at,progress:progress(p.id)}))});
   }
   if(path==='/api/v2/diagnostics/health'&&req.method==='GET'){auth(req,'inspector');return send(200,{ok:true,version:'network-v2',database:'ready',upgradeBackupReady:existsSync(resolve(data,'pre-content-v2-backup.sqlite')),upgradeBackupAt:existsSync(resolve(data,'pre-content-v2-backup.sqlite'))?statSync(resolve(data,'pre-content-v2-backup.sqlite')).mtime.toISOString():null,levels:catalog.length,checks:diagnosticChecks()});}
   if(path==='/api/v2/diagnostics/run'&&req.method==='POST'){
    const op=auth(req,'inspector',true);if(!rate('diagnostics:'+op.id,5))fail(429,'检修任务过于频繁');const checks=diagnosticChecks(),id=randomBytes(16).toString('hex'),result={id,status:checks.every(c=>c.ok)?'passed':'failed',checks,isolated:true,createdAt:nowISO()};db.prepare('INSERT INTO diagnostic_runs VALUES(?,?,?,?)').run(id,op.id,JSON.stringify(result),nowISO());db.prepare('DELETE FROM diagnostic_runs WHERE owner=? AND id NOT IN (SELECT id FROM diagnostic_runs WHERE owner=? ORDER BY created_at DESC LIMIT 20)').run(op.id,op.id);return send(200,result);
   }
   const run=path.match(/^\/api\/v2\/diagnostics\/runs\/([a-f0-9]{32})$/);if(run&&req.method==='GET'){const op=auth(req,'inspector'),row=db.prepare('SELECT result FROM diagnostic_runs WHERE id=? AND owner=?').get(run[1],op.id);if(!row)fail(404,'没有此检修记录');return send(200,JSON.parse(row.result));}
   const observeAsInspector=path.match(/^\/api\/v2\/diagnostics\/players\/(\d+)\/observe$/);
   if(observeAsInspector&&req.method==='GET'){
    // 检修只读查看任意玩家的任意进度：不依赖展示房间，不改动存档。
    auth(req,'inspector');const playerId=Number(observeAsInspector[1]),wanted=url.searchParams.get('slug')||'',list=progress(playerId),selected=(wanted&&list.find(item=>item.slug===wanted))||list.slice().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
    if(!selected)return send(200,{view:null,slug:null,revision:0,playerId});
    if(selected.migrationRequired)return send(200,{view:null,slug:selected.slug,revision:selected.revision,migrationRequired:true,playerId});
    const content=contents.get(selected.slug);if(!content)fail(404,'关卡不存在');const stored=saveFor(playerId,selected.slug);if(!stored)return send(200,{view:null,slug:selected.slug,revision:0,playerId});
    return send(200,{view:getView(content,decodeSave(content,stored.save)),slug:selected.slug,revision:stored.revision,playerId});
   }
   const saveAsInspector=path.match(/^\/api\/v2\/diagnostics\/players\/(\d+)\/save$/);
   if(saveAsInspector&&req.method==='GET'){
    // 检修沙盒：把原始存档交给前端本地引擎，可自由前后推进；只读副本，不写回玩家。
    auth(req,'inspector');const playerId=Number(saveAsInspector[1]),wanted=url.searchParams.get('slug')||'',list=progress(playerId),selected=(wanted&&list.find(item=>item.slug===wanted))||list.slice().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
    if(!selected)fail(404,'该玩家没有可查看的进度');if(selected.migrationRequired)fail(409,'该进度需先在玩家入口确认迁移');
    const content=contents.get(selected.slug);if(!content)fail(404,'关卡不存在');const stored=saveFor(playerId,selected.slug);if(!stored)fail(404,'没有找到该进度存档');
    return send(200,{slug:selected.slug,version:stored.version,revision:stored.revision,save:stored.save,playerId,stageTitle:selected.stageTitle});
   }
   fail(404,'没有这个接口');
  }catch(error){if(!res.headersSent)send(error.status||500,{error:error.status?error.message:'服务暂不可用，请保留本机进度后稍后重试',...(error.field?{field:error.field}:{})});else res.end();}
 });
 const heartbeat=setInterval(()=>{if(closed)return;for(const client of subscribers){if(client.expiresAt<=clock()||!db.prepare('SELECT token_hash FROM sessions WHERE token_hash=?').get(client.sessionHash)){client.res.end();subscribers.delete(client);}else client.res.write(': keepalive\n\n');}for(const id of new Set([...subscribers].map(s=>s.room)))emitRoom(id);},20000);heartbeat.unref();
 return {server,db,createOperator:details=>createOperator(db,details),close:()=>new Promise(resolve=>{closed=true;clearInterval(heartbeat);for(const s of subscribers)s.res.end();subscribers.clear();server.close(()=>{db.close();resolve();});})};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=Object.fromEntries(process.argv.slice(2).map(v=>v.split('=')));if(!args['--site']||!args['--data'])throw Error('需要 --site=静态目录 --data=私有存档目录');
 const app=createSaveService({site:args['--site'],data:args['--data'],allowedOrigins:(process.env.GAME_ORIGINS||'').split(',').filter(Boolean),secureCookies:process.env.GAME_INSECURE_TEST_COOKIE!=='1'});app.server.listen(Number(process.env.PORT||4186),'127.0.0.1',()=>console.log('Game v2 service listening on loopback'));
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await app.close();process.exit(0);});
}

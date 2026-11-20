// LOCAL QA ONLY: isolated temporary database and fixture operator credentials.
// Never use this server, its insecure localhost cookies or its fixtures in production.
import http from 'node:http';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir,networkInterfaces} from 'node:os';
import {resolve,join,extname,sep} from 'node:path';
import {createSaveService} from '../network-server.mjs';
import {hashSecretSync} from '../network/store.mjs';
import {createGame,dispatch,getView} from '../core/engine.mjs';
import {encodeSave} from '../core/save.mjs';
const site=resolve(import.meta.dirname,'../../09_Builds/JiaoHun_Demo/site'),data=mkdtempSync(join(tmpdir(),'jiaohun-browser-qa-'));
const port=Number(process.env.JIAOHUN_PREVIEW_PORT||4188),host=process.env.JIAOHUN_PREVIEW_HOST||'127.0.0.1',origin=`http://${host}:${port}`;
const api=createSaveService({site,data,allowedOrigins:host==='0.0.0.0'
 ? [`http://127.0.0.1:${port}`,`http://localhost:${port}`,...Object.values(networkInterfaces()).flat().filter(i=>i&&i.family==='IPv4'&&!i.internal).map(i=>`http://${i.address}:${port}`)]
 : [origin],secureCookies:false});
for(const role of ['presenter','inspector'])api.createOperator({role,name:'qa-'+role,password:'LocalPreview123!'});
// Explicit synthetic fixtures in this disposable local-only database. Never
// import this preview tool into the production runtime or deployment bundle.
if(process.env.JIAOHUN_PREVIEW_SEED==='1'){
 const content=JSON.parse(readFileSync(resolve(site,'levels/xiaoshan-demo/content.json'),'utf8'));
 const old=JSON.parse(readFileSync(resolve(site,'levels/xiaoshan-legacy/content.json'),'utf8'));
 function atFinal(){let state=createGame(content);const visited=new Set();for(let count=0;count<5000;count++){
  const view=getView(content,state),stage=content.stages[state.stageId];if(state.stageId==='final_cut'&&!view.dialogue)return state;let action;
  if(view.dialogue)action={type:'NEXT_DIALOGUE'};
  else if(view.kind==='investigation'){const item=view.interactions.find(item=>!item.completed);if(item)action={type:'INTERACT',interactionId:item.id};else if(view.canAdvance)action={type:'ADVANCE_STAGE'};else{visited.add(state.stageId+':'+state.locationId);const location=view.locations.find(loc=>!visited.has(state.stageId+':'+loc.id));if(!location)throw Error('QA fixture investigation blocked');action={type:'MOVE',locationId:location.id};}}
  else if(view.kind==='hearing'){const rule=stage.rules.find(rule=>rule.statementId===view.statement.id&&(!rule.onceFlag||!state.flags.includes(rule.onceFlag))&&(rule.requires||[]).every(flag=>state.flags.includes(flag)));action=rule?{type:'PRESENT',...(rule.evidenceIds?{evidenceIds:rule.evidenceIds}:{evidenceId:rule.evidenceId})}:{type:'NEXT_STATEMENT'};}
  else throw Error('QA fixture ended early');const result=dispatch(content,state,action);if(!result.ok)throw Error(result.error);state=result.state;
 }throw Error('QA fixture exceeded guard');}
 for(const [index,name] of ['剧情控件验收','旧版迁移验收','初次调查验收'].entries()){
  const now=new Date().toISOString(),id=Number(api.db.prepare('INSERT INTO players(name,normalized,avatar_id,secret_hash,recovery_hash,created_at) VALUES(?,?,?,?,?,?)').run(name,name,'avatar-0'+(index+1),hashSecretSync('LocalPreview123!'),'0'.repeat(64),now).lastInsertRowid);
  const chosen=index===1?old:content,state=index===0?atFinal():createGame(chosen);
  api.db.prepare('INSERT INTO saves(player,slug,version,revision,save,updated_at) VALUES(?,?,?,?,?,?)').run(id,'xiaoshan-demo',chosen.version,1,encodeSave(chosen,state),now);
 }
}
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.jpg':'image/jpeg'};
const server=http.createServer((req,res)=>{
 let url;try{url=new URL(req.url,origin);}catch{res.writeHead(400).end();return;}
 if(url.pathname.startsWith('/game/api/')){req.url=url.pathname.slice(5)+url.search;api.server.emit('request',req,res);return;}
 if(url.pathname==='/'){res.writeHead(302,{Location:'/game/'}).end();return;}
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
 const rel=decodeURIComponent(url.pathname).replace(/^\/game\//,'');
 if(!url.pathname.startsWith('/game/')||rel.includes('\\')||rel.split('/').some(p=>p==='..'||p.startsWith('.'))){res.writeHead(403).end();return;}
 const path=resolve(site,rel||'index.html');if(!path.startsWith(site+sep)){res.writeHead(403).end();return;}
 try{const bytes=readFileSync(path);res.writeHead(200,{'Content-Type':types[extname(path)]||'text/plain; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; frame-ancestors 'self'; object-src 'none'",'X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);}catch{res.writeHead(404).end('Not found');}
});
server.listen(port,host,()=>console.log(`LOCAL QA ONLY ${origin}/game/ — disposable data, synthetic operator fixtures${host==='0.0.0.0'?'（已开放到局域网，仅限本机演示，勿用于生产）':''}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{api.db.close();rmSync(data,{recursive:true,force:true});process.exit(0);}));

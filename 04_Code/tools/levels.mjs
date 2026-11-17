import {readdir,readFile,writeFile,mkdir,copyFile,lstat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {validateContent} from '../core/engine.mjs';
export const MAX_ASSET_BYTES=8*1024*1024;
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function safeAssetPath(slug,file){return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)&&typeof file==='string'&&new RegExp(`^levels/${slug}/assets/[a-zA-Z0-9_-]+\\.(png|jpg|webp)$`).test(file);}
export async function validateLevel(root,slug){
 const base=resolve(root,'levels',slug);
 const read=async name=>{const path=resolve(base,name);if(!(await lstat(path)).isFile())throw Error('禁止符号链接或特殊文件');return JSON.parse(await readFile(path,'utf8'));};
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))throw Error('slug 无效');
 if(!(await lstat(base)).isDirectory()||(await lstat(base)).isSymbolicLink())throw Error('关卡目录无效');
 const manifest=await read('manifest.json'),content=await read('content.json');
 const errors=validateContent(content);if(errors.length)throw Error(errors.join('\n'));
 if(manifest.slug!==slug||manifest.title!==content.title||manifest.version!==content.version||manifest.license!=='CC-BY-NC-4.0'||typeof manifest.author!=='string'||!manifest.author.trim()||!Array.isArray(manifest.assets))throw Error('manifest 契约无效');
 const ids=new Set(),files=new Set();let total=0;
 for(const asset of manifest.assets){
  if(!/^(background|character|evidence|detail)\.[a-z0-9_]+(?:\.[a-z0-9_]+)?$/.test(asset.id)||ids.has(asset.id)||!safeAssetPath(slug,asset.file))throw Error('资源 ID 或路径无效');
  ids.add(asset.id);files.add(asset.file);
  const path=resolve(root,asset.file);if(!(await lstat(resolve(base,'assets'))).isDirectory()||(await lstat(resolve(base,'assets'))).isSymbolicLink()||!(await lstat(path)).isFile())throw Error('资源必须是普通文件');
  const bytes=await readFile(path);
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(!(asset.file.endsWith('.png')?png:asset.file.endsWith('.jpg')?jpg:webp))throw Error('图片格式与扩展名不符');
  if(bytes.length!==asset.bytes||hash(bytes)!==asset.sha256)throw Error('资源大小或哈希不符');
 }
 for(const file of files)total+=(await lstat(resolve(root,file))).size;
 if(total>MAX_ASSET_BYTES)throw Error('单关资产超过 8MB');
 const walk=value=>{if(!value||typeof value!=='object')return;for(const [key,child] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))throw Error('禁止原型键');if(key.endsWith('AssetId')||key==='assetId'){if(typeof child==='string'&&!ids.has(child))throw Error(`缺少资源 ${child}`);}else walk(child);}};
 walk(content);
 const allowed=new Set(['content.json','manifest.json','nodes.json',...(files.size?['assets']:[])]);
 for(const ent of await readdir(base,{withFileTypes:true}))if(!allowed.has(ent.name)||ent.isSymbolicLink())throw Error('内容包含未声明文件');
 if(files.size)for(const ent of await readdir(resolve(base,'assets'),{withFileTypes:true}))if(!ent.isFile()||!files.has(`levels/${slug}/assets/${ent.name}`))throw Error('资源目录含未声明文件');
 return {manifest,content,total,contentSha256:hash(await readFile(resolve(base,'content.json'))),manifestSha256:hash(await readFile(resolve(base,'manifest.json')))};
}
export async function buildLevels(root,out){
 const levels=[],rejected=[];await mkdir(resolve(out,'levels'),{recursive:true});
 for(const ent of await readdir(resolve(root,'levels'),{withFileTypes:true})){
  try{
   const result=await validateLevel(root,ent.name),m=result.manifest;
   const target=resolve(out,'levels',ent.name);await mkdir(target,{recursive:true});
   for(const name of ['content.json','manifest.json'])await copyFile(resolve(root,'levels',ent.name,name),resolve(target,name));
   // nodes.json 是可选的章节跳转快照，随关卡一起发布；没有就跳过（旧关卡可能未生成）。
   try{await copyFile(resolve(root,'levels',ent.name,'nodes.json'),resolve(target,'nodes.json'));}catch{}
   for(const file of new Set(m.assets.map(a=>a.file))){await mkdir(dirname(resolve(out,file)),{recursive:true});await copyFile(resolve(root,file),resolve(out,file));}
   levels.push({slug:m.slug,title:m.title,author:m.author,version:m.version,license:m.license,bytes:result.total,status:'valid',...(m.archived===true?{archived:true}:{}),contentSha256:result.contentSha256,manifestSha256:result.manifestSha256});
  }catch(error){rejected.push({slug:ent.name,error:error.message});}
 }
 levels.sort((a,b)=>a.slug.localeCompare(b.slug));
 await writeFile(resolve(out,'levels/index.json'),JSON.stringify({generatedAt:new Date().toISOString(),levels},null,2));
 return {levels,rejected};
}

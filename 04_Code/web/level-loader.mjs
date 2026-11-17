import {validateContent} from './core/engine.mjs';
export const levelSlug=new URL(location.href).searchParams.get('level');
async function digest(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function load(){
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(levelSlug))throw Error('关卡名称无效');
 const get=async path=>{const r=await fetch(path,{cache:'no-cache'});if(!r.ok)throw Error('关卡读取失败');return r.text();};
 const index=JSON.parse(await get('./levels/index.json')),entry=index.levels.find(l=>l.slug===levelSlug);
 if(!entry)throw Error('此关卡尚未收录');
 const [rawContent,rawManifest]=await Promise.all(['content','manifest'].map(name=>get(`./levels/${levelSlug}/${name}.json`)));
 const contentSha256=await digest(rawContent);
 if(contentSha256!==entry.contentSha256||await digest(rawManifest)!==entry.manifestSha256)throw Error('关卡版本不一致，请刷新');
 const content=JSON.parse(rawContent),manifest=JSON.parse(rawManifest),catalog=Object.create(null);
 if(validateContent(content).length)throw Error('关卡契约无效');
 for(const asset of manifest.assets){if(!new RegExp(`^levels/${levelSlug}/assets/[a-zA-Z0-9_-]+\\.(png|jpg|webp)$`).test(asset.file))throw Error('配图路径无效');catalog[asset.id]={src:`./${asset.file}`};}
 return {content,catalog,contentSha256};
}
let loaded;
try{loaded=await load();}catch(error){document.getElementById('stage-title').textContent='卷宗未能打开';document.getElementById('notice').textContent=error.message;throw error;}
export const demoContent=loaded.content,assetCatalog=loaded.catalog,contentSha256=loaded.contentSha256;

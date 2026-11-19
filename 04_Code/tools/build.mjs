import { mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipDirectory } from './zip.mjs';
import { buildStaticSite } from './static-site.mjs';
const codeRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const project=resolve(codeRoot,'..');
const build=resolve(project,'09_Builds','JiaoHun_Demo');
if(build!==resolve(project,'09_Builds','JiaoHun_Demo')||!build.startsWith(project))throw new Error('构建目录越界');
// Only this documented, generated distribution directory is replaced.
await rm(build,{recursive:true,force:true});
await mkdir(build,{recursive:true});
await cp(resolve(codeRoot,'web'),resolve(build,'web'),{recursive:true});
await cp(resolve(codeRoot,'core'),resolve(build,'core'),{recursive:true});
await cp(resolve(codeRoot,'server.mjs'),resolve(build,'server.mjs'));
await mkdir(resolve(build,'content'),{recursive:true});
await cp(resolve(project,'05_Content','demo-content.mjs'),resolve(build,'content','demo-content.mjs'));
// Bundled server uses its sibling content directory, not the source project layout.
let server=await readFile(resolve(build,'server.mjs'),'utf8');
server=server.replace("resolve(root, '../05_Content')","resolve(root, 'content')");
await writeFile(resolve(build,'server.mjs'),server,'utf8');
await writeFile(resolve(build,'package.json'),JSON.stringify({name:'jiaohun-demo',version:'0.2.0',private:true,type:'module',scripts:{start:'node server.mjs'},engines:{node:'>=22'}},null,2),'utf8');
await writeFile(resolve(build,'Start_Demo.cmd'),'@echo off\r\ncd /d "%~dp0"\r\nnode server.mjs\r\npause\r\n','utf8');
// Also produce a genuinely self-contained file: no file:// module imports,
// remote fonts, assets, or server needed. Each module retains its own scope.
const [html,css,content,engine,save,app]=await Promise.all([
  readFile(resolve(codeRoot,'web/index.html'),'utf8'),readFile(resolve(codeRoot,'web/style.css'),'utf8'),
  readFile(resolve(build,'content/demo-content.mjs'),'utf8'),readFile(resolve(build,'core/engine.mjs'),'utf8'),
  readFile(resolve(build,'core/save.mjs'),'utf8'),readFile(resolve(codeRoot,'web/app.mjs'),'utf8')
]);
const stripImports=text=>text.replace(/^import .*;\r?\n/gm,'');
const stripExports=text=>text.replace(/^export /gm,'');
const {assetCatalog}=await import(new URL('../web/assets.mjs',import.meta.url).href+'?build='+Date.now());
const inlineCatalog=structuredClone(assetCatalog), dataByPath=new Map();
for(const [id,asset] of Object.entries(inlineCatalog)) {
  if(!/^\/assets\/[a-zA-Z0-9._/-]+\.(png|jpg|webp|svg)$/.test(asset.src)||asset.src.includes('..'))throw new Error(`非法资源路径：${id}`);
  if(!dataByPath.has(asset.src)) {
    const bytes=await readFile(resolve(codeRoot,'web',asset.src.slice(1)));
    const type=asset.src.endsWith('.png')?'image/png':asset.src.endsWith('.webp')?'image/webp':asset.src.endsWith('.svg')?'image/svg+xml':'image/jpeg';
    dataByPath.set(asset.src,`data:${type};base64,${bytes.toString('base64')}`);
  }
}
const uniquePaths=[...dataByPath.keys()];
const assetBundle=`const assetCatalog=(()=>{const data=${JSON.stringify([...dataByPath.values()])};const catalog=${JSON.stringify(inlineCatalog)};const paths=${JSON.stringify(uniquePaths)};for(const asset of Object.values(catalog))asset.src=data[paths.indexOf(asset.src)];return catalog;})();`;
const bundle=[
  `const {demoContent}=(()=>{\n${stripExports(content)}\nreturn {demoContent};})();`,
  `const {createGame,dispatch,getView,validateState}=(()=>{\n${stripExports(engine)}\nreturn {createGame,dispatch,getView,validateState};})();`,
  `const {encodeSave,decodeSave}=(()=>{\n${stripExports(stripImports(save))}\nreturn {encodeSave,decodeSave};})();`,
  assetBundle, stripImports(app)
].join('\n');
const standalone=html.replace('<link rel="stylesheet" href="/style.css">',()=>`<style>${css}</style>`)
  .replace('<script type="module" src="/audio.mjs"></script>','')
  .replace('<script type="module" src="/app.mjs"></script>',()=>`<script type="module">\n${bundle.replaceAll('</script','<\\/script')}\n</script>`)
  .replace('href="/" aria-label','href="#game" aria-label');
await writeFile(resolve(build,'Demo.html'),standalone,'utf8');
await writeFile(resolve(build,'README.txt'),'萧山剪辫案 Demo v0.2.0\n\n最快试玩：双击 Demo.html，用现代桌面浏览器打开，无需安装、无需联网。\n如果浏览器限制本地文件自动存档，可用“导出存档”保存，再导入恢复。\n\n可选本地服务：需要 Node.js 22 或更新版本，无需 npm 安装。\nWindows 双击 Start_Demo.cmd；或运行 node server.mjs。\n浏览器访问 http://127.0.0.1:4173；关闭服务按 Ctrl+C。\n服务仅监听本机，无账号、无联网服务。\n\n本版集成6个场景、8个人物共30张立绘与差分、4张器物原画及5张特写，合计45张选用原图。图片与对白为可校订工作稿，尚待用户艺术认可。\n帽子检查及比对是游戏新增设计；新增对白为改编工作稿。\n','utf8');
const zip=resolve(project,'09_Builds','JiaoHun_Demo.zip');
await cp(resolve(project,'02_Art/ASSET_MANIFEST.json'),resolve(build,'ASSET_MANIFEST.json'));
await buildStaticSite(project,build);
const result=await zipDirectory(build,zip);
console.log(`已生成：${build}\n${zip}\n${result.files} files, ${result.bytes} bytes`);

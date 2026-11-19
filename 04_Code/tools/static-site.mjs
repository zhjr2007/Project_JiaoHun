import {mkdir,readFile,writeFile,copyFile,cp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {buildLevels} from './levels.mjs';
export async function buildStaticSite(project,build){
 const code=resolve(project,'04_Code'),site=resolve(build,'site');await mkdir(site,{recursive:true});
 const report=await buildLevels(project,site);
 await writeFile(resolve(project,'09_Builds/levels-validation.json'),JSON.stringify(report,null,2));
 await cp(resolve(code,'core'),resolve(site,'core'),{recursive:true});
 const files=['style.css','audio.mjs','level-loader.mjs','level-list.mjs','player.mjs','cloud-progress.mjs','network-lobby.mjs','theme.js','entry-tour.mjs','network-play.mjs','lobby.css','avatars.mjs','operator.html','operator.css','operator.mjs','screen.html','screen.css','screen.mjs','inspect.html','inspect.mjs'];
 for(const name of files)await copyFile(resolve(code,'web',name),resolve(site,name));
 await cp(resolve(code,'web/vendor'),resolve(site,'vendor'),{recursive:true});
 await cp(resolve(code,'web/chrome'),resolve(site,'chrome'),{recursive:true});
 await cp(resolve(code,'web/media'),resolve(site,'media'),{recursive:true});
 await copyFile(resolve(code,'web/lobby.html'),resolve(site,'index.html'));
 let html=await readFile(resolve(code,'web/index.html'),'utf8');
 html=html.replace('href="/style.css"','href="./style.css"').replace('src="/app.mjs"','src="./app.mjs"').replace('src="/audio.mjs"','src="./audio.mjs"').replace('href="/" aria-label','href="./" aria-label');
 html=html.replace('自动保存于当前浏览器','正在读取 NAS 进度……');
 await writeFile(resolve(site,'play.html'),html);
 let app=await readFile(resolve(code,'web/app.mjs'),'utf8');
 app=app.replace("import { demoContent } from '/content/demo-content.mjs';","import {demoContent,assetCatalog,levelSlug,contentSha256} from './level-loader.mjs';").replace("from '/core/engine.mjs'","from './core/engine.mjs'").replace("from '/core/save.mjs'","from './core/save.mjs'").replace("import { assetCatalog } from '/assets.mjs';",'');
 await writeFile(resolve(site,'app.mjs'),"import {gamePlatform} from './network-play.mjs';\n"+app);
 console.log(`网页关卡：${report.levels.length} 有效，${report.rejected.length} 拒绝；认证与大屏入口已打包`);
}

// 多入口一致性检查：确认 .top / .xyz 与其 :8443 变体是否发的是同一份站点。
//
// 用途：每次部署后跑一次，用"字节哈希"证明四个入口没有分叉，而不是逐个肉眼看。
// 用法：
//   node 04_Code/tools/verify-entries.mjs
//   node 04_Code/tools/verify-entries.mjs --path /game/lobby.css --path /game/play.html
//   node 04_Code/tools/verify-entries.mjs --base https://example.test/game
//
// 退出码：0 = 所有入口一致且资源可达；1 = 有分叉或取不到。
// 说明：这是运维自查工具，不参与 node --test（需要联网，且线上状态会变）。

import { createHash } from 'node:crypto';

const DEFAULT_BASES = [
  'https://sociology.lumi-ember.top/game',
  'https://sociology.lumi-ember.top:8443/game',
  'https://sociology.lumi-ember.xyz/game',
  'https://sociology.lumi-ember.xyz:8443/game'
];

// 覆盖五类：页面、样式/脚本、生成的纹理、配乐、派生清单与接口健康。
const DEFAULT_PATHS = [
  '/',
  '/lobby.css',
  '/theme.js',
  '/entry-tour.mjs',
  '/play.html',
  '/audio.mjs',
  '/chrome/paper.webp',
  '/media/bgm/bgm_01_entry.mp3',
  '/lines.json',
  '/voice-index.json',
  '/api/v2/health'
];

function parseArgs(argv) {
  const bases = [], paths = [];
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--base' && value) { bases.push(value.replace(/\/+$/, '')); index += 1; }
    else if (flag === '--path' && value) { paths.push(value.startsWith('/') ? value : '/' + value); index += 1; }
  }
  return { bases: bases.length ? bases : DEFAULT_BASES, paths: paths.length ? paths : DEFAULT_PATHS };
}

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

async function fetchOnce(base, path) {
  try {
    // 一律不走缓存：这些入口没有 Cache-Control，只有 Etag/Last-Modified，用随机查询串强制取新。
    const url = `${base}${path}${path.includes('?') ? '&' : '?'}v=${Date.now().toString(36)}`;
    const response = await fetch(url, { redirect: 'follow', headers: { 'cache-control': 'no-cache' } });
    const body = Buffer.from(await response.arrayBuffer());
    return { status: response.status, type: response.headers.get('content-type') || '', bytes: body.length, hash: sha256(body), error: null };
  } catch (error) {
    return { status: 0, type: '', bytes: 0, hash: '', error: error.message };
  }
}

const { bases, paths } = parseArgs(process.argv.slice(2));
console.log(`入口 ${bases.length} 个 × 资源 ${paths.length} 个\n`);
for (const base of bases) console.log('  ' + base);
console.log('');

let failures = 0;
const rows = [];
for (const path of paths) {
  const results = await Promise.all(bases.map(base => fetchOnce(base, path)));
  const hashes = new Set(results.map(result => result.hash).filter(Boolean));
  const statuses = results.map(result => result.status);
  const unreachable = results.filter(result => result.error).length;
  const divergent = hashes.size > 1;
  const badStatus = statuses.some(status => status !== 200);
  const ok = !divergent && !unreachable && !badStatus;
  if (!ok) failures += 1;
  rows.push({
    path,
    verdict: ok ? 'OK' : divergent ? 'DIVERGENT' : unreachable ? 'UNREACHABLE' : 'STATUS',
    types: [...new Set(results.map(result => result.type))].join(' | ') || '(none)',
    bytes: results[0].bytes,
    hashes: [...hashes],
    statuses
  });
}

const width = Math.max(...rows.map(row => row.path.length), 6);
for (const row of rows) {
  const mark = row.verdict === 'OK' ? ' ' : '!';
  console.log(`${mark} ${row.path.padEnd(width)}  ${row.verdict.padEnd(11)} ${String(row.bytes).padStart(9)}B  ${row.types}`);
  if (row.verdict !== 'OK') {
    console.log(`    status: ${row.statuses.join(', ')}`);
    console.log(`    各入口哈希: ${row.hashes.join(' / ') || '(empty)'}`);
  }
}

console.log('');
if (failures) {
  console.log(`不一致或不可达：${failures} 项。四个入口应指向同一个 site 目录；若出现分叉，先核对 NAS 上的 Caddy 各站点块 root 是否都指向 Project_JiaoHun/site。`);
  process.exit(1);
}
console.log('全部入口一致：同一份站点、同一批资源。');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const crypto = require('node:crypto');

const code = esbuild.buildSync({stdin:{contents:"export * from './src/hub/services/iptv/source'; export * from './src/hub/services/iptv/playlist-source';",resolveDir:path.join(__dirname,'..'),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const loaded={exports:{}};
function makeAnchor(){let parsed=new URL('https://catalog.example/');const anchor={};for(const key of ['href','protocol','hostname','username','password','search'])Object.defineProperty(anchor,key,{get(){return parsed[key];},set(value){if(key==='href')parsed=new URL(value,parsed.href);}});return anchor;}
new Function('module','exports','require','document',code)(loaded,loaded.exports,require,{createElement(){return makeAnchor();}});
const {CatalogRepository,IptvSource,IptvOrgPlaylistSource}=loaded.exports;

function fixture(corrupt=false,unverified=false){
  const cards=[{id:'One.ar',name:'Canal Uno',logo:'',country:'AR',categories:['general'],languages:['esp'],status:unverified?'unverified':'verified',provenance:{status:unverified?'unreviewed':'reviewed'},verification:{status:unverified?'unverified':'ok',environment:'home-ar'},detailPage:'versions/v1/details/0.json'}];
  const primary={id:'main',url:'https://official.example/live.m3u8',quality:'720p',height:720,transport:'direct',headers:{},verification:{status:unverified?'unverified':'ok'}};
  const files={
    'versions/v1/countries/AR/0.json':{items:cards},
    'versions/v1/details/0.json':{items:[{id:'One.ar',primary,fallbacks:[{...primary,id:'backup',url:'https://official.example/backup.m3u8'}]}]}
  };
  const manifest={schemaVersion:1,version:'v1',generatedAt:'2026-10-22',countries:['AR'],verificationEnvironment:'home-ar',categories:{general:'General'},partitions:{countries:{AR:['versions/v1/countries/AR/0.json']},search:[],lookup:'',details:['versions/v1/details/0.json']},files:Object.entries(files).map(([filename,value])=>({path:filename,bytes:Buffer.byteLength(JSON.stringify(value)),hash:crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24)}))};
  const calls=[];
  const repository=new CatalogRepository('https://catalog.example/manifest.json',{read(url,maxBytes,done){calls.push(url);const pathname=new URL(url).pathname.slice(1);const value=pathname==='manifest.json'?manifest:files[pathname];done({ok:true,value:JSON.stringify(corrupt&&pathname.includes('/countries/')?{items:[]}:value)});return{cancel(){}};}});
  return{repository,source:new IptvSource(repository),calls};
}

test('IPTV: browse, busqueda y resolucion conservan fallbacks sin scraping en la TV',()=>{
  const {source,calls}=fixture();
  source.browse(result=>{assert.equal(result.ok,true);assert.equal(result.value.items[0].ref.sourceId,'iptv');});
  source.search('uno',result=>assert.equal(result.value.items.length,1));
  source.resolvePlayback({sourceId:'iptv',itemId:'One.ar'},result=>{assert.equal(result.ok,true);assert.equal(result.value.candidates.length,2);assert.equal(result.value.candidates[0].label,'720p');});
  assert.equal(calls.length,3);
});

test('IPTV: rechaza una particion modificada y rutas fuera del manifest',()=>{
  const {source}=fixture(true);
  source.browse(result=>{assert.equal(result.ok,false);assert.equal(result.error.code,'CATALOG_INTEGRITY');});
  const {repository}=fixture();repository.load(()=>{});
  repository.read('../private.json',result=>assert.equal(result.error.code,'CATALOG_PATH'));
});

test('IPTV: conserva candidatos revisados sin sondeo y los resuelve para probarlos al reproducir',()=>{
  const {source}=fixture(false,true);
  source.browse(result=>{assert.equal(result.ok,true);assert.equal(result.value.items[0].verification.status,'unverified');assert.equal(result.value.items[0].provenance.status,'unreviewed');});
  source.resolvePlayback({sourceId:'iptv',itemId:'One.ar'},result=>{assert.equal(result.ok,true);assert.equal(result.value.candidates[0].url,'https://official.example/live.m3u8');assert.equal(result.value.candidates[0].id,'main');});
});

test('IPTV directo: consulta M3U y blocklist, agrupa variantes y descarta headers, URLs privadas y bloqueados',()=>{
  const playlist=['#EXTM3U','#EXTINF:-1 tvg-id="Good.ar@HD" tvg-name="Canal Uno" group-title="News",Canal, Uno (1080p)','https://good.example/hd.m3u8','#EXTINF:-1 tvg-id="Good.ar@SD" tvg-name="Canal Uno" group-title="News",Canal Uno (480p)','http://good.example/sd.m3u8','#EXTINF:-1 tvg-id="Blocked.ar@SD" group-title="General",Bloqueado','https://blocked.example/live.m3u8','#EXTINF:-1 tvg-id="Header.ar@SD" http-referrer="https://official.example/" group-title="General",Con Referer','https://header.example/live.m3u8','#EXTINF:-1 tvg-id="Private.ar@SD" group-title="General",Privado','http://192.168.1.70/live.m3u8','#EXTINF:-1 tvg-id="Hidden.ar@SD" group-title="General",Oculto','https://hidden.example/live.m3u8','#EXTINF:-1 tvg-id="Adult.ar@SD" group-title="XXX",XXX','https://adult.example/live.m3u8','#EXTINF:-1 tvg-id="Geo.ar@HD" group-title="General",Canal [Geo-blocked]','https://geo.example/live.m3u8'].join('\n');
  const blocklist=JSON.stringify([{channel:'Blocked.ar',reason:'dmca'}]);
  const transport={read(url,maxBytes,done){done({ok:true,value:url.indexOf('blocklist')>=0?blocklist:playlist});return{cancel(){}};}};
  const source=new IptvOrgPlaylistSource(transport,'https://iptv-org.example/ar.m3u','https://iptv-org.example/blocklist.json','iptv',['Hidden.ar']);
  source.browse(result=>{assert.equal(result.ok,true);assert.equal(result.value.items.length,1);assert.equal(result.value.items[0].name,'Canal Uno');assert.equal(result.value.items[0].provenance.status,'unreviewed');});
  source.resolvePlayback({sourceId:'iptv',itemId:'Good.ar'},result=>{assert.equal(result.ok,true);assert.equal(result.value.candidates.length,2);assert.deepEqual(result.value.candidates.map(item=>item.height),[1080,480]);});
});

test('IPTV directo: un fallo de red completa browse una sola vez aunque la otra descarga termine',()=>{
  let completed=0;
  const source=new IptvOrgPlaylistSource({read(url,maxBytes,done){if(url.indexOf('blocklist')>=0)done({ok:true,value:'[]'});else done({ok:false,error:{code:'NETWORK',message:'offline'}});return{cancel(){}};}},'https://iptv-org.example/ar.m3u','https://iptv-org.example/blocklist.json');
  source.browse(result=>{completed++;assert.equal(result.ok,false);});
  assert.equal(completed,1);
});

test('IPTV directo: cada refresh invalida la cache y evita respuestas HTTP cacheadas',()=>{
  const calls=[];const playlist='#EXTM3U\n#EXTINF:-1 tvg-id="Good.ar@SD" group-title="General",Canal Bueno\nhttps://good.example/live.m3u8';
  const source=new IptvOrgPlaylistSource({read(url,maxBytes,done){calls.push(url);done({ok:true,value:url.indexOf('blocklist')>=0?'[]':playlist});return{cancel(){}};}},'https://iptv-org.example/ar.m3u','https://iptv-org.example/blocklist.json');
  source.browse(result=>assert.equal(result.ok,true));source.browse(result=>assert.equal(result.ok,true));
  assert.equal(calls.length,2);
  source.refresh();source.browse(result=>assert.equal(result.ok,true));
  assert.equal(calls.length,4);assert.notEqual(calls[0],calls[2]);assert.notEqual(calls[1],calls[3]);
});

test('IPTV: resuelve un favorito al iniciar sin haber abierto la seccion antes',()=>{
  const {source}=fixture();
  source.resolvePlayback({sourceId:'iptv',itemId:'One.ar'},result=>{assert.equal(result.ok,true);assert.equal(result.value.item.name,'Canal Uno');});
});
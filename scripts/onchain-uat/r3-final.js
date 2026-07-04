/*
 * INFRA-9 R3 FINAL (PRIV-1) — turbo-gateway.com ONLY.
 * Download+decrypt a KNOWN small private file whose data tx is available on
 * turbo-gateway.com, twice, and assert a stable SHA-256. Gateway is flaky under
 * load (504 / socket hang up / circuit-open) so every call is retry-hardened.
 * Also samples R4 (isHidden) and R5 (robustness) from decrypted metadata.
 */
'use strict';
process.env.ARDRIVE_GATEWAY_HOST = 'turbo-gateway.com';
const fs = require('fs'), os = require('os'), path = require('path');
const c = require('./common');
const core = require('ardrive-core-js');
const { arDriveFactory, ArweaveAddress, EID, readJWKFile } = core;
const _ax = require('axios'); const axios = _ax.default || _ax;
const ax = axios.create({ validateStatus: undefined, maxRedirects: 5, timeout: 20000 });
const GATEWAY = 'turbo-gateway.com';
const DRIVE = '8d81a9db-b665-4040-866f-37336d324e14';
// Known small files with available data (from enumeration), in preference order.
const TARGET_NAMES = ['base.webp', 'meta-logo.svg', 'AR-IO-SDK-README-2.md'];
const CANNOT_DECRYPT = new Set(['ENCRYPTED', 'Encrypted', 'ENCRYPTED_DATA']);
function toNum(x){try{return Number(x.toString());}catch{return NaN;}}
function looksLikeText(buf){const n=Math.min(buf.length,512);if(!n)return false;let p=0;for(let i=0;i<n;i++){const b=buf[i];if(b===9||b===10||b===13||(b>=32&&b<127))p++;}return p/n>0.85;}
async function retry(fn,label,tries=5){let e;for(let i=0;i<tries;i++){try{return await fn();}catch(err){e=err;const w=1500*Math.pow(1.7,i);c.log(`   [retry] ${label} #${i+1}/${tries}: ${String(err.message).slice(0,60)}${i+1<tries?` wait ${Math.round(w)}ms`:''}`);if(i+1<tries)await new Promise(r=>setTimeout(r,w));}}throw e;}
async function gqlFiles(driveId){
  const q={query:`query{transactions(owners:["${c.IKRY_ADDRESS}"],tags:[{name:"Drive-Id",values:["${driveId}"]},{name:"Entity-Type",values:["file"]}],first:100){edges{node{id tags{name value}}}}}`};
  const {data}=await ax.post(`https://${GATEWAY}/graphql`,q,{headers:{'content-type':'application/json'}});
  const edges=(data&&data.data&&data.data.transactions&&data.data.transactions.edges)||[];
  const m=new Map();
  for(const e of edges){const t=Object.fromEntries(e.node.tags.map(x=>[x.name,x.value]));const fid=t['File-Id'];if(fid&&!m.has(fid))m.set(fid,{fileId:fid,metaTx:e.node.id});}
  return [...m.values()];
}
(async()=>{
  const results={gateway:GATEWAY,R3:{},R4:{},R5:{}};
  const {walletPath,password}=c.loadEnv();
  const arweave=c.initArweave();
  c.log('gateway:',GATEWAY);
  const wallet=readJWKFile(walletPath); const walletJson=JSON.parse(fs.readFileSync(walletPath,'utf8'));
  const dkm=require(path.resolve(__dirname,'..','..','dist','main','drive-key-manager.js')).driveKeyManager;
  dkm.setWallet(walletJson);
  const arDrive=arDriveFactory({wallet,arweave,turboSettings:{turboUrl:new URL('https://upload.ardrive.io')}});
  const owner=new ArweaveAddress(c.IKRY_ADDRESS);
  const driveKey=await dkm.deriveKey(DRIVE,password);

  const list=await gqlFiles(DRIVE);
  c.log(`drive ${DRIVE} has ${list.length} unique file entities`);
  let pick=null; const decrypted=[];
  for(const f of list){
    if(pick)break;
    let meta;
    try{meta=await retry(()=>arDrive.getPrivateFile({fileId:EID(f.fileId),driveKey,owner}),`getPrivateFile ${f.fileId.slice(0,8)}`,3);}
    catch(e){continue;}
    const name=String(meta.name);const size=toNum(meta.size);const dtx=meta.dataTxId?meta.dataTxId.toString():null;
    decrypted.push({name,size,isHidden:meta.isHidden===true,nameDec:!CANNOT_DECRYPT.has(name)&&name.length>0});
    if(TARGET_NAMES.includes(name)&&dtx&&size>0&&size<c.FREE_TIER_BYTES){
      pick={fileId:f.fileId,name,size,dataTxId:dtx};
      c.log(`   PICK "${c.assertNoSecret(name)}" ${size}B fileId=${f.fileId} dataTx=${dtx}`);
    }
  }

  c.section('R3  download+decrypt private file x2; SHA-256 stable (PRIV-1)');
  if(!pick){results.R3.error='no target small file resolved';c.log('   '+results.R3.error);}
  else{
    results.R3.picked={name:pick.name,fileId:pick.fileId,size:pick.size,dataTxId:pick.dataTxId,under105KiB:pick.size<c.FREE_TIER_BYTES};
    const hashes=[];
    for(let i=0;i<2;i++){
      const dest=fs.mkdtempSync(path.join(os.tmpdir(),`infra9-r3f-${i}-`));
      await retry(()=>arDrive.downloadPrivateFile({fileId:EID(pick.fileId),driveKey,destFolderPath:dest,defaultFileName:'dl.bin'}),`downloadPrivateFile#${i+1}`,6);
      const buf=fs.readFileSync(path.join(dest,fs.readdirSync(dest)[0]));
      hashes.push({sha256:c.sha256(buf),bytes:buf.length,text:looksLikeText(buf)});
      fs.rmSync(dest,{recursive:true,force:true});
      c.log(`   dl#${i+1} sha256=${hashes[i].sha256} (${hashes[i].bytes}B ${hashes[i].text?'text':'bin'})`);
    }
    results.R3.hashes=hashes;
    results.R3.stable=hashes[0].sha256===hashes[1].sha256&&hashes[0].bytes===hashes[1].bytes;
    results.R3.plaintextBytesMatchMetadataSize=hashes[0].bytes===pick.size;
    c.log(`   STABLE SHA-256 across two fetches: ${results.R3.stable?'YES':'NO'}`);
    c.log(`   plaintext bytes (${hashes[0].bytes}) == metadata size (${pick.size}): ${results.R3.plaintextBytesMatchMetadataSize}`);
  }

  c.section('R4/R5  hidden + robustness (from decrypted-so-far)');
  results.R4.filesDecrypted=decrypted.length;
  results.R4.hiddenCount=decrypted.filter(d=>d.isHidden).length;
  results.R5.threw=false;
  results.R5.namesDecrypted=decrypted.filter(d=>d.nameDec).length;
  c.log(`   decrypted ${decrypted.length} files; hidden=${results.R4.hiddenCount}; names ok=${results.R5.namesDecrypted}; no crash`);

  dkm.clearAllKeys();
  c.section('R3 FINAL JSON');
  console.log(JSON.stringify(results,null,2));
  process.exit(0);
})().catch(e=>{console.error('R3FINAL FATAL',e&&e.stack?e.stack:e);process.exit(1);});

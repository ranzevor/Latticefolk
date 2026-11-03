import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn,execFileSync } from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});
function validationPaths(projectRoot,temporaryRoot=os.tmpdir()){
  const output=fs.mkdtempSync(path.join(temporaryRoot,'latticefolk-validation-'));
  const projectKey=Buffer.from(fs.realpathSync(projectRoot)).toString('base64url');
  const lockDirectory=path.join(temporaryRoot,'latticefolk-validation-locks',...(projectKey.match(/.{1,120}/g)||[]));
  fs.mkdirSync(lockDirectory,{recursive:true});
  return {
    output,
    lock:path.join(lockDirectory,'running.lock'),
    browserEnv:{
      PLAYWRIGHT_OUTPUT_DIR:path.join(output,'test-results'),
      PLAYWRIGHT_JSON_OUTPUT_FILE:path.join(output,'playwright.json'),
      PLAYWRIGHT_HTML_OUTPUT_DIR:path.join(output,'playwright-report')
    }
  };
}
const {output,lock,browserEnv}=validationPaths(root);
let ownsLock=false;
const record={startedAt:new Date().toISOString(),node:process.version,platform:process.platform,
  gitHead:null,gitTree:null,sourceDigest:null,sourceUnchanged:null,steps:[],result:'in_progress',actionsUsed:false};
const writeRecord=()=>fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(record,null,2)+'\n');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const normalSave=()=>Object.fromEntries(['','.wal','.shm'].map(suffix=>{
  const name='data/latticefolk.sqlite'+suffix.replace('.', '-');
  const file=path.join(root,name);
  return [name,fs.existsSync(file)?hash(fs.readFileSync(file)):null];
}));
const snapshotSeedFiles=new Set(['data/dialogue-example.jsonl','data/dialogue-seed.multilingual.jsonl']);
const snapshotDirectories=new Set(['src','server','tests','e2e','scripts','docs','public','.github']);
const snapshotRootFiles=new Set([
  '.dockerignore','.editorconfig','.env.example','.gitattributes','.gitignore','.node-version',
  'CHANGELOG.md','CITATION.cff','CODE_OF_CONDUCT.md','CONTRIBUTING.md','DEPENDENCY_LICENSES.md',
  'Dockerfile','LICENSE','README.md','SECURITY.md','THIRD_PARTY_ASSETS.md','THIRD_PARTY_NOTICES.md',
  'index.html','package.json','package-lock.json','npm-shrinkwrap.json','pnpm-lock.yaml','yarn.lock',
  'playwright.config.ts','run.bat','run.ps1','sbom.cdx.json','tsconfig.json','vite.config.ts'
]);
function snapshotSource(name){
  const parts=name.split('/');
  if(!name||path.isAbsolute(name)||parts.some(part=>!part||part==='.'||part==='..'))return false;
  if(snapshotSeedFiles.has(name))return true;
  const excluded=['node_modules','.git','.aws','.ssh','.npm','.cache','.local-validation','test-results','playwright-report','coverage','dist','build','data','runtime','logs'];
  if(parts.some(part=>excluded.includes(part)))return false;
  if(parts.slice(0,-1).some(part=>/^\.?(credentials?|secrets?|api[-_]?keys?)$/i.test(part)))return false;
  if(parts.slice(0,-1).some(part=>part.startsWith('latticefolk-validation-')))return false;
  if(name!=='.env.example'&&parts.some(part=>part==='.env'||part.startsWith('.env.')))return false;
  const filename=parts[parts.length-1];
  if(['.npmrc','.netrc','.pypirc','.git-credentials','id_rsa','id_ed25519'].includes(filename))return false;
  if(/^(credentials|secrets|api[-_]?keys?)(\.(json|ya?ml|toml|ini|txt))?$/i.test(filename))return false;
  if(/\.(sqlite(-wal|-shm)?|db(-wal|-shm)?|log|pem|key|p12|pfx)$/i.test(filename))return false;
  return parts.length===1?snapshotRootFiles.has(name):snapshotDirectories.has(parts[0]);
}
function sourceEntry(name,captured){
  const file=path.resolve(root,name);
  if(!fs.existsSync(file))return {path:name,sha256:null};
  if(!fs.lstatSync(file).isFile())throw new Error(`Snapshot source is not a regular file: ${name}`);
  const resolved=path.relative(fs.realpathSync(root),fs.realpathSync(file)).split(path.sep).join('/');
  if(!snapshotSource(resolved))throw new Error(`Snapshot source resolves outside supported source files: ${name}`);
  const bytes=fs.readFileSync(file);
  if(captured)captured.set(name,bytes);
  return {path:name,sha256:hash(bytes)};
}
function sourcePatch(entries){
  return entries.length?git('diff','HEAD','--binary','--',...entries.map(entry=>':(literal)'+entry.path)):'';
}
function files(captured){
  const names=[...new Set(git('ls-files','-z','--cached','--others','--exclude-standard').split('\0').filter(Boolean))].filter(snapshotSource).sort();
  return names.map(name=>sourceEntry(name,captured));
}
async function npm(args,name,extraEnv={}){
  const cli=process.env.npm_execpath;
  if(!cli||!fs.existsSync(cli))throw new Error('Run this command through npm run validate:local');
  const step={name,command:['npm',...args],startedAt:new Date().toISOString(),exitCode:null};
  record.steps.push(step);writeRecord();
  const log=fs.createWriteStream(path.join(output,`${name}.log`));
  console.log(`[local-validation] ${step.command.join(' ')}`);
  try {
    step.exitCode=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[cli,...args],{cwd:root,env:{...process.env,...extraEnv},stdio:['ignore','pipe','pipe']});
      child.stdout.on('data',bytes=>{log.write(bytes);process.stdout.write(bytes);});
      child.stderr.on('data',bytes=>{log.write(bytes);process.stderr.write(bytes);});
      child.once('error',reject);child.once('exit',(code,signal)=>resolve(code??(signal?130:1)));
    });
  } finally {await new Promise(resolve=>log.end(resolve));step.finishedAt=new Date().toISOString();writeRecord();}
  if(step.exitCode!==0)throw new Error(`${name} failed with exit ${step.exitCode}; evidence retained at ${output}`);
}

let initialFiles;
try {
  const legacyLock=path.join(root,'.local-validation','running.lock');
  if(fs.existsSync(legacyLock))throw new Error(`Existing validation lock: ${legacyLock}`);
  const fd=fs.openSync(lock,'wx');ownsLock=true;fs.writeFileSync(fd,JSON.stringify({pid:process.pid,output}));fs.closeSync(fd);
  await npm(['run','assets:prepare'],'assets');
  record.gitHead=git('rev-parse','HEAD').trim();record.gitTree=git('rev-parse','HEAD^{tree}').trim();
  record.workingTreeStatus=git('status','--porcelain');
  record.regularSaveBefore=normalSave();
  const capturedSources=new Map();
  initialFiles=files(capturedSources);record.sourceDigest=hash(JSON.stringify(initialFiles));
  fs.writeFileSync(path.join(output,'source-manifest.json'),JSON.stringify(initialFiles,null,2)+'\n');
  fs.writeFileSync(path.join(output,'working.patch'),sourcePatch(initialFiles));
  // Include untracked implementation files, unlike a tracked-only git diff.
  for(const file of initialFiles){
    if(file.sha256===null)continue;
    const destination=path.join(output,'source',file.path);fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.writeFileSync(destination,capturedSources.get(file.path));
  }
  writeRecord();
  await npm(['run','check'],'check');
  await npm(['run','test:e2e','--','--forbid-only','--reporter=list,html,json'],'browser',browserEnv);
  const browser=JSON.parse(fs.readFileSync(path.join(output,'playwright.json'),'utf8'));
  record.browserStats=browser.stats;
  if(!(browser.stats.expected>0)||browser.stats.unexpected||browser.stats.flaky||browser.stats.skipped||browser.errors?.length){
    throw new Error('Browser report is incomplete, failing, flaky or skipped; not local acceptance');
  }
  record.result='passed';
} catch(error){
  record.result='failed';record.error=error instanceof Error?error.message:String(error);process.exitCode=1;
} finally {
  if(ownsLock){
    if(initialFiles){
      record.sourceUnchanged=record.sourceDigest===hash(JSON.stringify(files()));
      record.regularSaveAfter=normalSave();
      record.regularSaveUnchanged=JSON.stringify(record.regularSaveBefore)===JSON.stringify(record.regularSaveAfter);
      if(!record.regularSaveUnchanged){record.result='failed';record.error='Regular player save changed during isolated validation';process.exitCode=1;}
      if(!record.sourceUnchanged){record.result='failed';record.error='Source changed during validation; this run cannot validate the final source';process.exitCode=1;}
    }
    const report=path.join(output,'playwright.json');
    if(fs.existsSync(report)){
      try {record.browserStats=JSON.parse(fs.readFileSync(report,'utf8')).stats;}
      catch {record.browserReportUnreadable=true;}
    }
    fs.unlinkSync(lock);
  }
  record.finishedAt=new Date().toISOString();writeRecord();
  console.log(`[local-validation] ${record.result}: ${output}`);
  if(record.error)console.error(record.error);
}

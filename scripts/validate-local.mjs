import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn,execFileSync } from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});
function validationPaths(projectRoot,temporaryRoot=tmpdir()){
  const output=fs.mkdtempSync(path.join(temporaryRoot,'latticefolk-validation-'));
  const lock=path.join(projectRoot,'.local-validation','running.lock');
  fs.mkdirSync(path.dirname(lock),{recursive:true});
  return {output,lock};
}
const {output,lock}=validationPaths(root);
let ownsLock=false;
const record={startedAt:new Date().toISOString(),node:process.version,platform:process.platform,
  gitHead:null,gitTree:null,sourceDigest:null,sourceUnchanged:null,steps:[],result:'in_progress'};
const writeRecord=()=>fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(record,null,2)+'\n');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const normalSave=()=>Object.fromEntries(['','.wal','.shm'].map(suffix=>{
  const name='data/latticefolk.sqlite'+suffix.replace('.', '-');
  const file=path.join(root,name);
  return [name,fs.existsSync(file)?hash(fs.readFileSync(file)):null];
}));
function files(){
  const names=[...new Set(git('ls-files','-z','--cached','--others','--exclude-standard').split('\0').filter(Boolean))].sort();
  return names.map(name=>({path:name,sha256:fs.existsSync(path.join(root,name))?hash(fs.readFileSync(path.join(root,name))):null}));
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
  const fd=fs.openSync(lock,'wx');ownsLock=true;fs.writeFileSync(fd,JSON.stringify({pid:process.pid,output}));fs.closeSync(fd);
  await npm(['run','assets:prepare'],'assets');
  record.gitHead=git('rev-parse','HEAD').trim();record.gitTree=git('rev-parse','HEAD^{tree}').trim();
  record.workingTreeStatus=git('status','--porcelain');
  record.regularSaveBefore=normalSave();
  initialFiles=files();record.sourceDigest=hash(JSON.stringify(initialFiles));
  fs.writeFileSync(path.join(output,'source-manifest.json'),JSON.stringify(initialFiles,null,2)+'\n');
  fs.writeFileSync(path.join(output,'working.patch'),git('diff','HEAD','--binary'));
  // Include untracked implementation files, unlike a tracked-only git diff.
  for(const file of initialFiles){
    if(file.sha256===null)continue;
    const destination=path.join(output,'source',file.path);fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.copyFileSync(path.join(root,file.path),destination);
  }
  writeRecord();
  await npm(['run','check'],'check');
  await npm(['run','test:e2e','--','--forbid-only','--reporter=list,html,json','--output',path.join(output,'test-results')],'browser',{
    PLAYWRIGHT_JSON_OUTPUT_FILE:path.join(output,'playwright.json'),
    PLAYWRIGHT_HTML_OUTPUT_DIR:path.join(output,'playwright-report'),
    PLAYWRIGHT_HTML_REPORT:path.join(output,'playwright-report')
  });
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

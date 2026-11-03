import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';
import config from '../playwright.config.js';

test('managed browser fixtures isolate their destructive resets from the regular player save',()=>{
  const server=config.webServer;
  assert.ok(server&&!Array.isArray(server));
  assert.equal(server.env?.WORLD_DB_PATH,fileURLToPath(new URL('../data/latticefolk.e2e.sqlite',import.meta.url)));
  assert.notEqual(server.env?.WORLD_DB_PATH,fileURLToPath(new URL('../data/latticefolk.sqlite',import.meta.url)));
  assert.equal(server.reuseExistingServer,false,'never reset an already-running user server');
  assert.equal(config.workers,1,'the suite intentionally shares one isolated world');
  assert.equal(config.fullyParallel,false);
});

test('browser result paths honor explicit locations and otherwise use OS temporary output',()=>{
  assert.ok(config.outputDir);
  assert.equal(config.outputDir,process.env.PLAYWRIGHT_OUTPUT_DIR||path.join(path.dirname(config.outputDir),'test-results'));
  if(!process.env.PLAYWRIGHT_OUTPUT_DIR)assert.ok(config.outputDir.startsWith(path.join(os.tmpdir(),'latticefolk-playwright-')));
  const reporters=config.reporter;assert.ok(Array.isArray(reporters));
  const report=reporters.find(entry=>Array.isArray(entry)&&entry[0]==='html');assert.ok(report&&report[1]);
  const html=report[1] as {outputFolder:string;open:string};
  assert.equal(html.open,'never');
  if(process.env.PLAYWRIGHT_HTML_OUTPUT_DIR)assert.equal(html.outputFolder,process.env.PLAYWRIGHT_HTML_OUTPUT_DIR);
  else assert.ok(html.outputFolder.startsWith(path.join(os.tmpdir(),'latticefolk-playwright-')));
  const server=config.webServer;assert.ok(server&&!Array.isArray(server));assert.equal(server.env?.DECISION_PROVIDER,'fallback');
});

test('local validation paths keep current browser output together and locking stable per checkout',()=>{
  const source=fs.readFileSync(new URL('../scripts/validate-local.mjs',import.meta.url),'utf8');
  const ast=ts.createSourceFile('validate-local.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const helper=ast.statements.find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==='validationPaths');assert.ok(helper);
  let sequence=0;
  const fakeFs={mkdtempSync:(prefix:string)=>prefix+String(++sequence),realpathSync:(root:string)=>root==='alias-a'?'project-a':root,mkdirSync:()=>undefined};
  const paths=new Function('fs','path','os',`return (${helper.getText(ast)});`)(fakeFs,path,os) as (root:string,temporaryRoot:string)=>{output:string;lock:string;browserEnv:Record<string,string>};
  const temporary=path.join(os.tmpdir(),'validation-path-fixture');const a=paths('project-a',temporary),b=paths('project-a',temporary),alias=paths('alias-a',temporary),other=paths('project-b',temporary);
  assert.notEqual(a.output,b.output);assert.equal(a.lock,b.lock);assert.equal(a.lock,alias.lock);assert.notEqual(a.lock,other.lock);
  assert.equal(a.browserEnv.PLAYWRIGHT_OUTPUT_DIR,path.join(a.output,'test-results'));
  assert.equal(a.browserEnv.PLAYWRIGHT_JSON_OUTPUT_FILE,path.join(a.output,'playwright.json'));
  assert.equal(a.browserEnv.PLAYWRIGHT_HTML_OUTPUT_DIR,path.join(a.output,'playwright-report'));
});

test('source snapshots select normal implementation inputs before reading content',()=>{
  const source=fs.readFileSync(new URL('../scripts/validate-local.mjs',import.meta.url),'utf8');
  const ast=ts.createSourceFile('validate-local.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const names=new Set(['snapshotSeedFiles','snapshotDirectories','snapshotRootFiles']);
  const declarations=ast.statements.filter(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(item=>names.has(item.name.getText(ast)))).map(node=>node.getText(ast));
  const functions=ast.statements.filter((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&['snapshotSource','sourceEntry','sourcePatch'].includes(node.name?.text||'')).map(node=>node.getText(ast));
  assert.equal(declarations.length,3);assert.equal(functions.length,3);
  type SnapshotReader={snapshotSource:(name:string)=>boolean;sourceEntry:(name:string,captured:Map<string,Buffer>)=>{path:string;sha256:string|null};sourcePatch:(entries:Array<{path:string}>)=>string};
  const compile=new Function('path','fs','root','hash','git',`${declarations.join('\n')}\n${functions.join('\n')}\nreturn {snapshotSource,sourceEntry,sourcePatch};`);
  const sourceRoot=path.resolve('snapshot-fixture');
  const sourceFs={existsSync:()=>true,lstatSync:()=>({isFile:()=>true}),realpathSync:(file:string)=>file,readFileSync:()=>Buffer.from('source')};
  const selected=compile(path,sourceFs,sourceRoot,()=> 'content-digest') as SnapshotReader;
  for(const name of ['src/main.ts','server/index.ts','tests/example.test.ts','public/assets/model.glb','.github/workflows/ci.yml','.env.example','package.json','package-lock.json','data/dialogue-example.jsonl','data/dialogue-seed.multilingual.jsonl','src/security/credentialPolicy.ts','server/auth/credential-store.ts','docs/secrets-management.md','tests/fixtures/credential-validation.json'])assert.equal(selected.snapshotSource(name),true,name);
  for(const name of ['.local-validation/old/source/src/main.ts','src/node_modules/pkg/index.js','.git/config','.env','.env.local','server/.env.production','server/credentials.json','server/secrets/token.json','src/credentials/config.json','server/Secrets/token.json','src/.credentials/config.json','server/API_keys/private.json','public/assets/private.key','data/world.sqlite','data/dialogue.jsonl','tests/session.db','test-results/old.json','src/tmp/latticefolk-validation-old/result.json','../.env'])assert.equal(selected.snapshotSource(name),false,name);
  const captured=new Map<string,Buffer>();selected.sourceEntry('src/main.ts',captured);assert.equal(captured.get('src/main.ts')?.toString(),'source');
  let unsafeReads=0;
  const noRead=()=>{unsafeReads++;throw new Error('Unexpected content read');};
  const link=compile(path,{...sourceFs,lstatSync:()=>({isFile:()=>false}),readFileSync:noRead},sourceRoot,()=> 'content-digest') as SnapshotReader;
  assert.throws(()=>link.sourceEntry('src/main.ts',new Map()),/not a regular file/);
  const escape=compile(path,{...sourceFs,realpathSync:(file:string)=>file===sourceRoot?file:path.resolve(sourceRoot,'../private/.env'),readFileSync:noRead},sourceRoot,()=> 'content-digest') as SnapshotReader;
  assert.throws(()=>escape.sourceEntry('src/main.ts',new Map()),/outside supported source/);
  for(const destination of ['server/secrets/token.json','src/credentials/config.json']){
    const privateDirectory=compile(path,{...sourceFs,realpathSync:(file:string)=>file===sourceRoot?file:path.resolve(sourceRoot,destination),readFileSync:noRead},sourceRoot,()=> 'content-digest') as SnapshotReader;
    assert.throws(()=>privateDirectory.sourceEntry('src/main.ts',new Map()),/outside supported source/);
  }
  assert.equal(unsafeReads,0);
  const diffCalls:string[][]=[];
  const patchReader=compile(path,sourceFs,sourceRoot,()=> 'content-digest',(...args:string[])=>{diffCalls.push(args);return 'selected source patch';}) as SnapshotReader;
  assert.equal(patchReader.sourcePatch([]),'');assert.equal(diffCalls.length,0);
  assert.equal(patchReader.sourcePatch([{path:'src/main.ts'},{path:'data/dialogue-seed.multilingual.jsonl'},{path:'src/[fixture]*.ts'}]),'selected source patch');
  assert.deepEqual(diffCalls,[['diff','HEAD','--binary','--',':(literal)src/main.ts',':(literal)data/dialogue-seed.multilingual.jsonl',':(literal)src/[fixture]*.ts']]);
});

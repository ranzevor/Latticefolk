import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
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

test('browser diagnostics share the effective HTML output root',()=>{
  assert.ok(config.outputDir);
  assert.ok(isAbsolute(config.outputDir));
  const output=dirname(config.outputDir);
  assert.ok(process.env.PLAYWRIGHT_HTML_OUTPUT_DIR);
  assert.equal(output,dirname(process.env.PLAYWRIGHT_HTML_OUTPUT_DIR));
  assert.equal(config.outputDir,join(output,'test-results'));
  assert.deepEqual(config.reporter,[
    ['list'],
    ['html',{open:'never',outputFolder:process.env.PLAYWRIGHT_HTML_OUTPUT_DIR}]
  ]);
  assert.equal(config.use?.screenshot,'only-on-failure');
  assert.equal(config.use?.trace,'retain-on-failure');
});

test('separate config loads allocate distinct diagnostic roots',()=>{
  const url=new URL('../playwright.config.ts',import.meta.url).href;
  const env={...process.env};
  delete env.PLAYWRIGHT_HTML_OUTPUT_DIR;
  delete env.PLAYWRIGHT_HTML_REPORT;
  const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','--eval',
    `const {default:config}=await import(${JSON.stringify(url)});console.log(JSON.stringify(config.outputDir));`
  ],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',env});
  assert.ifError(result.error);
  assert.equal(result.status,0,result.stderr);
  const outputDir:unknown=JSON.parse(result.stdout);
  assert.ok(typeof outputDir==='string');
  assert.notEqual(outputDir,config.outputDir);
  assert.equal(dirname(dirname(outputDir)),resolve(tmpdir()));
  assert.match(basename(dirname(outputDir)),/^latticefolk-playwright-[A-Za-z0-9]+$/);
  const checkout=resolve(fileURLToPath(new URL('../',import.meta.url)));
  assert.notEqual(dirname(outputDir),checkout);
  assert.equal(dirname(outputDir).startsWith(checkout+sep),false);
  assert.equal(existsSync(dirname(outputDir)),true);
  assert.deepEqual(readdirSync(dirname(outputDir)),[]);
});

test('config reloads inherit the current run root and native HTML directory precedence',()=>{
  const url=new URL('../playwright.config.ts',import.meta.url).href;
  const fixture=mkdtempSync(join(tmpdir(),'latticefolk-html-path-test-'));
  const preferred=join(fixture,'preferred','html'),alias=join(fixture,'alias','html');
  const cases=[
    {env:{...process.env},html:process.env.PLAYWRIGHT_HTML_OUTPUT_DIR!},
    {env:{...process.env,PLAYWRIGHT_HTML_OUTPUT_DIR:preferred,PLAYWRIGHT_HTML_REPORT:alias},html:preferred},
    {env:{...process.env,PLAYWRIGHT_HTML_OUTPUT_DIR:'',PLAYWRIGHT_HTML_REPORT:alias},html:alias}
  ];
  for(const entry of cases){
    const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','--eval',
      `const {default:config}=await import(${JSON.stringify(url)});console.log(JSON.stringify({outputDir:config.outputDir,html:config.reporter[1][1].outputFolder,effective:process.env.PLAYWRIGHT_HTML_OUTPUT_DIR}));`
    ],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',env:entry.env});
    assert.ifError(result.error);
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout),{
      outputDir:join(dirname(resolve(entry.html)),'test-results'),html:resolve(entry.html),effective:resolve(entry.html)
    });
  }
});

test('local validation uses unique temporary reports and the existing checkout lock',()=>{
  const source=readFileSync(new URL('../scripts/validate-local.mjs',import.meta.url),'utf8');
  const ast=ts.createSourceFile('validate-local.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const helper=ast.statements.find((node):node is ts.FunctionDeclaration=>
    ts.isFunctionDeclaration(node)&&node.name?.text==='validationPaths');
  assert.ok(helper);
  const paths=new Function('fs','path','tmpdir',`return (${helper.getText(ast)});`)(
    {mkdtempSync,mkdirSync},{join,dirname},tmpdir
  ) as (projectRoot:string,temporaryRoot?:string)=>{output:string;lock:string};
  const fixture=mkdtempSync(join(tmpdir(),'latticefolk-validation-path-test-'));
  const checkout=join(fixture,'checkout');
  const a=paths(checkout,fixture),b=paths(checkout,fixture),other=paths(join(fixture,'other'));
  assert.notEqual(a.output,b.output);
  assert.equal(dirname(a.output),fixture);
  assert.equal(dirname(other.output),resolve(tmpdir()));
  assert.equal(a.lock,join(checkout,'.local-validation','running.lock'));
  assert.equal(a.lock,b.lock);
  assert.notEqual(a.lock,other.lock);
  assert.deepEqual(readdirSync(a.output),[]);
  writeFileSync(a.lock,'existing validator',{flag:'wx'});
  assert.throws(()=>openSync(b.lock,'wx'),/EEXIST/);
  assert.equal(readFileSync(a.lock,'utf8'),'existing validator');
});

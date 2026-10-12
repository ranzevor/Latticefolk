import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../e2e/playable-smoke.spec.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('playable-smoke.spec.ts',source,ts.ScriptTarget.Latest,true);
const runtime=ast.statements.find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==='runtime')!;
const code=ts.transpileModule(runtime.getText(ast)+'\nreturn runtime;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
for(const [value,expected] of [[undefined,false],['false',false],['true',true]] as const)test(`visual readiness observation ${value??'missing'}`,async()=>{
 const read=new Function('document',code)({querySelector:()=>({dataset:{assetsReady:value,assetFailures:'0'}})});
 const result=await read({evaluate:async(fn:()=>unknown)=>fn()});
 assert.equal(result.assetsReady,expected);assert.equal(result.assetFailures,0);
});

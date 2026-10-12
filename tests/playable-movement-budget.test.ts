import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source=fs.readFileSync(process.env.MOVEMENT_GATE_SOURCE??new URL('../e2e/playable-smoke.spec.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('playable-smoke.spec.ts',source,ts.ScriptTarget.Latest,true);
const wrapper=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='drivePlayerTo') as ts.FunctionDeclaration;
const calls:ts.CallExpression[]=[];
function visit(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='drivePlayerTo')calls.push(node);ts.forEachChild(node,visit);}
visit(ast);
test('all three tool-contact routes require explicit input budgets and retain endpoint contracts',()=>{
 assert.equal(calls.length,3);
 assert.deepEqual(calls.map(call=>call.arguments.slice(2).map(arg=>Number(arg.getText(ast).replaceAll('_','')))),[[3,45000,.55],[3,45000,.45],[1,12000,.28]]);
 assert.equal(wrapper.parameters[2].name.getText(ast),'maxInputSeconds');
 assert.equal(wrapper.parameters[2].initializer,undefined);
});
const code=ts.transpileModule(wrapper.getText(ast)+'\nreturn drivePlayerTo;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
for(const reached of [true,false])test(`tool-contact wrapper preserves bounded driver result ${reached}`,async()=>{
 let received:unknown;
 const driver=()=>{};
 const run=new Function('driveNativeWaypoint','expect',code)(driver,(actual:unknown)=>({toBe(expected:unknown){assert.equal(actual,expected);}}));
 const page={evaluate:async(fn:unknown,args:unknown)=>{assert.equal(fn,driver);received=args;return{reached,x:1,z:2};}};
 const pending=run(page,{x:5.2,z:4},3,45000,.55);
 if(reached)await pending;else await assert.rejects(pending);
 assert.deepEqual(received,{target:{x:5.2,z:4},timeoutMs:45000,tolerance:.55,maxInputSeconds:3});
});

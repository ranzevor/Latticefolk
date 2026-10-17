import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import {I18n,SUPPORTED_LOCALES} from '../src/i18n.js';
import {startTown} from '../src/ui/startup.js';

const {JSDOM}=createRequire(import.meta.url)('jsdom');
const source=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const mount=ast.statements.find(s=>ts.isExpressionStatement(s)&&ts.isBinaryExpression(s.expression)
  &&s.expression.left.getText(ast)==='app.innerHTML');
assert.ok(mount);
// Run the actual application entry, not a test-only invocation of the guard.
const entry=ast.statements.at(-1)!;
const boot=new Function('TownGame','app','i18n','startTown',entry.getText(ast));
function fixture(locale='en'){
  const dom=new JSDOM('<div id="app"></div>'),document=dom.window.document as Document;
  const app=document.querySelector<HTMLElement>('#app')!,i18n=new I18n(locale);
  new Function('app','i18n','SUPPORTED_LOCALES',mount!.getText(ast))(app,i18n,SUPPORTED_LOCALES);
  return {document,app,i18n,button:app.querySelector<HTMLButtonElement>('#startBtn')!,
    run:(Town:unknown)=>boot(Town,app,i18n,startTown)};
}

const labels={'zh-CN':'无法进入小镇',en:'Town unavailable',ja:'町に入れません',es:'Pueblo no disponible'};
for(const {code} of SUPPORTED_LOCALES)test(`${code}: real WebGL context failure disables entry and exposes a localized persistent alert`,t=>{
  const f=fixture(code),canvas=f.document.createElement('canvas');let contexts=0,constructed=0,entered=0;
  canvas.getContext=(()=>{contexts++;return null;}) as typeof canvas.getContext;
  class UnavailableTown {
    renderer=new THREE.WebGLRenderer({canvas});
    constructor(){constructed++;}
  }
  f.button.addEventListener('click',()=>entered++);
  const errors:unknown[][]=[];t.mock.method(console,'error',(...args:unknown[])=>errors.push(args));
  assert.doesNotThrow(()=>f.run(UnavailableTown));
  assert.ok(contexts>0);assert.equal(constructed,0,'renderer failure happens before the game constructor body');
  assert.equal(f.button.disabled,true);assert.equal(f.button.textContent,labels[code]);
  f.button.click();f.button.click();assert.equal(entered,0,'repeat clicks cannot pretend to enter a failed runtime');
  const alert=f.app.querySelector<HTMLElement>('[role="alert"]')!;
  assert.equal(alert.textContent,f.i18n.t('start.graphicsUnavailable'));assert.match(alert.textContent!,/WebGL 2/);
  assert.equal(alert.dataset.i18n,'start.graphicsUnavailable');
  assert.equal(f.app.querySelector('#startOverlay')!.classList.contains('hidden'),false);
  assert.equal(f.app.querySelector('[data-i18n="start.retry"]')!.textContent,f.i18n.t('start.retry'));
  assert.equal(f.app.querySelector('[data-i18n="start.controls"]'),null,'movement instructions must not imply the world is ready');
  assert.ok(errors.some(args=>args[0]==='Latticefolk startup failed:'&&args[1] instanceof Error));
  for(const key of ['start.graphicsUnavailable','start.failed','start.unavailable','start.retry']){
    assert.notEqual(f.i18n.t(key),key);
    if(code!=='en')assert.notEqual(f.i18n.t(key),new I18n('en').t(key),'every supported locale owns its failure message');
  }
});

test('normal startup still constructs once and keeps the original entry UI and handlers',()=>{
  const f=fixture();const before=f.app.innerHTML;let constructed=0,entered=0;
  class AvailableTown {constructor(){constructed++;f.button.addEventListener('click',()=>entered++);}}
  f.run(AvailableTown);assert.equal(constructed,1);assert.equal(f.app.innerHTML,before);
  assert.equal(f.button.disabled,false);f.button.click();assert.equal(entered,1);
  assert.equal(f.app.querySelector('[role="alert"]'),null);
});

test('unexpected constructor failures stay blocked without leaking thrown markup or claiming a WebGL diagnosis',t=>{
  t.mock.method(console,'error',()=>{});
  for(const error of [new Error('<img src=x onerror=alert(1)>'),'unexpected startup failure']){
    const f=fixture();let constructed=0;
    class BrokenTown {constructor(){constructed++;throw error;}}
    assert.doesNotThrow(()=>f.run(BrokenTown));assert.equal(constructed,1);assert.equal(f.button.disabled,true);
    assert.equal(f.app.querySelector('[role="alert"]')!.textContent,f.i18n.t('start.failed'));
    assert.equal(f.app.querySelector('img'),null);
  }
});

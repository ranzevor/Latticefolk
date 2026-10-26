import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {request} from 'node:http';
import {once} from 'node:events';
import test from 'node:test';
import express from 'express';
import {registerStaticFiles} from '../server/staticFiles.js';

test('production static files preserve assets, SPA routes and API errors while missing assets are real 404s',async t=>{
  const dist=fs.mkdtempSync(path.join(os.tmpdir(),'latticefolk-static-'));
  const html='<!doctype html><title>Latticefolk test fixture</title>';
  const bytes=Buffer.from([0,1,2,127,128,255]);
  fs.mkdirSync(path.join(dist,'assets'));
  fs.writeFileSync(path.join(dist,'index.html'),html);
  fs.writeFileSync(path.join(dist,'assets','model.glb'),bytes);
  fs.writeFileSync(path.join(dist,'assets','entry.js'),'export const ready=true;');
  const app=express();
  app.get('/api/fixture-error',(_req,res)=>res.status(400).json({error:'fixture rejection'}));
  registerStaticFiles(app,dist);
  const server=app.listen(0,'127.0.0.1');
  t.after(()=>new Promise<void>((resolve,reject)=>server.close(error=>{
    fs.rmSync(dist,{recursive:true,force:true});if(error)reject(error);else resolve();
  })));
  await once(server,'listening');
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for(const url of ['/assets/model.glb','/assets/model.glb?v=1']){
    const response=await fetch(origin+url);assert.equal(response.status,200);
    assert.match(response.headers.get('content-type')!,/model\/gltf-binary/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  }
  const js=await fetch(origin+'/assets/entry.js?v=1');assert.equal(js.status,200);
  assert.match(js.headers.get('content-type')!,/javascript/);assert.equal(await js.text(),'export const ready=true;');
  const head=await fetch(origin+'/assets/model.glb?v=1',{method:'HEAD'});
  assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(bytes.length));assert.equal(await head.text(),'');
  for(const method of ['GET','HEAD'])for(const url of ['/assets/missing.glb','/assets/missing.glb?v=1','/assets/sub/missing.js']){
    const response=await fetch(origin+url,{method});assert.equal(response.status,404);
    assert.doesNotMatch(response.headers.get('content-type')||'',/html/);
    const body=await response.text();assert.notEqual(body,html);if(method==='HEAD')assert.equal(body,'');
  }
  for(const url of ['/','/town/observer?view=1','/assets-like-route']){
    const response=await fetch(origin+url);assert.equal(response.status,200);
    assert.match(response.headers.get('content-type')!,/html/);assert.equal(await response.text(),html);
  }
  const api=await fetch(origin+'/api/fixture-error');assert.equal(api.status,400);
  assert.deepEqual(await api.json(),{error:'fixture rejection'});

  // Preserve the raw request target, including repeated slashes and encoded dots.
  const raw=(url:string,method='GET',headers:Record<string,string>={})=>new Promise<{status:number;headers:import('node:http').IncomingHttpHeaders;body:Buffer}>((resolve,reject)=>{
    const outgoing=request({hostname:'127.0.0.1',port:(server.address() as AddressInfo).port,path:url,method,headers},response=>{
      const chunks:Buffer[]=[];response.on('data',chunk=>chunks.push(Buffer.from(chunk)));
      response.on('end',()=>resolve({status:response.statusCode!,headers:response.headers,body:Buffer.concat(chunks)}));
      response.on('error',reject);
    });
    outgoing.on('error',reject);outgoing.end();
  });
  const prefixes=['/assets/','/%61ssets/','/assets%2f','/assets%2F','/%61ssets%2f','//assets/','/%2fassets/','/foo%2f..%2fassets/'];
  for(const method of ['GET','HEAD'])for(const query of ['','?v=1','?unrelated=%GG'])for(const prefix of prefixes){
    const existing=await raw(prefix+'entry.js'+query,method);
    assert.equal(existing.status,200,`${method} ${prefix}entry.js${query}`);
    assert.match(existing.headers['content-type']!,/javascript/);
    assert.equal(existing.body.toString(),method==='GET'?'export const ready=true;':'');
    const missing=await raw(prefix+'missing.js'+query,method);
    assert.equal(missing.status,404,`${method} ${prefix}missing.js${query}`);
    assert.doesNotMatch(missing.headers['content-type']||'',/html/);
    assert.equal(missing.body.toString(),method==='GET'?'Not Found':'');
  }
  for(const method of ['GET','HEAD'])for(const url of ['/assets/%','/assets/%GG.js','/%61ssets/%','/assets%2f%GG','/assets/%C0%AF','/assets/%00.js','/town/%']){
    const invalid=await raw(url+'?v=1',method);
    assert.equal(invalid.status,400,`${method} ${url}`);
    assert.doesNotMatch(invalid.headers['content-type']||'',/html/);
    assert.equal(invalid.body.toString(),method==='GET'?'Bad Request':'');
  }
  for(const method of ['GET','HEAD'])for(const url of ['/ASSETS/missing.js','/%41SSETS%2fmissing.js']){
    const missing=await raw(url+'?v=1',method);assert.equal(missing.status,404,`${method} ${url}`);
    assert.doesNotMatch(missing.headers['content-type']||'',/html/);
  }
  for(const method of ['GET','HEAD'])for(const url of ['/assets-like-route','/%61ssets-like-route','/t%6fwn/observer','/assets%252fmissing.js']){
    const spa=await raw(url+'?unrelated=%GG',method);assert.equal(spa.status,200,`${method} ${url}`);
    assert.match(spa.headers['content-type']!,/html/);assert.equal(spa.body.toString(),method==='GET'?html:'');
  }
  const existing=await raw('/%61ssets/entry.js');
  const cached=await raw('/%61ssets/entry.js','GET',{'If-None-Match':existing.headers.etag!});
  assert.equal(cached.status,304);assert.equal(cached.body.length,0);
  const partial=await raw('/assets%2fentry.js','GET',{Range:'bytes=0-5'});
  assert.equal(partial.status,206);assert.equal(partial.body.toString(),'export');
});

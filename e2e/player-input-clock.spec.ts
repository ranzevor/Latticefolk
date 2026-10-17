import {test,expect} from '@playwright/test';
import {startFirstPerson} from './helpers/native-start.js';

test.afterEach(async({page,request})=>{await page.close();const cleanup=await request.delete('/api/world/state');expect(cleanup.ok()).toBe(true);});

test('native short input retains event time with real WebGL and reports frame response',async({page,request},info)=>{
  test.setTimeout(120_000);
  const reset=await request.delete('/api/world/state');expect(reset.ok()).toBe(true);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('latticefolk.locale','en'));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#worldStatus')).toHaveAttribute('data-asset-failures','0');
  await startFirstPerson(page);
  await page.evaluate(()=>{
    const read=()=>{
      const data=document.querySelector<HTMLElement>('#worldStatus')!.dataset;
      return {x:Number(data.playerX),z:Number(data.playerZ),inputSeconds:Number(data.playerInputSeconds),
        clock:JSON.parse(data.simulationClock??'null') as {elapsedSeconds:number;simulatedSeconds:number;pendingSeconds:number;steps:number;inputOverflowCount:number;resetReason:string}|null};
    };
    const evidence={before:read(),keys:[] as {type:string;at:number;eventAt:number;trusted:boolean}[],frames:[] as {at:number;state:ReturnType<typeof read>}[],done:false};
    const key=(event:KeyboardEvent)=>{if(event.code==='KeyD'&&!event.repeat)evidence.keys.push({type:event.type,at:performance.now(),eventAt:event.timeStamp,trusted:event.isTrusted});};
    addEventListener('keydown',key);addEventListener('keyup',key);
    let afterRelease=0;
    const sample=()=>{
      evidence.frames.push({at:performance.now(),state:read()});
      if(evidence.keys.some(k=>k.type==='keyup'))afterRelease++;
      if((afterRelease>=2&&evidence.frames.at(-1)!.state.clock?.pendingSeconds===0)||evidence.frames.length>=128){
        removeEventListener('keydown',key);removeEventListener('keyup',key);evidence.done=true;
      }else requestAnimationFrame(sample);
    };
    (window as unknown as {inputClockEvidence:typeof evidence}).inputClockEvidence=evidence;
    requestAnimationFrame(sample);
  });
  try{
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(100);
  }finally{await page.keyboard.up('KeyD');}
  await page.waitForFunction(()=>Boolean((window as unknown as {inputClockEvidence?:{done:boolean}}).inputClockEvidence?.done),undefined,{timeout:15_000});
  const evidence=await page.evaluate(()=>(window as unknown as {inputClockEvidence:{
    before:{x:number;z:number;inputSeconds:number};keys:{type:string;at:number;eventAt:number;trusted:boolean}[];
    frames:{at:number;state:{x:number;z:number;inputSeconds:number;clock:{elapsedSeconds:number;simulatedSeconds:number;pendingSeconds:number;steps:number;inputOverflowCount:number;resetReason:string}|null}}[]
  }}).inputClockEvidence);
  const intervals=evidence.frames.slice(1).map((frame,index)=>frame.at-evidence.frames[index].at).sort((a,b)=>a-b);
  const percentile=(p:number)=>intervals[Math.min(intervals.length-1,Math.floor(intervals.length*p))]??null;
  const timing={frames:evidence.frames.length,p50Ms:percentile(.5),p95Ms:percentile(.95),maxMs:intervals.at(-1)??null};
  await info.attach('native-input-clock-and-natural-frame-timing',{body:Buffer.from(JSON.stringify({evidence,timing,errors},null,2)),contentType:'application/json'});
  await info.attach('native-input-clock-scene',{body:await page.screenshot(),contentType:'image/png'});
  expect(errors).toEqual([]);expect(evidence.keys.map(k=>k.type)).toEqual(['keydown','keyup']);expect(evidence.keys.every(k=>k.trusted)).toBe(true);
  const held=(evidence.keys[1].eventAt-evidence.keys[0].eventAt)/1000;
  expect(Number.isFinite(held)).toBe(true);expect(held).toBeGreaterThan(0);
  const final=evidence.frames.at(-1)!.state,inputSeconds=final.inputSeconds-evidence.before.inputSeconds;
  expect(Math.abs(inputSeconds-held)).toBeLessThan(.02);
  expect(final.x-evidence.before.x).toBeGreaterThan(.05);
  expect(final.x-evidence.before.x).toBeLessThanOrEqual(4.5*inputSeconds+.01);
  expect(Math.abs(final.z-evidence.before.z)).toBeLessThan(.01);
  const observed=evidence.frames.filter(frame=>frame.at>=evidence.keys[0].at);
  expect(observed.length).toBeGreaterThan(0);
  for(const {state} of observed){
    expect(state.clock).not.toBeNull();expect(state.clock!.resetReason).toBe('none');expect(state.clock!.inputOverflowCount).toBe(0);
    expect(state.clock!.steps).toBeLessThanOrEqual(296);
    expect(state.clock!.simulatedSeconds).toBeLessThanOrEqual(2.000001);
    expect(state.clock!.pendingSeconds).toBeGreaterThanOrEqual(0);
  }
  expect(final.clock!.pendingSeconds).toBe(0);
});

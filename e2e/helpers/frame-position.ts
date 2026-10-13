import { randomUUID } from 'node:crypto';
import { expect,type ConsoleMessage,type Page } from '@playwright/test';

interface PositionSample {x:number;z:number;observedAt:number;}
interface FrameSample {
  poll:number;observedAt:number;x:number|null;z:number|null;inputSeconds:number|null;
  mode:string|null;yaw:number|null;playerBody:string|null;
  nearby:Array<{id:string;x:number;z:number;clearance:number|null}>;
}
interface PollTrace {
  polls:number;sequence:number;dropped:number;firstPollAt:number|null;lastFlushAt:number|null;
  firstReached:FrameSample|null;pending:FrameSample[];
}
interface PollInput {maxZ:number;token:string;trace:PollTrace;}
interface Packet {
  sequence:number;timeOrigin:number;firstPollAt:number;polls:number;dropped:number;
  firstReached:FrameSample|null;samples:FrameSample[];
}
interface ReceivedSample extends FrameSample {timeOrigin:number;receivedAfterCallMs:number;}
export interface PlayerZWaitDiagnostics {
  token:string;timeout:number;maxZ:number;outcome:'resolved'|'rejected';
  waitSettledAfterCallMs:number|null;receivedSamples:number;evictedSamples:number;invalidPackets:number;
  epochs:Array<{timeOrigin:number;lastSequence:number;observedPolls:number;browserDroppedSamples:number}>;
  firstSample:ReceivedSample|null;firstReached:ReceivedSample|null;lastSample:ReceivedSample|null;
  timeline:ReceivedSample[];
  coverage:'received batches only; unflushed or late samples may be missing';
}
const diagnostics=new WeakMap<object,PlayerZWaitDiagnostics>();
/** Test-side evidence only. Neither a late sample nor this record overrides Playwright's verdict. */
export function getPlayerZWaitDiagnostics(value:object) {return diagnostics.get(value);}

/** Serialized into Chromium. Its argument is private to this one Playwright wait, not the app. */
export function observePlayerZ({maxZ,token,trace}:PollInput):PositionSample|false {
  const data=document.querySelector<HTMLElement>('#worldStatus')?.dataset;
  const x=Number(data?.playerX??'NaN'),z=Number(data?.playerZ??'NaN');
  // Freeze precisely the original predicate/result before any optional diagnostic work.
  const result=Number.isFinite(x)&&Number.isFinite(z)&&z<maxZ?{x,z,observedAt:performance.now()}:false;
  try {
    const observedAt=result?result.observedAt:performance.now();
    const nearby:FrameSample['nearby']=[];
    const raw=data?.characterSoles;
    // Bound parsing and output even if diagnostic DOM is malformed or unexpectedly large.
    if(Number.isFinite(x)&&Number.isFinite(z)&&raw&&raw.length<=8192){
      try {
        const actors:unknown=JSON.parse(raw);
        if(Array.isArray(actors)&&actors.length<=64){
          for(const actor of actors){
            if(!actor||typeof actor!=='object')continue;
            const ax=Number(actor.position?.x??'NaN'),az=Number(actor.position?.z??'NaN');
            if(typeof actor.id!=='string'||!Number.isFinite(ax)||!Number.isFinite(az)||Math.hypot(ax-x,az-z)>4)continue;
            const clearance=Number(actor.playerHeadClearance??'NaN');
            nearby.push({id:actor.id.slice(0,64),x:ax,z:az,clearance:Number.isFinite(clearance)?clearance:null});
          }
          nearby.sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z));
          nearby.length=Math.min(nearby.length,3);
        }
      } catch { /* Broken optional NPC diagnostics cannot change the position predicate. */ }
    }
    const inputSeconds=Number(data?.playerInputSeconds??'NaN'),yaw=Number(data?.cameraYaw??'NaN');
    const sample:FrameSample={poll:++trace.polls,observedAt,x:Number.isFinite(x)?x:null,z:Number.isFinite(z)?z:null,
      inputSeconds:Number.isFinite(inputSeconds)?inputSeconds:null,mode:data?.cameraMode?.slice(0,24)??null,
      yaw:Number.isFinite(yaw)?yaw:null,playerBody:data?.playerBodyPresent?.slice(0,8)??null,nearby};
    trace.firstPollAt??=observedAt;
    if(result)trace.firstReached??=sample;
    trace.pending.push(sample);
    if(trace.pending.length>64){trace.pending.shift();trace.dropped++;}
    // One small batch per250ms; a slow frame or the first passing poll flushes immediately.
    // No extra RAF, timer, evaluation, global property, or failure-path browser read.
    if(trace.lastFlushAt===null||observedAt-trace.lastFlushAt>=250||result){
      const packet:Packet={sequence:++trace.sequence,timeOrigin:performance.timeOrigin,firstPollAt:trace.firstPollAt,
        polls:trace.polls,dropped:trace.dropped,firstReached:trace.firstReached,samples:trace.pending};
      console.debug(token+JSON.stringify(packet));
      trace.pending=[];trace.lastFlushAt=observedAt;
    }
  } catch { /* Observation must never replace a true/false result or its timestamp. */ }
  return result;
}

/** Observe within Chromium's animation loop, without repeatedly resolving a locator
 * across a slow WebGL/CDP boundary. This only reads the existing diagnostic DOM.
 * The caller still supplies native keyboard input and releases it in finally.
 */
export async function waitForPlayerZBelow(page:Page,maxZ:number,timeout=20_000) {
  const token=`[player-z-observation:${randomUUID()}]`;
  const trace:PollTrace={polls:0,sequence:0,dropped:0,firstPollAt:null,lastFlushAt:null,firstReached:null,pending:[]};
  const record:PlayerZWaitDiagnostics={token,timeout,maxZ,outcome:'rejected',waitSettledAfterCallMs:null,
    receivedSamples:0,evictedSamples:0,invalidPackets:0,epochs:[],firstSample:null,firstReached:null,lastSample:null,timeline:[],
    coverage:'received batches only; unflushed or late samples may be missing'};
  let startedAt=performance.now();
  const receive=(message:ConsoleMessage)=>{
    try {
      const text=message.text();if(!text.startsWith(token))return;
      if(text.length>131072){record.invalidPackets++;return;}
      const packet=JSON.parse(text.slice(token.length)) as Packet;
      if(!Number.isFinite(packet.timeOrigin)||!Array.isArray(packet.samples)||packet.samples.length>64){record.invalidPackets++;return;}
      const receivedAfterCallMs=performance.now()-startedAt;
      let epoch=record.epochs.find(item=>item.timeOrigin===packet.timeOrigin);
      if(!epoch){if(record.epochs.length>=8){record.invalidPackets++;return;}
        epoch={timeOrigin:packet.timeOrigin,lastSequence:0,observedPolls:0,browserDroppedSamples:0};record.epochs.push(epoch);}
      if(!Number.isInteger(packet.sequence)||packet.sequence<=epoch.lastSequence){record.invalidPackets++;return;}
      epoch.lastSequence=packet.sequence;epoch.observedPolls=packet.polls;epoch.browserDroppedSamples=packet.dropped;
      for(const sample of packet.samples){
        const received={...sample,timeOrigin:packet.timeOrigin,receivedAfterCallMs};
        record.firstSample??=received;record.lastSample=received;record.receivedSamples++;
        record.timeline.push(received);
        if(record.timeline.length>128){record.timeline.shift();record.evictedSamples++;}
      }
      if(!record.firstReached&&packet.firstReached)record.firstReached={...packet.firstReached,timeOrigin:packet.timeOrigin,receivedAfterCallMs};
    } catch {record.invalidPackets++;}
  };
  // Subscription is not awaited; Playwright may send its normal console-subscription message.
  // There is no preflight page evaluation or awaited diagnostic round trip while W is held.
  try{page.on('console',receive);}catch{record.invalidPackets++;}
  startedAt=performance.now();
  try {
    const handle=await page.waitForFunction(observePlayerZ,{maxZ,token,trace},{timeout,polling:'raf'});
    record.waitSettledAfterCallMs=performance.now()-startedAt;
    try {
      const sample=await handle.jsonValue();
      expect(sample).not.toBe(false);
      record.outcome='resolved';
      if(sample&&typeof sample==='object')diagnostics.set(sample,record);
      return sample;
    } finally {
      await handle.dispose();
      // Successful cases do not retain browser traces in the existing workflow. Preserve
      // the already received bounded record in test stdout, with no new browser operation.
      if(record.outcome==='resolved')try{console.info('[player-z-wait] '+JSON.stringify(record));}catch{}
    }
  } catch(error) {
    record.outcome='rejected';
    record.waitSettledAfterCallMs??=performance.now()-startedAt;
    if(error&&typeof error==='object')diagnostics.set(error,record);
    // Full batches are already in Playwright's browser-console trace. Keep stderr small and
    // never await diagnostic transport before the caller's finally releases native input.
    try {console.error('[player-z-wait] '+JSON.stringify({token,timeout,maxZ,outcome:'rejected',
      waitSettledAfterCallMs:record.waitSettledAfterCallMs,receivedSamples:record.receivedSamples,
      lastSample:record.lastSample,firstReached:record.firstReached,coverage:record.coverage}));}catch{}
    throw error;
  } finally {try{page.off('console',receive);}catch{}}
}

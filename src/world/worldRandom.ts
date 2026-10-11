import {readNpcContinuation,readWildlifeContinuation} from './actorContinuation.js';
import type {WorldPersistenceSnapshot, WorldRandomness} from '../types.js';

export const DEFAULT_WORLD_SEED='latticefolk-default';
export const WORLD_RANDOM_VERSION=1;
export type RandomSource=()=>number;
type RandomKey=string|number|boolean|null|undefined;

export class WorldRandomValidationError extends Error {}

export function readWorldRandomness(value:unknown):WorldRandomness {
  if(value===undefined)return {version:WORLD_RANDOM_VERSION,seed:DEFAULT_WORLD_SEED};
  if(!value||typeof value!=='object'||Array.isArray(value))throw new WorldRandomValidationError('Invalid world randomness metadata');
  const {version,seed}=value as Record<string,unknown>;
  if(version!==WORLD_RANDOM_VERSION)throw new WorldRandomValidationError('Unsupported world randomness version');
  if(typeof seed!=='string'||!seed.trim()||seed.length>256)throw new WorldRandomValidationError('Invalid world random seed');
  return {version,seed};
}

export function randomEventCursor(value:unknown):number {
  if(value===undefined)return 0;
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new WorldRandomValidationError('Invalid entity random event cursor');
  return value;
}

/** Check all stored random authority before creating or mutating the world. */
export function snapshotRandomness(snapshot:WorldPersistenceSnapshot):WorldRandomness {
  const randomness=readWorldRandomness(snapshot.meta.randomness);
  for(const state of snapshot.homeNpcs||[]){randomEventCursor(state.randomEventCursor);readNpcContinuation(state.continuation);}
  for(const chunk of snapshot.fineChunks||[]){
    for(const state of chunk.npcStates||[]){randomEventCursor(state.randomEventCursor);readNpcContinuation(state.continuation);}
    for(const state of chunk.wildlifeStates||[]){randomEventCursor(state.randomEventCursor);readWildlifeContinuation(state.continuation);}
  }
  for(const transfer of snapshot.wildlifeTransfers||[]){randomEventCursor(transfer.state.randomEventCursor);readWildlifeContinuation(transfer.state.continuation);}
  return randomness;
}

export function hashText(text:string):number {
  let h=2166136261;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
  return h>>>0;
}

/** The existing fine planner's FNV-1a / Mulberry32 sequence. */
export function randomFromKey(key:string):RandomSource {
  let s=hashText(key)||1;
  return ()=>{
    s+=0x6D2B79F5;
    let t=s;
    t=Math.imul(t^(t>>>15),t|1);
    t^=t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}

export function keyedRandom(randomness:WorldRandomness,domain:string,...key:RandomKey[]):RandomSource {
  const {version,seed}=readWorldRandomness(randomness);
  return randomFromKey(JSON.stringify([version,seed,domain,...key.map(value=>value??null)]));
}

/** One accepted event owns a local draw sequence, independent of other actors. */
export function beginRandomEvent(randomness:WorldRandomness,state:{id:string;randomEventCursor?:number},kind:string,...key:RandomKey[]):RandomSource {
  const cursor=randomEventCursor(state.randomEventCursor);
  if(cursor===Number.MAX_SAFE_INTEGER)throw new WorldRandomValidationError('Entity random event cursor exhausted');
  const random=keyedRandom(randomness,'event',kind,state.id,cursor,...key);
  state.randomEventCursor=cursor+1;
  return random;
}

/** Preserve every historical default-seed layout value, including road axes. */
export function fineLayoutKey(seed:string,key:string):string {
  return seed===DEFAULT_WORLD_SEED?key:JSON.stringify([WORLD_RANDOM_VERSION,seed,'fine-layout',key]);
}


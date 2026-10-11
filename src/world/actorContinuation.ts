import type {DecisionAction,NpcState,SocialIntent,Vec2} from '../types.js';

interface NpcTask {
  action:DecisionAction;targetNpcId?:string;targetObjectId?:string;intent?:SocialIntent;
  approach?:Vec2&{yaw:number};startedAt:number;
}
export interface NpcContinuation {
  version:1;path:Vec2[];nextDecisionInMs:number;
  task?:Omit<NpcTask,'startedAt'>&{elapsedMs:number};
}
interface Runtime {
  state:NpcState;path:Vec2[];pathIndex:number;nextDecisionAt:number;task?:NpcTask;
}
const actions=new Set(['idle','wander','talk','work','rest','eat','pickup','use_object','inspect','drop_item','harvest','craft','trade','gift','deliver','fetch_water','patrol','visit','sleep','explore']);
const intents=new Set(['greet','smalltalk','ask_help','offer_help','trade','joke','praise','complain','share_news','leave']);
export class ActorContinuationError extends Error {}
const reject=():never=>{throw new ActorContinuationError('Invalid actor continuation');};
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:reject();
const number=(value:unknown,min=-Number.MAX_SAFE_INTEGER):number=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=Number.MAX_SAFE_INTEGER?value:reject();
const point=(value:unknown):Vec2=>{const p=record(value);return {x:number(p.x),z:number(p.z)};};
const identifier=(value:unknown):string|undefined=>value===undefined?undefined:typeof value==='string'&&value.length>0&&value.length<=256?value:reject();

export function readNpcContinuation(value:unknown):NpcContinuation|undefined {
  if(value===undefined)return undefined;
  const v=record(value);
  if(v.version!==1||!Array.isArray(v.path)||v.path.length>4096)reject();
  const result:NpcContinuation={version:1,path:(v.path as unknown[]).map(point),nextDecisionInMs:number(v.nextDecisionInMs,0)};
  if(v.task!==undefined){
    const task=record(v.task);
    if(typeof task.action!=='string'||!actions.has(task.action))reject();
    if(task.intent!==undefined&&(typeof task.intent!=='string'||!intents.has(task.intent)))reject();
    result.task={action:task.action as DecisionAction,elapsedMs:number(task.elapsedMs,0)};
    const npc=identifier(task.targetNpcId),object=identifier(task.targetObjectId);
    if(npc!==undefined)result.task.targetNpcId=npc;
    if(object!==undefined)result.task.targetObjectId=object;
    if(task.intent!==undefined)result.task.intent=task.intent as SocialIntent;
    if(task.approach!==undefined)result.task.approach={...point(task.approach),yaw:number(record(task.approach).yaw)};
  }
  return result;
}

export function checkpointNpc(runtime:Runtime,clock:number):NpcState {
  number(clock,0);
  if(!Number.isInteger(runtime.pathIndex)||runtime.pathIndex<0||runtime.pathIndex>runtime.path.length)reject();
  const continuation:NpcContinuation={version:1,path:runtime.path.slice(runtime.pathIndex).map(p=>({...p})),nextDecisionInMs:Math.max(0,runtime.nextDecisionAt-clock)};
  if(runtime.task){
    const {startedAt,...task}=runtime.task;
    continuation.task={...structuredClone(task),elapsedMs:Math.max(0,clock-number(startedAt))};
  }
  return {...structuredClone(runtime.state),continuation:readNpcContinuation(continuation)};
}

export function restoreNpcContinuation(runtime:Runtime,clock:number):void {
  number(clock,0);
  const value=readNpcContinuation(runtime.state.continuation);
  if(!value)return;
  runtime.path=value.path;runtime.pathIndex=0;runtime.nextDecisionAt=number(clock+value.nextDecisionInMs,0);
  runtime.task=undefined;
  if(value.task){const {elapsedMs,...task}=value.task;runtime.task={...task,startedAt:clock-elapsedMs};}
  delete runtime.state.continuation;
}

export interface WildlifeContinuation {
  version:1;path:Vec2[];nextDecisionInMs:number;actionResolved:boolean;controllerSpeed:number;
}
interface WildlifeRuntime {
  state:import('../types.js').WildlifeState;path:Vec2[];pathIndex:number;nextDecisionAt:number;actionResolved:boolean;controllerSpeed:number;
}
export function readWildlifeContinuation(value:unknown):WildlifeContinuation|undefined {
  if(value===undefined)return undefined;
  const v=record(value),common=readNpcContinuation(value)!;
  if(v.task!==undefined||typeof v.actionResolved!=='boolean')reject();
  return {version:1,path:common.path,nextDecisionInMs:common.nextDecisionInMs,actionResolved:v.actionResolved as boolean,controllerSpeed:number(v.controllerSpeed,0)};
}
export function checkpointWildlife(runtime:WildlifeRuntime,clock:number):import('../types.js').WildlifeState {
  number(clock,0);
  if(!Number.isInteger(runtime.pathIndex)||runtime.pathIndex<0||runtime.pathIndex>runtime.path.length)reject();
  return {...structuredClone(runtime.state),continuation:readWildlifeContinuation({version:1,path:runtime.path.slice(runtime.pathIndex),
    nextDecisionInMs:Math.max(0,runtime.nextDecisionAt-clock),actionResolved:runtime.actionResolved,controllerSpeed:runtime.controllerSpeed??0})};
}
export function restoreWildlifeContinuation(runtime:WildlifeRuntime,clock:number):void {
  number(clock,0);
  const value=readWildlifeContinuation(runtime.state.continuation);
  if(!value)return;
  runtime.path=value.path;runtime.pathIndex=0;runtime.nextDecisionAt=number(clock+value.nextDecisionInMs,0);
  runtime.actionResolved=value.actionResolved;runtime.controllerSpeed=value.controllerSpeed;
  delete runtime.state.continuation;
}

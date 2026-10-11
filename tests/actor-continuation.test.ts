import assert from 'node:assert/strict';
import test from 'node:test';
import {restoreNpcContinuation,restoreWildlifeContinuation,ActorContinuationError} from '../src/world/actorContinuation.js';
for(const kind of ['npc','wildlife'] as const)test(`${kind} rejects an overflowing restored deadline without partial runtime mutation`,()=>{
 const runtime:any={state:{id:'actor',continuation:{version:1,path:[{x:4,z:5}],nextDecisionInMs:Number.MAX_SAFE_INTEGER,
  ...(kind==='npc'?{task:{action:'patrol',elapsedMs:10}}:{actionResolved:false,controllerSpeed:2})}},
  path:[{x:1,z:2}],pathIndex:1,nextDecisionAt:20,task:{action:'idle',startedAt:0},actionResolved:true,controllerSpeed:1};
 const before=structuredClone(runtime);
 assert.throws(()=>(kind==='npc'?restoreNpcContinuation:restoreWildlifeContinuation)(runtime,100),ActorContinuationError);
 assert.deepEqual(runtime,before);
});

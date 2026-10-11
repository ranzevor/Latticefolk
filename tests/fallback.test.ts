import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackDecision, fallbackDialogue, fallbackChunkDecisions } from '../server/decision/rules.js';
import type { DecisionRequest, DialogueRequest, DialogueEntry, NpcState } from '../src/types.js';

function npc(overrides: Partial<NpcState> = {}): NpcState {
  return {
    id: 'npc-1', name: 'Ari', role: 'resident', position: { x: 0, z: 0 }, home: { x: 0, z: 0 },
    mood: 'neutral', hunger: 20, energy: 80, social: 80, money: 5, inventory: [], relationships: {}, memories: [],
    currentAction: 'idle', goal: 'live normally', lastDecisionAt: 0, ...overrides,
  };
}

function request(overrides: Partial<NpcState> = {}): DecisionRequest {
  return {
    npc: npc(overrides),
    allowedActions: ['idle', 'wander', 'eat', 'rest', 'talk'],
    world: { gameTime: '12:00', minuteOfDay: 720, weather: 'clear', nearbyNpcs: [], nearbyObjects: [], recentEvents: [] },
  };
}

test('hungry NPC chooses eat when legal', () => {
  const result = fallbackDecision(request({ hunger: 90 }));
  assert.equal(result.action, 'eat');
});

test('exhausted NPC chooses rest when legal', () => {
  const result = fallbackDecision(request({ hunger: 10, energy: 10 }));
  assert.equal(result.action, 'rest');
});

test('fallback never returns an illegal action', () => {
  const req = request({ hunger: 99, energy: 1 });
  req.allowedActions = ['wander'];
  const result = fallbackDecision(req);
  assert.ok(req.allowedActions.includes(result.action));
});


test('coarse chunk fallback reacts to scarcity without inventing numeric mutations', () => {
  const result = fallbackChunkDecisions({
    day: 3,
    gameTime: '14:20',
    weather: 'clear',
    chunks: [{
      id:'chunk_2_0', cx:2, cz:0, biome:'plains', settlementLevel:1, population:18,
      food:12, wood:55, water:20, ecology:46, danger:25, prosperity:38,
      strategy:'sustain', migrationPolicy:'retain', ecologyPolicy:'balance',
      lastDecisionAt:0, decisionVersion:0
    }]
  });
  assert.equal(result.decisions[0]?.strategy, 'conserve');
  assert.equal(result.decisions[0]?.migrationPolicy, 'release');
  assert.equal(result.decisions[0]?.ecologyPolicy, 'recover');
});

function dialogueRequest():DialogueRequest {
  return {speaker:{id:'a',name:'A',role:'farmer',mood:'neutral'},listener:{id:'b',name:'B',role:'resident',mood:'neutral'},
    situation:'meeting',intent:'greet',world:{gameTime:'12:00',weather:'clear',nearbyTags:[]},recentLines:[]};
}
function lines(kind:'line'|'fragment',slot?:DialogueEntry['slot']):DialogueEntry[]{
  return Array.from({length:8},(_,i)=>({id:`${slot??kind}-${i}`,kind,slot,text:`${slot??kind} ${i}`,tags:[],intents:['greet'],moods:[],roles:[],weight:1}));
}
const reverseKeys=(value:any):any=>Array.isArray(value)?value.map(reverseKeys):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reverseKeys(value[key])])):value;

test('decision fallback repeats across request key order and unrelated calls without global randomness',t=>{
  t.mock.method(Math,'random',()=>{throw new Error('global randomness');});
  const req=request({role:'farmer'});req.allowedActions=['harvest','work','wander','idle'];
  const baseline=fallbackDecision(req),before=structuredClone(req);
  for(let i=0;i<20;i++){
    fallbackDecision(request({id:`other-${i}`,role:'guard'}));
    assert.deepEqual(fallbackDecision(reverseKeys(req)),baseline);
  }
  assert.deepEqual(req,before);assert.ok(req.allowedActions.includes(baseline.action));
});
for(const mode of ['line','fragments'] as const)test(`dialogue ${mode} fallback repeats without global randomness`,t=>{
  t.mock.method(Math,'random',()=>{throw new Error('global randomness');});
  const req=dialogueRequest(),candidates=mode==='line'?lines('line'):[];
  const fragments={opener:lines('fragment','opener'),body:lines('fragment','body'),closer:lines('fragment','closer')};
  const before=structuredClone({req,candidates,fragments}),baseline=fallbackDialogue(req,candidates,fragments);
  for(let i=0;i<20;i++){
    fallbackDialogue({...req,situation:`other-${i}`},candidates,fragments);
    assert.deepEqual(fallbackDialogue(reverseKeys(req),reverseKeys(candidates),reverseKeys(fragments)),baseline);
  }
  assert.deepEqual({req,candidates,fragments},before);assert.equal(baseline.mode,mode);
  const selected=[...candidates,...fragments.opener,...fragments.body,...fragments.closer];
  assert.ok(baseline.selectedIds.every(id=>selected.some(line=>line.id===id)));
});

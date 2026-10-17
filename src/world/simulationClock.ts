export interface PlayerMovementInput {
  forward:number;
  right:number;
  sprint:boolean;
  directionX:number;
  directionZ:number;
}

export const SIMULATION_STEP_MS=50;
export const SIMULATION_MAX_ADVANCE_MS=2000;
export const SIMULATION_MAX_INPUT_CHANGES=256;
export const isPlayerMovementKey=(code:string)=>['KeyW','KeyA','KeyS','KeyD','ShiftLeft'].includes(code);

type InputChange={at:number;input:PlayerMovementInput|undefined};
type ResetReason='none'|'suspended'|'invalid-time'|'input-overflow';

export class SimulationClock {
  private sampledAt?:number;
  private advancedThroughMs?:number;
  get consumedThroughMs(){return this.advancedThroughMs;}
  private lastFrameAt?:number;
  private lastAnimationAt?:number;
  private input?:PlayerMovementInput;
  private changes:InputChange[]=[];
  private lateEventOffset?:number;
  readonly diagnostics={elapsedSeconds:0,simulatedSeconds:0,pendingSeconds:0,steps:0,inputOverflowCount:0,resetReason:'none' as ResetReason};

  reset(reason:ResetReason='suspended') {
    this.sampledAt=undefined;this.advancedThroughMs=undefined;this.lastFrameAt=undefined;this.lastAnimationAt=undefined;
    this.clearInput();this.lateEventOffset=undefined;
    Object.assign(this.diagnostics,{elapsedSeconds:0,simulatedSeconds:0,pendingSeconds:0,steps:0,resetReason:reason});
  }

  clearInput(){this.input=undefined;this.changes=[];}

  recordEvent(eventAt:number|undefined,handledAt:number,input:PlayerMovementInput|undefined):boolean {
    if(!Number.isFinite(handledAt)||handledAt<0||handledAt<(this.lastFrameAt??0))return this.record(handledAt,input);
    const validEvent=typeof eventAt==='number'&&Number.isFinite(eventAt)&&eventAt>=0&&eventAt<=handledAt;
    let at=validEvent?eventAt!:handledAt;
    const consumed=this.advancedThroughMs??this.sampledAt;
    if(validEvent&&this.sampledAt!==undefined&&at<this.sampledAt){
      if(this.lateEventOffset===undefined)this.lateEventOffset=this.sampledAt-at;
      at+=this.lateEventOffset;
    }else if(this.lateEventOffset!==undefined&&validEvent){
      at+=this.lateEventOffset;
    }
    const recorded=this.recordInput(Math.max(at,this.sampledAt??0,this.changes.at(-1)?.at??0),input,true);
    if(input===undefined)this.lateEventOffset=undefined;
    return recorded;
  }

  record(at:number,input:PlayerMovementInput|undefined):boolean {
    return this.recordInput(at,input,false);
  }

  private recordInput(at:number,input:PlayerMovementInput|undefined,allowFrameDebt:boolean):boolean {
    const latest=this.changes.at(-1);
    if(!Number.isFinite(at)||at<0||(this.sampledAt!==undefined&&at<this.sampledAt)||(!allowFrameDebt&&this.lastFrameAt!==undefined&&at<this.lastFrameAt)||(latest&&at<latest.at)){
      this.reset('invalid-time');return false;
    }
    if(this.sampledAt===undefined){this.sampledAt=at;this.lastFrameAt=at;}
    const previous=latest?latest.input:this.input;
    if(this.sameInput(previous,input))return true;
    const change={at,input:input?{...input}:undefined};
    if(this.changes.length===SIMULATION_MAX_INPUT_CHANGES){
      this.diagnostics.inputOverflowCount++;this.diagnostics.resetReason='input-overflow';return false;
    }
    if(latest?.at===at){this.changes[this.changes.length-1]=change;return true;}
    if(this.changes.length>=SIMULATION_MAX_INPUT_CHANGES-1){
      if(this.changes.length<SIMULATION_MAX_INPUT_CHANGES)this.changes.push({at,input:undefined});
      this.diagnostics.inputOverflowCount++;this.diagnostics.resetReason='input-overflow';return false;
    }
    this.changes.push(change);return true;
  }

  advance(at:number,step:(seconds:number,input:PlayerMovementInput|undefined)=>void):boolean {
    return this.advanceTo(at,at,step);
  }

  advanceFrame(frameAt:number|undefined,handledAt:number,step:(seconds:number,input:PlayerMovementInput|undefined)=>void):boolean {
    const at=frameAt===undefined?handledAt:frameAt;
    if(!Number.isFinite(at)||at<0||!Number.isFinite(handledAt)||at>handledAt||(frameAt!==undefined&&this.lastAnimationAt!==undefined&&frameAt<this.lastAnimationAt)){
      this.reset('invalid-time');return false;
    }
    if(frameAt!==undefined)this.lastAnimationAt=frameAt;
    return this.advanceTo(Math.max(at,this.lastFrameAt??at),handledAt,step);
  }

  private advanceTo(at:number,handledAt:number,step:(seconds:number,input:PlayerMovementInput|undefined)=>void):boolean {
    if(!Number.isFinite(at)||at<0||!Number.isFinite(handledAt)||at>handledAt||(this.sampledAt!==undefined&&at<this.sampledAt)||(this.lastFrameAt!==undefined&&at<this.lastFrameAt)||(this.changes.at(-1)?.at??0)>handledAt){
      this.reset('invalid-time');return false;
    }
    if(this.sampledAt===undefined){this.sampledAt=at;this.lastFrameAt=at;this.advancedThroughMs=at;return true;}
    const endAt=Math.min(at,this.sampledAt+SIMULATION_MAX_ADVANCE_MS);
    Object.assign(this.diagnostics,{elapsedSeconds:(at-this.lastFrameAt!)/1000,simulatedSeconds:0,pendingSeconds:(at-endAt)/1000,steps:0,resetReason:'none'});
    this.lastFrameAt=at;
    let cursor=this.sampledAt,index=0;
    while(cursor<endAt){
      while(index<this.changes.length&&this.changes[index].at<=cursor)this.input=this.changes[index++].input;
      const end=Math.min(endAt,cursor+SIMULATION_STEP_MS,this.changes[index]?.at??endAt);
      const seconds=(end-cursor)/1000;
      step(seconds,this.input);
      this.diagnostics.steps++;
      this.diagnostics.simulatedSeconds+=seconds;
      cursor=end;
    }
    while(index<this.changes.length&&this.changes[index].at<=endAt)this.input=this.changes[index++].input;
    this.changes.splice(0,index);this.sampledAt=endAt;this.advancedThroughMs=endAt;return true;
  }

  private sameInput(a:PlayerMovementInput|undefined,b:PlayerMovementInput|undefined){
    return a===b||Boolean(a&&b&&a.forward===b.forward&&a.right===b.right&&a.sprint===b.sprint&&a.directionX===b.directionX&&a.directionZ===b.directionZ);
  }
}


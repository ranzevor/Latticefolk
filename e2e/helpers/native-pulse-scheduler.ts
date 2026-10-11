export type NativeKeyCommand={type:'rawKeyDown'|'keyUp';code:string;key:string;windowsVirtualKeyCode:number;modifiers:number;location?:number};
export type NativePulseRequest={codes:string[];durationMs:number;deadlineEpochMs:number};
export type NativePulseHost={now:()=>number;schedule:(callback:()=>void,delay:number)=>unknown;cancel:(timer:unknown)=>void;dispatch:(command:NativeKeyCommand)=>Promise<unknown>};

export async function scheduleNativePulse(request:NativePulseRequest,host:NativePulseHost){
  const descriptions:Record<string,{key:string;windowsVirtualKeyCode:number;location?:number}>={
    KeyW:{key:'w',windowsVirtualKeyCode:87},KeyA:{key:'a',windowsVirtualKeyCode:65},
    KeyS:{key:'s',windowsVirtualKeyCode:83},KeyD:{key:'d',windowsVirtualKeyCode:68},
    ShiftLeft:{key:'Shift',windowsVirtualKeyCode:16,location:1}
  };
  if(!request.codes.length||new Set(request.codes).size!==request.codes.length||request.codes.some(code=>!descriptions[code])||
    !Number.isFinite(request.durationMs)||request.durationMs<=0||!Number.isFinite(request.deadlineEpochMs))throw new Error('Invalid native pulse request');
  const receivedAt=host.now(),durationMs=Math.min(request.durationMs,request.deadlineEpochMs-receivedAt);
  const commands:Array<{command:NativeKeyCommand;issuedAt:number;confirmedAt?:number;error?:string}>=[];
  const result={request,receivedAt,durationMs,releasedAt:null as number|null,commands,errors:[] as string[],skipped:durationMs<=0};
  if(result.skipped)return result;
  const codes=[...request.codes].sort((a,b)=>Number(b==='ShiftLeft')-Number(a==='ShiftLeft'));
  const held=new Set<string>(),responses:Promise<void>[]=[];
  let released=false,timer:unknown,finishRelease=()=>{};
  const releaseComplete=new Promise<void>(resolve=>{finishRelease=resolve;});
  const dispatch=(type:NativeKeyCommand['type'],code:string)=>{
    if(type==='rawKeyDown')held.add(code);else held.delete(code);
    const command={type,code,...descriptions[code],modifiers:held.has('ShiftLeft')?8:0};
    const row:typeof commands[number]={command,issuedAt:host.now()};commands.push(row);
    let response:Promise<unknown>;
    try{response=host.dispatch(command);}catch(error){response=Promise.reject(error);}
    responses.push(response.then(()=>{row.confirmedAt=host.now();},error=>{
      row.confirmedAt=host.now();row.error=String(error);result.errors.push(row.error);
      if(type==='rawKeyDown')release();
    }));
  };
  const release=()=>{
    if(released)return;released=true;host.cancel(timer);result.releasedAt=host.now();
    for(const code of [...codes].reverse())dispatch('keyUp',code);
    finishRelease();
  };
  timer=host.schedule(release,durationMs);
  for(const code of codes)dispatch('rawKeyDown',code);
  await releaseComplete;
  await Promise.all(responses);
  return result;
}

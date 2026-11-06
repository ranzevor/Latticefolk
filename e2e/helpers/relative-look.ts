import { expect, type Page } from '@playwright/test';

// Headless pointer lock does not reliably convert out-of-viewport absolute mouse
// coordinates to deltas. Use the ordinary PointerLockControls event listener, never
// camera/game state writes. Native Start/E/menu input is unchanged.
export async function lookForObject(page:Page,title:string,yaw:number,pitch:number,reference:'relative'|'world'='relative') {
  await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.tagName)).toBe('CANVAS');
  // Preserve relative turns by default. Mouse-Start fixtures can opt into a
  // world heading, correcting observed drift through the same relative inputs.
  // Keep the five pitch candidates, pitch limits and two rendered frames.
  // Batch input and its read checkpoint to avoid repeated selector/dispatch RPCs.
  const found=await page.evaluate(async({title,yaw,pitch,reference})=>{
    const canvas=document.querySelector('#game canvas');
    if(!canvas||document.pointerLockElement!==canvas)throw new Error('Relative look requires the real locked game canvas');
    const look=(x:number,y:number)=>{
      const event=new MouseEvent('mousemove',{bubbles:true});
      Object.defineProperties(event,{movementX:{value:x},movementY:{value:y}});
      canvas.dispatchEvent(event);
    };
    if(reference==='relative')look(yaw/.002,0);
    for(const adjustment of [0,.10,-.10,.20,-.20]){
      if(reference==='world'){
        const observed=Number(document.querySelector<HTMLElement>('#worldStatus')?.dataset.cameraYaw??'NaN');
        if(!Number.isFinite(observed))throw new Error('Relative look requires an observed camera heading');
        const delta=Math.atan2(Math.sin(observed+yaw),Math.cos(observed+yaw));
        look(delta/.002,0);
      }
      const downward=Math.max(.1,Math.min(1.4,pitch+adjustment));
      look(0,2000);look(0,(downward-Math.PI/2)/.002);
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      if(document.querySelector<HTMLElement>('#prompt')?.innerText.includes(title))return true;
    }
    return false;
  },{title,yaw,pitch,reference});
  if(!found)await expect(page.locator('#prompt')).toContainText(title,{timeout:5_000});
}

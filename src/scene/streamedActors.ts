import {retireResources} from './retireResources.js';
import type {Object3D} from 'three';

interface PresentedActor {state:{id:string;chunkId?:string};mesh:Object3D;}

/** Keeps known actor visuals alive independently of the fine simulation maps. */
export class StreamedActors<T extends PresentedActor> {
  private readonly actors=new Map<string,T>();
  constructor(private readonly release:(actor:T)=>void){}
  get(id:string){return this.actors.get(id);}
  values(){return this.actors.values();}
  hasMesh(mesh:Object3D){return [...this.actors.values()].some(actor=>actor.mesh===mesh);}

  remember(actor:T){
    const previous=this.actors.get(actor.state.id);
    if(previous&&previous.mesh!==actor.mesh)throw new Error(`Actor visual identity changed: ${actor.state.id}`);
    this.actors.set(actor.state.id,actor);
  }

  remove(actor:T){
    if(this.actors.get(actor.state.id)!==actor)return false;
    this.actors.delete(actor.state.id);this.release(actor);return true;
  }

  retain(owners:ReadonlySet<string>,active:ReadonlyMap<string,T>){
    const retired=[...this.actors.values()].filter(actor=>
      active.get(actor.state.id)!==actor&&!owners.has(actor.state.chunkId!)
    );
    retireResources(retired.map(actor=>()=>{this.remove(actor);}));
  }
}

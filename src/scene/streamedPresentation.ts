import * as THREE from 'three';
import {retireResources} from './retireResources.js';
import type {WorldObjectState} from '../types.js';
import {advancePickupRespawn} from '../world/portableObjects.js';
import type {LayoutBuilding,LayoutObject,LayoutRoad,StreamedLayout} from '../world/streamedLayouts.js';

export interface StaticLayoutObject {state:WorldObjectState;mesh:THREE.Object3D;}
export type StaticLayoutEntry={kind:'building';plan:LayoutBuilding}|{kind:'road';plan:LayoutRoad}|{kind:'object';plan:LayoutObject};
interface PresentationHost {
  objects:Map<string,StaticLayoutObject>;
  create(entry:StaticLayoutEntry,unitId:string,saved?:WorldObjectState):StaticLayoutObject;
  release(unitId:string,objects:readonly StaticLayoutObject[]):void;
}

/** A visible layout owns static meshes. Fine simulation only borrows their identities. */
export class StreamedPresentation {
  private readonly units=new Map<string,{layout:StreamedLayout;objects:StaticLayoutObject[]}>();
  private readonly staticObjects=new Map<string,StaticLayoutObject>();
  private readonly activeOwners=new Set<string>();
  private readonly visualStats=new WeakMap<THREE.Object3D,{revision:number;meshes:number;primitiveMeshes:number}>();
  private readonly physicsOwners=new Map<string,string>();
  constructor(private readonly host:PresentationHost){}

  has(id:string){return this.staticObjects.has(id);}
  physicsOwner(id:string){return this.physicsOwners.get(id);}
  unitIds(){return [...this.units.keys()];}
  object(id:string){return this.staticObjects.get(id);}
  objects(){return this.staticObjects.values();}

  present(layout:StreamedLayout,states:readonly WorldObjectState[]){
    if(this.units.has(layout.unit.id))return;
    const saved=new Map(states.map(s=>[s.id,s])),objects:StaticLayoutObject[]=[];
    const entries:StaticLayoutEntry[]=[...layout.buildings.map(plan=>({kind:'building' as const,plan})),
      ...layout.roads.map(plan=>({kind:'road' as const,plan})),...layout.objects.map(plan=>({kind:'object' as const,plan}))];
    try{
      for(const entry of entries){
        if(this.staticObjects.has(entry.plan.id))throw new Error(`Duplicate static layout identity ${entry.plan.id}`);
        const object=this.host.create(entry,layout.unit.id,saved.get(entry.plan.id));
        this.staticObjects.set(entry.plan.id,object);this.physicsOwners.set(entry.plan.id,layout.unit.id);objects.push(object);
        if(!this.activeOwners.has(entry.plan.ownerCellId)&&this.host.objects.get(entry.plan.id)===object)this.host.objects.delete(entry.plan.id);
      }
    }catch(error){
      this.forgetObjects(objects);
      try{this.host.release(layout.unit.id,objects);}
      catch(cleanupError){throw new AggregateError([error,cleanupError],'Static presentation rollback failed');}
      throw error;
    }
    this.units.set(layout.unit.id,{layout,objects});
  }

  activate(ownerCellId:string):StaticLayoutObject[]{
    this.activeOwners.add(ownerCellId);
    const objects=[...this.staticObjects.values()].filter(o=>o.state.chunkId===ownerCellId);
    for(const object of objects)this.host.objects.set(object.state.id,object);
    return objects;
  }

  deactivate(ownerCellId:string){
    this.activeOwners.delete(ownerCellId);
    for(const object of this.staticObjects.values())if(object.state.chunkId===ownerCellId&&this.host.objects.get(object.state.id)===object)this.host.objects.delete(object.state.id);
  }

  states(ownerCellId:string){
    return [...this.staticObjects.values()].filter(o=>o.state.chunkId===ownerCellId).map(o=>structuredClone(o.state));
  }

  advancePickupRespawns(timestamp:number):WorldObjectState[]{
    const changed:WorldObjectState[]=[];
    for(const object of this.staticObjects.values()){
      if(this.activeOwners.has(object.state.chunkId!)||!advancePickupRespawn(object.state,timestamp))continue;
      object.mesh.visible=true;changed.push(object.state);
    }
    return changed;
  }

  /** End old ownership before invoking callbacks that may present replacement identities. */
  private forgetObjects(objects:readonly StaticLayoutObject[]){
    for(const object of objects){
      const id=object.state.id;
      if(this.staticObjects.get(id)===object){this.staticObjects.delete(id);this.physicsOwners.delete(id);}
      if(this.host.objects.get(id)===object)this.host.objects.delete(id);
    }
  }

  retainVisible(unitIds:ReadonlySet<string>){
    const candidates=[...this.units];
    retireResources(candidates.map(([id,unit])=>()=>{
      if(this.units.get(id)!==unit||unitIds.has(id)||unit.layout.ownerCellIds.some(owner=>this.activeOwners.has(owner)))return;
      this.units.delete(id);this.forgetObjects(unit.objects);
      this.host.release(id,unit.objects);
    }));
  }

  diagnostics(){
    return [...this.units.values()].map(({layout,objects})=>({unitId:layout.unit.id,bounds:layout.unit.bounds,
      fineOwners:layout.ownerCellIds.filter(id=>this.activeOwners.has(id)),
      entities:objects.map(o=>{
        const revision=Number(o.mesh.userData.visualRevision)||0;
        let stats=this.visualStats.get(o.mesh);
        if(!stats||stats.revision!==revision){
          stats={revision,meshes:0,primitiveMeshes:0};
          o.mesh.traverse(node=>{const mesh=node as THREE.Mesh;if(!mesh.isMesh)return;stats!.meshes++;
            if(['BoxGeometry','CylinderGeometry','ConeGeometry','PlaneGeometry','SphereGeometry'].includes(mesh.geometry.type))stats!.primitiveMeshes++;});
          this.visualStats.set(o.mesh,stats);
        }
        return {id:o.state.id,ownerCellId:o.state.chunkId,kind:o.state.kind,visible:o.mesh.visible,meshes:stats.meshes,primitiveMeshes:stats.primitiveMeshes,
          position:{x:o.mesh.position.x,z:o.mesh.position.z}};
      })}));
  }
}

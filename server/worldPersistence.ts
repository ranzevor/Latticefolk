import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type {
  CoarseChunkState, PersistedFineChunk, PersistedWildlifeTransfer, WorldPersistenceMeta, WorldPersistenceSnapshot,
  NpcState, WildlifeDomesticationState, WildlifeHabitatExposure, WildlifeHabitatSnapshot, WildlifeLineageRecord, WildlifeMigrationEvent, WildlifeOrganismGenome, WildlifePhenotype, WildlifeState, WildlifeTraits, WorldObjectState
} from '../src/types.js';
import { computeEvolutionStatistics, computeWildlifeCoevolutionEvidence, computeWildlifeInteractionSelectionEvidence } from '../src/world/evolution.js';
import { computeWildlifeInteractionNetwork } from '../src/world/interactionNetwork.js';
import { WorldSnapshotValidationError, validateWorldPersistenceSnapshot } from './worldSnapshotValidation.js';
import { layoutIdentity, readStreamedLayout, assertStreamedLayoutStates } from '../src/world/streamedLayouts.js';
import { readWorldRandomness } from '../src/world/worldRandom.js';

type Row = Record<string, unknown>;

export class WorldPersistenceIntegrityError extends Error {
  constructor(readonly table:string,readonly row:string,readonly field:string){
    super(`Invalid persisted JSON: ${table}[${row.replace(/[^a-zA-Z0-9_.:-]/g,'?').slice(0,96)}].${field}`);
    this.name='WorldPersistenceIntegrityError';
  }
}

const parseStored = <T>(value:unknown,table:string,row:string,field:string,kind:'array'|'object'):T => {
  try{
    if(typeof value!=='string')throw new Error();
    const decoded:unknown=JSON.parse(value);
    if(kind==='array'?!Array.isArray(decoded):decoded===null||typeof decoded!=='object'||Array.isArray(decoded))throw new Error();
    return decoded as T;
  }catch{throw new WorldPersistenceIntegrityError(table,row,field);}
};

export class WorldPersistenceConflictError extends Error {
  constructor(readonly expectedRevision:number,readonly currentRevision:number){
    super(`World persistence revision conflict: expected ${expectedRevision}, current ${currentRevision}`);
    this.name='WorldPersistenceConflictError';
  }
}

export class WorldPersistence {
  private db: Database.Database;

  constructor(private readonly file:string) {
    fs.mkdirSync(path.dirname(file), { recursive:true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS world_control (
        slot TEXT PRIMARY KEY,
        revision INTEGER NOT NULL
      );

      INSERT OR IGNORE INTO world_control(slot,revision) VALUES('default',0);

      CREATE TABLE IF NOT EXISTS world_meta (
        slot TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        meta_json TEXT NOT NULL,
        saved_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS coarse_chunks (
        id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fine_chunks (
        chunk_id TEXT PRIMARY KEY,
        npc_json TEXT NOT NULL,
        object_json TEXT NOT NULL,
        wildlife_json TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS home_state (
        slot TEXT PRIMARY KEY,
        npc_json TEXT NOT NULL,
        object_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS streamed_layouts (
        unit_id TEXT PRIMARY KEY,
        layout_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS wildlife_lineage (
        entity_id TEXT PRIMARY KEY,
        species TEXT NOT NULL,
        mother_id TEXT,
        father_id TEXT,
        birth_day REAL NOT NULL,
        death_day REAL,
        death_reason TEXT,
        generation INTEGER NOT NULL,
        birth_chunk TEXT NOT NULL,
        death_chunk TEXT,
        traits_at_birth_json TEXT NOT NULL,
        traits_at_death_json TEXT,
        phenotype_at_birth_json TEXT,
        phenotype_at_death_json TEXT,
        phenotype_provenance TEXT,
        organism_genome_at_birth_json TEXT,
        organism_genome_at_death_json TEXT,
        organism_genome_provenance TEXT,
        domestication_at_birth_json TEXT,
        domestication_at_death_json TEXT,
        birth_habitat_json TEXT,
        death_habitat_json TEXT,
        habitat_exposure_json TEXT,
        migration_history_json TEXT,
        predation_outcomes_json TEXT,
        origin TEXT NOT NULL DEFAULT 'founder',
        offspring_count INTEGER NOT NULL DEFAULT 0,
        reproductive_success INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_wildlife_lineage_species_generation ON wildlife_lineage(species,generation);
      CREATE INDEX IF NOT EXISTS idx_wildlife_lineage_mother ON wildlife_lineage(mother_id);
      CREATE INDEX IF NOT EXISTS idx_wildlife_lineage_father ON wildlife_lineage(father_id);

      CREATE TABLE IF NOT EXISTS wildlife_transfers (
        entity_id TEXT PRIMARY KEY,
        transfer_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    const fineColumns=this.db.prepare("PRAGMA table_info(fine_chunks)").all() as Array<{name:string}>;
    if(!fineColumns.some(column=>column.name==='wildlife_json')){
      this.db.exec("ALTER TABLE fine_chunks ADD COLUMN wildlife_json TEXT NOT NULL DEFAULT '[]'");
    }
    if(!fineColumns.some(column=>column.name==='dynamic_activated')){
      this.db.exec('ALTER TABLE fine_chunks ADD COLUMN dynamic_activated INTEGER CHECK(dynamic_activated IN (0,1))');
    }
    const lineageColumns=this.db.prepare("PRAGMA table_info(wildlife_lineage)").all() as Array<{name:string}>;
    if(!lineageColumns.some(column=>column.name==='origin')){
      this.db.exec("ALTER TABLE wildlife_lineage ADD COLUMN origin TEXT NOT NULL DEFAULT 'founder'");
    }
    if(!lineageColumns.some(column=>column.name==='phenotype_at_birth_json')){
      this.db.exec("ALTER TABLE wildlife_lineage ADD COLUMN phenotype_at_birth_json TEXT");
    }
    if(!lineageColumns.some(column=>column.name==='phenotype_at_death_json')){
      this.db.exec("ALTER TABLE wildlife_lineage ADD COLUMN phenotype_at_death_json TEXT");
    }
    if(!lineageColumns.some(column=>column.name==='phenotype_provenance')){
      this.db.exec("ALTER TABLE wildlife_lineage ADD COLUMN phenotype_provenance TEXT");
    }
    if(!lineageColumns.some(column=>column.name==='organism_genome_at_birth_json')){
      this.db.exec("ALTER TABLE wildlife_lineage ADD COLUMN organism_genome_at_birth_json TEXT");
    }
    if(!lineageColumns.some(column=>column.name==='organism_genome_at_death_json')){
      this.db.exec("ALTER TABLE wildlife_lineage ADD COLUMN organism_genome_at_death_json TEXT");
    }
    if(!lineageColumns.some(column=>column.name==='organism_genome_provenance')){
      this.db.exec("ALTER TABLE wildlife_lineage ADD COLUMN organism_genome_provenance TEXT");
    }
    if(!lineageColumns.some(column=>column.name==='domestication_at_birth_json')){
      this.db.exec("ALTER TABLE wildlife_lineage ADD COLUMN domestication_at_birth_json TEXT");
    }
    if(!lineageColumns.some(column=>column.name==='domestication_at_death_json')){
      this.db.exec("ALTER TABLE wildlife_lineage ADD COLUMN domestication_at_death_json TEXT");
    }
    if(!lineageColumns.some(column=>column.name==='birth_habitat_json')){
      this.db.exec("ALTER TABLE wildlife_lineage ADD COLUMN birth_habitat_json TEXT");
    }
    if(!lineageColumns.some(column=>column.name==='death_habitat_json')){
      this.db.exec("ALTER TABLE wildlife_lineage ADD COLUMN death_habitat_json TEXT");
    }
    if(!lineageColumns.some(column=>column.name==='habitat_exposure_json')){
      this.db.exec("ALTER TABLE wildlife_lineage ADD COLUMN habitat_exposure_json TEXT");
    }
    if(!lineageColumns.some(column=>column.name==='migration_history_json')){
      this.db.exec("ALTER TABLE wildlife_lineage ADD COLUMN migration_history_json TEXT");
    }
    if(!lineageColumns.some(column=>column.name==='predation_outcomes_json')){
      this.db.exec("ALTER TABLE wildlife_lineage ADD COLUMN predation_outcomes_json TEXT");
    }
  }

  revision() {
    const row=this.db.prepare('SELECT revision FROM world_control WHERE slot = ?').get('default') as {revision:number}|undefined;
    const revision=Number(row?.revision??0);
    if(!Number.isSafeInteger(revision)||revision<0)throw new Error('Invalid persisted world revision');
    return revision;
  }

  save(snapshot:WorldPersistenceSnapshot,expectedRevision:number) {
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new RangeError('expectedRevision must be a non-negative safe integer');
    const validated=validateWorldPersistenceSnapshot(snapshot);
    const savedAt = Date.now();
    const upsertMeta=this.db.prepare(`
      INSERT INTO world_meta(slot,version,meta_json,saved_at) VALUES('default',?,?,?)
      ON CONFLICT(slot) DO UPDATE SET version=excluded.version,meta_json=excluded.meta_json,saved_at=excluded.saved_at
    `);
    const upsertChunk=this.db.prepare(`
      INSERT INTO coarse_chunks(id,state_json,updated_at) VALUES(?,?,?)
      ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at
    `);
    const upsertFine=this.db.prepare(`
      INSERT INTO fine_chunks(chunk_id,npc_json,object_json,wildlife_json,dynamic_activated,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(chunk_id) DO UPDATE SET npc_json=excluded.npc_json,object_json=excluded.object_json,wildlife_json=excluded.wildlife_json,dynamic_activated=excluded.dynamic_activated,updated_at=excluded.updated_at
    `);
    const upsertHome=this.db.prepare(`
      INSERT INTO home_state(slot,npc_json,object_json,updated_at) VALUES('default',?,?,?)
      ON CONFLICT(slot) DO UPDATE SET npc_json=excluded.npc_json,object_json=excluded.object_json,updated_at=excluded.updated_at
    `);
    const upsertLineage=this.db.prepare(`
      INSERT INTO wildlife_lineage(
        entity_id,species,mother_id,father_id,birth_day,death_day,death_reason,generation,
        birth_chunk,death_chunk,traits_at_birth_json,traits_at_death_json,phenotype_at_birth_json,phenotype_at_death_json,phenotype_provenance,organism_genome_at_birth_json,organism_genome_at_death_json,organism_genome_provenance,domestication_at_birth_json,domestication_at_death_json,birth_habitat_json,death_habitat_json,habitat_exposure_json,migration_history_json,predation_outcomes_json,origin,offspring_count,reproductive_success,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(entity_id) DO UPDATE SET
        species=excluded.species,
        mother_id=COALESCE(wildlife_lineage.mother_id,excluded.mother_id),
        father_id=COALESCE(wildlife_lineage.father_id,excluded.father_id),
        birth_day=MIN(wildlife_lineage.birth_day,excluded.birth_day),
        death_day=COALESCE(wildlife_lineage.death_day,excluded.death_day),
        death_reason=COALESCE(wildlife_lineage.death_reason,excluded.death_reason),
        generation=excluded.generation,
        birth_chunk=wildlife_lineage.birth_chunk,
        death_chunk=COALESCE(wildlife_lineage.death_chunk,excluded.death_chunk),
        traits_at_birth_json=wildlife_lineage.traits_at_birth_json,
        traits_at_death_json=COALESCE(wildlife_lineage.traits_at_death_json,excluded.traits_at_death_json),
        phenotype_at_birth_json=COALESCE(wildlife_lineage.phenotype_at_birth_json,excluded.phenotype_at_birth_json),
        phenotype_at_death_json=COALESCE(wildlife_lineage.phenotype_at_death_json,excluded.phenotype_at_death_json),
        phenotype_provenance=COALESCE(wildlife_lineage.phenotype_provenance,excluded.phenotype_provenance),
        organism_genome_at_birth_json=COALESCE(wildlife_lineage.organism_genome_at_birth_json,excluded.organism_genome_at_birth_json),
        organism_genome_at_death_json=COALESCE(wildlife_lineage.organism_genome_at_death_json,excluded.organism_genome_at_death_json),
        organism_genome_provenance=COALESCE(wildlife_lineage.organism_genome_provenance,excluded.organism_genome_provenance),
        domestication_at_birth_json=COALESCE(wildlife_lineage.domestication_at_birth_json,excluded.domestication_at_birth_json),
        domestication_at_death_json=COALESCE(excluded.domestication_at_death_json,wildlife_lineage.domestication_at_death_json),
        birth_habitat_json=COALESCE(wildlife_lineage.birth_habitat_json,excluded.birth_habitat_json),
        death_habitat_json=COALESCE(wildlife_lineage.death_habitat_json,excluded.death_habitat_json),
        habitat_exposure_json=COALESCE(excluded.habitat_exposure_json,wildlife_lineage.habitat_exposure_json),
        migration_history_json=COALESCE(excluded.migration_history_json,wildlife_lineage.migration_history_json),
        predation_outcomes_json=COALESCE(excluded.predation_outcomes_json,wildlife_lineage.predation_outcomes_json),
        origin=CASE WHEN wildlife_lineage.origin='reproduction' OR excluded.origin='reproduction' THEN 'reproduction' ELSE 'founder' END,
        offspring_count=MAX(wildlife_lineage.offspring_count,excluded.offspring_count),
        reproductive_success=MAX(wildlife_lineage.reproductive_success,excluded.reproductive_success),
        updated_at=excluded.updated_at
    `);
    const upsertTransfer=this.db.prepare(`
      INSERT INTO wildlife_transfers(entity_id,transfer_json,updated_at) VALUES(?,?,?)
      ON CONFLICT(entity_id) DO UPDATE SET transfer_json=excluded.transfer_json,updated_at=excluded.updated_at
    `);
    const deleteTransfer=this.db.prepare('DELETE FROM wildlife_transfers WHERE entity_id = ?');
    const setRevision=this.db.prepare("UPDATE world_control SET revision = ? WHERE slot = 'default'");

    const tx=this.db.transaction((data:WorldPersistenceSnapshot)=>{
      const currentRevision=this.revision();
      if(currentRevision!==expectedRevision)throw new WorldPersistenceConflictError(expectedRevision,currentRevision);
      this.load();
      const nextRevision=currentRevision+1;
      if(!Number.isSafeInteger(nextRevision))throw new Error('World persistence revision exhausted');

      const previous=this.db.prepare("SELECT meta_json FROM world_meta WHERE slot = 'default'").get() as {meta_json:string}|undefined;
      if(previous&&JSON.parse(previous.meta_json).streamedLayoutVersion!==undefined&&data.meta.streamedLayoutVersion!==1){
        throw new WorldSnapshotValidationError(['snapshot.meta.streamedLayoutVersion: cannot omit stored layout contract']);
      }
      if(previous){
        const meta=JSON.parse(String(previous.meta_json)) as WorldPersistenceMeta;
        const prior=readWorldRandomness(meta.randomness),incoming=readWorldRandomness(data.meta.randomness);
        if((meta.randomness!==undefined&&data.meta.randomness===undefined)||prior.seed!==incoming.seed||prior.version!==incoming.version){
          throw new WorldSnapshotValidationError(['snapshot.meta.randomness: cannot replace or omit stored world random authority']);
        }
      }
      const newLayouts:NonNullable<WorldPersistenceSnapshot['streamedLayouts']>=[];
      for(const layout of data.streamedLayouts||[]){
        const stored=this.db.prepare('SELECT layout_json FROM streamed_layouts WHERE unit_id = ?').get(layout.unit.id) as {layout_json:string}|undefined;
        if(stored&&layoutIdentity(JSON.parse(stored.layout_json))!==layoutIdentity(layout)){
          throw new WorldSnapshotValidationError([`snapshot.streamedLayouts: cannot replace established layout ${layout.unit.id}`]);
        }
        if(!stored){newLayouts.push(layout);this.db.prepare('INSERT INTO streamed_layouts(unit_id,layout_json) VALUES(?,?)').run(layout.unit.id,JSON.stringify(layout));}
      }

      const layouts=(this.db.prepare('SELECT unit_id,layout_json FROM streamed_layouts').all() as {unit_id:string;layout_json:string}[]).map(row=>readStreamedLayout(parseStored(row.layout_json,'streamed_layouts',row.unit_id,'layout_json','object')));
      try{assertStreamedLayoutStates(newLayouts,data.fineChunks);assertStreamedLayoutStates(layouts,data.fineChunks,true);}catch(error){
        throw new WorldSnapshotValidationError([error instanceof Error?error.message:String(error)]);
      }

      upsertMeta.run(data.version,JSON.stringify(data.meta),savedAt);

      // Snapshot row omission is not a deletion signal. Discovered coarse/fine
      // history is only removed by the explicit clear/reset path.
      for(const chunk of data.coarseChunks) upsertChunk.run(chunk.id,JSON.stringify(chunk),savedAt);

      for(const chunk of data.fineChunks){
        const stored=this.db.prepare('SELECT dynamic_activated FROM fine_chunks WHERE chunk_id = ?').get(chunk.chunkId) as {dynamic_activated:number|null}|undefined;
        if(stored&&stored.dynamic_activated!==0&&chunk.dynamicActivated===false)throw new WorldSnapshotValidationError(['Cannot deactivate an established actor population']);
        upsertFine.run(chunk.chunkId,JSON.stringify(chunk.npcStates),JSON.stringify(chunk.objectStates),JSON.stringify(chunk.wildlifeStates||[]),chunk.dynamicActivated===undefined?null:Number(chunk.dynamicActivated),savedAt);
      }

      upsertHome.run(JSON.stringify(data.homeNpcs),JSON.stringify(data.homeObjects),savedAt);

      for(const record of data.wildlifeLineage||[]){
        upsertLineage.run(
          record.entityId,record.species,record.motherId??null,record.fatherId??null,
          record.birthDay,record.deathDay??null,record.deathReason??null,record.generation,
          record.birthChunk,record.deathChunk??null,JSON.stringify(record.traitsAtBirth),
          record.traitsAtDeath?JSON.stringify(record.traitsAtDeath):null,
          record.phenotypeAtBirth?JSON.stringify(record.phenotypeAtBirth):null,
          record.phenotypeAtDeath?JSON.stringify(record.phenotypeAtDeath):null,
          record.phenotypeProvenance??null,
          record.organismGenomeAtBirth?JSON.stringify(record.organismGenomeAtBirth):null,
          record.organismGenomeAtDeath?JSON.stringify(record.organismGenomeAtDeath):null,
          record.organismGenomeProvenance??null,
          record.domesticationAtBirth?JSON.stringify(record.domesticationAtBirth):null,
          record.domesticationAtDeath?JSON.stringify(record.domesticationAtDeath):null,
          record.birthHabitat?JSON.stringify(record.birthHabitat):null,record.deathHabitat?JSON.stringify(record.deathHabitat):null,
          record.habitatExposure?JSON.stringify(record.habitatExposure):null,
          record.migrationHistory?JSON.stringify(record.migrationHistory):null,
          record.predationOutcomes?JSON.stringify(record.predationOutcomes):null,
          record.origin==='reproduction'?'reproduction':'founder',record.offspringCount,
          record.reproductiveSuccess?1:0,savedAt
        );
      }

      if(data.wildlifeTransfers!==undefined){
        const transferIds=new Set(data.wildlifeTransfers.map(transfer=>transfer.entityId));
        const existingTransfers=this.db.prepare('SELECT entity_id FROM wildlife_transfers').all() as Array<{entity_id:string}>;
        for(const row of existingTransfers)if(!transferIds.has(row.entity_id))deleteTransfer.run(row.entity_id);
        for(const transfer of data.wildlifeTransfers){
          upsertTransfer.run(transfer.entityId,JSON.stringify(transfer),savedAt);
        }
      }

      setRevision.run(nextRevision);
      return nextRevision;
    });

    const revision=tx.immediate(validated);
    return { ok:true, savedAt, revision };
  }

  load():WorldPersistenceSnapshot|null {
    const metaRow=this.db.prepare('SELECT version,meta_json,saved_at FROM world_meta WHERE slot = ?').get('default') as Row|undefined;
    if(!metaRow)return null;

    const coarseRows=this.db.prepare('SELECT id,state_json FROM coarse_chunks ORDER BY id').all() as Array<{id:string;state_json:string}>;
    const fineRows=this.db.prepare('SELECT chunk_id,npc_json,object_json,wildlife_json,dynamic_activated FROM fine_chunks ORDER BY chunk_id').all() as Array<{chunk_id:string;npc_json:string;object_json:string;wildlife_json:string;dynamic_activated:number|null}>;
    const homeRow=this.db.prepare('SELECT npc_json,object_json FROM home_state WHERE slot = ?').get('default') as {npc_json:string;object_json:string}|undefined;
    const transferRows=this.db.prepare('SELECT entity_id,transfer_json FROM wildlife_transfers ORDER BY entity_id').all() as Array<{entity_id:string;transfer_json:string}>;
    const lineageRows=this.db.prepare(`
      SELECT entity_id,species,mother_id,father_id,birth_day,death_day,death_reason,generation,
             birth_chunk,death_chunk,traits_at_birth_json,traits_at_death_json,phenotype_at_birth_json,phenotype_at_death_json,phenotype_provenance,organism_genome_at_birth_json,organism_genome_at_death_json,organism_genome_provenance,domestication_at_birth_json,domestication_at_death_json,birth_habitat_json,death_habitat_json,habitat_exposure_json,migration_history_json,predation_outcomes_json,origin,offspring_count,reproductive_success
      FROM wildlife_lineage ORDER BY birth_day,entity_id
    `).all() as Array<{
      entity_id:string;species:WildlifeLineageRecord['species'];mother_id:string|null;father_id:string|null;
      birth_day:number;death_day:number|null;death_reason:WildlifeLineageRecord['deathReason']|null;generation:number;
      birth_chunk:string;death_chunk:string|null;traits_at_birth_json:string;traits_at_death_json:string|null;
      phenotype_at_birth_json:string|null;phenotype_at_death_json:string|null;phenotype_provenance:WildlifeLineageRecord['phenotypeProvenance']|null;
      organism_genome_at_birth_json:string|null;organism_genome_at_death_json:string|null;organism_genome_provenance:WildlifeLineageRecord['organismGenomeProvenance']|null;
      domestication_at_birth_json:string|null;domestication_at_death_json:string|null;
      birth_habitat_json:string|null;death_habitat_json:string|null;habitat_exposure_json:string|null;migration_history_json:string|null;predation_outcomes_json:string|null;origin:'founder'|'reproduction';
      offspring_count:number;reproductive_success:number;
    }>;

    const coarseChunks=coarseRows.map(row=>parseStored<CoarseChunkState>(row.state_json,'coarse_chunks',row.id,'state_json','object'));
    if(fineRows.some(row=>row.dynamic_activated!==null&&row.dynamic_activated!==0&&row.dynamic_activated!==1))throw new Error('Invalid persisted owner activation state');
    const fineChunks:PersistedFineChunk[]=fineRows.map(row=>({
      chunkId:row.chunk_id,
      ...(row.dynamic_activated===null?{}:{dynamicActivated:Boolean(row.dynamic_activated)}),
      npcStates:parseStored<NpcState[]>(row.npc_json,'fine_chunks',row.chunk_id,'npc_json','array'),
      objectStates:parseStored<WorldObjectState[]>(row.object_json,'fine_chunks',row.chunk_id,'object_json','array'),
      wildlifeStates:parseStored<WildlifeState[]>(row.wildlife_json,'fine_chunks',row.chunk_id,'wildlife_json','array')
    }));
    const wildlifeTransfers=transferRows.map(row=>parseStored<PersistedWildlifeTransfer>(
      row.transfer_json,'wildlife_transfers',row.entity_id,'transfer_json','object'));
    const wildlifeLineage:WildlifeLineageRecord[]=lineageRows.map(row=>({
      entityId:row.entity_id,
      species:row.species,
      motherId:row.mother_id??undefined,
      fatherId:row.father_id??undefined,
      birthDay:Number(row.birth_day),
      deathDay:row.death_day===null?undefined:Number(row.death_day),
      deathReason:row.death_reason??undefined,
      generation:Number(row.generation),
      birthChunk:row.birth_chunk,
      deathChunk:row.death_chunk??undefined,
      traitsAtBirth:parseStored<WildlifeTraits>(row.traits_at_birth_json,'wildlife_lineage',row.entity_id,'traits_at_birth_json','object'),
      traitsAtDeath:row.traits_at_death_json!==null?parseStored<WildlifeTraits|undefined>(row.traits_at_death_json,'wildlife_lineage',row.entity_id,'traits_at_death_json','object'):undefined,
      phenotypeAtBirth:row.phenotype_at_birth_json!==null?parseStored<WildlifePhenotype|undefined>(row.phenotype_at_birth_json,'wildlife_lineage',row.entity_id,'phenotype_at_birth_json','object'):undefined,
      phenotypeAtDeath:row.phenotype_at_death_json!==null?parseStored<WildlifePhenotype|undefined>(row.phenotype_at_death_json,'wildlife_lineage',row.entity_id,'phenotype_at_death_json','object'):undefined,
      phenotypeProvenance:row.phenotype_provenance??undefined,
      organismGenomeAtBirth:row.organism_genome_at_birth_json!==null?parseStored<WildlifeOrganismGenome|undefined>(row.organism_genome_at_birth_json,'wildlife_lineage',row.entity_id,'organism_genome_at_birth_json','object'):undefined,
      organismGenomeAtDeath:row.organism_genome_at_death_json!==null?parseStored<WildlifeOrganismGenome|undefined>(row.organism_genome_at_death_json,'wildlife_lineage',row.entity_id,'organism_genome_at_death_json','object'):undefined,
      organismGenomeProvenance:row.organism_genome_provenance??undefined,
      domesticationAtBirth:row.domestication_at_birth_json!==null?parseStored<WildlifeDomesticationState|undefined>(row.domestication_at_birth_json,'wildlife_lineage',row.entity_id,'domestication_at_birth_json','object'):undefined,
      domesticationAtDeath:row.domestication_at_death_json!==null?parseStored<WildlifeDomesticationState|undefined>(row.domestication_at_death_json,'wildlife_lineage',row.entity_id,'domestication_at_death_json','object'):undefined,
      birthHabitat:row.birth_habitat_json!==null?parseStored<WildlifeHabitatSnapshot|undefined>(row.birth_habitat_json,'wildlife_lineage',row.entity_id,'birth_habitat_json','object'):undefined,
      deathHabitat:row.death_habitat_json!==null?parseStored<WildlifeHabitatSnapshot|undefined>(row.death_habitat_json,'wildlife_lineage',row.entity_id,'death_habitat_json','object'):undefined,
      habitatExposure:row.habitat_exposure_json!==null?parseStored<WildlifeHabitatExposure|undefined>(row.habitat_exposure_json,'wildlife_lineage',row.entity_id,'habitat_exposure_json','object'):undefined,
      migrationHistory:row.migration_history_json!==null?parseStored<WildlifeMigrationEvent[]>(row.migration_history_json,'wildlife_lineage',row.entity_id,'migration_history_json','array'):undefined,
      predationOutcomes:row.predation_outcomes_json!==null?parseStored<NonNullable<WildlifeLineageRecord['predationOutcomes']>|undefined>(row.predation_outcomes_json,'wildlife_lineage',row.entity_id,'predation_outcomes_json','object'):undefined,
      origin:row.origin==='reproduction'?'reproduction':'founder',
      offspringCount:Number(row.offspring_count)||0,
      reproductiveSuccess:Boolean(row.reproductive_success)
    }));

    const streamedLayouts=(this.db.prepare('SELECT unit_id,layout_json FROM streamed_layouts ORDER BY unit_id').all() as {unit_id:string;layout_json:string}[])
      .map(row=>readStreamedLayout(parseStored(row.layout_json,'streamed_layouts',row.unit_id,'layout_json','object')));
    assertStreamedLayoutStates(streamedLayouts,fineChunks);
    return {
      version:Number(metaRow.version)===1?1:1,
      ...(streamedLayouts.length?{streamedLayouts}:{}),
      meta:parseStored<WorldPersistenceMeta>(metaRow.meta_json,'world_meta','default','meta_json','object'),
      coarseChunks,
      fineChunks,
      homeNpcs:homeRow?parseStored<NpcState[]>(homeRow.npc_json,'home_state','default','npc_json','array'):[],
      homeObjects:homeRow?parseStored<WorldObjectState[]>(homeRow.object_json,'home_state','default','object_json','array'):[],
      wildlifeLineage,
      wildlifeTransfers,
      savedAt:Number(metaRow.saved_at)||undefined
    };
  }

  evolutionStats() {
    const snapshot=this.load();
    const asOfDay=snapshot?snapshot.meta.day+snapshot.meta.minuteOfDay/1440:undefined;
    return computeEvolutionStatistics(snapshot?.wildlifeLineage||[],asOfDay);
  }

  coevolutionStats() {
    const snapshot=this.load();
    const asOfDay=snapshot?snapshot.meta.day+snapshot.meta.minuteOfDay/1440:undefined;
    return computeWildlifeCoevolutionEvidence(snapshot?.wildlifeLineage||[],asOfDay);
  }

  interactionSelectionStats() {
    const snapshot=this.load();
    const asOfDay=snapshot?snapshot.meta.day+snapshot.meta.minuteOfDay/1440:undefined;
    return computeWildlifeInteractionSelectionEvidence(snapshot?.wildlifeLineage||[],asOfDay);
  }

  interactionNetwork() {
    const snapshot=this.load();
    return computeWildlifeInteractionNetwork(snapshot?.coarseChunks||[]);
  }

  stats() {
    const saved=this.db.prepare('SELECT saved_at FROM world_meta WHERE slot = ?').get('default') as {saved_at:number}|undefined;
    const coarse=(this.db.prepare('SELECT COUNT(*) AS n FROM coarse_chunks').get() as {n:number}).n;
    const fine=(this.db.prepare('SELECT COUNT(*) AS n FROM fine_chunks').get() as {n:number}).n;
    const lineage=(this.db.prepare('SELECT COUNT(*) AS n FROM wildlife_lineage').get() as {n:number}).n;
    const transfers=(this.db.prepare('SELECT COUNT(*) AS n FROM wildlife_transfers').get() as {n:number}).n;
    return { configured:true,file:path.basename(this.file),hasSave:Boolean(saved),savedAt:saved?.saved_at||null,revision:this.revision(),coarseChunks:coarse,fineChunks:fine,lineageRecords:lineage,pendingWildlifeTransfers:transfers };
  }

  clear() {
    const setRevision=this.db.prepare("UPDATE world_control SET revision = ? WHERE slot = 'default'");
    const tx=this.db.transaction(()=>{
      const nextRevision=this.revision()+1;
      if(!Number.isSafeInteger(nextRevision))throw new Error('World persistence revision exhausted');
      this.db.prepare('DELETE FROM world_meta').run();
      this.db.prepare('DELETE FROM coarse_chunks').run();
      this.db.prepare('DELETE FROM fine_chunks').run();
      this.db.prepare('DELETE FROM streamed_layouts').run();
      this.db.prepare('DELETE FROM home_state').run();
      this.db.prepare('DELETE FROM wildlife_lineage').run();
      this.db.prepare('DELETE FROM wildlife_transfers').run();
      setRevision.run(nextRevision);
      return nextRevision;
    });
    const revision=tx.immediate();
    return {ok:true,revision};
  }

  close(){ this.db.close(); }
}

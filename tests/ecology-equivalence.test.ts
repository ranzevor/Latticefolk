import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {ChunkBiome,CoarseChunkState} from '../src/types.js';
import {ensureWildlifePopulations,simulateWildlife} from '../src/world/ecology.js';
import {wildlifeSpeciesProfile} from '../src/world/wildlifeSpecies.js';

const biomes:ChunkBiome[]=['plains','forest','hills','wetlands','dryland'];
const fixture=(i:number):CoarseChunkState=>({
  id:`chunk_${i}_0`,cx:i,cz:0,biome:biomes[i%5]!,settlementLevel:i%4,population:i%37,
  food:i*7%101,wood:60,water:i*13%101,ecology:i*17%101,danger:i*19%101,prosperity:20,
  strategy:'sustain',migrationPolicy:'retain',ecologyPolicy:'balance',lastDecisionAt:0,decisionVersion:0
});

test('ecology preserves exact seasonal trajectories across heterogeneous habitats',()=>{
  const hash=createHash('sha256');
  for(let i=0;i<100;i++){
    const chunk=fixture(i);ensureWildlifePopulations(chunk);
    for(const weather of ['clear','rain','cloudy'])for(const day of [1,31,61,91]){
      simulateWildlife(chunk,1+i%30,weather,day);hash.update(JSON.stringify(chunk));
    }
  }
  assert.equal(hash.digest('hex'),'7dfc84034c98ef71db1f8ea35a4ea6a59329753ca6f75ce5eb1f495f987197c2');
});

test('niche normalization observes changed species profiles on the next computation',()=>{
  const niche=wildlifeSpeciesProfile('rabbit').niche;
  const original=niche.grass;
  const axes=['grass','shrub','fruit','crop','prey','space'] as const;
  try{
    for(const grass of [0,.03125,19]){
      niche.grass=grass;
      const chunk=fixture(111);ensureWildlifePopulations(chunk);
      for(const pair of chunk.nicheCompetition!.pairs!){
        const a=wildlifeSpeciesProfile(pair.speciesA).niche,b=wildlifeSpeciesProfile(pair.speciesB).niche;
        const sa=axes.reduce((sum,key)=>sum+a[key],0),sb=axes.reduce((sum,key)=>sum+b[key],0);
        const shared=axes.reduce((sum,key)=>sum+Math.min(a[key]/sa,b[key]/sb),0);
        assert.equal(pair.nicheOverlap,Math.round(Math.max(0,Math.min(1,shared))*1000)/1000);
      }
    }
  }finally{niche.grass=original;}
});

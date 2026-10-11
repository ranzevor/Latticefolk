import type { Express } from 'express';
import { WorldPersistence, WorldPersistenceConflictError, WorldPersistenceIntegrityError } from './worldPersistence.js';
import { validateWorldPersistenceSnapshot, WorldSnapshotValidationError } from './worldSnapshotValidation.js';

export function registerWorldStateRoutes(app:Express,worldStore:WorldPersistence) {
  app.get('/api/world/state', (_req, res) => {
    try{
      res.json({ snapshot:worldStore.load(), revision:worldStore.revision(), stats:worldStore.stats() });
    }catch(error){
      if(!(error instanceof WorldPersistenceIntegrityError))throw error;
      res.status(500).json({error:error.message});
    }
  });

  app.post('/api/world/state', (req, res) => {
    try {
      const body=req.body as {snapshot?:unknown;expectedRevision?:unknown}|undefined;
      if(!body||!Number.isSafeInteger(body.expectedRevision)||Number(body.expectedRevision)<0){
        res.status(400).json({error:'World persistence write requires a non-negative integer expectedRevision'});
        return;
      }
      const snapshot=validateWorldPersistenceSnapshot(body.snapshot);
      res.json(worldStore.save(snapshot,Number(body.expectedRevision)));
    } catch(error) {
      if(error instanceof WorldPersistenceIntegrityError){
        res.status(500).json({error:error.message});
        return;
      }
      if(error instanceof WorldPersistenceConflictError){
        res.status(409).json({
          error:'World persistence revision conflict',
          expectedRevision:error.expectedRevision,
          currentRevision:error.currentRevision
        });
        return;
      }
      if(error instanceof WorldSnapshotValidationError){
        res.status(400).json({error:'Invalid world persistence payload',details:error.issues});
        return;
      }
      res.status(400).json({error:error instanceof Error?error.message:String(error)});
    }
  });

  app.delete('/api/world/state', (_req, res) => {
    const runtimeAdminAllowed = process.env.NODE_ENV !== 'production' || process.env.ALLOW_RUNTIME_ADMIN === 'true';
    if(!runtimeAdminAllowed){
      res.status(403).json({error:'World reset is disabled in production. Set ALLOW_RUNTIME_ADMIN=true to enable.'});
      return;
    }
    res.json(worldStore.clear());
  });
}

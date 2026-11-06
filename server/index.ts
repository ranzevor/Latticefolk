import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DialogueStore } from './dialogueStore.js';
import { createDecisionProvider } from './decision/createProvider.js';
import { WorldPersistence } from './worldPersistence.js';
import { registerWorldStateRoutes } from './worldStateRoutes.js';
import { registerStaticFiles } from './staticFiles.js';
import type { DecisionRequest, DialogueRequest, ImportDialogueRequest, ChunkDecisionRequest, RegionDecisionRequest, WorldDecisionRequest, WildlifeDecisionBatchRequest } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dialogue = new DialogueStore(path.join(root, 'data', 'dialogue.jsonl'));
const selection = createDecisionProvider(dialogue);
const decision = selection.active;
const worldDbPath = process.env.WORLD_DB_PATH ? path.resolve(process.env.WORLD_DB_PATH) : path.join(root, 'data', 'latticefolk.sqlite');
const worldStore = new WorldPersistence(worldDbPath);
const app = express();

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '64mb' }));
registerWorldStateRoutes(app,worldStore);

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  project: 'latticefolk',
  decision: {
    requested: selection.requested,
    active: decision.id,
    status: decision.status(),
  },
  dialogue: dialogue.stats(),
  persistence: worldStore.stats(),
}));

app.get('/api/decision/budget', (_req, res) => {
  res.json(decision.status().budget ?? { unavailable:true });
});

app.put('/api/decision/budget', (req, res) => {
  const runtimeAdminAllowed = process.env.NODE_ENV !== 'production' || process.env.ALLOW_RUNTIME_ADMIN === 'true';
  if (!runtimeAdminAllowed) {
    res.status(403).json({ error:'Runtime admin controls are disabled in production. Set ALLOW_RUNTIME_ADMIN=true to enable.' });
    return;
  }
  if (!decision.updateBudget) {
    res.status(400).json({ error:'Active decision provider does not expose a runtime budget.' });
    return;
  }
  try {
    res.json(decision.updateBudget(req.body ?? {}));
  } catch (error) {
    res.status(400).json({ error:error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/world/evolution', (_req, res) => {
  res.json({
    species:worldStore.evolutionStats(),
    coevolution:worldStore.coevolutionStats(),
    interactionSelection:worldStore.interactionSelectionStats(),
    persistence:worldStore.stats()
  });
});

app.get('/api/world/interactions', (_req, res) => {
  res.json({ network:worldStore.interactionNetwork(), persistence:worldStore.stats() });
});

app.get('/api/dialogue/stats', (_req, res) => res.json(dialogue.stats()));

app.post('/api/dialogue/import', (req, res) => {
  try {
    const body = req.body as ImportDialogueRequest;
    if (!body || !['plain', 'jsonl', 'json'].includes(body.format) || typeof body.text !== 'string') {
      res.status(400).json({ error: 'Invalid import payload' });
      return;
    }
    res.json(dialogue.import(body));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/wildlife/decide', async (req, res) => {
  const body=req.body as WildlifeDecisionBatchRequest;
  if(!body||!Array.isArray(body.requests)){
    res.status(400).json({error:'Invalid wildlife decision payload'});
    return;
  }
  if(body.requests.length>6){
    res.status(400).json({error:'Wildlife decision batch exceeds 6 animals'});
    return;
  }
  res.json(await decision.decideWildlife(body));
});

app.post('/api/decision', async (req, res) => {
  const body = req.body as DecisionRequest;
  if (!body?.npc || !body?.world || !Array.isArray(body.allowedActions)) {
    res.status(400).json({ error: 'Invalid decision payload' });
    return;
  }
  res.json(await decision.decide(body));
});

app.post('/api/world/regions/decide', async (req, res) => {
  const body=req.body as RegionDecisionRequest;
  if(!body||!Array.isArray(body.regions)||typeof body.day!=='number'||typeof body.gameTime!=='string'){
    res.status(400).json({error:'Invalid region decision payload'});
    return;
  }
  if(body.regions.length>8){
    res.status(400).json({error:'Region decision batch exceeds 8 regions'});
    return;
  }
  res.json(await decision.decideRegions(body));
});

app.post('/api/world/strategy/decide', async (req, res) => {
  const body=req.body as WorldDecisionRequest;
  if(!body||!body.summary||!Array.isArray(body.regions)||typeof body.day!=='number'||typeof body.gameTime!=='string'){
    res.status(400).json({error:'Invalid world decision payload'});
    return;
  }
  res.json(await decision.decideWorld(body));
});

app.post('/api/world/chunks/decide', async (req, res) => {
  const body = req.body as ChunkDecisionRequest;
  if (!body || !Array.isArray(body.chunks) || typeof body.day !== 'number' || typeof body.gameTime !== 'string') {
    res.status(400).json({ error: 'Invalid chunk decision payload' });
    return;
  }
  if (body.chunks.length > 8) {
    res.status(400).json({ error: 'Chunk decision batch exceeds 8 chunks' });
    return;
  }
  res.json(await decision.decideChunks(body));
});

app.post('/api/dialogue', async (req, res) => {
  const body = req.body as DialogueRequest;
  if (!body?.speaker || !body?.listener || !body?.intent) {
    res.status(400).json({ error: 'Invalid dialogue payload' });
    return;
  }
  res.json(await decision.dialogueDecision(body));
});

const dist = path.join(root, 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(dist)) {
  registerStaticFiles(app,dist);
}

const port = Number(process.env.PORT || 8787);
const server=app.listen(port, () => {
  const status = decision.status();
  console.log(`[latticefolk] server on http://localhost:${port}`);
  console.log(`[latticefolk] decision provider: ${decision.id}${status.configured ? '' : ' (not configured; provider will fall back safely)'}`);
});


const shutdown=()=>{
  server.close(()=>{ worldStore.close(); process.exit(0); });
};
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);

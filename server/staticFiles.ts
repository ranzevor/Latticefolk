import express, { type Express } from 'express';
import path from 'node:path';

export function registerStaticFiles(app:Express,dist:string):void {
  app.use(express.static(dist));
  app.use((req,res,next)=>{
    let pathname:string;
    try{pathname=decodeURIComponent(req.path);}catch{res.sendStatus(400);return;}
    if(pathname.includes('\0')){res.sendStatus(400);return;}
    // Match the same single-decoded, platform-normalized path as express.static.
    const [directory]=path.normalize('.'+path.sep+pathname).split(path.sep);
    if(directory.toLowerCase()==='assets'){res.sendStatus(404);return;}
    next();
  });
  app.get('*splat',(_req,res)=>res.sendFile(path.join(dist,'index.html')));
}

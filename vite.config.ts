import {defineConfig} from 'vite';
export default defineConfig({
 base:'./', server:{host:'127.0.0.1'},
 plugins:[{
  name:'local-codex-status',
  configureServer(server){
   server.middlewares.use('/api/status',async(req,res)=>{
    if(req.method!=='GET'){res.statusCode=405;res.end();return;}
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`){res.statusCode=403;res.end();return;}
    try{
     const {readTaskStatus,refreshUsage}=await import('./telemetry/status.mjs');
     // Quota runs in the background at its own cadence, so task reads stay fast.
     void refreshUsage({maxAgeMs:30000});
     res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
     res.end(JSON.stringify(await readTaskStatus()));
    }catch{res.statusCode=503;res.end('{"remainingPercent":null,"activeTasks":null,"usageStatus":"unavailable","tasksStatus":"unavailable"}');}
   });
  }
 }]
});

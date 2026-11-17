import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
function collect(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?collect(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const files=[...collect('src'),...collect('integrations')].filter(p=>/\.test\.(ts|mjs)$/.test(p));
const node=spawnSync(process.execPath,['--experimental-strip-types','--test',...files],{stdio:'inherit'});
if(node.status)process.exit(node.status);
for(const folder of ['integrations/traffic-ledger','integrations/unlock-worker']){
  const python=spawnSync(process.env.PYTHON||'python',['-B','-m','unittest','discover','-p','test_*.py','-v'],{cwd:folder,stdio:'inherit',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  if(python.status)process.exit(python.status||1);
}

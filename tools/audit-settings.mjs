import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root=process.cwd();
const source=fs.readFileSync(path.join(root,'src/config/default.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {DEFAULT_CONFIG}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const metadata=JSON.parse(fs.readFileSync('komari-theme.json','utf8')).configuration.data;
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const code=files('src').filter(p=>/\.(ts|tsx|mjs|css)$/.test(p)&&!p.endsWith(path.join('config','default.ts'))).map(p=>fs.readFileSync(p,'utf8')).join('\n');
const schema=metadata.filter(x=>x.key);
console.log('Unknown schema keys',schema.filter(x=>!(x.key in DEFAULT_CONFIG)).map(x=>x.key));
console.log('Missing settings',Object.keys(DEFAULT_CONFIG).filter(k=>!schema.some(x=>x.key===k)));
console.log('Keys with no consumers',Object.keys(DEFAULT_CONFIG).filter(k=>!(new RegExp('\\b'+k+'\\b')).test(code)));
console.log('Settings',JSON.stringify(schema.map(x=>({key:x.key,type:x.type,default:x.default,name:x.name})),null,2));

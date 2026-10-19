import {readFileSync,existsSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const env={...process.env};
const personalFile=join(homedir(),'.env');
if(!env.CLOUDFLARE_API_TOKEN && existsSync(personalFile)) {
 const personal=parseEnv(readFileSync(personalFile,'utf8'));
 env.CLOUDFLARE_API_TOKEN=personal.PERSONAL_CLOUDFLARE_API_TOKEN || personal.CLOUDFLARE_API_TOKEN;
}
if(!env.CLOUDFLARE_API_TOKEN)throw new Error('Set CLOUDFLARE_API_TOKEN in the environment');
const cwd=fileURLToPath(new URL('../',import.meta.url));
env.PATH=join(cwd,'node_modules/.bin')+':'+env.PATH;
const args=process.argv.slice(2);
const python=args[0]==='python';
const r=python?spawnSync('uv',['tool','run','--from','uv>=0.12.3','uv','run','pywrangler',...args.slice(1)],{cwd,env,stdio:'inherit'}):spawnSync(process.execPath,[join(cwd,'node_modules/wrangler/bin/wrangler.js'),...args],{cwd,env,stdio:'inherit'});
if(r.error)console.error(r.error.message);
process.exit(r.status??1);

import fs from 'node:fs';
import { createHash } from 'node:crypto';
const root=new URL('../Web/',import.meta.url);const directory=new URL('unity/Build/',root);const files=fs.readdirSync(directory);
function asset(suffix){const matches=files.filter(f=>f.endsWith(suffix));if(matches.length!==1)throw new Error(`Expected one ${suffix}, got ${matches.length}`);const hash=createHash('sha256').update(fs.readFileSync(new URL(matches[0],directory))).digest('hex').slice(0,16);return `./unity/Build/${matches[0]}?v=${hash}`;}
const manifest={loaderUrl:asset('.loader.js'),dataUrl:asset('.data'),frameworkUrl:asset('.framework.js'),codeUrl:asset('.wasm'),streamingAssetsUrl:'./unity/StreamingAssets'};
fs.writeFileSync(new URL('unity-build.json',root),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest));

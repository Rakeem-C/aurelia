import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createHash} from 'node:crypto';
test('shipping Web page references a real, complete Unity WebAssembly player',()=>{
 const base=new URL('../Web/',import.meta.url);const manifest=JSON.parse(fs.readFileSync(new URL('unity-build.json',base),'utf8'));
 for(const key of ['loaderUrl','dataUrl','frameworkUrl','codeUrl']){const file=new URL(manifest[key],base);assert.ok(fs.statSync(file).size>1000,`${key} is a real build artifact`);assert.equal(file.searchParams.get('v'),createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0,16),'each changed Unity artifact invalidates browser caches');}
 assert.deepEqual([...fs.readFileSync(new URL(manifest.codeUrl,base)).subarray(0,8)],[0,97,115,109,1,0,0,0],'WebAssembly magic and version');
});

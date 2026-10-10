import { mkdir,rm,cp,readFile } from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const dist=new URL('dist/',root);
await readFile(new URL('public/index.html',root));
await rm(dist,{recursive:true,force:true});
await mkdir(dist,{recursive:true});
await cp(new URL('public/',root),dist,{recursive:true});
console.log('Static UI built; Vercel API is in api/.');

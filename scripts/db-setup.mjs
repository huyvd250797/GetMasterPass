import {readFile} from 'node:fs/promises';
import {getStore} from '../lib/store.mjs';
try{
 const store=await getStore(process.env);
 const sql=await readFile(new URL('../database/schema.sql',import.meta.url),'utf8');
 for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await store.query(statement);
 console.log('Database schema v2.5.0 ready. No passwords or master codes were created.');
}catch{console.error('Database setup failed. Check DATABASE_URL, connectivity and database privileges.');process.exitCode=1;}

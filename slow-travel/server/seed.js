// 初始化/重置演示数据：node server/seed.js [--force]
import { initDb, DEFAULT_DB_PATH } from './db.js';

const force = process.argv.includes('--force');
const db = await initDb(DEFAULT_DB_PATH, { force });
console.log(force ? `已重置数据库：${DEFAULT_DB_PATH}` : `数据库就绪：${DEFAULT_DB_PATH}`);
console.log(`路线数：${Object.keys(db.routes).length}`);

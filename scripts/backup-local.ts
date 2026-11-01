import 'dotenv/config';
import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const destinationArg = process.argv[2];
if (!destinationArg)
  throw new Error('Usage: npm run backup:local -- <new-backup-file.sqlite>');

const destination = path.resolve(destinationArg);
const source = path.resolve('data/arena.sqlite');
if (!existsSync(source)) throw new Error(`Local database does not exist: ${source}`);
if (existsSync(destination)) throw new Error(`Backup target already exists: ${destination}`);
mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });

const database = new Database(source, { fileMustExist: true });
try {
  await database.backup(destination);
  chmodSync(destination, 0o600);
} finally {
  database.close();
}
console.log(`SQLite backup created: ${destination}`);

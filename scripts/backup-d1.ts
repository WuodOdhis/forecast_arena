import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const environment = process.argv[2];
const destinationArg = process.argv[3];
const databases = {
  staging: 'forecast-arena-staging',
  mainnet: 'forecast-arena-prod',
} as const;
if (environment !== 'staging' && environment !== 'mainnet')
  throw new Error('Usage: npm run backup:d1 -- <staging|mainnet> <backup.sql outside the repository>');
if (!destinationArg)
  throw new Error('Provide a new backup file path outside the repository.');

const destination = path.resolve(destinationArg);
const repository = path.resolve('.');
const relative = path.relative(repository, destination);
if (!relative.startsWith('..') || path.isAbsolute(relative))
  throw new Error('D1 backups must be stored outside the repository.');
if (existsSync(destination))
  throw new Error(`Backup target already exists: ${destination}`);
mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });

const result = spawnSync(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'd1',
    'export',
    databases[environment],
    '--remote',
    '--env',
    environment,
    '--skip-confirmation',
    '--output',
    destination,
  ],
  { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024, windowsHide: true },
);
const redactSignedLinks = (value: string | null) =>
  (value || '').replace(
    /https:\/\/\S+\.r2\.cloudflarestorage\.com\/\S+/g,
    '[redacted temporary D1 export URL]',
  );
if (result.stdout) process.stdout.write(redactSignedLinks(result.stdout));
if (result.stderr) process.stderr.write(redactSignedLinks(result.stderr));
if (result.error || result.status !== 0) {
  if (existsSync(destination)) rmSync(destination);
  throw new Error(
    `D1 export failed${result.error ? `: ${result.error.message}` : ` (exit ${result.status})`}.`,
  );
}
chmodSync(destination, 0o600);
console.log(`D1 backup created outside the repository: ${destination}`);

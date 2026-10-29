import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// Applies database/migrations/NNN_*.sql in order and records each one in
// `schema_migrations`, so every migration runs exactly once (Step 15).
//
//   npm run migrate                    apply pending migrations
//   npm run migrate -- --status        list applied and pending migrations
//   npm run migrate -- --baseline 010  record 001-010 as applied without running them
//                                      (for a database migrated by hand before this runner)
//
// It never drops or rewrites anything itself. MySQL commits DDL immediately, so
// if a file fails part-way it is not recorded and the error is shown: fix the
// cause (restoring from backup if needed) before running again.

export const MIGRATION_FILE = /^(\d{3})_[a-z0-9_]+\.sql$/;

export const listMigrations = (dir: string) =>
  fs
    .readdirSync(dir)
    .filter((f) => MIGRATION_FILE.test(f))
    .sort()
    .map((file) => {
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      return { file, number: file.slice(0, 3), sql: prepareSql(raw), checksum: crypto.createHash('sha256').update(raw).digest('hex') };
    });

// The files start with `USE ai_resume_analyzer;` for manual use; the runner is
// already connected to DB_NAME, so that line is removed (the name may differ).
export const prepareSql = (raw: string) => raw.replace(/^\s*USE\s+`?[A-Za-z0-9_]+`?\s*;\s*$/gim, '');

const TRACKING_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(255) PRIMARY KEY,
  checksum CHAR(64) NOT NULL,
  baseline TINYINT(1) NOT NULL DEFAULT 0,
  applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
)`;

export const run = async (args: string[], log: (line: string) => void = console.log) => {
  const dir = path.resolve(process.env.MIGRATIONS_DIR || path.join(__dirname, '../../../database/migrations'));
  const migrations = listMigrations(dir);
  if (migrations.length === 0) throw new Error(`No migrations found in ${dir}`);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ai_resume_analyzer',
    multipleStatements: true,
  });
  try {
    // One runner at a time (e.g. two containers starting together).
    const [lock]: any = await connection.query("SELECT GET_LOCK('schema_migrations', 60) AS got");
    if (Number(lock[0].got) !== 1) throw new Error('Another migration run is in progress');
    await connection.query(TRACKING_TABLE);
    const [rows]: any = await connection.query('SELECT version, checksum FROM schema_migrations');
    const applied = new Map<string, string>(rows.map((r: any) => [r.version, r.checksum]));

    for (const m of migrations) {
      if (applied.has(m.file) && applied.get(m.file) !== m.checksum) log(`warning: ${m.file} has changed since it was applied (it is not run again)`);
    }

    if (args.includes('--status')) {
      for (const m of migrations) log(`${applied.has(m.file) ? 'applied' : 'pending'}  ${m.file}`);
      return { applied: [] as string[] };
    }

    const baselineIndex = args.indexOf('--baseline');
    if (baselineIndex !== -1) {
      const upTo = args[baselineIndex + 1];
      if (!upTo || !/^\d{3}$/.test(upTo) || !migrations.some((m) => m.number === upTo)) throw new Error('--baseline needs an existing migration number, e.g. --baseline 010');
      const marked: string[] = [];
      for (const m of migrations.filter((m) => m.number <= upTo && !applied.has(m.file))) {
        await connection.query('INSERT INTO schema_migrations (version, checksum, baseline) VALUES (?, ?, 1)', [m.file, m.checksum]);
        marked.push(m.file);
      }
      log(marked.length ? `Recorded as already applied: ${marked.join(', ')}` : 'Nothing to record.');
      return { applied: [] as string[] };
    }

    const done: string[] = [];
    for (const m of migrations.filter((m) => !applied.has(m.file))) {
      log(`applying ${m.file}`);
      try {
        await connection.query(m.sql);
      } catch (error: any) {
        throw new Error(`${m.file} failed (${error.code ?? 'error'}): ${error.sqlMessage ?? error.message}. It was not recorded; earlier files were.`);
      }
      await connection.query('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)', [m.file, m.checksum]);
      done.push(m.file);
    }
    log(done.length ? `Applied ${done.length} migration(s).` : 'Database is up to date.');
    return { applied: done };
  } finally {
    await connection.query("SELECT RELEASE_LOCK('schema_migrations')").catch(() => {});
    await connection.end();
  }
};

if (require.main === module) {
  run(process.argv.slice(2)).catch((error) => {
    // Only the error, never the connection settings.
    console.error(`Migration failed: ${error.message}`);
    process.exit(1);
  });
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

/**
 * 幂等迁移：schema.sql 与 seed.sql 全部 IF NOT EXISTS / ON CONFLICT DO NOTHING，
 * 可反复执行。生产构建需把 *.sql 复制进 dist（见 package.json build 脚本）。
 */
export async function runMigrations(pool: Pool): Promise<void> {
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  const seed = readFileSync(join(__dirname, 'seed.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(seed);
}

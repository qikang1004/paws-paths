import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

export interface MigrationOptions {
  /** 是否灌入演示数据（8 用户 / 8 宠物 / 17 照片 / 10 场所）。默认不灌。 */
  seed?: boolean;
}

/**
 * 是否开启演示数据。只认字面 '1'：'true' / 'yes' 一律视为关闭。
 * 灌演示数据是不可逆的写库动作，宁可让人多写一个字符，也不要靠猜环境变量的语义
 * 把 8 只测试宠物插进生产库。
 */
export function shouldSeed(raw: string | undefined): boolean {
  return raw === '1';
}

/**
 * 迁移锁的键。任意常量都行，只要全项目统一；取个固定数字避免和别的应用撞。
 * 见 https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS
 */
const MIGRATION_LOCK_KEY = 20260816;

/**
 * 幂等迁移：schema.sql 与 seed.sql 全部 IF NOT EXISTS / ON CONFLICT DO NOTHING，
 * 可反复执行。生产构建需把 *.sql 复制进 dist（见 package.json build 脚本）。
 *
 * 建表与灌数据分开：前者任何环境都该跑，后者只在明确要求时跑。
 *
 * 全程包在会话级咨询锁里：微信云托管多副本时每个副本启动都会跑迁移，并发执行
 * CREATE INDEX / INSERT 会互相踩（远程库上表现为 Connection terminated unexpectedly）。
 * 锁是会话级的，所以必须独占一条连接，不能用 pool.query()——那样每条语句可能落在
 * 不同连接上，锁等于没加。
 */
export async function runMigrations(pool: Pool, opts: MigrationOptions = {}): Promise<void> {
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  const seed = opts.seed ? readFileSync(join(__dirname, 'seed.sql'), 'utf8') : null;

  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
    try {
      await client.query(schema);
      if (seed) await client.query(seed);
    } finally {
      // 解锁要和加锁在同一条连接上，且必须在 release() 之前。
      await client.query(`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`);
    }
  } finally {
    client.release();
  }
}

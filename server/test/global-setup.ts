import { Pool } from 'pg';
import { runMigrations } from '../src/database/migrations';

/**
 * 全套件只跑一次迁移。
 *
 * 之前每个集成套件都在自己的 beforeAll 里跑 runMigrations：迁移加了咨询锁后它们被
 * 串行化，排在后面的套件要等前面几个跑完（远程库单次约 1.8s），必然撞 jest 默认的
 * 5000ms 钩子超时。迁移本来就是全局一次性动作，放这里最合适。
 *
 * 未设 DATABASE_URL 时直接返回，集成套件会各自 skip。
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    // 集成用例断言种子行数（8 宠物 / 10 场所 / 8 用户），测试环境固定灌种子，
    // 不受 SEED_DEMO_DATA 影响；该开关只管生产启动。
    await runMigrations(pool, { seed: true });
  } finally {
    await pool.end();
  }
}

import { Pool } from 'pg';

/**
 * 懒连接池：未设 DATABASE_URL 返回 null（服务端以 InMemory 模式运行），
 * 设了才创建连接池——无数据库的测试与演示不碰 socket。
 */
export function createPool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 });
}

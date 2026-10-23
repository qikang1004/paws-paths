import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type * as Shared from '@paws/types';
import type * as Me from '../src/me/me.controller';
import type * as Pets from '../src/pets/pets.service';

/**
 * 宠物 DTO 单一来源守卫（phase3-notes 第八节既有账 4）。
 *
 * `PetSummary` / `PetPhoto` / `PetDetail` / `PetListResponse` / `MyPetListResponse`
 * 是服务端响应与小程序共用的契约，唯一定义在 `packages/types`。服务端过去在
 * `pets.service.ts` / `me.controller.ts` 各抄了一份，加字段时要记得两边同改，
 * 漏一边编译器不会说话 —— 响应里多出或少了字段，客户端类型却照旧。
 *
 * 两道闸：
 * 1. **类型层**：服务端导出的名字必须与 `@paws/types` 那份**完全相同**（不是「互相可赋值」，
 *    可选 / readonly 的差别也算漂移）。ts-jest 带类型检查，不相等这个文件就编译不过。
 * 2. **文本层**：`server/src` 里不许再出现这几个名字的本地 `interface` / `type` 定义，
 *    只许从 `@paws/types` 转出。
 */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** 只在类型层起作用；参数为 `false` 时编译失败。 */
function assertTrue<T extends true>(): T | undefined {
  return undefined;
}

const SRC = resolve(__dirname, '..', 'src');
const SHARED_NAMES = ['PetSummary', 'PetPhoto', 'PetDetail', 'PetListResponse', 'MyPetListResponse'];
const LOCAL_DEF = new RegExp(
  // `interface X` 或 `type X =` / `type X<`；import 列表里的 `type X,` 不算定义。
  `^\\s*(?:export\\s+)?(?:interface\\s+(?:${SHARED_NAMES.join('|')})\\b|type\\s+(?:${SHARED_NAMES.join('|')})\\s*[=<])`,
  'm',
);

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('宠物 DTO 与 @paws/types 同源', () => {
  it('服务端导出的宠物 DTO 与 @paws/types 类型完全相同', () => {
    assertTrue<Equal<Pets.PetSummary, Shared.PetSummary>>();
    assertTrue<Equal<Pets.PetPhoto, Shared.PetPhoto>>();
    assertTrue<Equal<Pets.PetDetail, Shared.PetDetail>>();
    assertTrue<Equal<Pets.PetListResponse, Shared.PetListResponse>>();
    assertTrue<Equal<Me.MyPetListResponse, Shared.MyPetListResponse>>();
    // 守卫自检：Equal 真能分辨出漂移（多一个可选字段也算不同）。
    assertTrue<Equal<Equal<Shared.PetPhoto, Shared.PetPhoto & { extra?: string }>, false>>();
    expect(true).toBe(true);
  });

  it('server/src 不再本地定义这几个 DTO，只从 @paws/types 转出', () => {
    const files = listTsFiles(SRC);
    expect(files.length).toBeGreaterThan(20);
    const offenders = files
      .filter((f) => LOCAL_DEF.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});

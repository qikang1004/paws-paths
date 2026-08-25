import type { ImageExt } from './image-file';

/**
 * 存储分两档。**审核状态就是文件所在的档**，不另存一份状态：
 *
 * - `public`：机审通过的图，任何人可取。
 * - `private`：还没有结论的图（含 `FAKE_CONTENT_SECURITY` 那档），只有作者本人可取。
 *
 * 阶段 4 的证件照是合规硬约束（必须私有、不进 CDN），提前把这两档立在抽象里，
 * 到时候换对象存储只要再实现一次这个接口，业务侧不动。
 */
export type StorageLane = 'public' | 'private';

export const LANES: readonly StorageLane[] = ['public', 'private'];

export const IMAGE_STORAGE = 'ImageStorage';

export interface PutImageInput {
  lane: StorageLane;
  ownerId: string;
  ext: ImageExt;
  data: Buffer;
}

export interface ImageStorage {
  /** 落盘并返回 key（形如 `<ownerId>/<uuid>.<ext>`，就是入库要存的那个值）。 */
  put(input: PutImageInput): Promise<string>;
  /** 这个 key 在哪一档，不存在返回 null。取字节前先问这个，好在读之前决定给不给。 */
  locate(key: string): Promise<StorageLane | null>;
  read(key: string, lane: StorageLane): Promise<Buffer>;
}

export interface ImageKey {
  ownerId: string;
  name: string;
  ext: ImageExt;
}

/**
 * key 从 URL 里来，是**不可信输入**，而它接下来要拼成文件路径。
 *
 * 所以这里不做「过滤危险字符」那种黑名单，而是整条白名单匹配后**按字段重建路径** ——
 * `..`、`/`（含 `%2f` 解码出来的）、反斜杠、点开头的名字全都过不了这个正则，
 * 拼路径时用的也不再是原始字符串。
 */
const KEY_PATTERN =
  /^([A-Za-z0-9_-]{1,64})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|gif|webp)$/;

export function parseImageKey(raw: string): ImageKey | null {
  const matched = KEY_PATTERN.exec(raw);
  if (!matched) return null;
  return { ownerId: matched[1], name: matched[2], ext: matched[3] as ImageExt };
}

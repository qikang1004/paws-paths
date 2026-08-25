import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  LANES,
  parseImageKey,
  type ImageStorage,
  type PutImageInput,
  type StorageLane,
} from './image-storage';

/**
 * 本地磁盘实现：`<root>/public/<ownerId>/<uuid>.<ext>` 与 `<root>/private/...`。
 *
 * 本阶段的正式存储（对象存储 + CDN）属外部事项（spec §10），这里先用磁盘顶着。
 * 两档目录分开而不是同目录加标记，是为了让「私有的绝不进 CDN」这件事在阶段 4
 * 落成一条目录级的规则，而不是每次读写都要记得看那个标记。
 *
 * 单机限定：多副本部署时各实例只看得见自己那份盘。换成对象存储即解，
 * 已记在 phase2-notes 的遗留项里。
 */
export class LocalDiskImageStorage implements ImageStorage {
  constructor(private readonly root: string) {}

  async put({ lane, ownerId, ext, data }: PutImageInput): Promise<string> {
    const key = `${ownerId}/${randomUUID()}.${ext}`;
    const file = this.pathOf(key, lane);
    await mkdir(join(this.root, lane, ownerId), { recursive: true });
    await writeFile(file, data);
    return key;
  }

  async locate(key: string): Promise<StorageLane | null> {
    for (const lane of LANES) {
      if (await this.exists(key, lane)) return lane;
    }
    return null;
  }

  async read(key: string, lane: StorageLane): Promise<Buffer> {
    return readFile(this.pathOf(key, lane));
  }

  private async exists(key: string, lane: StorageLane): Promise<boolean> {
    try {
      await access(this.pathOf(key, lane));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 路径**按解析出的字段重建**，不用调用方给的原始字符串拼 —— key 里的穿越企图
   * 在 `parseImageKey` 那一步就整条不匹配了，这里再拼一次原串等于把防线又拆开。
   */
  private pathOf(key: string, lane: StorageLane): string {
    const parsed = parseImageKey(key);
    if (!parsed) throw new Error(`非法的图片 key：${key}`);
    return join(this.root, lane, parsed.ownerId, `${parsed.name}.${parsed.ext}`);
  }
}

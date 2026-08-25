/**
 * 上传文件的纯函数校验。放在这里而不是 service 里，是为了能不起 HTTP 就测：
 * 魔数嗅探和尺寸解析是这条通道上最容易写错、也最值得逐个 case 摆开的两件事。
 */

export type ImageExt = 'jpg' | 'png' | 'gif' | 'webp';

/** 单张图上限 5MB。微信 `chooseMedia` 压缩后的照片通常 1MB 上下，5MB 给全画质留了余量。 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * 交给 multer 的硬上限，刻意比业务上限宽一倍。
 *
 * 两道限制各管一段：multer 这道是**内存保护** —— 内存存储会把整个请求体读进 Buffer，
 * 没有它一个 1GB 的 body 就能把进程顶爆，超了直接 413；业务那道（{@link MAX_UPLOAD_BYTES}）
 * 才是给用户看的 422。留一倍余量是为了让「稍微超一点」这种正常误用落到 422 上，
 * 而不是撞在 413 那个语义更含糊的边界。
 */
export const MULTER_HARD_LIMIT_BYTES = MAX_UPLOAD_BYTES * 2;

export const MIME_OF: Readonly<Record<ImageExt, string>> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

const MAGIC: ReadonlyArray<{ ext: ImageExt; test: (data: Buffer) => boolean }> = [
  { ext: 'jpg', test: (d) => d.length >= 3 && d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff },
  { ext: 'png', test: (d) => d.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'gif', test: (d) => d.subarray(0, 4).toString('latin1') === 'GIF8' },
  // WEBP 是 RIFF 容器的一种，光看 RIFF 会把 AVI / WAV 也认进来，第 8 字节起那四个字符才是判据。
  {
    ext: 'webp',
    test: (d) =>
      d.length >= 12 &&
      d.subarray(0, 4).toString('latin1') === 'RIFF' &&
      d.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

/**
 * 按内容的魔数判断图片类型，**不看**客户端报的 `Content-Type` 或文件扩展名 ——
 * 两者都由请求方随便填，一个 shell 脚本改名成 `.jpg` 就能混进图片目录，
 * 而那个目录是要对外发字节的。认不出来就是认不出来，返回 null 让调用方 422。
 */
export function sniffImageType(data: Buffer): ImageExt | null {
  return MAGIC.find((candidate) => candidate.test(data))?.ext ?? null;
}

/** 宽高的上限，纯粹防呆：真实照片不会有十万像素的边。 */
const MAX_DIMENSION = 100_000;

/**
 * 解析 multipart 里的宽高。表单字段一律是字符串，所以先卡格式再转数：
 * `Number('')` 是 0、`Number(' 6 ')` 是 6、`parseInt('600.5')` 是 600，
 * 这三种宽容度在这里都是错的 —— 客户端把字段填错，不如当场 422 让它露出来。
 */
export function parseDimension(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw)) return null;
  const value = Number(raw);
  return value >= 1 && value <= MAX_DIMENSION ? value : null;
}

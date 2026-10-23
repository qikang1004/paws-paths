import { API_BASE_URL } from '../../../../config';
import { resolveImageUrl } from '../../../../utils/image-url';
import { buildAuditBadge } from '../../../../utils/post-view';
import type {
  PetDetail,
  PetGender,
  PetPhoto,
  PetSpecies,
  PetUpsertDto,
} from '../../../../shared/types/index';

/**
 * 宠物编辑页的表单模型。
 *
 * 校验放在这里而不是页面里，是因为这几条上限必须与服务端
 * (`server/src/pets/pets.service.ts`) 逐条对齐：放过去的东西会换回一个 422，
 * 而 422 的文案说的是字段名，对主人没有指导性。
 *
 * 长度一律按**码点数**（`[...s].length`）算，与服务端同口径 —— 用 `.length`
 * 的话一个 emoji 会算成两字，主人会看到「明明没超」的报错。
 */

/** 与服务端 `PET_NAME_MAX_LENGTH` 对齐。 */
export const PET_NAME_MAX_LENGTH = 20;
/** 与服务端 `PET_BREED_MAX_LENGTH` 对齐。 */
export const PET_BREED_MAX_LENGTH = 20;
/** 与服务端 `PET_BIO_MAX_LENGTH` 对齐。 */
export const PET_BIO_MAX_LENGTH = 200;
/** 与服务端 `PET_TAG_MAX_LENGTH` 对齐（单个标签）。 */
export const PET_TAG_MAX_LENGTH = 10;
/** 与服务端 `PET_TAGS_MAX_COUNT` 对齐（标签条数）。 */
export const PET_TAGS_MAX_COUNT = 5;
/** 一只宠物最多几张照片。服务端不限，这里限的是相册的可用性。 */
export const PET_PHOTOS_MAX_COUNT = 9;

export interface OptionView<T extends string> {
  value: T;
  label: string;
}

/**
 * 物种三档，**没有「全部」** —— 那是筛选栏的选项，建号必须落到一个具体物种上
 * （`species` 在服务端是必填白名单字段）。
 */
export const SPECIES_OPTIONS: OptionView<PetSpecies>[] = [
  { value: 'dog', label: '狗' },
  { value: 'cat', label: '猫' },
  { value: 'other', label: '其它' },
];

/** 性别三档，默认「不确定」：领回来的流浪猫当场未必分得清。 */
export const GENDER_OPTIONS: OptionView<PetGender>[] = [
  { value: 'unknown', label: '不确定' },
  { value: 'male', label: '公' },
  { value: 'female', label: '母' },
];

export interface PetForm {
  name: string;
  species: PetSpecies;
  gender: PetGender;
  breed: string;
  /** `YYYY-MM-DD`，空串表示不填。 */
  birthDate: string;
  bio: string;
  personalityTags: string[];
}

export function emptyPetForm(): PetForm {
  return {
    name: '',
    species: 'dog',
    gender: 'unknown',
    breed: '',
    birthDate: '',
    bio: '',
    personalityTags: [],
  };
}

/** 详情 → 表单。编辑与新建共用一套表单，差别只在这一步有没有数据可摊。 */
export function formFromDetail(detail: PetDetail): PetForm {
  return {
    name: detail.name,
    species: detail.species,
    gender: detail.gender,
    breed: detail.breed,
    birthDate: detail.birthDate ?? '',
    bio: detail.bio,
    personalityTags: [...detail.personalityTags],
  };
}

const countOf = (s: string): number => [...s].length;

/**
 * 标签输入框 → 标签数组。中英文逗号与空白都当分隔符：主人打字时用哪个
 * 取决于输入法此刻是中文还是英文，这不该变成一条校验错误。
 */
export function parseTags(raw: string): string[] {
  const parts = raw
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [...new Set(parts)];
}

/** 标签数组 → 输入框文本。回填时用中文逗号，与提示语里的写法一致。 */
export function formatTags(tags: string[]): string {
  return tags.join('，');
}

export interface ValidationResult {
  ok: boolean;
  /** 校验通过时为空串。页面直接把它丢给 `wx.showToast`。 */
  message: string;
}

const OK: ValidationResult = { ok: true, message: '' };
const fail = (message: string): ValidationResult => ({ ok: false, message });

/** `YYYY-MM-DD` 且必须是真实存在的日期 —— `2024-02-31` 格式对但没有这一天。 */
function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function validatePetForm(form: PetForm): ValidationResult {
  const name = form.name.trim();
  if (!name) return fail('给它起个名字吧');
  if (countOf(name) > PET_NAME_MAX_LENGTH) return fail(`名字最多 ${PET_NAME_MAX_LENGTH} 字`);

  if (!SPECIES_OPTIONS.some((o) => o.value === form.species)) return fail('选一下它是什么');

  if (countOf(form.breed.trim()) > PET_BREED_MAX_LENGTH) {
    return fail(`品种最多 ${PET_BREED_MAX_LENGTH} 字`);
  }
  if (countOf(form.bio.trim()) > PET_BIO_MAX_LENGTH) {
    return fail(`简介最多 ${PET_BIO_MAX_LENGTH} 字`);
  }

  if (form.personalityTags.length > PET_TAGS_MAX_COUNT) {
    return fail(`标签最多 ${PET_TAGS_MAX_COUNT} 个`);
  }
  if (form.personalityTags.some((tag) => countOf(tag) > PET_TAG_MAX_LENGTH)) {
    return fail(`单个标签最多 ${PET_TAG_MAX_LENGTH} 字`);
  }

  // 生日可以不填 —— 捡来的猫多半不知道，逼着填只会得到一个假日期。
  if (form.birthDate && !isRealDate(form.birthDate)) return fail('生日填的日子不对');

  return OK;
}

/**
 * 表单 → 提交体。生日空串**不发**：服务端按 `YYYY-MM-DD` 校验，空串会当格式错，
 * 而「不填」的正确表达是省略这个字段。
 */
export function toPetUpsert(form: PetForm): PetUpsertDto {
  const dto: PetUpsertDto = {
    name: form.name.trim(),
    species: form.species,
    gender: form.gender,
    breed: form.breed.trim(),
    bio: form.bio.trim(),
    personalityTags: form.personalityTags,
  };
  if (form.birthDate) dto.birthDate = form.birthDate;
  return dto;
}

export interface PhotoTile {
  id: string;
  /** 已补全的地址。 */
  url: string;
  /** 第一张就是封面：服务端按 `sort_order` 给，封面指针也指着它。 */
  isCover: boolean;
  /**
   * 角标文案。过审的照片是空串（不画角标）；待审 / 复核中 / 未通过的照片
   * 只有主人看得到（服务端对别人直接不下发），编辑页给它们压一个角标。
   * 文案与动态的审核角标共用 `buildAuditBadge`，两处措辞不各写一份。
   */
  badgeText: string;
}

export function buildPhotoTiles(photos: PetPhoto[], baseUrl?: string): PhotoTile[] {
  const base = baseUrl ?? API_BASE_URL;
  return photos.map((photo, index) => ({
    id: photo.id,
    url: resolveImageUrl(photo.url, base),
    isCover: index === 0,
    badgeText: buildAuditBadge(photo.auditStatus, null).text,
  }));
}

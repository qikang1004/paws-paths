import { pickAndUploadImages } from '../../../../api/media';
import {
  addPetPhoto,
  createPet,
  deletePet,
  fetchPetDetail,
  removePetPhoto,
  updatePet,
} from '../../../../api/pets';
import { locationStore } from '../../../../store/location';
import type { PetGender, PetSpecies, PetUpsertDto } from '../../../../shared/types/index';
import {
  GENDER_OPTIONS,
  PET_BIO_MAX_LENGTH,
  PET_NAME_MAX_LENGTH,
  PET_PHOTOS_MAX_COUNT,
  PET_TAGS_MAX_COUNT,
  SPECIES_OPTIONS,
  buildPhotoTiles,
  emptyPetForm,
  formFromDetail,
  formatTags,
  parseTags,
  toPetUpsert,
  validatePetForm,
  type PetForm,
  type PhotoTile,
} from './pet-edit-model';

/**
 * 宠物资料页，新建与编辑是同一个页面：差别只在有没有 `id`。
 *
 * 照片必须挂在一只已存在的宠物上（`POST /pets/:id/photos`），所以新建时先存资料、
 * 拿到 id 后原地转成编辑态再传图 —— 而不是把图攒在本地等保存时一起发，
 * 那样中途退出就全丢了。
 */
Page({
  data: {
    id: '',
    isNew: true,
    form: emptyPetForm(),
    /** 标签输入框的原文。数组回不到输入框里，得单独留一份文本。 */
    tagsText: '',
    photos: [] as PhotoTile[],
    speciesOptions: SPECIES_OPTIONS,
    genderOptions: GENDER_OPTIONS,
    nameMax: PET_NAME_MAX_LENGTH,
    bioMax: PET_BIO_MAX_LENGTH,
    tagsMax: PET_TAGS_MAX_COUNT,
    photosMax: PET_PHOTOS_MAX_COUNT,
    /** 生日不能选到未来。 */
    today: '',
    loading: false,
    saving: false,
    uploading: false,
    error: false,
  },

  onLoad(query: Record<string, string | undefined>) {
    const id = query.id ?? '';
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    this.setData({ id, isNew: !id, today });
    if (id) void this.load();
  },

  onRetry() {
    void this.load();
  },

  onNameInput(e: WechatMiniprogram.Input) {
    this.setData({ 'form.name': e.detail.value });
  },

  onBreedInput(e: WechatMiniprogram.Input) {
    this.setData({ 'form.breed': e.detail.value });
  },

  onBioInput(e: WechatMiniprogram.Input) {
    this.setData({ 'form.bio': e.detail.value });
  },

  onTagsInput(e: WechatMiniprogram.Input) {
    const raw = e.detail.value;
    // 原文照留，解析结果另存：正在打「粘人，」时不能把那个逗号吃掉。
    this.setData({ tagsText: raw, 'form.personalityTags': parseTags(raw) });
  },

  onSpeciesTap(e: WechatMiniprogram.BaseEvent) {
    this.setData({ 'form.species': String(e.currentTarget.dataset.value) as PetSpecies });
  },

  onGenderTap(e: WechatMiniprogram.BaseEvent) {
    this.setData({ 'form.gender': String(e.currentTarget.dataset.value) as PetGender });
  },

  onBirthDateChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ 'form.birthDate': String(e.detail.value) });
  },

  async onSave(): Promise<void> {
    if (this.data.saving) return;
    const form = this.data.form as PetForm;
    const check = validatePetForm(form);
    if (!check.ok) {
      wx.showToast({ title: check.message, icon: 'none' });
      return;
    }

    const dto = toPetUpsert(form);
    this.setData({ saving: true });
    try {
      if (this.data.isNew) {
        await this.create(dto);
      } else {
        // 整份表单一起发：字段齐全，撞不上「一个都不给」的 422。
        this.applyDetail(await updatePet(this.data.id, dto));
        wx.showToast({ title: '已保存', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  onDelete() {
    if (this.data.isNew) return;
    wx.showModal({
      title: '删掉这只宠物？',
      content: '它的照片、收藏和浏览记录会一起消失，删了找不回来。',
      confirmText: '删除',
      success: (res) => {
        if (res.confirm) void this.remove();
      },
    });
  },

  async onPickPhotos(): Promise<void> {
    if (this.data.uploading) return;
    if (this.data.isNew) {
      wx.showToast({ title: '先保存资料，再传照片', icon: 'none' });
      return;
    }
    const remaining = PET_PHOTOS_MAX_COUNT - this.data.photos.length;
    if (remaining <= 0) {
      wx.showToast({ title: `最多 ${PET_PHOTOS_MAX_COUNT} 张`, icon: 'none' });
      return;
    }

    this.setData({ uploading: true });
    try {
      const result = await pickAndUploadImages(remaining);
      if (result.canceled) return;
      if (result.images.length === 0) {
        if (result.skipped > 0) wx.showToast({ title: '这些图不合适，换几张', icon: 'none' });
        return;
      }
      for (const image of result.images) {
        // 宽高来自上传回执，原样带给服务端（Global Constraint 21）。
        await addPetPhoto(this.data.id, {
          url: image.url,
          width: image.width,
          height: image.height,
        });
      }
      if (result.skipped > 0) {
        wx.showToast({ title: `${result.skipped} 张没传上去`, icon: 'none' });
      }
      // 封面指针在服务端定，重取一遍比本地猜顺序可靠。
      await this.load();
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '上传失败', icon: 'none' });
    } finally {
      this.setData({ uploading: false });
    }
  },

  async onRemovePhoto(e: WechatMiniprogram.CustomEvent): Promise<void> {
    if (this.data.uploading) return;
    const photo = this.data.photos[Number(e.detail.index)];
    if (!photo) return;
    this.setData({ uploading: true });
    try {
      await removePetPhoto(this.data.id, photo.id);
      await this.load();
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '删除失败', icon: 'none' });
    } finally {
      this.setData({ uploading: false });
    }
  },

  /** 建号。带上定位是为了让别人在附近刷到它。 */
  async create(dto: PetUpsertDto): Promise<void> {
    const body: PetUpsertDto = { ...dto };
    // 只用已经拿到的精确坐标：为建号在这里补弹一次授权太打扰，广场页早问过了。
    // 没坐标就不带，服务端按「只有城市」收。
    const state = locationStore.state;
    if (state?.mode === 'precise') {
      body.lat = state.coords.latitude;
      body.lng = state.coords.longitude;
    }
    const created = await createPet(body);
    // 原地转编辑态：照片接口要 id，让主人接着传第一张。
    this.setData({ id: created.id, isNew: false });
    wx.showToast({ title: '建好了，传张照片吧', icon: 'none' });
    await this.load();
  },

  async remove(): Promise<void> {
    try {
      await deletePet(this.data.id);
      wx.showToast({ title: '已删除', icon: 'none' });
      wx.navigateBack();
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '删除失败', icon: 'none' });
    }
  },

  applyDetail(detail: Parameters<typeof formFromDetail>[0]): void {
    const form = formFromDetail(detail);
    this.setData({
      form,
      tagsText: formatTags(form.personalityTags),
      photos: buildPhotoTiles(detail.photos),
      error: false,
    });
  },

  async load(): Promise<void> {
    if (!this.data.id || this.data.loading) return;
    this.setData({ loading: true });
    try {
      this.applyDetail(await fetchPetDetail(this.data.id));
    } catch {
      this.setData({ error: true });
    } finally {
      this.setData({ loading: false });
    }
  },
});

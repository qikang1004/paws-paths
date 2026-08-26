import { pickAndUploadImages } from '../../../../api/media';
import { fetchMyPets } from '../../../../api/me';
import { publishPost } from '../../../../api/posts';
import { buildPetOptions, resolvePetId, type PetOption } from '../../../../utils/my-pets-view';
import {
  countChars,
  POST_CONTENT_MAX_LENGTH,
  POST_IMAGES_MAX_COUNT,
  toPublishBody,
  validatePostForm,
  type ComposeImage,
} from './compose-model';

/**
 * 发动态。
 *
 * 动态挂在宠物名下，所以先得选一只 —— 从「我的动态」进来时会把当前那只由
 * `?petId=` 带过来，直接选中它。一只宠物都没有时不给表单，那张表填完也发不出去。
 *
 * 选图不在这里做：`pickAndUploadImages` 才是唯一出口，图片的真实宽高必须原样从
 * chooseMedia 的返回带到上传接口（Global Constraint 21，服务端缺宽高直接 422）。
 * 页面自己去选图迟早会有人拿显示尺寸凑数。
 */
Page({
  data: {
    pets: [] as PetOption[],
    petId: '',
    content: '',
    contentCount: 0,
    contentMax: POST_CONTENT_MAX_LENGTH,
    images: [] as ComposeImage[],
    imagesMax: POST_IMAGES_MAX_COUNT,
    uploading: false,
    submitting: false,
  },

  onLoad(query: Record<string, string | undefined>) {
    void this.loadPets(query.petId ?? '');
  },

  onPetTap(e: WechatMiniprogram.BaseEvent) {
    const petId = String(e.currentTarget.dataset.id ?? '');
    if (!petId) return;
    this.setData({ petId });
  },

  onContentInput(e: WechatMiniprogram.Input) {
    const content = String(e.detail.value ?? '');
    // 字数按码点数，跟服务端一个口径（`compose-model.countChars`）。
    this.setData({ content, contentCount: countChars(content) });
  },

  async onPickPhotos(): Promise<void> {
    if (this.data.uploading) return;
    const remaining = POST_IMAGES_MAX_COUNT - this.data.images.length;
    if (remaining <= 0) {
      wx.showToast({ title: `最多只能发 ${POST_IMAGES_MAX_COUNT} 张图`, icon: 'none' });
      return;
    }
    this.setData({ uploading: true });
    try {
      const result = await pickAndUploadImages(remaining);
      // 点了取消不该弹任何东西，这跟「选了图但全被挡下」不是一回事。
      if (result.canceled) return;
      if (result.images.length > 0) {
        this.setData({ images: [...this.data.images, ...result.images] });
      }
      if (result.skipped > 0) {
        wx.showToast({ title: `${result.skipped} 张图没传上去`, icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '上传失败', icon: 'none' });
    } finally {
      this.setData({ uploading: false });
    }
  },

  onRemovePhoto(e: WechatMiniprogram.CustomEvent) {
    const index = Number(e.detail.index);
    this.setData({ images: this.data.images.filter((_, i) => i !== index) });
  },

  async onSubmit(): Promise<void> {
    // 上传还没完就提交，会把那几张图漏在外面。
    if (this.data.submitting || this.data.uploading) return;
    const form = {
      petId: this.data.petId,
      content: this.data.content,
      images: this.data.images,
    };
    const check = validatePostForm(form);
    if (!check.ok) {
      wx.showToast({ title: check.message, icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      await publishPost(toPublishBody(form));
      // 响应的 auditStatus 恒为 pending（机审在服务端异步跑），所以这里说「审核中」
      // 而不是「已发布」—— 过审前只有作者自己看得见这条。
      wx.showToast({ title: '发出去了，审核中', icon: 'none', duration: 1500 });
      setTimeout(() => {
        wx.navigateBack();
      }, 1200);
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '发布失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  onCreatePet() {
    wx.navigateTo({ url: '/packages/profile/pages/pet-edit/index' });
  },

  async loadPets(preferred: string): Promise<void> {
    try {
      const res = await fetchMyPets();
      const pets = buildPetOptions(res.items);
      this.setData({ pets, petId: resolvePetId(pets, preferred) });
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '加载失败', icon: 'none' });
    }
  },
});

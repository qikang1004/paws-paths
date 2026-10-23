# 结转账：宠物照片审核（`pet_photos.audit_status`）

对应 `phase3-notes.md` 第八节既有账 2 / 第九节清单第 4 项。spec §4.1 的表格与 §4.5
「`pet_photos` / `posts` / `post_images` / `messages` / `pet_licenses` 共用一套状态机」
一直写着 `pet_photos` 有 `audit_status`，实际没有。本次按 spec 补上，而不是改 spec。

## 一、做了什么

- **迁移**：`pet_photos.audit_status TEXT NOT NULL`，列级 CHECK 与另外两张表同一组四个值。
  分两步：`ADD COLUMN ... DEFAULT 'approved'` 让既有行回填为过审（它们在加列之前就已经
  公开展示，补列不该让它们一夜之间从广场消失），随后 `SET DEFAULT 'pending'` —— 从此以后
  漏写状态的插入默认待审（fail-closed）。两句都幂等，可以重复跑。
- **种子**：`seed.sql` 显式写 `'approved'`。不写的话 global-setup 第二遍跑种子时会落成默认的 pending。
- **接机审**：机审本来就在上传那一步同步做完，结论就是文件所在的存储档位（公开档 = 过审，
  私有档 = 待审）。`PetsService.addPhoto` 用 `UploadsService.laneOfUrl` 取档位，再经
  `auditStatusOfLane`（从 `posts.service.ts` 挪到 `uploads/image-storage.ts`，动态图片与宠物照片
  共用一处）定状态。验不出档位的地址（外链、拼错的 key、已删的文件）一律待审。
  请求体里带的 `auditStatus` 不认。
- **可见性**，与动态图片同一口径（`isVisibleTo` / `isPubliclyVisible`，SQL 里 `audit_status = ANY($n)`）：
  - 详情：别人与未登录只拿到过审照片；主人（`isOwn`）拿到全部，带 `auditStatus`。
    `PATCH /pets/:id` 的回读也按主人视角。
  - 广场 / `listByIds`（关注、收藏列表）：封面必须是过审照片，否则这只宠物不出现 —— 卡片是照片打底的。
  - 「我的宠物」不筛（同既有的「刚建好还没照片的宠物也要出现」）。
- **封面指针**：加照片时，封面为空、或新照片过审而当前封面不是过审的，就换成新照片；
  删掉封面时优先把过审的照片提上来。
- **类型**：`@paws/types` 的 `PetPhoto` 加 `auditStatus`，已 `sync:types` 到小程序。
- **小程序**：编辑页的相册格子按 `buildAuditBadge` 压「审核中 / 未通过」角标（`media-picker`
  新增可选的 `badgeText`，组件本身不认识审核状态）。

## 二、刻意没做 / 已知限制

1. **没有异步转正路径。** `moderation_tasks` / `audit_log` 的 `target_type` CHECK 只有
   `post` / `post_image`，运营后台也只处理这两类。所以一张机审结论为待审的宠物照片会**一直待审**，
   主人能看到「审核中」，别人看不到。要让它能转正，需要把 `pet_photo` 加进
   `MODERATION_TARGET_TYPES` 与那两条 CHECK，并在运营后台接上 —— 留给后续。
2. **`PATCH coverPhotoId` 仍然可以指向待审照片**（只校验是这只宠物自己的照片）。后果是这只宠物
   暂时离开广场，不会泄露待审图片；没有拦成 422 是为了不在本次改变既有写接口的语义。
3. **小程序编辑页的 `isCover` 仍按「第一张」算。** 封面现在优先过审照片，第一张是待审时
   这个标记可能不准；详情页对主人展示待审照片时也没有角标。
4. **详情查询的宠物本体仍按 `visibility = 'public'` 过滤**（既有行为，未改）。

## 三、验证到哪一步

- 无库：server / miniprogram / `@paws/types` 全量测试与构建通过（数字见 PR 描述）。
- **真库未跑**：`test/pet-photo-audit.spec.ts` 有一份 Postgres 门控的同契约测试，需要 `DATABASE_URL`。
  上线前请在真库上跑一遍迁移（确认既有行回填为 approved、新行默认 pending）和这套测试。
- **微信开发者工具未跑**：角标的样式（左下角、反色 token）需要在开发者工具 / 真机上看一眼。

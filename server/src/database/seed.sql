INSERT INTO users (id, openid, nickname, avatar_url, is_verified_owner) VALUES
  ('u-1','openid-huang','小陈','https://picsum.photos/seed/paw-u1/120/120',true),
  ('u-2','openid-naixi','阿喵','https://picsum.photos/seed/paw-u2/120/120',true),
  ('u-3','openid-kele','老王','https://picsum.photos/seed/paw-u3/120/120',false),
  ('u-4','openid-doubao','小周','https://picsum.photos/seed/paw-u4/120/120',false),
  ('u-5','openid-huahua','安安','https://picsum.photos/seed/paw-u5/120/120',true),
  ('u-6','openid-tuanzi','七七','https://picsum.photos/seed/paw-u6/120/120',false),
  ('u-7','openid-wangcai','老李','https://picsum.photos/seed/paw-u7/120/120',true),
  ('u-8','openid-mimi','点点','https://picsum.photos/seed/paw-u8/120/120',false)
ON CONFLICT (openid) DO NOTHING;

INSERT INTO pets (id, owner_id, name, species, breed, gender, birth_date, bio, personality_tags, location, last_active_at) VALUES
  ('p-1','u-1','大黄','dog','金毛','male','2022-05-01','爱玩水的暖男，见到谁都摇尾巴。','{"黏人","爱玩水"}',ST_SetSRID(ST_MakePoint(116.4040,39.9060),4326),'2026-08-20T10:00:00Z'),
  ('p-2','u-2','奶昔','cat','布偶','female','2024-02-14','蓝眼睛的小公主，喜欢被摸下巴。','{"温柔","爱睡觉"}',ST_SetSRID(ST_MakePoint(116.4100,39.9020),4326),'2026-08-21T08:30:00Z'),
  ('p-3','u-3','可乐','dog','柯基','male','2023-08-20','小短腿大嗓门，对零食毫无抵抗力。','{"活泼","贪吃"}',ST_SetSRID(ST_MakePoint(116.4000,39.9100),4326),'2026-08-19T18:00:00Z'),
  ('p-4','u-4','豆包','dog','柴犬','female','2021-11-11','高冷柴，出门必带围巾。','{"高冷","独立"}',ST_SetSRID(ST_MakePoint(116.4150,39.9000),4326),'2026-08-18T09:00:00Z'),
  ('p-5','u-5','花花','cat','中华田园猫','female','2023-03-08','小区明星，尾巴上有朵花。','{"粘人","怕生"}',ST_SetSRID(ST_MakePoint(116.4120,39.9080),4326),'2026-08-17T15:00:00Z'),
  ('p-6','u-6','团子','cat','英国短毛猫','male','2024-06-01','圆脸橘白，站着都能睡着。','{"安静","圆脸"}',ST_SetSRID(ST_MakePoint(116.4000,39.8950),4326),'2026-08-16T12:00:00Z'),
  ('p-7','u-7','旺财','dog','边牧','male','2022-12-25','智商担当，会开门会拿快递。','{"聪明","精力旺盛"}',ST_SetSRID(ST_MakePoint(116.4180,39.9150),4326),'2026-08-22T07:00:00Z'),
  ('p-8','u-8','咪咪','cat','美国短毛猫','female','2024-09-10','好奇心旺盛，家里的探索者。','{"好奇","活泼"}',ST_SetSRID(ST_MakePoint(116.4060,39.8990),4326),'2026-08-15T20:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO pet_photos (id, pet_id, url, width, height, sort_order) VALUES
  ('ph-1','p-1','https://picsum.photos/seed/paws-huang/600/800',600,800,0),
  ('ph-2','p-1','https://picsum.photos/seed/paws-huang2/800/600',800,600,1),
  ('ph-3','p-1','https://picsum.photos/seed/paws-huang3/600/800',600,800,2),
  ('ph-4','p-2','https://picsum.photos/seed/paws-naixi/800/600',800,600,0),
  ('ph-5','p-2','https://picsum.photos/seed/paws-naixi2/600/800',600,800,1),
  ('ph-6','p-3','https://picsum.photos/seed/paws-kele/600/800',600,800,0),
  ('ph-7','p-3','https://picsum.photos/seed/paws-kele2/900/600',900,600,1),
  ('ph-8','p-4','https://picsum.photos/seed/paws-doubao/900/600',900,600,0),
  ('ph-9','p-4','https://picsum.photos/seed/paws-doubao2/600/800',600,800,1),
  ('ph-10','p-5','https://picsum.photos/seed/paws-huahua/600/800',600,800,0),
  ('ph-11','p-5','https://picsum.photos/seed/paws-huahua2/800/800',800,800,1),
  ('ph-12','p-6','https://picsum.photos/seed/paws-tuanzi/800/800',800,800,0),
  ('ph-13','p-6','https://picsum.photos/seed/paws-tuanzi2/600/800',600,800,1),
  ('ph-14','p-7','https://picsum.photos/seed/paws-wangcai/600/900',600,900,0),
  ('ph-15','p-7','https://picsum.photos/seed/paws-wangcai2/800/600',800,600,1),
  ('ph-16','p-8','https://picsum.photos/seed/paws-mimi/700/700',700,700,0),
  ('ph-17','p-8','https://picsum.photos/seed/paws-mimi2/600/800',600,800,1)
ON CONFLICT (id) DO NOTHING;

-- 回填 cover_photo_id：第一张即封面
UPDATE pets SET cover_photo_id = 'ph-1' WHERE id = 'p-1' AND cover_photo_id IS NULL;
UPDATE pets SET cover_photo_id = 'ph-4' WHERE id = 'p-2' AND cover_photo_id IS NULL;
UPDATE pets SET cover_photo_id = 'ph-6' WHERE id = 'p-3' AND cover_photo_id IS NULL;
UPDATE pets SET cover_photo_id = 'ph-8' WHERE id = 'p-4' AND cover_photo_id IS NULL;
UPDATE pets SET cover_photo_id = 'ph-10' WHERE id = 'p-5' AND cover_photo_id IS NULL;
UPDATE pets SET cover_photo_id = 'ph-12' WHERE id = 'p-6' AND cover_photo_id IS NULL;
UPDATE pets SET cover_photo_id = 'ph-14' WHERE id = 'p-7' AND cover_photo_id IS NULL;
UPDATE pets SET cover_photo_id = 'ph-16' WHERE id = 'p-8' AND cover_photo_id IS NULL;

INSERT INTO venue_extras (poi_id, name, address, category, rating, avg_price, tags, curated_photo, location) VALUES
  ('v-1','宠福康宠物医院','朝阳区望京西路 48 号','hospital',4.8,320,'{"夜间急诊","猫友好"}','https://picsum.photos/seed/venue-v1/800/500',ST_SetSRID(ST_MakePoint(116.4050,39.9050),4326)),
  ('v-2','贝恩宠物医院','朝阳区广顺北大街 33 号','hospital',4.5,280,'{"犬猫分区","住院部"}','https://picsum.photos/seed/venue-v2/800/500',ST_SetSRID(ST_MakePoint(116.4020,39.9120),4326)),
  ('v-3','萌宠之家宠物用品店','朝阳区望京街 9 号','shop',4.6,150,'{"进口粮","美容工具"}','https://picsum.photos/seed/venue-v3/800/500',ST_SetSRID(ST_MakePoint(116.4090,39.9010),4326)),
  ('v-4','汪汪星球宠物店','朝阳区阜通东大街 12 号','shop',4.7,180,'{"活体选购","寄养"}','https://picsum.photos/seed/venue-v4/800/500',ST_SetSRID(ST_MakePoint(116.4140,39.9070),4326)),
  ('v-5','靓靓宠物美容','朝阳区望京西路 27 号','grooming',4.9,120,'{"造型设计","SPA"}','https://picsum.photos/seed/venue-v5/800/500',ST_SetSRID(ST_MakePoint(116.4060,39.9030),4326)),
  ('v-6','爪爪洗澡屋','朝阳区湖光中街 5 号','grooming',4.4,80,'{"洗护","修剪"}','https://picsum.photos/seed/venue-v6/800/500',ST_SetSRID(ST_MakePoint(116.4080,39.9100),4326)),
  ('v-7','朝阳公园宠物区','朝阳区朝阳公园南路 1 号','park',4.6,0,'{"大草坪","宠物厕所"}','https://picsum.photos/seed/venue-v7/800/500',ST_SetSRID(ST_MakePoint(116.4160,39.9080),4326)),
  ('v-8','奥森宠物公园','朝阳区科荟路 33 号','park',4.8,0,'{"围栏区","饮水点"}','https://picsum.photos/seed/venue-v8/800/500',ST_SetSRID(ST_MakePoint(116.4120,39.9150),4326)),
  ('v-9','有猫咖啡','朝阳区望京西路 19 号','cafe',4.7,45,'{"猫咪互动","咖啡"}','https://picsum.photos/seed/venue-v9/800/500',ST_SetSRID(ST_MakePoint(116.4030,39.9020),4326)),
  ('v-10','萌宠主题餐厅','朝阳区阜通西大街 8 号','cafe',4.3,88,'{"宠物餐","人宠同食"}','https://picsum.photos/seed/venue-v10/800/500',ST_SetSRID(ST_MakePoint(116.4110,39.9060),4326))
ON CONFLICT (poi_id) DO NOTHING;

-- ── 阶段 2 种子 ────────────────────────────────────────────────────
-- u-1 关注了 3 只别人的宠物（不含自己的 p-1，关注自己应被接口拦下）。
INSERT INTO follows (id, follower_id, target_pet_id, created_at) VALUES
  ('f-1','u-1','p-2', now() - interval '3 day'),
  ('f-2','u-1','p-3', now() - interval '2 day'),
  ('f-3','u-1','p-5', now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- 浏览历史混两种 target_type，供「按 viewed_at 倒序」与混排投影用。
INSERT INTO view_history (id, user_id, target_type, target_id, viewed_at) VALUES
  ('vh-1','u-1','pet','p-3', now() - interval '4 hour'),
  ('vh-2','u-1','venue','v-1', now() - interval '3 hour'),
  ('vh-3','u-1','pet','p-5', now() - interval '2 hour'),
  ('vh-4','u-1','venue','v-9', now() - interval '1 hour')
ON CONFLICT (id) DO NOTHING;

-- 动态覆盖审核状态机的三种可见性情形：
--   po-1/po-2/po-3 approved  → 所有人可见
--   po-4 pending             → 仅作者 u-2 可见（「审核中」角标）
--   po-5 rejected            → 仅作者 u-5 可见（带驳回原因）
-- po-4 / po-5 是「未 approved 对他人不可见」那条过审必要条件的测试素材，
-- 删掉它们会让 post-visibility.security.spec.ts 失去意义。
INSERT INTO posts (id, pet_id, author_id, content, audit_status, reject_reason, published_at) VALUES
  ('po-1','p-1','u-1','今天带大黄去公园撒欢，玩水玩到不肯走。','approved',NULL, now() - interval '5 hour'),
  ('po-2','p-2','u-2','奶昔今天格外黏人，一直踩奶。','approved',NULL, now() - interval '4 hour'),
  ('po-3','p-5','u-5','花花学会开门了，家里再没有秘密。','approved',NULL, now() - interval '3 hour'),
  ('po-4','p-2','u-2','这条还在机审队列里。','pending',NULL, now() - interval '2 hour'),
  ('po-5','p-5','u-5','这条被机审驳回了。','rejected','包含疑似违规信息', now() - interval '1 hour')
ON CONFLICT (id) DO NOTHING;

-- 图片宽高各异，供瀑布流按原始比例预估高度。
-- pi-6 挂在 approved 的 po-3 上但自身 pending：用于验证「文字过审、某张图未过审时
-- 该图不返回而文字正常显示」，图片与动态的审核状态是独立的。
INSERT INTO post_images (id, post_id, url, width, height, sort_order, audit_status) VALUES
  ('pi-1','po-1','https://picsum.photos/seed/post-1a/600/800',600,800,0,'approved'),
  ('pi-2','po-1','https://picsum.photos/seed/post-1b/800/600',800,600,1,'approved'),
  ('pi-3','po-2','https://picsum.photos/seed/post-2a/700/700',700,700,0,'approved'),
  ('pi-4','po-3','https://picsum.photos/seed/post-3a/900/600',900,600,0,'approved'),
  ('pi-5','po-4','https://picsum.photos/seed/post-4a/600/900',600,900,0,'pending'),
  ('pi-6','po-3','https://picsum.photos/seed/post-3b/800/800',800,800,1,'pending')
ON CONFLICT (id) DO NOTHING;

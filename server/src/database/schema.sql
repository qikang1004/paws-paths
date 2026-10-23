CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  openid TEXT UNIQUE NOT NULL,
  nickname TEXT NOT NULL,
  avatar_url TEXT,
  is_verified_owner BOOLEAN NOT NULL DEFAULT false,
  last_location geography(Point,4326),
  city TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  species TEXT NOT NULL CHECK (species IN ('dog','cat','other')),
  breed TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male','female','unknown')),
  birth_date DATE NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  personality_tags TEXT[] NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'public',
  location geography(Point,4326),
  cover_photo_id TEXT,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pets_location_gix ON pets USING GIST (location);
CREATE INDEX IF NOT EXISTS pets_visibility_active_idx ON pets (visibility, last_active_at DESC);

CREATE TABLE IF NOT EXISTS pet_photos (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pets(id),
  url TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_photos_pet_idx ON pet_photos (pet_id, sort_order);

CREATE TABLE IF NOT EXISTS venue_extras (
  poi_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('hospital','shop','grooming','park','cafe','other')),
  rating NUMERIC(2,1),
  avg_price INTEGER,
  tags TEXT[] NOT NULL DEFAULT '{}',
  curated_photo TEXT,
  location geography(Point,4326) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venue_extras_location_gix ON venue_extras USING GIST (location);
CREATE INDEX IF NOT EXISTS venue_extras_category_idx ON venue_extras (category);

-- 阶段 2 把这张表从「只支持场所」改成多态（spec §4.2：target_type + target_id）。
-- 新库直接建成多态形状；阶段 1 建的旧库由文件末尾的迁移块改过来。
-- target_id 刻意不设外键：目标是多态的（pets 一张表、场所来自腾讯 POI 本库可能没有），
-- 与 view_history 同一个理由，目标失效在投影时跳过。
CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('pet','venue')),
  target_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS favorites_user_idx ON favorites (user_id, created_at DESC);

-- ── 阶段 2：身份与社交 ──────────────────────────────────────────────
-- 主键与外键一律 TEXT：既有 users.id / pets.id 是 TEXT（值形如 u-1 / p-2），
-- 用 uuid 会因类型不匹配直接建表失败。

-- 关注关系。spec §4.2：目标是宠物不是用户。
CREATE TABLE IF NOT EXISTS follows (
  id TEXT PRIMARY KEY,
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (follower_id, target_pet_id)
);
CREATE INDEX IF NOT EXISTS follows_follower_idx ON follows (follower_id, created_at DESC);
CREATE INDEX IF NOT EXISTS follows_target_idx ON follows (target_pet_id);

-- 浏览历史。spec §4.2：按 (user, target) 幂等更新时间戳，
-- 唯一约束是 ON CONFLICT DO UPDATE 的前提。
CREATE TABLE IF NOT EXISTS view_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('pet','venue')),
  target_id TEXT NOT NULL,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS view_history_user_idx ON view_history (user_id, viewed_at DESC);

-- 动态。audit_status 走 spec §4.5 统一审核状态机。
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  audit_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (audit_status IN ('pending','approved','pending_review','rejected')),
  reject_reason TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 可见性过滤是最热的查询路径（未 approved 对他人不可见），状态入索引。
CREATE INDEX IF NOT EXISTS posts_pet_visible_idx ON posts (pet_id, audit_status, published_at DESC);
CREATE INDEX IF NOT EXISTS posts_author_idx ON posts (author_id, published_at DESC);

-- 动态图片。width/height 为瀑布流预估高度而存在，spec §4.1 明确非可选。
-- 审核状态与 posts 独立：文字过审而某张图未过审时，该图不返回、文字正常显示。
CREATE TABLE IF NOT EXISTS post_images (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  audit_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (audit_status IN ('pending','approved','pending_review','rejected'))
);
CREATE INDEX IF NOT EXISTS post_images_post_idx ON post_images (post_id, sort_order);

-- ── 阶段 3：举报与人工复核 ──────────────────────────────────────────
-- spec §4.4 的两张表。职责不同，不可互相替代（spec 原话）：
-- audit_log 是不可变流水，只追加；moderation_tasks 是待处理队列，会被更新。

-- 审核动作的不可变流水。
--
-- actor_id 与 target_id 都不挂外键，理由不同：
--   actor_id：流水必须比它记录的主体活得久。ON DELETE SET NULL 会改写一条
--     本该不可变的记录，RESTRICT 会让有审核历史的用户永远删不掉。
--   target_id：目标是多态的（post / post_image 两张表），同 favorites/view_history。
-- 代价是拼错的 actor_id 不会被库拦住，接受。
-- 机审的流水 actor_id 为 NULL —— 那不是人做的动作。
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL
    CHECK (action IN ('report','review_approve','review_reject','auto_approve','auto_reject')),
  target_type TEXT NOT NULL CHECK (target_type IN ('post','post_image')),
  target_id TEXT NOT NULL,
  status_before TEXT NOT NULL
    CHECK (status_before IN ('pending','approved','pending_review','rejected')),
  status_after TEXT NOT NULL
    CHECK (status_after IN ('pending','approved','pending_review','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_target_idx ON audit_log (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_id, created_at DESC);

-- 待处理的审核工单。result IS NULL 即待处理。
-- source 保留 spec §4.4 的三个值，但本阶段机审**不入队**（机审当场就有结论，
-- 入队等于建一条立刻要关掉的工单）。
--
-- reported_by 与 handled_by **挂**了外键（ON DELETE SET NULL）：工单是队列不是流水，
-- 运营账号注销后把指针置空是可接受的，而队列本身不承担合规留痕的职责 —— 那是
-- audit_log 的事。这与 audit_log.actor_id 不挂外键的取向不矛盾，两张表职责不同。
CREATE TABLE IF NOT EXISTS moderation_tasks (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('post','post_image')),
  target_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('wx_auto','user_report','manual')),
  reported_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  result TEXT CHECK (result IN ('approved','rejected')),
  handled_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 举报幂等的实现：同一目标同时只能有一条未处理工单。
-- 部分索引而不是整表唯一 —— 同一条内容可以被举报、复核、再被举报第二次。
CREATE UNIQUE INDEX IF NOT EXISTS moderation_tasks_open_target_idx
  ON moderation_tasks (target_type, target_id) WHERE result IS NULL;
CREATE INDEX IF NOT EXISTS moderation_tasks_queue_idx
  ON moderation_tasks (created_at) WHERE result IS NULL;

-- ── 既有表的迁移 ────────────────────────────────────────────────────
-- 放在所有建表之后：这里改的是阶段 1 已经存在的表，顺序反了会改到还没建的表上。

-- 运营角色。RBAC 的最小落法（spec §3.1 的运营后台复用同一 API + RBAC 隔离）。
-- 只增一列，不改任何既有列的类型或约束。既有用户自动落 'user'。
--
-- CHECK 写成**列级**约束跟在同一句里，不另开 ADD CONSTRAINT：
-- ADD CONSTRAINT 没有 IF NOT EXISTS，重跑会报重复，而列级 CHECK 跟着
-- ADD COLUMN IF NOT EXISTS 一起幂等 —— 列已存在时整句跳过，不会重复加约束。
-- 已在远程库上用临时表实测：重跑两次约束数不变（都是一条自动命名的
-- users_role_check），且非法值被拦（SQLSTATE 23514）。
--
-- 角色**不进 JWT**：令牌是阶段 0 签的，里面没有角色字段；而把角色塞进令牌会让
-- 「撤销运营权限」要等到令牌过期才生效。每次复核多一次 O(1) 查询，换即时可撤销。
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'
  CHECK (role IN ('user','moderator','admin'));

-- 宠物照片接入审核（spec §4.5：pet_photos 与 posts / post_images 共用一套状态机）。
--
-- 两步走，顺序不能反：
--   1. 加列时 DEFAULT 'approved' —— 存量照片此前一直公开展示，加列这一刻原地回填成
--      「已过审」，否则上线即广场全空；
--   2. 回填完把默认值切到 'pending' —— 之后漏传状态的新行宁可待审，也不默认公开
--      （fail-closed，同 posts.audit_status）。
-- 第 2 句每次启动都重跑，但 SET DEFAULT 只改目录、不碰行，幂等且无害；
-- 第 1 句在列已存在时整句跳过，不会把后来的待审行再刷成 approved。
-- CHECK 写成列级约束（理由同上面 users.role）。
ALTER TABLE pet_photos ADD COLUMN IF NOT EXISTS audit_status TEXT NOT NULL DEFAULT 'approved'
  CHECK (audit_status IN ('pending','approved','pending_review','rejected'));
ALTER TABLE pet_photos ALTER COLUMN audit_status SET DEFAULT 'pending';

-- 运营后台的登录凭据（阶段 4：独立 Web 后台）。
--
-- 两列都**允许 NULL**，这是本段最要紧的一点：小程序用户走微信登录（openid），
-- 压根没有用户名与密码。只有运营账号会有值 —— 给所有用户加密码等于开一条
-- 全新的、不该存在的攻击面。加 NOT NULL 还会让迁移在有数据的旧库上直接失败。
--
-- password_hash 存的是自描述串（scrypt$N$r$p$salt$hash，见 src/auth/password.ts），
-- 参数写在串里，所以这里不需要额外的算法/成本列 —— 将来调高成本或换 argon2
-- 都不必再动 schema。
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- 用户名唯一，但只约束非 NULL 的行。
-- Postgres 的 UNIQUE 本来就允许多个 NULL，写成部分索引是为了把意图讲明白：
-- 「没有用户名」不是一种需要互斥的值。这个索引同时也是登录查询的索引
-- （WHERE username = $1 是密码登录的唯一入口）。
CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx
  ON users (username) WHERE username IS NOT NULL;

-- favorites 多态化。spec §4.2 要求 (target_type, target_id)，阶段 1 实际建的是
-- (user_id, poi_id) 复合主键，只支持场所收藏，宠物详情的收藏心标（原型 _2）
-- 因此从未落地。这是对「只增不改」的**有意例外**，记在
-- docs/superpowers/phase2-notes.md 的「与计划的偏差」里。
--
-- 整段包在「poi_id 这列还在吗」的判断里，两个理由：
--   1. 新库的建表语句已经是多态形状，没有 poi_id —— 而 UPDATE ... = poi_id
--      会在语义分析阶段就因为列不存在而报错。plpgsql 对没走到的分支不做名字解析，
--      所以这个判断挡得住。
--   2. 迁移每次启动都重跑，已迁过的库必须原地跳过。
-- schema.sql 整体是一条多语句查询，跑在同一个隐式事务里，所以这段要么全成要么全滚回，
-- 不会留下「加了列没换主键」的半截状态。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'favorites' AND column_name = 'poi_id'
  ) THEN
    ALTER TABLE favorites ADD COLUMN IF NOT EXISTS target_type TEXT;
    ALTER TABLE favorites ADD COLUMN IF NOT EXISTS target_id TEXT;
    -- 回填：阶段 1 的每一行都是场所收藏。
    UPDATE favorites SET target_type = 'venue', target_id = poi_id WHERE target_id IS NULL;
    -- 回填完才能上非空与 CHECK，顺序反了有数据的库直接迁移失败。
    ALTER TABLE favorites ALTER COLUMN target_type SET NOT NULL;
    ALTER TABLE favorites ALTER COLUMN target_id SET NOT NULL;
    ALTER TABLE favorites ADD CONSTRAINT favorites_target_type_check
      CHECK (target_type IN ('pet','venue'));
    -- 换主键：旧主键 (user_id, poi_id) 挡着后面的 DROP COLUMN。
    ALTER TABLE favorites DROP CONSTRAINT IF EXISTS favorites_pkey;
    ALTER TABLE favorites ADD PRIMARY KEY (user_id, target_type, target_id);
    -- poi_id 的值已经进 target_id，留着就是第二份真相。
    ALTER TABLE favorites DROP COLUMN poi_id;
    CREATE INDEX IF NOT EXISTS favorites_user_idx ON favorites (user_id, created_at DESC);
  END IF;
END $$;

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

-- ── 既有表的迁移 ────────────────────────────────────────────────────
-- 放在所有建表之后：这里改的是阶段 1 已经存在的表，顺序反了会改到还没建的表上。

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

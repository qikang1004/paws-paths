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

CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL REFERENCES users(id),
  poi_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, poi_id)
);

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

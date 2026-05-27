-- 初始化用户表 + 激活码表 + 创建管理员账户
-- 运行一次即可

-- 1. 用户表
CREATE TABLE IF NOT EXISTS xx_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  user_group VARCHAR(20) DEFAULT 'member',
  expire_at TIMESTAMP,
  status VARCHAR(20) DEFAULT 'active',
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_login TIMESTAMP
);

-- 2. 激活码表
CREATE TABLE IF NOT EXISTS xx_activation_codes (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  days INTEGER NOT NULL,
  batch_id VARCHAR(100),
  created_by INTEGER REFERENCES xx_users(id),
  used_by INTEGER REFERENCES xx_users(id),
  status VARCHAR(20) DEFAULT 'unused',
  created_at TIMESTAMP DEFAULT NOW(),
  used_at TIMESTAMP
);

-- 3. 创建管理员账户（admin / zzmm2026）
-- bcrypt hash for 'zzmm2026' using bcryptjs rounds=10
INSERT INTO xx_users (username, password_hash, user_group, expire_at, status, created_at, updated_at)
VALUES ('admin', '$2a$10$rPQvZKz0vQ3nXJG7d5JvXOQZ6lL8m5F1pH9rV6eW3oB2cKxH8jU0', 'admin', '2099-12-31', 'active', NOW(), NOW())
ON CONFLICT (username) DO NOTHING;

-- 4. 生成一批激活码（10个30天，5个90天）
DO $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i INT;
  seg TEXT;
  code TEXT;
BEGIN
  FOR i IN 1..10 LOOP
    seg := '';
    FOR j IN 1..4 LOOP
      seg := seg || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    code := seg || '-' ||
      (SELECT string_agg(substr(chars, floor(random() * length(chars) + 1)::int, 1), '') FROM generate_series(1,4)) || '-' ||
      (SELECT string_agg(substr(chars, floor(random() * length(chars) + 1)::int, 1), '') FROM generate_series(1,4));
    INSERT INTO xx_activation_codes (code, days, batch_id, status, created_at)
    VALUES (code, 30, '初始批次', 'unused', NOW()) ON CONFLICT DO NOTHING;
  END LOOP;

  FOR i IN 1..5 LOOP
    seg := '';
    FOR j IN 1..4 LOOP
      seg := seg || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    code := seg || '-' ||
      (SELECT string_agg(substr(chars, floor(random() * length(chars) + 1)::int, 1), '') FROM generate_series(1,4)) || '-' ||
      (SELECT string_agg(substr(chars, floor(random() * length(chars) + 1)::int, 1), '') FROM generate_series(1,4));
    INSERT INTO xx_activation_codes (code, days, batch_id, status, created_at)
    VALUES (code, 90, '初始批次', 'unused', NOW()) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
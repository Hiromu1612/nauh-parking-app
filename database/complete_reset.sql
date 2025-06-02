-- 完全なデータベースリセットとセットアップ

-- 既存のポリシーとトリガーを削除
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 既存のポリシーを削除
DROP POLICY IF EXISTS select_roles ON roles;
DROP POLICY IF EXISTS insert_own_user ON users;
DROP POLICY IF EXISTS insert_own_user_role ON user_roles;
DROP POLICY IF EXISTS insert_own_parking_lot ON parking_lots;
DROP POLICY IF EXISTS create_own_parking_lots ON parking_lots;
DROP POLICY IF EXISTS owner_own_parking_lots ON parking_lots;
DROP POLICY IF EXISTS admin_all_parking_lots ON parking_lots;

-- 既存のテーブルを削除（順序に注意）
DROP TABLE IF EXISTS space_statuses CASCADE;
DROP TABLE IF EXISTS detection_results CASCADE;
DROP TABLE IF EXISTS detection_sessions CASCADE;
DROP TABLE IF EXISTS parking_spaces CASCADE;
DROP TABLE IF EXISTS parking_lots CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

-- ビューを削除
DROP VIEW IF EXISTS latest_detection_results CASCADE;

-- 関数を削除
DROP FUNCTION IF EXISTS end_detection_session(text);

-- 1. ロールテーブル
CREATE TABLE roles (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT
);

-- 2. ユーザーテーブル
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_sign_in TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE
);

-- 3. ユーザーロールテーブル
CREATE TABLE user_roles (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- 4. 駐車場テーブル
CREATE TABLE parking_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  location TEXT,
  address TEXT,
  total_spaces INTEGER NOT NULL DEFAULT 0,
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  camera_id TEXT,
  config JSONB
);

-- 5. 駐車スペーステーブル
CREATE TABLE parking_spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parking_lot_id UUID REFERENCES parking_lots(id) ON DELETE CASCADE,
  space_number TEXT NOT NULL,
  type TEXT DEFAULT 'standard',
  status TEXT DEFAULT 'empty',
  coordinates JSONB
);

-- 6. 検知セッションテーブル
CREATE TABLE detection_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parking_lot_id UUID REFERENCES parking_lots(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ DEFAULT NOW(),
  end_time TIMESTAMPTZ,
  status TEXT DEFAULT 'running',
  started_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- 7. 検知結果テーブル
CREATE TABLE detection_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES detection_sessions(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  frame_count INTEGER,
  frame_path TEXT,
  total_occupied_spaces INTEGER,
  total_empty_spaces INTEGER,
  total_cars INTEGER,
  total_large_cars INTEGER
);

-- 8. スペースステータステーブル
CREATE TABLE space_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id UUID REFERENCES detection_results(id) ON DELETE CASCADE,
  space_id UUID REFERENCES parking_spaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  duration INTEGER DEFAULT 0,
  vehicle_type TEXT
);

-- 初期ロールデータを挿入
INSERT INTO roles (name, description) VALUES
  ('admin', '管理者'),
  ('owner', '駐車場オーナー'),
  ('user', '一般ユーザー');

-- RLSを有効化
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE parking_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE parking_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE detection_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE detection_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_statuses ENABLE ROW LEVEL SECURITY;

-- 最小限のRLSポリシー（無限再帰を避ける）

-- rolesテーブル: 認証済みユーザーは読み取り可能
CREATE POLICY "roles_select" ON roles
  FOR SELECT
  TO authenticated
  USING (true);

-- usersテーブル: 自分のレコードのみ操作可能
CREATE POLICY "users_all" ON users
  FOR ALL
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- user_rolesテーブル: 自分のロール情報のみ操作可能
CREATE POLICY "user_roles_all" ON user_roles
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- parking_lotsテーブル: オーナーは自分の駐車場、管理者は全て
CREATE POLICY "parking_lots_select" ON parking_lots
  FOR SELECT
  TO authenticated
  USING (
    owner_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid() AND r.name = 'admin'
    )
  );

CREATE POLICY "parking_lots_insert" ON parking_lots
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "parking_lots_update" ON parking_lots
  FOR UPDATE
  TO authenticated
  USING (
    owner_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid() AND r.name = 'admin'
    )
  );

-- parking_spacesテーブル: 駐車場のオーナーまたは管理者
CREATE POLICY "parking_spaces_all" ON parking_spaces
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM parking_lots pl
      WHERE pl.id = parking_spaces.parking_lot_id
      AND (
        pl.owner_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM user_roles ur
          JOIN roles r ON ur.role_id = r.id
          WHERE ur.user_id = auth.uid() AND r.name = 'admin'
        )
      )
    )
  );

-- detection_sessionsテーブル: 駐車場のオーナーまたは管理者
CREATE POLICY "detection_sessions_all" ON detection_sessions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM parking_lots pl
      WHERE pl.id = detection_sessions.parking_lot_id
      AND (
        pl.owner_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM user_roles ur
          JOIN roles r ON ur.role_id = r.id
          WHERE ur.user_id = auth.uid() AND r.name = 'admin'
        )
      )
    )
  );

-- detection_resultsテーブル: セッションの駐車場のオーナーまたは管理者
CREATE POLICY "detection_results_all" ON detection_results
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM detection_sessions ds
      JOIN parking_lots pl ON pl.id = ds.parking_lot_id
      WHERE ds.id = detection_results.session_id
      AND (
        pl.owner_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM user_roles ur
          JOIN roles r ON ur.role_id = r.id
          WHERE ur.user_id = auth.uid() AND r.name = 'admin'
        )
      )
    )
  );

-- space_statusesテーブル: 検知結果の駐車場のオーナーまたは管理者
CREATE POLICY "space_statuses_all" ON space_statuses
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM detection_results dr
      JOIN detection_sessions ds ON ds.id = dr.session_id
      JOIN parking_lots pl ON pl.id = ds.parking_lot_id
      WHERE dr.id = space_statuses.result_id
      AND (
        pl.owner_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM user_roles ur
          JOIN roles r ON ur.role_id = r.id
          WHERE ur.user_id = auth.uid() AND r.name = 'admin'
        )
      )
    )
  );

-- 検知セッション終了関数
CREATE OR REPLACE FUNCTION end_detection_session(session_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE detection_sessions
  SET end_time = NOW(), status = 'completed'
  WHERE id = session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 最新の検知結果ビュー
CREATE VIEW latest_detection_results AS
SELECT 
  dr.*,
  pl.name as parking_lot_name,
  pl.owner_id
FROM detection_results dr
JOIN detection_sessions ds ON ds.id = dr.session_id
JOIN parking_lots pl ON pl.id = ds.parking_lot_id;

-- 新規ユーザー登録時のトリガー関数（シンプル版）
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  default_role_id INT;
  user_role TEXT;
BEGIN
  -- デフォルトロールIDを取得
  SELECT id INTO default_role_id FROM public.roles WHERE name = 'user';
  
  -- メタデータからロール情報を取得
  user_role := NEW.raw_user_meta_data->>'role';
  
  -- ユーザーテーブルに情報を挿入
  INSERT INTO public.users (id, email, full_name, created_at, is_active)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', NOW(), TRUE)
  ON CONFLICT (id) DO NOTHING;
  
  -- ロールを割り当て
  IF user_role = 'admin' THEN
    INSERT INTO public.user_roles (user_id, role_id)
    SELECT NEW.id, id FROM public.roles WHERE name = 'admin'
    ON CONFLICT DO NOTHING;
  ELSIF user_role = 'owner' THEN
    INSERT INTO public.user_roles (user_id, role_id)
    SELECT NEW.id, id FROM public.roles WHERE name = 'owner'
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role_id)
    VALUES (NEW.id, default_role_id)
    ON CONFLICT DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- トリガーを作成
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- テスト用の管理者ユーザーを作成（必要に応じて）
-- INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at)
-- VALUES (
--   gen_random_uuid(),
--   'admin@example.com',
--   crypt('admin123', gen_salt('bf')),
--   NOW(),
--   NOW(),
--   NOW()
-- );

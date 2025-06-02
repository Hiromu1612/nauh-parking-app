-- ロールの初期データを挿入
INSERT INTO roles (name, description) 
VALUES 
  ('admin', '管理者'),
  ('owner', '駐車場オーナー'),
  ('user', '一般ユーザー')
ON CONFLICT (name) DO NOTHING;

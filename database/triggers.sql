-- ユーザー登録時にロールを自動割り当てするトリガー関数
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role_id INT;
  owner_role_id INT;
  admin_role_id INT;
  role_name TEXT;
BEGIN
  -- ロールIDを取得
  SELECT id INTO user_role_id FROM public.roles WHERE name = 'user';
  SELECT id INTO owner_role_id FROM public.roles WHERE name = 'owner';
  SELECT id INTO admin_role_id FROM public.roles WHERE name = 'admin';
  
  -- ユーザーテーブルに情報を挿入
  INSERT INTO public.users (id, email, full_name, created_at, is_active)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', NOW(), TRUE);
  
  -- メタデータからロール情報を取得
  role_name := NEW.raw_user_meta_data->>'role';
  
  -- ロールに応じてユーザーロールを割り当て
  IF role_name = 'admin' THEN
    -- 管理者ロールを割り当て
    INSERT INTO public.user_roles (user_id, role_id)
    VALUES (NEW.id, admin_role_id);
  ELSIF role_name = 'owner' THEN
    -- オーナーロールを割り当て
    INSERT INTO public.user_roles (user_id, role_id)
    VALUES (NEW.id, owner_role_id);
  ELSE
    -- デフォルトで一般ユーザーロールを割り当て
    INSERT INTO public.user_roles (user_id, role_id)
    VALUES (NEW.id, user_role_id);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- auth.usersテーブルに新しいユーザーが追加されたときにトリガーを実行
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

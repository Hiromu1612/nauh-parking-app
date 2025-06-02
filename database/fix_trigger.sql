-- トリガー関数を修正して、エラーハンドリングを強化
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role_id INT;
  owner_role_id INT;
  admin_role_id INT;
  role_name TEXT;
BEGIN
  -- ロールIDを取得
  BEGIN
    SELECT id INTO user_role_id FROM public.roles WHERE name = 'user';
    SELECT id INTO owner_role_id FROM public.roles WHERE name = 'owner';
    SELECT id INTO admin_role_id FROM public.roles WHERE name = 'admin';
  EXCEPTION WHEN OTHERS THEN
    -- ロールが存在しない場合は作成
    INSERT INTO public.roles (name, description) VALUES ('user', 'General User') ON CONFLICT (name) DO NOTHING;
    INSERT INTO public.roles (name, description) VALUES ('owner', 'Parking Lot Owner') ON CONFLICT (name) DO NOTHING;
    INSERT INTO public.roles (name, description) VALUES ('admin', 'Administrator') ON CONFLICT (name) DO NOTHING;
    
    SELECT id INTO user_role_id FROM public.roles WHERE name = 'user';
    SELECT id INTO owner_role_id FROM public.roles WHERE name = 'owner';
    SELECT id INTO admin_role_id FROM public.roles WHERE name = 'admin';
  END;
  
  -- ユーザーテーブルに情報を挿入
  BEGIN
    INSERT INTO public.users (id, email, full_name, created_at, is_active)
    VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', NOW(), TRUE);
  EXCEPTION WHEN OTHERS THEN
    -- エラーを無視して続行
    RAISE NOTICE 'Error inserting user: %', SQLERRM;
  END;
  
  -- メタデータからロール情報を取得
  role_name := NEW.raw_user_meta_data->>'role';
  
  -- ロールに応じてユーザーロールを割り当て
  BEGIN
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
  EXCEPTION WHEN OTHERS THEN
    -- エラーを無視して続行
    RAISE NOTICE 'Error assigning role: %', SQLERRM;
  END;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

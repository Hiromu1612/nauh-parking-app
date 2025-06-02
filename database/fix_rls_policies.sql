-- 新規ユーザーが自分のデータを挿入できるようにするポリシー

-- usersテーブルのポリシー
DROP POLICY IF EXISTS insert_own_user ON users;
CREATE POLICY insert_own_user ON users
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- user_rolesテーブルのポリシー
DROP POLICY IF EXISTS insert_own_user_role ON user_roles;
CREATE POLICY insert_own_user_role ON user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- parking_lotsテーブルのポリシー
DROP POLICY IF EXISTS insert_own_parking_lot ON parking_lots;
CREATE POLICY insert_own_parking_lot ON parking_lots
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- 匿名ユーザーがロール情報を取得できるようにするポリシー
DROP POLICY IF EXISTS select_roles ON roles;
CREATE POLICY select_roles ON roles
  FOR SELECT
  TO authenticated
  USING (true);

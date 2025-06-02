-- 駐車場テーブルのポリシー
-- 新規ユーザーが自分の駐車場を作成できるようにする
CREATE POLICY create_own_parking_lots ON parking_lots
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- オーナーは自分の駐車場のみ閲覧・編集可能
CREATE POLICY owner_own_parking_lots ON parking_lots
  FOR ALL
  TO authenticated
  USING (owner_id = auth.uid());

-- 管理者はすべての駐車場を閲覧・編集可能
CREATE POLICY admin_all_parking_lots ON parking_lots
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid() AND r.name = 'admin'
    )
  );

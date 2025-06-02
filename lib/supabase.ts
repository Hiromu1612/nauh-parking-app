import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/types/supabase"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)

// 認証済みユーザーのロールを取得する関数
export async function getUserRole() {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role_id, roles(name)")
    .eq("user_id", user.id)
    .single()

  return roles?.roles?.name || null
}

// ユーザーが特定の駐車場にアクセスできるか確認する関数
export async function canAccessParkingLot(parkingLotId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return false

  // 管理者は全ての駐車場にアクセス可能
  const { data: adminRole } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id)
    .eq("roles.name", "admin")
    .maybeSingle()

  if (adminRole) return true

  // オーナーは自分の駐車場のみアクセス可能
  const { data: parkingLot } = await supabase
    .from("parking_lots")
    .select("id")
    .eq("id", parkingLotId)
    .eq("owner_id", user.id)
    .maybeSingle()

  return !!parkingLot
}

// 現在のユーザーがアクセスできる駐車場の一覧を取得する関数
export async function getAccessibleParkingLots() {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return []

  // 管理者は全ての駐車場にアクセス可能
  const { data: adminRole } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id)
    .eq("roles.name", "admin")
    .maybeSingle()

  if (adminRole) {
    const { data: allParkingLots } = await supabase.from("parking_lots").select("*, camera_secret_key").order("name") // camera_secret_key を追加

    return allParkingLots || []
  }

  // オーナーは自分の駐車場のみアクセス可能
  const { data: ownedParkingLots } = await supabase
    .from("parking_lots")
    .select("*, camera_secret_key") // camera_secret_key を追加
    .eq("owner_id", user.id)
    .order("name")

  return ownedParkingLots || []
}

// オーナーが自分の駐車場情報（シークレットキーを含む）を取得する関数
export async function getOwnedParkingLotsWithSecrets() {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return []

  const { data: ownedParkingLots } = await supabase
    .from("parking_lots")
    .select("id, name, location, address, total_spaces, camera_id, camera_secret_key") // 必要なカラムとキーを選択
    .eq("owner_id", user.id)
    .order("name")

  return ownedParkingLots || []
}

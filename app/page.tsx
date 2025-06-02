"use client"

import { useState, useEffect } from "react"
import { supabase, getUserRole } from "@/lib/supabase" // getUserRole をインポート
import { useRouter } from "next/navigation"
import AIControlPanel from "@/components/ai-control-panel"
import DetectionResults from "@/components/detection-results"
import ParkingLotSelector from "@/components/parking-lot-selector"
import UserProfile from "@/components/user-profile"
import ParkingLotCredentialsDisplay from "@/components/parking-lot-credentials-display"
import type { Database } from "@/types/supabase"

type ParkingLot = Database["public"]["Tables"]["parking_lots"]["Row"] & {
  camera_secret_key?: string | null
}

export default function Home() {
  const [user, setUser] = useState<any>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedParkingLot, setSelectedParkingLot] = useState<ParkingLot | null>(null)
  const router = useRouter()

  useEffect(() => {
    async function checkUserAndRole() {
      try {
        setLoading(true)
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
          router.push("/auth")
          return
        }
        setUser(user)

        const role = await getUserRole()
        setUserRole(role)
      } catch (error) {
        console.error("認証またはロール取得エラー:", error)
      } finally {
        setLoading(false)
      }
    }

    checkUserAndRole()
  }, [router])

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
        <p className="mt-4 text-gray-600">読み込み中...</p>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center p-4 bg-gray-50">
      <div className="max-w-6xl w-full space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">駐車場管理システム</h1>
          <p className="mt-2 text-lg text-gray-600">Supabase Realtimeを使用してAIカメラを遠隔操作します</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="md:col-span-1 space-y-6">
            <UserProfile />
            <ParkingLotSelector onSelect={setSelectedParkingLot} />
            {userRole === "owner" && selectedParkingLot && (
              <ParkingLotCredentialsDisplay parkingLot={selectedParkingLot} />
            )}
          </div>
          <div className="md:col-span-3 space-y-6">
            {" "}
            {/* AIコントロールパネルと検知結果を同じ列に配置 */}
            <AIControlPanel parkingLot={selectedParkingLot} /> {/* AIコントロールパネルを先に表示 */}
            <DetectionResults parkingLot={selectedParkingLot} />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <h2 className="text-xl font-semibold mb-4">使用方法</h2>
          <ol className="list-decimal list-inside space-y-2">
            <li>左側の駐車場選択から管理したい駐車場を選択します</li>
            <li>Pythonスクリプト（detector_realtime.py）を実行します（下記「エッジAI初期設定ガイド」参照）</li>
            <li>右側のコントロールパネルから「検知開始」ボタンをクリックすると、物体検知AIが開始します</li>
            <li>「検知停止」ボタンをクリックすると、物体検知AIが停止します</li>
            <li>検知結果は「runs/exp*」ディレクトリに自動保存されます</li>
            <li>検知データは5フレームに1回の頻度でSupabaseデータベースに保存されます</li>
            <li>検知画像は5フレームに1回の頻度でSupabaseストレージにアップロードされます</li>
            <li>右側の検知結果履歴から過去の検知結果を確認できます</li>
          </ol>
        </div>
      </div>
    </main>
  )
}

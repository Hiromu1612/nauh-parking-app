"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StopCircleIcon, PlayIcon, CameraIcon, DatabaseIcon, InfoIcon } from "lucide-react"
import { toast } from "@/components/ui/use-toast"
import { Progress } from "@/components/ui/progress"
import type { Database } from "@/types/supabase"

type ParkingLot = Database["public"]["Tables"]["parking_lots"]["Row"]

interface AIControlPanelProps {
  parkingLot: (ParkingLot & { camera_secret_key?: string | null }) | null // camera_secret_key を許容する型に変更
}

export default function AIControlPanel({ parkingLot }: AIControlPanelProps) {
  const [status, setStatus] = useState("stopped")
  const [isConnected, setIsConnected] = useState(false)
  const [channel, setChannel] = useState<any>(null)
  const [parkingStats, setParkingStats] = useState({
    total_parking_count: 0,
    total_cars: 0,
    total_large_cars: 0,
    total_empty_spaces: 0,
    total_occupied_spaces: 0,
  })
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [currentSession, setCurrentSession] = useState<string | null>(null)

  // Supabase接続
  useEffect(() => {
    if (!parkingLot || !parkingLot.id) return

    // 駐車場IDに基づいたチャンネル名
    const channelName = `parking-control-${parkingLot.id}`
    const channel = supabase.channel(channelName)

    channel
      .on("broadcast", { event: "status" }, (payload) => {
        if (payload.payload?.status) {
          const newStatus = payload.payload.status
          console.log(`状態を更新: ${status} -> ${newStatus}`)
          setStatus(newStatus)

          // セッションIDが含まれている場合は保存
          if (payload.payload.session_id) {
            setCurrentSession(payload.payload.session_id)
          }
        }
      })
      .subscribe((status) => {
        const isNowConnected = status === "SUBSCRIBED"
        setIsConnected(isNowConnected)

        if (isNowConnected) {
          console.log(`Supabase Realtime (${channelName}) に接続完了`)
        }
      })

    setChannel(channel)

    // 現在のセッションを確認
    checkCurrentSession()

    return () => channel.unsubscribe()
  }, [parkingLot])

  // 現在のセッションを確認する関数
  const checkCurrentSession = async () => {
    if (!parkingLot || !parkingLot.id) return

    try {
      const { data, error } = await supabase
        .from("detection_sessions")
        .select("id, status")
        .eq("parking_lot_id", parkingLot.id)
        .eq("status", "running")
        .order("start_time", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        console.error("セッション確認エラー:", error)
        return
      }

      if (data) {
        setCurrentSession(data.id)
        setStatus("running")
      } else {
        setStatus("stopped")
      }
    } catch (error) {
      console.error("セッション確認エラー:", error)
    }
  }

  // データベースからの最新データを取得
  const fetchLatestData = async () => {
    if (!parkingLot || !parkingLot.id) return

    try {
      const { data, error } = await supabase
        .from("detection_results")
        .select(`
          id,
          timestamp,
          total_occupied_spaces,
          total_empty_spaces,
          total_cars,
          total_large_cars,
          detection_sessions!inner(parking_lot_id)
        `)
        .eq("detection_sessions.parking_lot_id", parkingLot.id)
        .order("timestamp", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        console.error("データ取得エラー:", error)
        return
      }

      if (data) {
        setParkingStats({
          total_parking_count: (data.total_occupied_spaces || 0) + (data.total_empty_spaces || 0),
          total_cars: data.total_cars || 0,
          total_large_cars: data.total_large_cars || 0,
          total_empty_spaces: data.total_empty_spaces || 0,
          total_occupied_spaces: data.total_occupied_spaces || 0,
        })
        setLastUpdated(new Date(data.timestamp).toLocaleString("ja-JP"))
      }
    } catch (error) {
      console.error("データ取得エラー:", error)
    }
  }

  // データベースからの最新データを取得（条件付き自動更新）
  useEffect(() => {
    // 初回実行
    if (parkingLot && parkingLot.id) {
      fetchLatestData()
    }

    // 検知中の場合のみ5秒ごとに更新
    let interval: NodeJS.Timeout | null = null
    if (status === "running" && parkingLot && parkingLot.id) {
      interval = setInterval(fetchLatestData, 5000)
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [status, parkingLot])

  // 検知開始
  const startDetection = async () => {
    if (!channel || !parkingLot || !parkingLot.id || !parkingLot.camera_secret_key) {
      toast({
        title: "エラー",
        description: "駐車場情報またはカメラ認証キーが不足しています。",
        variant: "destructive",
      })
      return
    }

    try {
      // 新しいセッションを作成
      const {
        data: { user },
      } = await supabase.auth.getUser()

      const { data: session, error: sessionError } = await supabase
        .from("detection_sessions")
        .insert({
          parking_lot_id: parkingLot.id,
          status: "running",
          started_by: user?.id,
        })
        .select()
        .single()

      if (sessionError) throw sessionError

      // セッションIDを保存
      setCurrentSession(session.id)

      // UIの状態を即時更新
      setStatus("running")
      console.log("検知開始コマンドを送信")

      // コマンド送信
      await channel.send({
        type: "broadcast",
        event: "command",
        payload: {
          command: "start",
          session_id: session.id,
          parking_lot_id: parkingLot.id,
          camera_secret_key: parkingLot.camera_secret_key, // カメラ認証キーを追加
        },
      })
    } catch (error) {
      console.error("コマンド送信エラー:", error)
      setStatus("stopped")
      toast({
        title: "エラー",
        description: "検知開始に失敗しました。再度お試しください。",
        variant: "destructive",
      })
    }
  }

  // 検知停止
  const stopDetection = async () => {
    if (!channel || !currentSession || !parkingLot || !parkingLot.id || !parkingLot.camera_secret_key) {
      toast({
        title: "エラー",
        description: "駐車場情報またはカメラ認証キーが不足しています。",
        variant: "destructive",
      })
      return
    }

    try {
      // UIの状態を即時更新
      setStatus("stopped")
      console.log("検知停止コマンドを送信")

      // コマンド送信
      await channel.send({
        type: "broadcast",
        event: "command",
        payload: {
          command: "stop",
          session_id: currentSession,
          parking_lot_id: parkingLot.id,
          camera_secret_key: parkingLot.camera_secret_key, // カメラ認証キーを追加
        },
      })

      // セッションを終了
      await supabase.rpc("end_detection_session", { session_id: currentSession })

      // セッションIDをクリア
      setCurrentSession(null)
    } catch (error) {
      console.error("コマンド送信エラー:", error)
      setStatus("running")
      toast({
        title: "エラー",
        description: "検知停止に失敗しました。再度お試しください。",
        variant: "destructive",
      })
    }
  }

  // 駐車場の占有率を計算
  const occupancyRate =
    parkingStats.total_occupied_spaces + parkingStats.total_empty_spaces > 0
      ? (parkingStats.total_occupied_spaces / (parkingStats.total_occupied_spaces + parkingStats.total_empty_spaces)) *
        100
      : 0

  // 駐車場が選択されていない場合は何も表示しない
  if (!parkingLot) {
    return (
      <Card className="w-full shadow-lg border-0">
        <CardHeader>
          <CardTitle>物体検知AI制御パネル</CardTitle>
          <CardDescription>駐車場を選択してください</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card className="w-full shadow-lg border-0 overflow-hidden">
      <CardHeader>
        <CardTitle className="flex justify-between items-center">
          <div className="flex items-center">
            <CameraIcon className="mr-2 h-5 w-5" />
            物体検知AI制御パネル
          </div>
          <Badge
            className={`px-2 py-1 text-xs font-medium rounded-full ${
              isConnected
                ? "bg-green-100 text-green-600 border border-green-200"
                : "bg-red-100 text-red-600 border border-red-200"
            }`}
          >
            {isConnected ? "接続中" : "未接続"}
          </Badge>
        </CardTitle>
        <CardDescription className="text-gray-600">
          {parkingLot.name} - YOLOv8を使用した駐車場の物体検知AIを制御します
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex gap-3">
            <Button
              onClick={startDetection}
              className="flex-1 bg-green-600 hover:bg-green-700 transition-all shadow-md"
              disabled={status === "running"}
            >
              <PlayIcon className="mr-2 h-4 w-4" />
              検知開始
            </Button>
            <Button
              onClick={stopDetection}
              variant="destructive"
              className="flex-1 shadow-md transition-all"
              disabled={status === "stopped"}
            >
              <StopCircleIcon className="mr-2 h-4 w-4" />
              検知停止
            </Button>
          </div>

          <div className="bg-gray-50 p-3 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium flex items-center">
                <DatabaseIcon className="h-4 w-4 mr-1" />
                最新の駐車場データ
              </h3>
              {lastUpdated && <span className="text-xs text-gray-500">最終更新: {lastUpdated}</span>}
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>駐車場占有率</span>
                  <span>{Math.round(occupancyRate)}%</span>
                </div>
                <Progress value={occupancyRate} className="h-2" />
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-white p-2 rounded border">
                  <div className="text-gray-500 text-xs">合計駐車台数</div>
                  <div className="font-semibold">{parkingStats.total_parking_count}台</div>
                </div>
                <div className="bg-white p-2 rounded border">
                  <div className="text-gray-500 text-xs">現在の占有数</div>
                  <div className="font-semibold">{parkingStats.total_occupied_spaces}台</div>
                </div>
                <div className="bg-white p-2 rounded border">
                  <div className="text-gray-500 text-xs">普通車</div>
                  <div className="font-semibold">{parkingStats.total_cars}台</div>
                </div>
                <div className="bg-white p-2 rounded border">
                  <div className="text-gray-500 text-xs">中型・大型車</div>
                  <div className="font-semibold">{parkingStats.total_large_cars}台</div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 p-3 rounded-lg">
            <h3 className="text-sm font-medium mb-2">検知状態</h3>
            <Badge
              className={`px-3 py-1 text-sm font-medium ${
                status === "running"
                  ? "bg-green-100 text-green-600 border border-green-200"
                  : "bg-gray-100 text-gray-600 border border-gray-200"
              }`}
            >
              {status === "running" ? "検知実行中" : "検知停止中"}
            </Badge>
          </div>
        </div>
      </CardContent>
      <CardFooter className="bg-gray-50 border-t px-4 py-3">
        <div className="flex items-center text-xs text-gray-500">
          <InfoIcon className="h-3 w-3 mr-1" />
          検知結果は5フレームに1回の頻度で保存されます
        </div>
      </CardFooter>
    </Card>
  )
}

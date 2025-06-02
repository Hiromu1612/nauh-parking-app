"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { ChevronLeftIcon, ChevronRightIcon, RefreshCwIcon as RefreshIcon, ImageIcon, TableIcon } from "lucide-react"
import type { Database } from "@/types/supabase"

type ParkingLot = Database["public"]["Tables"]["parking_lots"]["Row"]

interface DetectionResultsProps {
  parkingLot: ParkingLot | null
}

type DetectionResult = {
  id: string
  timestamp: string
  frame_path: string | null
  total_parking_count: number
  total_cars: number | null
  total_large_cars: number | null
  total_empty_spaces: number | null
  total_occupied_spaces: number | null
  session_id: string
  spaces: SpaceStatus[]
}

type SpaceStatus = {
  id: string
  space_number: string
  status: string
  duration: number
  vehicle_type: string | null
}

export default function DetectionResults({ parkingLot }: DetectionResultsProps) {
  const [results, setResults] = useState<DetectionResult[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [selectedResult, setSelectedResult] = useState<DetectionResult | null>(null)
  const [view, setView] = useState<"table" | "gallery">("table")
  const pageSize = 10

  // 日時をフォーマットする関数
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString("ja-JP")
  }

  // データを取得する関数
  const fetchData = async () => {
    if (!parkingLot || !parkingLot.id) return

    setLoading(true)
    try {
      // 合計件数を取得
      const { count, error: countError } = await supabase
        .from("detection_results")
        .select(
          `
          id,
          detection_sessions!inner(parking_lot_id)
        `,
          { count: "exact", head: true },
        )
        .eq("detection_sessions.parking_lot_id", parkingLot.id)

      if (countError) {
        console.error("データ数取得エラー:", countError)
        return
      }

      setTotalPages(Math.ceil((count || 0) / pageSize))

      // 検知結果データを取得
      const { data: resultData, error: resultError } = await supabase
        .from("detection_results")
        .select(`
          id,
          session_id,
          timestamp,
          frame_count,
          frame_path,
          total_occupied_spaces,
          total_empty_spaces,
          total_cars,
          total_large_cars,
          detection_sessions!inner(parking_lot_id)
        `)
        .eq("detection_sessions.parking_lot_id", parkingLot.id)
        .order("timestamp", { ascending: false })
        .range(currentPage * pageSize, (currentPage + 1) * pageSize - 1)

      if (resultError) {
        console.error("データ取得エラー:", resultError)
        return
      }

      // 検知結果ごとに駐車スペースの状態を取得
      const resultsWithSpaces = await Promise.all(
        (resultData || []).map(async (result) => {
          const { data: spaceData, error: spaceError } = await supabase
            .from("space_statuses")
            .select(`
              id,
              status,
              duration,
              vehicle_type,
              parking_spaces(id, space_number)
            `)
            .eq("result_id", result.id)

          if (spaceError) {
            console.error("スペースデータ取得エラー:", spaceError)
            return {
              ...result,
              total_parking_count: (result.total_occupied_spaces || 0) + (result.total_empty_spaces || 0),
              spaces: [],
            }
          }

          const spaces = (spaceData || []).map((space) => ({
            id: space.id,
            space_number: space.parking_spaces?.space_number || "",
            status: space.status,
            duration: space.duration,
            vehicle_type: space.vehicle_type,
          }))

          return {
            ...result,
            total_parking_count: (result.total_occupied_spaces || 0) + (result.total_empty_spaces || 0),
            spaces,
          }
        }),
      )

      setResults(resultsWithSpaces)

      // 最初のデータを選択
      if (resultsWithSpaces.length > 0 && !selectedResult) {
        setSelectedResult(resultsWithSpaces[0])
      }
    } catch (error) {
      console.error("データ取得エラー:", error)
    } finally {
      setLoading(false)
    }
  }

  // 初回とページ変更時にデータを取得
  useEffect(() => {
    if (parkingLot && parkingLot.id) {
      fetchData()
    }
  }, [currentPage, parkingLot])

  // 駐車場が選択されていない場合は何も表示しない
  const renderNoParkingLotSelected = () => (
    <Card className="w-full shadow-lg border-0">
      <CardHeader>
        <CardTitle>検知結果履歴</CardTitle>
      </CardHeader>
      <CardContent>
        <p>駐車場を選択してください</p>
      </CardContent>
    </Card>
  )

  const renderContent = () => (
    <Card className="w-full shadow-lg border-0">
      <CardHeader>
        <CardTitle className="flex justify-between items-center">
          <div>{parkingLot?.name} - 検知結果履歴</div>
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" onClick={fetchData}>
              <RefreshIcon className="h-4 w-4 mr-1" />
              更新
            </Button>
            <Tabs defaultValue="table" value={view} onValueChange={(v) => setView(v as "table" | "gallery")}>
              <TabsList>
                <TabsTrigger value="table">
                  <TableIcon className="h-4 w-4 mr-1" />表
                </TabsTrigger>
                <TabsTrigger value="gallery">
                  <ImageIcon className="h-4 w-4 mr-1" />
                  ギャラリー
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* 選択された検知結果の詳細 - 上部に表示 */}
            {selectedResult && (
              <div className="border rounded-lg overflow-hidden mb-6">
                <div className="bg-gray-50 p-4 border-b">
                  <h3 className="text-lg font-medium">検知結果詳細</h3>
                  <p className="text-sm text-gray-500">{formatDate(selectedResult.timestamp)}</p>
                </div>

                <div className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* 検知画像 */}
                    <div>
                      <h4 className="text-sm font-medium mb-2">検知画像</h4>
                      <div className="aspect-video relative rounded overflow-hidden border">
                        {selectedResult.frame_path ? (
                          <img
                            src={selectedResult.frame_path || "/placeholder.svg"}
                            alt={`検知結果 ${formatDate(selectedResult.timestamp)}`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                            <ImageIcon className="h-12 w-12 text-gray-400" />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 駐車スペース状態 */}
                    <div>
                      <h4 className="text-sm font-medium mb-2">駐車スペース状態</h4>
                      <div className="grid grid-cols-5 gap-2">
                        {selectedResult.spaces.map((space) => (
                          <div
                            key={space.id}
                            className={`
                              p-2 rounded text-center text-xs font-medium
                              ${
                                space.status === "occupied"
                                  ? "bg-red-100 text-red-800 border border-red-200"
                                  : "bg-green-100 text-green-800 border border-green-200"
                              }
                            `}
                          >
                            {space.space_number}
                          </div>
                        ))}
                      </div>

                      {/* 統計情報 */}
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <div className="bg-gray-50 p-2 rounded border">
                          <div className="text-xs text-gray-500">合計駐車台数</div>
                          <div className="font-medium">{selectedResult.total_parking_count}台</div>
                        </div>
                        <div className="bg-gray-50 p-2 rounded border">
                          <div className="text-xs text-gray-500">占有率</div>
                          <div className="font-medium">
                            {Math.round(
                              ((selectedResult.total_occupied_spaces || 0) /
                                ((selectedResult.total_occupied_spaces || 0) +
                                  (selectedResult.total_empty_spaces || 0))) *
                                100,
                            )}
                            %
                          </div>
                        </div>
                        <div className="bg-gray-50 p-2 rounded border">
                          <div className="text-xs text-gray-500">普通車</div>
                          <div className="font-medium">{selectedResult.total_cars || 0}台</div>
                        </div>
                        <div className="bg-gray-50 p-2 rounded border">
                          <div className="text-xs text-gray-500">中型・大型車</div>
                          <div className="font-medium">{selectedResult.total_large_cars || 0}台</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 検知結果一覧 - 下部に表示 */}
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-50 p-3 border-b">
                <h3 className="text-sm font-medium">検知結果一覧</h3>
              </div>

              <div className="p-4">
                {view === "table" ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>日時</TableHead>
                          <TableHead>合計駐車台数</TableHead>
                          <TableHead>普通車</TableHead>
                          <TableHead>中型・大型車</TableHead>
                          <TableHead>空きスペース</TableHead>
                          <TableHead>占有スペース</TableHead>
                          <TableHead>操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {results.map((result) => (
                          <TableRow
                            key={result.id}
                            className={selectedResult?.id === result.id ? "bg-blue-50" : ""}
                            onClick={() => setSelectedResult(result)}
                          >
                            <TableCell>{formatDate(result.timestamp)}</TableCell>
                            <TableCell>{result.total_parking_count}</TableCell>
                            <TableCell>{result.total_cars || 0}</TableCell>
                            <TableCell>{result.total_large_cars || 0}</TableCell>
                            <TableCell>{result.total_empty_spaces || 0}</TableCell>
                            <TableCell>{result.total_occupied_spaces || 0}</TableCell>
                            <TableCell>
                              <Button variant="ghost" size="sm" onClick={() => setSelectedResult(result)}>
                                詳細
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {results.map((result) => (
                      <div
                        key={result.id}
                        className={`relative cursor-pointer rounded-lg overflow-hidden border-2 ${
                          selectedResult?.id === result.id ? "border-blue-500" : "border-transparent"
                        }`}
                        onClick={() => setSelectedResult(result)}
                      >
                        <div className="aspect-video relative">
                          {result.frame_path ? (
                            <img
                              src={result.frame_path || "/placeholder.svg"}
                              alt={`検知結果 ${formatDate(result.timestamp)}`}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                              <ImageIcon className="h-8 w-8 text-gray-400" />
                            </div>
                          )}
                        </div>
                        <div className="p-2 bg-white text-xs">
                          <div className="font-medium truncate">{formatDate(result.timestamp)}</div>
                          <div className="text-gray-500">占有: {result.total_occupied_spaces || 0}台</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* ページネーション */}
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-gray-500">
                    {totalPages > 0 ? `${currentPage + 1} / ${totalPages} ページ` : "データがありません"}
                  </div>
                  <div className="flex space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
                      disabled={currentPage === 0}
                    >
                      <ChevronLeftIcon className="h-4 w-4" />
                      前へ
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
                      disabled={currentPage >= totalPages - 1}
                    >
                      次へ
                      <ChevronRightIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )

  return parkingLot ? renderContent() : renderNoParkingLotSelected()
}

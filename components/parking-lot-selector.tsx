"use client"

import { useState, useEffect } from "react"
import { getAccessibleParkingLots } from "@/lib/supabase"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Database } from "@/types/supabase"

type ParkingLot = Database["public"]["Tables"]["parking_lots"]["Row"]

interface ParkingLotSelectorProps {
  onSelect: (parkingLot: ParkingLot | null) => void
}

export default function ParkingLotSelector({ onSelect }: ParkingLotSelectorProps) {
  const [parkingLots, setParkingLots] = useState<ParkingLot[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadParkingLots() {
      try {
        setLoading(true)
        const lots = await getAccessibleParkingLots()
        setParkingLots(lots)

        // 最初の駐車場を自動選択
        if (lots.length > 0 && !selectedId) {
          setSelectedId(lots[0].id)
          onSelect(lots[0])
        }
      } catch (error) {
        console.error("駐車場データの取得に失敗しました:", error)
      } finally {
        setLoading(false)
      }
    }

    loadParkingLots()
  }, [onSelect, selectedId])

  const handleChange = (value: string) => {
    setSelectedId(value)
    const selected = parkingLots.find((lot) => lot.id === value) || null
    onSelect(selected)
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>駐車場を読み込み中...</CardTitle>
        </CardHeader>
      </Card>
    )
  }

  if (parkingLots.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>駐車場が見つかりません</CardTitle>
        </CardHeader>
        <CardContent>
          <p>アクセス可能な駐車場がありません。管理者に連絡してください。</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>駐車場を選択</CardTitle>
      </CardHeader>
      <CardContent>
        <Select value={selectedId || undefined} onValueChange={handleChange}>
          <SelectTrigger>
            <SelectValue placeholder="駐車場を選択してください" />
          </SelectTrigger>
          <SelectContent>
            {parkingLots.map((lot) => (
              <SelectItem key={lot.id} value={lot.id}>
                {lot.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  )
}

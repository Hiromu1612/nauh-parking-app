"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CopyIcon, EyeIcon, EyeOffIcon, KeyRoundIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "@/components/ui/use-toast"
import type { Database } from "@/types/supabase"

type ParkingLot = Database["public"]["Tables"]["parking_lots"]["Row"] & {
  camera_secret_key?: string | null
}

interface ParkingLotCredentialsDisplayProps {
  parkingLot: ParkingLot | null
}

export default function ParkingLotCredentialsDisplay({ parkingLot }: ParkingLotCredentialsDisplayProps) {
  const [showSecretKey, setShowSecretKey] = useState(false)

  const copyToClipboard = (text: string | null | undefined, fieldName: string) => {
    if (!text) {
      toast({ title: "コピー失敗", description: `${fieldName}がありません。`, variant: "destructive" })
      return
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        toast({ title: `${fieldName}をコピーしました`, description: text })
      })
      .catch((err) => {
        toast({ title: "コピーに失敗しました", description: err.message, variant: "destructive" })
      })
  }

  if (!parkingLot) {
    return null
  }

  const displaySecretKey = parkingLot.camera_secret_key || "キーが設定されていません"

  return (
    <Card className="shadow-md border-0">
      <CardHeader>
        <CardTitle className="flex items-center">
          <KeyRoundIcon className="mr-2 h-5 w-5 text-yellow-500" />
          駐車場認証情報
        </CardTitle>
        <CardDescription>Pythonスクリプト設定用のIDと認証キーです。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor={`parking-id-${parkingLot.id}`}>駐車場ID</Label>
          <div className="flex items-center space-x-2">
            <Input id={`parking-id-${parkingLot.id}`} value={parkingLot.id} readOnly className="font-mono" />
            <Button
              variant="outline"
              size="icon"
              onClick={() => copyToClipboard(parkingLot.id, "駐車場ID")}
              title="駐車場IDをコピー"
            >
              <CopyIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div>
          <Label htmlFor={`secret-key-${parkingLot.id}`}>カメラ認証キー</Label>
          <div className="flex items-center space-x-2">
            <Input
              id={`secret-key-${parkingLot.id}`}
              type={showSecretKey ? "text" : "password"}
              value={displaySecretKey}
              readOnly
              className="font-mono"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowSecretKey(!showSecretKey)}
              title={showSecretKey ? "キーを隠す" : "キーを表示"}
            >
              {showSecretKey ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => copyToClipboard(parkingLot.camera_secret_key, "カメラ認証キー")}
              disabled={!parkingLot.camera_secret_key || displaySecretKey === "キーが設定されていません"}
              title="カメラ認証キーをコピー"
            >
              <CopyIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

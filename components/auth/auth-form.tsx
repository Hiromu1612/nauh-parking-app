"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "@/components/ui/use-toast"
import { Loader2, Info } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Separator } from "@/components/ui/separator"
import { v4 as uuidv4 } from "uuid"

export default function AuthForm() {
  // 認証モード
  const [authMode, setAuthMode] = useState<"login" | "signup">("login")
  const [loading, setLoading] = useState(false)

  // アカウントタイプ
  const [accountType, setAccountType] = useState<"user" | "owner" | "admin">("user")
  const [accountTypePassword, setAccountTypePassword] = useState("")

  // アカウント情報
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [fullName, setFullName] = useState("")

  // 駐車場情報（オーナーのみ）
  const [parkingLotName, setParkingLotName] = useState("")
  const [parkingLotLocation, setParkingLotLocation] = useState("")
  const [parkingLotAddress, setParkingLotAddress] = useState("")
  const [totalSpaces, setTotalSpaces] = useState("0")
  const [cameraId, setCameraId] = useState("")

  // デバッグモード
  const [debugInfo, setDebugInfo] = useState<string[]>([])
  const [showDebug, setShowDebug] = useState(false)

  // アカウントタイプパスワードが変更されたときの処理
  useEffect(() => {
    if (accountTypePassword === "admin") {
      setAccountType("admin")
    } else if (accountTypePassword === "owner") {
      setAccountType("owner")
    } else {
      setAccountType("user")
    }
  }, [accountTypePassword])

  // フォームをリセット
  const resetForm = () => {
    setEmail("")
    setPassword("")
    setFullName("")
    setParkingLotName("")
    setParkingLotLocation("")
    setParkingLotAddress("")
    setTotalSpaces("0")
    setCameraId("")
    setAccountTypePassword("")
    setAccountType("user")
    setDebugInfo([])
  }

  // デバッグ情報を追加
  const addDebugInfo = (info: string) => {
    setDebugInfo((prev) => [...prev, `${new Date().toISOString()}: ${info}`])
    console.log(info)
  }

  // ログイン処理
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) throw error

      toast({
        title: "ログインしました",
        description: "ダッシュボードにリダイレクトします",
      })

      // リロードしてセッションを反映
      window.location.href = "/"
    } catch (error: any) {
      toast({
        title: "エラーが発生しました",
        description: error.message,
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  // 新規登録処理（簡素化版）
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setDebugInfo([])

    try {
      // 入力チェック
      if (!email || !password || !fullName) {
        throw new Error("必須項目を入力してください")
      }

      if (accountType === "owner" && (!parkingLotName || !totalSpaces)) {
        throw new Error("駐車場名と駐車スペース数は必須です")
      }

      // パスワードの長さチェック
      if (password.length < 8) {
        throw new Error("パスワードは8文字以上で入力してください")
      }

      addDebugInfo("認証処理を開始します")

      // ユーザーアカウントを作成（トリガーでusersテーブルとuser_rolesテーブルに自動挿入される）
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            role: accountType,
          },
        },
      })

      if (authError) {
        addDebugInfo(`認証エラー: ${authError.message}`)
        throw authError
      }

      if (!authData.user) {
        addDebugInfo("ユーザーデータが取得できませんでした")
        throw new Error("ユーザー作成に失敗しました")
      }

      addDebugInfo(`ユーザーが作成されました: ${authData.user.id}`)

      // 少し待ってからトリガーの実行を確認
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // オーナーアカウントの場合、駐車場情報も登録
      if (accountType === "owner") {
        addDebugInfo("駐車場情報を登録します")

        const newCameraSecretKey = uuidv4() // カメラ認証キーを生成

        const parkingData = {
          name: parkingLotName,
          location: parkingLotLocation || "",
          address: parkingLotAddress || "",
          total_spaces: Number.parseInt(totalSpaces) || 0,
          owner_id: authData.user.id,
          camera_id: cameraId || null,
          is_active: true,
          camera_secret_key: newCameraSecretKey, // 生成したキーを保存
        }

        addDebugInfo(`駐車場データ: ${JSON.stringify(parkingData)}`)

        // 認証してから駐車場情報を登録
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (signInError) {
          addDebugInfo(`自動ログインエラー: ${signInError.message}`)
        } else {
          addDebugInfo("自動ログインが成功しました")
        }

        const { data: insertedParkingData, error: parkingLotError } = await supabase
          .from("parking_lots")
          .insert(parkingData)
          .select()

        if (parkingLotError) {
          addDebugInfo(`駐車場情報の登録エラー: ${parkingLotError.message}`)

          // エラーが発生してもアカウント作成は成功したことを伝える
          toast({
            title: "アカウント登録が完了しました",
            description:
              "駐車場情報の登録でエラーが発生しましたが、アカウントは正常に作成されました。ログイン後に駐車場情報を登録してください。",
            variant: "destructive",
          })
        } else {
          addDebugInfo(`駐車場情報が正常に登録されました: ${JSON.stringify(insertedParkingData)}`)

          toast({
            title: "アカウント登録が完了しました",
            description: "オーナー権限で登録され、駐車場情報も正常に登録されました。",
          })
        }
      } else {
        toast({
          title: "アカウント登録が完了しました",
          description: `${accountType !== "user" ? accountType + "権限で" : ""}登録されました。ログインしてダッシュボードにアクセスできます`,
        })
      }

      // 登録完了後、ログインフォームに戻る
      setAuthMode("login")
      resetForm()
    } catch (error: any) {
      addDebugInfo(`エラー発生: ${error.message}`)
      toast({
        title: "エラーが発生しました",
        description: error.message,
        variant: "destructive",
      })
      setShowDebug(true)
    } finally {
      setLoading(false)
    }
  }

  // ログインフォーム
  const renderLoginForm = () => (
    <form onSubmit={handleLogin}>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">メールアドレス</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="your@email.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">パスワード</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="********"
          />
        </div>
      </CardContent>
      <CardFooter className="flex flex-col space-y-4">
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          ログイン
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={() => {
            setAuthMode("signup")
            resetForm()
          }}
          disabled={loading}
        >
          アカウントをお持ちでない方はこちら
        </Button>
      </CardFooter>
    </form>
  )

  // 新規登録フォーム
  const renderSignupForm = () => (
    <form onSubmit={handleSignup}>
      <CardContent className="space-y-6">
        {/* アカウントタイプ選択 */}
        <div className="space-y-3">
          <Label>アカウントタイプ</Label>
          <RadioGroup
            value={accountType}
            onValueChange={(value) => setAccountType(value as "user" | "owner" | "admin")}
            className="flex flex-col space-y-1"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="user" id="user" />
              <Label htmlFor="user" className="cursor-pointer">
                一般ユーザー
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="owner" id="owner" />
              <Label htmlFor="owner" className="cursor-pointer">
                駐車場オーナー
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="admin" id="admin" />
              <Label htmlFor="admin" className="cursor-pointer">
                管理者
              </Label>
            </div>
          </RadioGroup>

          <div className="space-y-2">
            <Label htmlFor="account-type-password">アカウントタイプパスワード（オーナー: owner, 管理者: admin）</Label>
            <Input
              id="account-type-password"
              type="password"
              value={accountTypePassword}
              onChange={(e) => setAccountTypePassword(e.target.value)}
              placeholder="オーナー・管理者の場合は入力してください"
            />
          </div>

          {accountType !== "user" && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                {accountType === "admin"
                  ? "管理者アカウントとして登録されます"
                  : "駐車場オーナーアカウントとして登録されます"}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <Separator />

        {/* ユーザー情報 */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium">アカウント情報</h3>

          <div className="space-y-2">
            <Label htmlFor="signup-email">メールアドレス *</Label>
            <Input
              id="signup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="your@email.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="signup-password">パスワード *</Label>
            <Input
              id="signup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="********"
            />
            <p className="text-xs text-gray-500">※8文字以上の英数字を入力してください</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="full-name">氏名 *</Label>
            <Input
              id="full-name"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              placeholder="山田 太郎"
            />
          </div>
        </div>

        {/* 駐車場情報（オーナーのみ） */}
        {accountType === "owner" && (
          <>
            <Separator />

            <div className="space-y-4">
              <h3 className="text-lg font-medium">駐車場情報</h3>

              <div className="space-y-2">
                <Label htmlFor="parking-name">駐車場名 *</Label>
                <Input
                  id="parking-name"
                  type="text"
                  value={parkingLotName}
                  onChange={(e) => setParkingLotName(e.target.value)}
                  required
                  placeholder="○○駐車場"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="parking-location">駐車場の場所</Label>
                <Input
                  id="parking-location"
                  type="text"
                  value={parkingLotLocation}
                  onChange={(e) => setParkingLotLocation(e.target.value)}
                  placeholder="東京都渋谷区"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="parking-address">詳細住所</Label>
                <Input
                  id="parking-address"
                  type="text"
                  value={parkingLotAddress}
                  onChange={(e) => setParkingLotAddress(e.target.value)}
                  placeholder="○○町1-2-3"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="total-spaces">駐車スペース数 *</Label>
                <Input
                  id="total-spaces"
                  type="number"
                  value={totalSpaces}
                  onChange={(e) => setTotalSpaces(e.target.value)}
                  required
                  min="1"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="camera-id">カメラID（任意）</Label>
                <Input
                  id="camera-id"
                  type="text"
                  value={cameraId}
                  onChange={(e) => setCameraId(e.target.value)}
                  placeholder="camera-001"
                />
              </div>
            </div>
          </>
        )}

        {/* デバッグ情報 */}
        {showDebug && debugInfo.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">デバッグ情報</h3>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowDebug(false)}>
                  閉じる
                </Button>
              </div>
              <div className="bg-gray-100 p-2 rounded text-xs font-mono h-40 overflow-auto">
                {debugInfo.map((info, index) => (
                  <div key={index} className="mb-1">
                    {info}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>

      <CardFooter className="flex flex-col space-y-4">
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          登録する
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={() => {
            setAuthMode("login")
            resetForm()
          }}
          disabled={loading}
        >
          既にアカウントをお持ちの方はこちら
        </Button>
        {!showDebug && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="text-xs text-gray-500"
            onClick={() => setShowDebug(true)}
          >
            デバッグ情報を表示
          </Button>
        )}
      </CardFooter>
    </form>
  )

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>{authMode === "login" ? "ログイン" : "アカウント登録"}</CardTitle>
        <CardDescription>
          {authMode === "login"
            ? "メールアドレスとパスワードを入力してログインしてください"
            : "必要な情報を入力して登録してください"}
        </CardDescription>
      </CardHeader>
      {authMode === "login" ? renderLoginForm() : renderSignupForm()}
    </Card>
  )
}

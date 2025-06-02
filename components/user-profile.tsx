"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { LogOutIcon, UserIcon } from "lucide-react"
import { getUserRole } from "@/lib/supabase"

export default function UserProfile() {
  const [user, setUser] = useState<any>(null)
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadUserProfile() {
      try {
        setLoading(true)

        // ユーザー情報を取得
        const {
          data: { user },
        } = await supabase.auth.getUser()
        setUser(user)

        if (user) {
          // ユーザーロールを取得
          const userRole = await getUserRole()
          setRole(userRole)
        }
      } catch (error) {
        console.error("ユーザー情報の取得に失敗しました:", error)
      } finally {
        setLoading(false)
      }
    }

    loadUserProfile()
  }, [])

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut()
      window.location.href = "/auth"
    } catch (error) {
      console.error("ログアウトに失敗しました:", error)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>ユーザー情報を読み込み中...</CardTitle>
        </CardHeader>
      </Card>
    )
  }

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>ログインしていません</CardTitle>
        </CardHeader>
        <CardContent>
          <Button onClick={() => (window.location.href = "/auth")}>ログイン</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>ユーザープロフィール</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center space-x-4">
          <Avatar>
            <AvatarFallback>
              <UserIcon className="h-6 w-6" />
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium">{user.email}</div>
            <div className="text-sm text-gray-500">{role || "ロールなし"}</div>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleSignOut} className="w-full">
          <LogOutIcon className="h-4 w-4 mr-2" />
          ログアウト
        </Button>
      </CardContent>
    </Card>
  )
}

"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/use-toast"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type User = {
  id: string
  email: string
  full_name: string | null
  created_at: string
  is_active: boolean
  roles: string[]
}

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [roles, setRoles] = useState<{ id: number; name: string }[]>([])

  useEffect(() => {
    fetchUsers()
    fetchRoles()
  }, [])

  const fetchUsers = async () => {
    try {
      setLoading(true)
      const { data: usersData, error: usersError } = await supabase.from("users").select("*")

      if (usersError) throw usersError

      const usersWithRoles = await Promise.all(
        usersData.map(async (user) => {
          const { data: userRoles, error: rolesError } = await supabase
            .from("user_roles")
            .select("roles(name)")
            .eq("user_id", user.id)

          if (rolesError) throw rolesError

          return {
            ...user,
            roles: userRoles.map((r) => r.roles.name),
          }
        }),
      )

      setUsers(usersWithRoles)
    } catch (error) {
      console.error("ユーザー取得エラー:", error)
      toast({
        title: "エラー",
        description: "ユーザー情報の取得に失敗しました",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const fetchRoles = async () => {
    try {
      const { data, error } = await supabase.from("roles").select("*")
      if (error) throw error
      setRoles(data)
    } catch (error) {
      console.error("ロール取得エラー:", error)
    }
  }

  const assignRole = async (userEmail: string, roleName: string) => {
    try {
      const { error } = await supabase.rpc("assign_role_to_user", {
        user_email: userEmail,
        role_name: roleName,
      })

      if (error) throw error

      toast({
        title: "ロール割り当て成功",
        description: `${userEmail}に${roleName}ロールを割り当てました`,
      })

      fetchUsers()
    } catch (error: any) {
      toast({
        title: "エラー",
        description: error.message,
        variant: "destructive",
      })
    }
  }

  const removeRole = async (userEmail: string, roleName: string) => {
    try {
      const { error } = await supabase.rpc("remove_role_from_user", {
        user_email: userEmail,
        role_name: roleName,
      })

      if (error) throw error

      toast({
        title: "ロール削除成功",
        description: `${userEmail}から${roleName}ロールを削除しました`,
      })

      fetchUsers()
    } catch (error: any) {
      toast({
        title: "エラー",
        description: error.message,
        variant: "destructive",
      })
    }
  }

  const toggleUserStatus = async (userId: string, isActive: boolean) => {
    try {
      const { error } = await supabase.from("users").update({ is_active: !isActive }).eq("id", userId)

      if (error) throw error

      toast({
        title: "ステータス変更成功",
        description: `ユーザーのステータスを${!isActive ? "有効" : "無効"}に変更しました`,
      })

      fetchUsers()
    } catch (error: any) {
      toast({
        title: "エラー",
        description: error.message,
        variant: "destructive",
      })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>ユーザー管理</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>メールアドレス</TableHead>
                <TableHead>氏名</TableHead>
                <TableHead>ロール</TableHead>
                <TableHead>登録日</TableHead>
                <TableHead>ステータス</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.full_name || "-"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {user.roles.map((role) => (
                        <Badge key={role} variant="outline" className="mr-1">
                          {role}
                          <button className="ml-1 text-red-500" onClick={() => removeRole(user.email, role)}>
                            ×
                          </button>
                        </Badge>
                      ))}
                      <Select onValueChange={(value) => assignRole(user.email, value)}>
                        <SelectTrigger className="w-[120px] h-6">
                          <SelectValue placeholder="ロール追加" />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((role) => (
                            <SelectItem key={role.id} value={role.name}>
                              {role.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </TableCell>
                  <TableCell>{new Date(user.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Badge variant={user.is_active ? "default" : "destructive"}>
                      {user.is_active ? "有効" : "無効"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm" onClick={() => toggleUserStatus(user.id, user.is_active)}>
                      {user.is_active ? "無効化" : "有効化"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

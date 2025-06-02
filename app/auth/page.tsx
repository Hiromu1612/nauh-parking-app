import AuthForm from "@/components/auth/auth-form"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Info } from "lucide-react"

export default function AuthPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-gray-50">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">駐車場管理システム</h1>
          <p className="mt-2 text-lg text-gray-600">アカウントにログインして駐車場を管理しましょう</p>
        </div>

        <Alert className="bg-blue-50 border-blue-200">
          <Info className="h-4 w-4 text-blue-500" />
          <AlertTitle>アカウントタイプの選択</AlertTitle>
          <AlertDescription className="text-sm">
            <p>アカウントタイプを選択し、必要に応じてパスワードを入力してください：</p>
            <ul className="list-disc list-inside mt-1">
              <li>一般ユーザー：パスワード不要</li>
              <li>駐車場オーナー：パスワード「owner」</li>
              <li>管理者：パスワード「admin」</li>
            </ul>
          </AlertDescription>
        </Alert>

        <AuthForm />
      </div>
    </div>
  )
}

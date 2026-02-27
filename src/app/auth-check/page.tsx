import { createClient } from '@/app/lib/supabase/server'

export default async function AuthCheckPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  return (
    <main style={{ padding: 16 }}>
      <h1>Auth Check</h1>
      <pre>{JSON.stringify(data?.claims ?? null, null, 2)}</pre>
    </main>
  )
}
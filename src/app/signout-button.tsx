'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/app/lib/supabase/client'

export default function SignOutButton() {
  const router = useRouter()
  const supabase = createClient()

  return (
    <button
      onClick={async () => {
        await supabase.auth.signOut()
        router.push('/login')
        router.refresh()
      }}
      style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ccc' }}
    >
      Sign out
    </button>
  )
}
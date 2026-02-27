'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/app/lib/supabase/server'

type CreateEntryInput = {
  bn: string
  equipment_type: string
  quantity: number
  // add your other fields here (date, location, notes, etc.)
}

export async function createEntry(input: CreateEntryInput) {
  const supabase = await createClient()

  // optional: ensure user is logged in
  const { data: auth } = await supabase.auth.getClaims()
  if (!auth?.claims) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('bda_entries')
    .insert({
      bn: input.bn,
      equipment_type: input.equipment_type,
      quantity: input.quantity,
      // map other fields
    })

  if (error) throw new Error(error.message)

  // refresh any pages showing the list
  revalidatePath('/')
}
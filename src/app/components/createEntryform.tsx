'use client'

import { useState, useTransition } from 'react'
import { createEntry } from '@/app/actions/createEntry'

export function CreateEntryForm() {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(formData: FormData) {
    setError(null)

    const bn = String(formData.get('bn') ?? '').trim()
    const equipment_type = String(formData.get('equipment_type') ?? '').trim()
    const quantity = Number(formData.get('quantity') ?? 0)

    startTransition(async () => {
      try {
        await createEntry({ bn, equipment_type, quantity })
      } catch (e: any) {
        setError(e?.message ?? 'Failed to save')
      }
    })
  }

  return (
    <form action={onSubmit} style={{ display: 'grid', gap: 12, maxWidth: 520 }}>
      <input name="bn" placeholder="BN (e.g., 1651)" required />
      <input name="equipment_type" placeholder="Equipment Type (e.g., Type 96)" required />
      <input name="quantity" type="number" min={0} step={1} placeholder="Quantity" required />

      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}

      <button type="submit" disabled={isPending}>
        {isPending ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}
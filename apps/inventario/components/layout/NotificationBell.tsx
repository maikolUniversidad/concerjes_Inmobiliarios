'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export function NotificationBell() {
  const [count, setCount] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchCount = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { count: c } = await supabase
      .from('notificaciones')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', user.id)
      .eq('estado', 'NO_LEIDA')
    setCount(c ?? 0)
  }, [])

  useEffect(() => {
    fetchCount()
    intervalRef.current = setInterval(fetchCount, 30_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchCount])

  return (
    <Link
      href="/notificaciones"
      className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
      aria-label={`Notificaciones${count > 0 ? ` (${count} sin leer)` : ''}`}
    >
      <Bell className="w-5 h-5 text-gray-600" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white rounded-full flex items-center justify-center font-body font-bold text-[10px] leading-none">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </Link>
  )
}

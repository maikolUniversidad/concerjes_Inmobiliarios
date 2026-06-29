import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const pg = require('pg')

const { Pool } = pg

const pool = new Pool({
  connectionString: 'postgresql://postgres.esehmwmtevwrqxvbzmev:S9qxOMoOZCepMyke@aws-1-us-west-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false },
})

const FIFTY_MB = 52428800

const buckets = ['galeria-fotos', 'documentos-sst', 'productos-fotos', 'avatares']

const client = await pool.connect()
try {
  for (const bucket of buckets) {
    const res = await client.query(
      `UPDATE storage.buckets SET file_size_limit = $1 WHERE id = $2 RETURNING id, file_size_limit`,
      [FIFTY_MB, bucket]
    )
    if (res.rows.length > 0) {
      console.log(`✅ ${bucket}: ${res.rows[0].file_size_limit} bytes (${Math.round(res.rows[0].file_size_limit / 1024 / 1024)} MB)`)
    } else {
      console.log(`⚠️  ${bucket}: bucket no encontrado`)
    }
  }
  console.log('\n✅ Todos los buckets actualizados a 50 MB')
} finally {
  client.release()
  await pool.end()
}

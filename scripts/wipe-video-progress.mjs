#!/usr/bin/env node
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function readEnvFile(path) {
  if (!fs.existsSync(path)) return {}
  return Object.fromEntries(
    fs
      .readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'))
      .map((line) => {
        const [key, ...rest] = line.split('=')
        return [key.trim(), rest.join('=').trim()]
      })
  )
}

const env = { ...process.env, ...readEnvFile('.env.local'), ...readEnvFile('.env') }
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase credentials in .env or .env.local')
  process.exit(1)
}

console.log('Supabase URL:', supabaseUrl)
console.log('Service Key Length:', serviceRoleKey.length)

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

async function wipeProgress() {
  console.log('Wiping all video progress for all students...')

  // Supabase requires a filter to delete all rows via REST API,
  // so use a filter that matches everything, e.g. not null.
  const { error: deleteError } = await supabase
    .from('video_progress')
    .delete()
    .not('id', 'is', null)
    
  if (deleteError) {
    console.error('Error wiping progress:', deleteError.message)
    process.exit(1)
  }

  console.log('Successfully wiped video_progress table!')
  
  // Note: Since they stay logged in, and we just wiped the DB, 
  // they will now see zero progress! (It might take a minute for redis to clear if cached, 
  // but let's clear the cache via the API if needed).
}

wipeProgress()

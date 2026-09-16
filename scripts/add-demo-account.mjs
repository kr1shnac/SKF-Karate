#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')]
    })
)

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

async function main() {
  const skfId = 'SKF-DEMO-001'
  const demoAthlete = {
    id: `athlete_${skfId}`,
    skf_id: skfId,
    first_name: 'Demo',
    last_name: 'Student',
    date_of_birth: '2010-01-01',
    gender: 'Male',
    branch_name: 'HQ',
    current_belt: 'Black Belt',
    join_date: '2024-01-01',
    status: 'active',
    monthly_fee: 0, // Excluded from fees
    is_public: false, // Excluded from rankings
    achievements: [],
    points_history: [],
    points_balance: 0,
    points_lifetime: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase.from('athletes').upsert([demoAthlete], { onConflict: 'skf_id' })
  if (error) {
    console.error('Error creating demo account:', error.message)
    process.exit(1)
  }

  console.log(`Successfully created Demo Account with SKF ID: ${skfId}`)
}

main()

import { getLocalProfilePhotoFile } from '@/lib/server/profile-photos'
import { getAllAthletesLive } from '@/lib/server/repositories/athletes-live'
import { isSupabaseReady, supabaseAdmin } from '@/lib/server/supabase'
import { isExternallyManagedBranch } from '@/data/constants/branches'
import { env } from '@/src/server/config/env'
import { logger } from '@/src/server/lib/logger'
import {
  hasTelegramChannel,
  sendTelegramMessage,
  sendTelegramPhotoUrl,
} from '@/src/server/services/telegram.service'

const REMINDER_TIME_ZONE = 'Asia/Kolkata'
const DAY_MS = 24 * 60 * 60 * 1000
const BIRTHDAY_REMINDER_DAYS = new Set([0, 1])
const SPECIAL_DAY_REMINDER_DAYS = new Set([0, 1])

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const SPECIAL_DAY_FALLBACK_ROWS: SpecialDayRecord[] = [
  { name: 'New Year', date_token: '01-Jan', category: 'Celebration', notes: 'Happy New Year poster' },
  { name: 'Republic Day', date_token: '26-Jan', category: 'National', notes: 'National flag / patriotic poster' },
  { name: "Women's Day", date_token: '08-Mar', category: 'Awareness', notes: 'Women empowerment poster' },
  { name: 'Ugadi', date_token: '29-Mar', category: 'Festival', notes: 'Telugu/Kannada New Year' },
  { name: 'Ramadan Begins', date_token: '01-Mar', category: 'Festival', notes: 'Greetings poster' },
  { name: 'Ambedkar Jayanti', date_token: '14-Apr', category: 'National', notes: '' },
  { name: 'Eid ul-Fitr', date_token: '31-Mar', category: 'Festival', notes: 'Eid greetings poster' },
  { name: 'May Day', date_token: '01-May', category: 'Awareness', notes: 'Labour Day' },
  { name: 'International Yoga Day', date_token: '21-Jun', category: 'Sports', notes: 'Yoga & fitness poster' },
  { name: 'Eid ul-Adha', date_token: '07-Jun', category: 'Festival', notes: 'Bakrid greetings' },
  { name: 'Independence Day', date_token: '15-Aug', category: 'National', notes: 'Tricolor / patriotic poster' },
  { name: 'Janmashtami', date_token: '25-Aug', category: 'Festival', notes: 'Krishna Jayanti' },
  { name: 'National Sports Day', date_token: '29-Aug', category: 'Sports', notes: 'Dhyan Chand tribute & sports poster' },
  { name: "Teachers' Day", date_token: '05-Sep', category: 'Awareness', notes: 'Guru tribute poster' },
  { name: 'Ganesh Chaturthi', date_token: '07-Sep', category: 'Festival', notes: 'Ganpati poster' },
  { name: 'Gandhi Jayanti', date_token: '02-Oct', category: 'National', notes: 'Mahatma Gandhi tribute' },
  { name: 'Dasara / Dussehra', date_token: '12-Oct', category: 'Festival', notes: 'Victory of good poster' },
  { name: 'World Karate Day', date_token: '25-Oct', category: 'Sports', notes: 'Karate poster - MUST DO!' },
  { name: 'Diwali', date_token: '01-Nov', category: 'Festival', notes: 'Festival of lights poster' },
  { name: "Children's Day", date_token: '14-Nov', category: 'Awareness', notes: 'Chacha Nehru / kids poster' },
  { name: 'Guru Nanak Jayanti', date_token: '15-Nov', category: 'Festival', notes: '' },
  { name: 'Christmas', date_token: '25-Dec', category: 'Festival', notes: 'Christmas greetings poster' },
]

type ReminderAthlete = {
  skfId?: string
  firstName?: string
  lastName?: string
  dateOfBirth?: string
  branchName?: string
  status?: string
  photoUrl?: string
  gender?: string
}

type BirthdayReminder = {
  name: string
  skfId: string
  branch: string
  dateKey: string
  daysUntil: number
  turningAge: number | null
  photoUrl: string
}

type SpecialDayRecord = Record<string, unknown> & {
  name?: string
  date_token?: string
  category?: string
  notes?: string
}

type SpecialDayReminder = {
  name: string
  dateKey: string
  daysUntil: number
  category: string
  notes: string
  poster: string
  holiday: string
}

function getDatePartsForTimeZone(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REMINDER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const read = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return {
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
  }
}

function dateKeyFromParts(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day, 12))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-')
}

function todayDateKey(now = new Date()) {
  const { year, month, day } = getDatePartsForTimeZone(now)
  return dateKeyFromParts(year, month, day) || now.toISOString().slice(0, 10)
}

function parseDateKey(value: unknown) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null

  const [, year, month, day] = match
  return dateKeyFromParts(Number(year), Number(month), Number(day))
}

function dateKeyToUtcTime(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return Date.UTC(year, month - 1, day, 12)
}

function addDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days, 12))
  return dateKeyFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function daysBetween(fromDateKey: string, toDateKey: string) {
  return Math.round((dateKeyToUtcTime(toDateKey) - dateKeyToUtcTime(fromDateKey)) / DAY_MS)
}

function formatDateLabel(dateKey: string) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${dateKey}T12:00:00.000Z`))
}

function formatReminderLabel(daysUntil: number) {
  return daysUntil === 0 ? 'Birthday today' : 'Birthday tomorrow'
}

function formatSpecialDayReminderLabel(daysUntil: number) {
  return daysUntil === 0 ? 'Special day today' : 'Special day tomorrow'
}

function monthLabel(year: number, month: number) {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

function athleteDisplayName(athlete: ReminderAthlete) {
  const name = [athlete.firstName, athlete.lastName]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ')

  return name || String(athlete.skfId || 'SKF Athlete')
}

function isActiveAthlete(athlete: ReminderAthlete) {
  return String(athlete.status || 'active').trim().toLowerCase() === 'active'
}

function nextBirthdayDateKey(dateOfBirth: string, todayKey: string) {
  const birthDateKey = parseDateKey(dateOfBirth)
  if (!birthDateKey) return null

  const [todayYear] = todayKey.split('-').map(Number)
  const [, birthMonth, birthDay] = birthDateKey.split('-').map(Number)
  let nextKey = dateKeyFromParts(todayYear, birthMonth, birthDay)

  if (!nextKey && birthMonth === 2 && birthDay === 29) {
    nextKey = dateKeyFromParts(todayYear, 2, 28)
  }

  if (!nextKey) return null

  if (daysBetween(todayKey, nextKey) < 0) {
    nextKey = dateKeyFromParts(todayYear + 1, birthMonth, birthDay)
    if (!nextKey && birthMonth === 2 && birthDay === 29) {
      nextKey = dateKeyFromParts(todayYear + 1, 2, 28)
    }
  }

  return nextKey
}

function getTurningAge(dateOfBirth: string, nextBirthdayKey: string) {
  const birthDateKey = parseDateKey(dateOfBirth)
  if (!birthDateKey) return null

  const [birthYear] = birthDateKey.split('-').map(Number)
  const [birthdayYear] = nextBirthdayKey.split('-').map(Number)
  const age = birthdayYear - birthYear
  return Number.isFinite(age) && age >= 0 ? age : null
}

function toAbsoluteUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed

  const baseUrl = String(env.NEXT_PUBLIC_SITE_URL || env.NEXT_PUBLIC_APP_URL || 'https://www.skfkarate.org')
  try {
    return new URL(trimmed, baseUrl).toString()
  } catch {
    return ''
  }
}

function linkedPhotoUrl(athlete: ReminderAthlete) {
  const explicitPhoto = toAbsoluteUrl(String(athlete.photoUrl || ''))
  if (explicitPhoto) return explicitPhoto

  const localPhoto = getLocalProfilePhotoFile(athlete.skfId)
  if (!localPhoto) return ''

  return toAbsoluteUrl(`/api/profile-photos/${encodeURIComponent(localPhoto.skfId)}`)
}

async function getBirthdayReminders(todayKey: string): Promise<BirthdayReminder[]> {
  const athletes = (await getAllAthletesLive()) as ReminderAthlete[]

  return athletes
    .filter(isActiveAthlete)
    .filter((athlete) => !isExternallyManagedBranch(athlete.branchName))
    .map((athlete) => {
      const nextBirthdayKey = nextBirthdayDateKey(String(athlete.dateOfBirth || ''), todayKey)
      if (!nextBirthdayKey) return null

      const daysUntil = daysBetween(todayKey, nextBirthdayKey)
      if (!BIRTHDAY_REMINDER_DAYS.has(daysUntil)) return null

      return {
        name: athleteDisplayName(athlete),
        skfId: String(athlete.skfId || '').trim(),
        branch: String(athlete.branchName || '').trim(),
        dateKey: nextBirthdayKey,
        daysUntil,
        turningAge: getTurningAge(String(athlete.dateOfBirth || ''), nextBirthdayKey),
        photoUrl: linkedPhotoUrl(athlete),
      }
    })
    .filter((item): item is BirthdayReminder => Boolean(item))
    .sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name))
}

function parseSpecialDayDateToken(value: unknown, targetYear: number) {
  const text = String(value || '').trim()
  if (!text) return null

  const fullDate = parseDateKey(text)
  if (fullDate) return fullDate

  const match = text.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,}|\d{1,2})$/)
  if (!match) return null

  const day = Number(match[1])
  const monthToken = match[2]
  const month = /^\d+$/.test(monthToken)
    ? Number(monthToken)
    : MONTH_NAMES.findIndex((candidate) =>
        candidate.slice(0, 3).toLowerCase() === monthToken.slice(0, 3).toLowerCase()
      ) + 1

  if (!Number.isFinite(day) || !Number.isFinite(month)) return null
  return dateKeyFromParts(targetYear, month, day)
}

function nextSpecialDayDateKey(dateToken: unknown, todayKey: string) {
  const [todayYear] = todayKey.split('-').map(Number)
  const thisYearKey = parseSpecialDayDateToken(dateToken, todayYear)
  if (thisYearKey && daysBetween(todayKey, thisYearKey) >= 0) return thisYearKey

  const nextYearKey = parseSpecialDayDateToken(dateToken, todayYear + 1)
  if (nextYearKey && !parseDateKey(dateToken)) return nextYearKey

  return null
}

function readOptionalBoolean(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'boolean') return value
    if (value === null || value === undefined || value === '') continue

    const normalized = String(value).trim().toLowerCase()
    if (['true', '1', 'yes', 'y', 'required'].includes(normalized)) return true
    if (['false', '0', 'no', 'n', 'not required'].includes(normalized)) return false
  }

  return null
}

function inferPosterRequirement(record: SpecialDayRecord) {
  const explicit = readOptionalBoolean(
    record.create_poster,
    record.poster_required,
    record.needs_poster,
    record.poster,
    record.requires_poster
  )
  if (explicit !== null) return explicit ? 'Yes' : 'No'

  const notes = String(record.notes || '').toLowerCase()
  if (notes.includes('no poster') || notes.includes('poster not required')) return 'No (from notes)'
  return notes.includes('poster') ? 'Yes (from notes)' : 'Not specified'
}

function inferHolidayRequirement(record: SpecialDayRecord) {
  const explicit = readOptionalBoolean(
    record.is_holiday,
    record.holiday,
    record.give_holiday,
    record.requires_holiday,
    record.class_holiday
  )
  if (explicit !== null) return explicit ? 'Yes' : 'No'

  const notes = String(record.notes || '').toLowerCase()
  if (notes.includes('no holiday') || notes.includes('regular class')) return 'No (from notes)'
  return notes.includes('holiday') || notes.includes('no class') || notes.includes('closed')
    ? 'Yes (from notes)'
    : 'Not specified'
}

function mapSpecialDay(record: SpecialDayRecord, dateKey: string, todayKey: string): SpecialDayReminder {
  return {
    name: String(record.name || 'Special Day').trim(),
    dateKey,
    daysUntil: daysBetween(todayKey, dateKey),
    category: String(record.category || '').trim(),
    notes: String(record.notes || '').trim(),
    poster: inferPosterRequirement(record),
    holiday: inferHolidayRequirement(record),
  }
}

async function getSpecialDayRows() {
  if (!isSupabaseReady()) return SPECIAL_DAY_FALLBACK_ROWS

  const { data, error } = await supabaseAdmin
    .from('special_days')
    .select('*')
    .eq('is_active', true)

  if (error) {
    logger.warn('special_day_reminders.database_read_failed', { error })
    return SPECIAL_DAY_FALLBACK_ROWS
  }

  return (data?.length ? data : SPECIAL_DAY_FALLBACK_ROWS) as SpecialDayRecord[]
}

async function getSpecialDayReminders(todayKey: string): Promise<SpecialDayReminder[]> {
  const rows = await getSpecialDayRows()

  return rows
    .map((row) => {
      const dateKey = nextSpecialDayDateKey(row.date_token, todayKey)
      if (!dateKey) return null

      const reminder = mapSpecialDay(row, dateKey, todayKey)
      return SPECIAL_DAY_REMINDER_DAYS.has(reminder.daysUntil) ? reminder : null
    })
    .filter((item): item is SpecialDayReminder => Boolean(item))
    .sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name))
}

async function getNextMonthSpecialDays(todayKey: string): Promise<SpecialDayReminder[]> {
  const tomorrowKey = addDays(todayKey, 1)
  if (!tomorrowKey) return []

  const [, , tomorrowDay] = tomorrowKey.split('-').map(Number)
  if (tomorrowDay !== 1) return []

  const [targetYear, targetMonth] = tomorrowKey.split('-').map(Number)
  const rows = await getSpecialDayRows()

  return rows
    .map((row) => {
      const dateKey = parseSpecialDayDateToken(row.date_token, targetYear)
      if (!dateKey) return null

      const [year, month] = dateKey.split('-').map(Number)
      if (year !== targetYear || month !== targetMonth) return null

      return mapSpecialDay(row, dateKey, todayKey)
    })
    .filter((item): item is SpecialDayReminder => Boolean(item))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.name.localeCompare(b.name))
}

function buildBirthdayText(reminder: BirthdayReminder) {
  return [
    'SKF Birthday Reminder',
    `Reminder: ${formatReminderLabel(reminder.daysUntil)}`,
    `Student: ${reminder.name}`,
    `SKF ID: ${reminder.skfId || 'Not set'}`,
    `Birthday Date: ${formatDateLabel(reminder.dateKey)}`,
    `Turning Age: ${reminder.turningAge ?? 'Not set'}`,
    `Branch: ${reminder.branch || 'Not set'}`,
  ].join('\n')
}

function buildSpecialDayText(reminder: SpecialDayReminder) {
  return [
    'SKF Special Day Reminder',
    `Reminder: ${formatSpecialDayReminderLabel(reminder.daysUntil)}`,
    `Special Day: ${reminder.name}`,
    `Date: ${formatDateLabel(reminder.dateKey)}`,
    `Category: ${reminder.category || 'Not set'}`,
    `Poster Needed: ${reminder.poster}`,
    `Holiday / Class Off: ${reminder.holiday}`,
    `Notes: ${reminder.notes || 'Not specified'}`,
  ].join('\n')
}

function buildSpecialDayMonthlyText(todayKey: string, specialDays: SpecialDayReminder[]) {
  const firstSpecialDay = specialDays[0]
  const [targetYear, targetMonth] = firstSpecialDay.dateKey.split('-').map(Number)

  const lines = [
    'SKF Special Days Monthly Plan',
    `Prepared On: ${formatDateLabel(todayKey)}`,
    `Month: ${monthLabel(targetYear, targetMonth)}`,
    `Total Special Days: ${specialDays.length}`,
    '',
  ]

  for (const specialDay of specialDays) {
    lines.push(
      [
        `${formatDateLabel(specialDay.dateKey)} - ${specialDay.name}`,
        `Category: ${specialDay.category || 'Not set'}`,
        `Poster Needed: ${specialDay.poster}`,
        `Holiday / Class Off: ${specialDay.holiday}`,
        `Notes: ${specialDay.notes || 'Not specified'}`,
      ].join('\n')
    )
    lines.push('')
  }

  return lines.join('\n').trim()
}

async function sendBirthdayReminder(reminder: BirthdayReminder, requestId?: string) {
  const text = buildBirthdayText(reminder)

  if (reminder.photoUrl) {
    const photoResult = await sendTelegramPhotoUrl({
      channel: 'reminders',
      photoUrl: reminder.photoUrl,
      caption: text,
    })

    if (photoResult.ok) {
      return { ok: true, photoSent: true, status: photoResult.status }
    }

    logger.warn('birthday_reminders.telegram_photo_failed', {
      requestId,
      skfId: reminder.skfId,
      status: photoResult.status,
      skipped: photoResult.skipped,
      error: photoResult.error,
      systemAlert: false,
    })
  }

  const messageResult = await sendTelegramMessage({
    channel: 'reminders',
    text,
  })

  if (!messageResult.ok) {
    logger.warn('birthday_reminders.telegram_message_failed', {
      requestId,
      skfId: reminder.skfId,
      status: messageResult.status,
      skipped: messageResult.skipped,
      error: messageResult.error,
    })
  }

  return {
    ok: messageResult.ok,
    photoSent: false,
    status: messageResult.status,
    skipped: messageResult.skipped,
    error: messageResult.error,
  }
}

async function sendSpecialDayReminder(reminder: SpecialDayReminder, requestId?: string) {
  const result = await sendTelegramMessage({
    channel: 'reminders',
    text: buildSpecialDayText(reminder),
  })

  if (!result.ok) {
    logger.warn('special_day_reminders.telegram_message_failed', {
      requestId,
      name: reminder.name,
      date: reminder.dateKey,
      status: result.status,
      skipped: result.skipped,
      error: result.error,
    })
  }

  return result
}

export async function sendDailyReminders({ requestId }: { requestId?: string } = {}) {
  const todayKey = todayDateKey()
  const [birthdays, specialDays, nextMonthSpecialDays] = await Promise.all([
    getBirthdayReminders(todayKey),
    getSpecialDayReminders(todayKey),
    getNextMonthSpecialDays(todayKey),
  ])

  const dueCount = birthdays.length + specialDays.length + (nextMonthSpecialDays.length ? 1 : 0)

  if (!dueCount) {
    return {
      success: true,
      sent: false,
      skipped: true,
      reason: 'No reminders are due.',
      birthdays: 0,
      specialDays: 0,
      monthlySpecialDays: 0,
      photoMessages: 0,
      failed: 0,
    }
  }

  if (!hasTelegramChannel('reminders')) {
    logger.warn('reminders.telegram_missing_credentials', {
      requestId,
      birthdays: birthdays.length,
      specialDays: specialDays.length,
      monthlySpecialDays: nextMonthSpecialDays.length,
      systemAlert: false,
    })

    return {
      success: false,
      sent: false,
      skipped: true,
      reason: 'Telegram reminders channel is not configured.',
      birthdays: birthdays.length,
      specialDays: specialDays.length,
      monthlySpecialDays: nextMonthSpecialDays.length,
      photoMessages: 0,
      failed: 0,
    }
  }

  let sent = 0
  let photoMessages = 0
  let failed = 0

  if (nextMonthSpecialDays.length) {
    const result = await sendTelegramMessage({
      channel: 'reminders',
      text: buildSpecialDayMonthlyText(todayKey, nextMonthSpecialDays),
    })

    if (result.ok) {
      sent++
    } else {
      failed++
      logger.warn('special_day_reminders.monthly_telegram_failed', {
        requestId,
        count: nextMonthSpecialDays.length,
        status: result.status,
        skipped: result.skipped,
        error: result.error,
      })
    }
  }

  for (const birthday of birthdays) {
    const result = await sendBirthdayReminder(birthday, requestId)
    if (result.ok) {
      sent++
      if (result.photoSent) photoMessages++
    } else {
      failed++
    }
  }

  for (const specialDay of specialDays) {
    const result = await sendSpecialDayReminder(specialDay, requestId)
    if (result.ok) sent++
    else failed++
  }

  return {
    success: failed === 0,
    sent: sent > 0,
    skipped: false,
    reason: failed ? `${failed} reminder(s) failed to send.` : undefined,
    birthdays: birthdays.length,
    specialDays: specialDays.length,
    monthlySpecialDays: nextMonthSpecialDays.length,
    photoMessages,
    failed,
  }
}

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const email = process.argv[2]

if (!email || email === '--help' || email === '-h') {
  console.log('Usage: pnpm make-admin <user_email>')
  console.log('       npx tsx scripts/makeAdmin.ts <user_email>')
  console.log('')
  console.log('Promotes a user to admin by setting profiles.is_admin = true.')
  console.log('For Steam users, the email is {steamid64}@steam.skinpeer.gg.')
  process.exit(0)
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  // Find user in auth.users by email
  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })

  if (listError) {
    console.error('Error listing users:', listError.message)
    process.exit(1)
  }

  const authUser = users.find(u => u.email === email)
  if (!authUser) {
    console.error(`No user found with email: ${email}`)
    process.exit(1)
  }

  // Update profile
  const { data, error } = await supabase
    .from('profiles')
    .update({ is_admin: true })
    .eq('id', authUser.id)
    .select()
    .single()

  if (error) {
    console.error('Error updating profile:', error.message)
    process.exit(1)
  }

  console.log(`✓ Made admin: ${data.username} (${authUser.email})`)
}

main()

import { customAlphabet } from 'nanoid'
import { supabase } from '../lib/supabase'

// Excludes 0/O/I/1 to remove visual ambiguity. 32 chars × 6 = ~10⁹ combos.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const generate = customAlphabet(ALPHABET, 6)

const MAX_ATTEMPTS = 5

export async function generateProposalVerificationCode(): Promise<string> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const code = generate()
    const { data } = await supabase
      .from('trade_proposals')
      .select('id')
      .eq('verification_code', code)
      .maybeSingle()
    if (!data) return code
  }
  throw new Error('Failed to generate a unique verification code after 5 attempts')
}

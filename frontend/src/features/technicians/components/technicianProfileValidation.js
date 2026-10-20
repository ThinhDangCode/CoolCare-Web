const nameCharacters = /^[A-Za-zÀ-ÖØ-öø-ỹĐđ '-]*$/u
const fullName = /^[A-Za-zÀ-ÖØ-öø-ỹĐđ]+(?:[ '-][A-Za-zÀ-ÖØ-öø-ỹĐđ]+)*$/u
const phone = /^0(?:3[2-9]|5[25689]|7[06789]|8[1-689]|9[0-46-9])\d{7}$/

export function profileInputError(field, value) {
  if (field === 'full_name' && /\p{N}/u.test(value)) return 'Full name must not contain numbers.'
  if (field === 'full_name' && !nameCharacters.test(value.replace(/\p{M}/gu, '')))
    return 'Full name may only contain letters, spaces, apostrophes and hyphens.'
  if (field === 'phone' && /\D/.test(value)) return 'Phone number must contain digits only.'
  if (field === 'phone' && value && !value.startsWith('0')) return 'Phone number must start with 0.'
  if (field === 'phone' && value.length > 10) return 'Phone number must contain at most 10 digits.'
  return ''
}

export function localProfilePhone(value) {
  const normalized = String(value ?? '').replace(/[\s.-]/g, '')
  return normalized.startsWith('+84') ? `0${normalized.slice(3)}` : normalized
}

export function validateTechnicianProfile(values) {
  const errors = {}
  const name = String(values.full_name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
  const number = String(values.phone ?? '')
  const years = String(values.years_experience ?? '')
  if (!name) errors.full_name = 'Full name is required.'
  else if (profileInputError('full_name', name))
    errors.full_name = profileInputError('full_name', name)
  else if (name.length > 100) errors.full_name = 'Full name must contain at most 100 characters.'
  else if (!fullName.test(name.replace(/\p{M}/gu, '')))
    errors.full_name =
      'Enter a valid full name with letters separated by spaces, apostrophes or hyphens.'
  if (!number) errors.phone = 'Phone number is required.'
  else if (profileInputError('phone', number)) errors.phone = profileInputError('phone', number)
  else if (number.length !== 10) errors.phone = 'Phone number must contain exactly 10 digits.'
  else if (!phone.test(number) || /^0(\d)\1{8}$/.test(number))
    errors.phone = 'Enter a valid 10-digit Vietnamese mobile number, e.g. 0908341882.'
  if (!['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'].includes(values.qualification_level))
    errors.qualification_level = 'Choose a valid qualification level.'
  if (!years) errors.years_experience = 'Years of experience is required.'
  else if (!/^\d+$/.test(years) || Number(years) > 60)
    errors.years_experience = 'Years of experience must be a whole number from 0 to 60.'
  if (typeof values.bio !== 'string' || values.bio.length > 2000)
    errors.bio = 'Biography must contain at most 2000 characters.'
  return errors
}

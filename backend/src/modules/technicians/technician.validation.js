import { AppError, requireValidBody, isValidFullName, isValidVietnamesePhone, normalizeFullName, normalizePhone, validateUuid } from '../../utils.js'
import { serviceCity, serviceWards } from './technician.areas.js'

export function validateTechnicianAreas(body) {
  bodyObject(body, ['areas'])
  if (!Array.isArray(body.areas) || !body.areas.length) throw new AppError(422,'AREA_REQUIRED','A technician must have at least one service area.')
  if (body.areas.length > serviceWards.length) throw new AppError(422,'VALIDATION_ERROR','Too many service areas.')
  const seen = new Set()
  const areas = body.areas.map(area => {
    bodyObject(area, ['city','ward'])
    const city = typeof area.city === 'string' ? area.city.trim().replace(/\s+/g,' ') : ''
    const ward = typeof area.ward === 'string' ? area.ward.trim().replace(/\s+/g,' ') : ''
    if (!city || !ward || city.length > 100 || ward.length > 100) throw new AppError(422,'VALIDATION_ERROR','City and ward are required and must contain at most 100 characters.')
    if (city !== serviceCity) throw new AppError(422,'INVALID_SERVICE_CITY','Technicians can only operate in Can Tho City.')
    if (!serviceWards.includes(ward)) throw new AppError(422,'INVALID_SERVICE_WARD','Choose a current Can Tho ward from the list.')
    const key = JSON.stringify([city.toLocaleLowerCase('vi'),ward.toLocaleLowerCase('vi')])
    if (seen.has(key)) throw new AppError(422,'DUPLICATE_AREA','Each service area may only be assigned once.')
    seen.add(key)
    return {city,ward}
  })
  return {areas}
}

function bodyObject(body,allowed) {
  if(!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k=>!allowed.includes(k))) throw new AppError(422,'VALIDATION_ERROR','Invalid request fields.')
}
export function validateReview(body,certification=false) {
  bodyObject(body,['status','reason',...(certification?['expected_updated_at']:[])])
  const errors={}
  if(!['VERIFIED','REJECTED'].includes(body.status)) errors.status='Choose approve or reject.'
  const reason=typeof body.reason==='string'?body.reason.trim():''
  if(body.reason!==undefined && typeof body.reason!=='string') errors.reason='Invalid reason.'
  if(reason.length>1000 || (body.status==='REJECTED' && reason.length<5)) errors.reason='Rejection reason must contain 5–1000 characters.'
  if(certification) {
    const timestamp = body.expected_updated_at
    const day = typeof timestamp === 'string' ? /^\d{4}-\d{2}-\d{2}/.exec(timestamp)?.[0] : null
    const calendarDay = day ? new Date(`${day}T00:00:00Z`) : null
    if(!calendarDay || Number.isNaN(calendarDay.getTime()) || Number.isNaN(Date.parse(timestamp)) || calendarDay.toISOString().slice(0,10)!==day)
      errors.expected_updated_at='Refresh the certification before reviewing.'
  }
  requireValidBody(errors)
  return {status:body.status,reason:body.status==='REJECTED'?reason:null,...(certification?{expected_updated_at:body.expected_updated_at}:{})}
}
export function validateTechnicianUpdate(body) {
  bodyObject(body,['full_name','phone','qualification_level','years_experience','bio'])
  const errors={}
  if(typeof body.full_name!=='string' || !body.full_name.trim()) errors.full_name='Full name is required.'
  else if (/\p{N}/u.test(body.full_name)) errors.full_name='Full name must not contain numbers.'
  else if (normalizeFullName(body.full_name).length>100) errors.full_name='Full name must contain at most 100 characters.'
  else if (!isValidFullName(body.full_name)) errors.full_name='Full name may only contain letters, spaces, apostrophes and hyphens.'
  if(typeof body.phone!=='string' || !body.phone.trim()) errors.phone='Phone number is required.'
  else if (/\D/.test(body.phone)) errors.phone='Phone number must contain digits only.'
  else if (!body.phone.startsWith('0')) errors.phone='Phone number must start with 0.'
  else if (body.phone.length!==10) errors.phone='Phone number must contain exactly 10 digits.'
  else if (!isValidVietnamesePhone(body.phone)) errors.phone='Enter a valid Vietnamese mobile number, e.g. 0908341882.'
  if(!['BEGINNER','INTERMEDIATE','ADVANCED','EXPERT'].includes(body.qualification_level)) errors.qualification_level='Choose a valid qualification level.'
  if(!Number.isInteger(body.years_experience) || body.years_experience<0 || body.years_experience>60) errors.years_experience='Years of experience must be a whole number from 0 to 60.'
  if(typeof body.bio!=='string' || body.bio.length>2000) errors.bio='Biography must contain at most 2000 characters.'
  requireValidBody(errors)
  return {...body,full_name:normalizeFullName(body.full_name),phone:normalizePhone(body.phone),bio:body.bio.trim()}
}
export function validateTechnicianSkills(body) {
  bodyObject(body,['skills'])
  if(!Array.isArray(body.skills) || body.skills.length>100) throw new AppError(422,'VALIDATION_ERROR','Provide at most 100 skills.')
  const keys=new Set()
  const skills=body.skills.map(item=>{
    bodyObject(item,['skill_id','ac_brand_id','skill_level'])
    validateUuid(item.skill_id)
    const brand=item.ac_brand_id??null
    if(brand!==null) validateUuid(brand)
    if(!['BEGINNER','INTERMEDIATE','ADVANCED','EXPERT'].includes(item.skill_level)) throw new AppError(422,'VALIDATION_ERROR','Invalid skill level.')
    const key=item.skill_id+':'+brand
    if(keys.has(key)) throw new AppError(422,'VALIDATION_ERROR','Duplicate skill and brand.')
    keys.add(key)
    return {skill_id:item.skill_id,ac_brand_id:brand,skill_level:item.skill_level}
  })
  return {skills}
}

export function validatePenaltyQuery(query) {
  const errors = {}
  const page = query.page === undefined ? 1 : Number(query.page)
  const limit = query.limit === undefined ? 10 : Number(query.limit)
  const search = query.search ?? ''
  const status = query.status ?? 'ACTIVE'
  const type = query.type ?? 'ALL'
  if (!Number.isInteger(page) || page < 1 || page > 1000000) errors.page = 'Invalid page.'
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) errors.limit = 'Invalid page size.'
  if (typeof search !== 'string' || search.length > 150) errors.search = 'Maximum 150 characters.'
  if (!['ALL','ACTIVE','EXPIRED','REVOKED'].includes(status)) errors.status = 'Invalid status.'
  if (!['ALL','DECLINE','CANCELLATION','LATE_HANDLING','RULE_VIOLATION'].includes(type)) errors.type = 'Invalid penalty type.'
  requireValidBody(errors)
  return { page, limit, search: search.trim(), status, type }
}

export function validateTechnicianQuery(query, certifications = false) {
  const errors = {}
  const page = query.page === undefined ? 1 : Number(query.page)
  const limit = query.limit === undefined ? 10 : Number(query.limit)
  if (!Number.isInteger(page) || page < 1 || page > 1000000) errors.page = 'Invalid page.'
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) errors.limit = 'Invalid page size.'
  const choices = {
    status: certifications ? ['ALL', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED', 'EXPIRING'] : ['ALL', 'ACTIVE', 'INACTIVE', 'LOCKED'],
    verification: ['ALL', 'PENDING', 'VERIFIED', 'REJECTED'],
    qualification: ['ALL', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'],
    availability: ['ALL', 'ONLINE', 'OFFLINE', 'BUSY'],
  }
  const result = { page, limit }
  result.sort = query.sort ?? 'NAME'
  if (!['NAME', 'LATEST', 'OLDEST', 'PRIORITY'].includes(result.sort)) errors.sort = 'Invalid sort order.'
  for (const [key, options] of Object.entries(choices)) {
    const value = query[key] ?? 'ALL'
    if (!options.includes(value)) errors[key] = 'Invalid filter.'
    result[key] = value
  }
  if (certifications && query.type !== undefined && !['ALL', 'PDF', 'IMAGE', 'OTHER'].includes(query.type)) errors.type = 'Invalid document type.'
  result.type = certifications ? (query.type ?? 'ALL') : 'ALL'
  for (const key of ['search', 'area', 'skill', 'issuer']) {
    const value = query[key] ?? ''
    if (typeof value !== 'string' || value.length > 150) errors[key] = 'Maximum 150 characters.'
    result[key] = typeof value === 'string' ? value.trim() : ''
  }
  requireValidBody(errors)
  return result
}

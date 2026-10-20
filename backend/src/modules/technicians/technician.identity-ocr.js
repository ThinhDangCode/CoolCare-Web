import { env } from '../../config/env.js'
import { AppError } from '../../utils.js'

const endpoint = 'https://api.fpt.ai/vision/idr/vnm/'
const maxBytes = 5 * 1024 * 1024
const fields = ['id','name','dob','sex','nationality','home','address','doe','issue_date','issue_loc']
const text = value => typeof value === 'string' && value.trim() && value !== 'N/A' ? value.trim() : null
const normalizeName = value => String(value ?? '').normalize('NFC').trim().replace(/\s+/g,' ').toLocaleUpperCase('vi')

export function compareIdentity(front, profile) {
  const id = front.fields?.id?.value
  const name = front.fields?.name?.value
  return {
    identity_number: !id || !profile.identity_number ? 'UNAVAILABLE' : id.replace(/\s/g,'') === String(profile.identity_number).replace(/\s/g,'') ? 'MATCH' : 'MISMATCH',
    full_name: !name || !profile.full_name ? 'UNAVAILABLE' : normalizeName(name) === normalizeName(profile.full_name) ? 'MATCH' : 'MISMATCH',
  }
}

export class IdentityOcr {
  constructor({ apiKey = env.fptAiApiKey, allowedHosts = env.identityImageHosts, fetchImpl = fetch } = {}) {
    this.apiKey = apiKey
    this.allowedHosts = allowedHosts
    this.fetch = fetchImpl
    this.active = new Set()
  }

  async readSide(imageUrl, side) {
    if (!imageUrl) throw new AppError(422,'IDENTITY_IMAGE_MISSING','Chưa có ảnh căn cước.')
    let url
    try { url = new URL(imageUrl) } catch { throw new AppError(422,'INVALID_IMAGE_URL','Đường dẫn ảnh không hợp lệ.') }
    // Only download from administrator-configured storage, never arbitrary profile URLs.
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !this.allowedHosts.includes(url.hostname)) {
      throw new AppError(422,'IMAGE_HOST_NOT_ALLOWED','Ảnh phải ở kho lưu trữ HTTPS được cấu hình trong IDENTITY_IMAGE_ALLOWED_HOSTS.')
    }
    const imageResponse = await this.fetch(url.href, {redirect:'error',signal:AbortSignal.timeout(15000)})
    if (!imageResponse.ok) throw new AppError(422,'IMAGE_DOWNLOAD_FAILED','Không tải được ảnh căn cước. Kiểm tra lại file đã nộp.')
    const mime = (imageResponse.headers.get('content-type') || '').split(';')[0].trim()
    if (!['image/jpeg','image/png','image/webp'].includes(mime)) throw new AppError(422,'INVALID_IMAGE_TYPE','Ảnh phải là JPG, PNG hoặc WEBP.')
    if (Number(imageResponse.headers.get('content-length')) > maxBytes) throw new AppError(422,'IMAGE_TOO_LARGE','Ảnh không được vượt quá 5 MB.')
    const chunks = []
    let length = 0
    for await (const chunk of imageResponse.body) {
      length += chunk.length
      if (length > maxBytes) throw new AppError(422,'IMAGE_TOO_LARGE','Ảnh không được vượt quá 5 MB.')
      chunks.push(chunk)
    }
    if (!length) throw new AppError(422,'EMPTY_IMAGE','File ảnh rỗng.')
    const body = new FormData()
    body.append('image',new Blob(chunks,{type:mime}),`identity-${side}.${mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]}`)
    const response = await this.fetch(endpoint, {
      method:'POST',headers:{'api-key':this.apiKey},body,redirect:'error',signal:AbortSignal.timeout(30000),
    })
    if (!response.ok) {
      const message = [401,403].includes(response.status) ? 'FPT từ chối API key. Kiểm tra quyền sử dụng dịch vụ OCR.' : response.status === 429 ? 'FPT đã giới hạn lượt gọi. Vui lòng thử lại sau.' : 'Dịch vụ FPT OCR đang gặp lỗi. Vui lòng thử lại.'
      throw new AppError(502,'FPT_REQUEST_FAILED',message)
    }
    const payload = await response.json().catch(() => null)
    if (!payload || payload.errorCode === undefined) throw new AppError(502,'INVALID_FPT_RESPONSE','FPT trả về kết quả không hợp lệ.')
    if (Number(payload.errorCode) !== 0) {
      const messages = {2:'Ảnh thiếu góc căn cước. Vui lòng chụp lại.',3:'Không tìm thấy căn cước hoặc ảnh quá mờ/tối.',7:'File gửi lên không phải ảnh hợp lệ.',8:'Ảnh bị hỏng hoặc định dạng không được hỗ trợ.'}
      throw new AppError(422,'FPT_RECOGNITION_FAILED',messages[payload.errorCode] || 'FPT chưa đọc được ảnh. Kiểm tra ảnh hoặc cấu hình dịch vụ.')
    }
    const record = payload.data?.[0]
    if (!record || typeof record !== 'object') throw new AppError(422,'NO_OCR_DATA','FPT không trả về thông tin căn cước.')
    const type = text(record.type)
    const correctSide = side === 'front' ? ['old','new'].includes(type) : ['old_back','new_back'].includes(type)
    return {
      status:'READ',type,correct_side:correctSide,
      warning: correctSide ? null : 'Không nhận diện đúng mặt căn cước. Kiểm tra ảnh mặt trước/mặt sau.',
      fields:Object.fromEntries(fields.map(field => {
        const raw = record[`${field}_prob`]
        const confidence = raw === undefined || raw === null || raw === '' || raw === 'N/A' ? null : Number(raw)
        return [field,{value:text(record[field]),confidence:Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : null}]
      })),
    }
  }

  async check(profile) {
    if (!this.apiKey) throw new AppError(503,'FPT_NOT_CONFIGURED','Chưa cấu hình FPT_AI_API_KEY ở backend. Thêm key và khởi động lại backend.')
    if (this.active.has(profile.id)) throw new AppError(409,'OCR_IN_PROGRESS','Hồ sơ này đang được kiểm tra. Vui lòng chờ.')
    this.active.add(profile.id)
    try {
      const results = await Promise.allSettled([
        this.readSide(profile.identity_front_url,'front'),
        this.readSide(profile.identity_back_url,'back'),
      ])
      const sides = results.map(result => result.status === 'fulfilled' ? result.value : {
        status:'ERROR',message:result.reason instanceof AppError ? result.reason.message : 'Không kết nối được dịch vụ đọc ảnh. Vui lòng thử lại.',
      })
      return {
        provider:'FPT.AI',checked_at:new Date().toISOString(),front:sides[0],back:sides[1],
        comparison:compareIdentity(sides[0].correct_side ? sides[0] : {},profile),
        authenticity_verified:false,
      }
    } finally { this.active.delete(profile.id) }
  }
}

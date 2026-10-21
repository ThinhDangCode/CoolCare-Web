const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME?.trim()
const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET?.trim()

export async function uploadProfilePhoto(file, folder = 'coolcare/profile-photos') {
  if (!cloudName || !uploadPreset) {
    throw new Error(
      'Cloudinary chưa được cấu hình. Cần VITE_CLOUDINARY_CLOUD_NAME và VITE_CLOUDINARY_UPLOAD_PRESET.'
    )
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Chỉ hỗ trợ ảnh JPG, PNG hoặc WEBP.')
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('Ảnh đại diện không được vượt quá 5 MB.')

  const body = new FormData()
  body.append('file', file)
  body.append('upload_preset', uploadPreset)
  body.append('folder', folder)

  let response
  try {
    response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
      { method: 'POST', body }
    )
  } catch {
    throw new Error('Không thể kết nối Cloudinary. Vui lòng kiểm tra kết nối mạng.')
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.secure_url) {
    throw new Error(payload.error?.message || 'Cloudinary không thể tải ảnh lên.')
  }
  return payload.secure_url
}

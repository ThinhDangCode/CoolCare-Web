// Keep search independent of the optional PostgreSQL unaccent extension.
const vietnameseAccents = 'àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ'
const plainAccents = [...vietnameseAccents]
  .map((character) => character === 'đ' ? 'd' : character.normalize('NFD').replace(/\p{M}/gu, ''))
  .join('')

export const normalizeSearch = (value) => value.toLowerCase()
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .replace(/đ/g, 'd')

export const searchPattern = (value) => `%${normalizeSearch(value).replace(/[\\%_]/g, '\\$&')}%`

// `expression` must be a hard-coded SQL column/expression, never user input.
export const searchSql = (expression) =>
  `translate(lower(${expression}), '${vietnameseAccents}', '${plainAccents}')`

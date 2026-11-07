export function nameError(value, maxLength = 100) {
  const name = value.trim()
  if (!name) return 'Enter a name.'
  if (name.length > maxLength) return `Name must not exceed ${maxLength} characters.`
  if (!/\p{L}/u.test(name) || !/^[\p{L}\p{M} &'’()./-]+$/u.test(name))
    return 'Use letters and spaces; numbers and special symbols are not allowed.'
  return ''
}

export function modelNameError(value) {
  const name = value.trim()
  if (!name) return 'Enter a model name.'
  if (name.length > 100) return 'Model name must not exceed 100 characters.'
  if (!/[\p{L}0-9]/u.test(name) || !/^[\p{L}\p{M}0-9 &'’()./_-]+$/u.test(name))
    return 'Use letters, numbers, spaces and standard model separators.'
  return ''
}

export function numberError(value, { optional = false, max, integer = true } = {}) {
  if (value === '') return optional ? '' : 'Enter a value.'
  const number = Number(value)
  if (!Number.isFinite(number) || number < (integer ? 1 : 0) || number > max)
    return `Enter a number from ${integer ? 1 : 0} to ${max}.`
  if (integer && !Number.isInteger(number)) return 'Enter a whole number.'
  if (!integer && Math.abs(number * 100 - Math.round(number * 100)) > 0.0001)
    return 'Use no more than two decimal places.'
  return ''
}

// Match the immutable booking address snapshot against a saved address or
// another booking snapshot. No generated columns, migrations or address IDs.
// All callers must separately scope the comparison to the same customer.
const normalize = (column) =>
  `lower(btrim(regexp_replace(${column}, '[[:space:]]+', ' ', 'g')))`

export function sameServiceLocation(bookingAlias, addressAlias, streetColumn = 'address_line') {
  return [
    ['service_address', streetColumn], ['ward', 'ward'], ['city', 'city'],
  ].map(([left, right]) =>
    `${normalize(`${bookingAlias}.${left}`)} = ${normalize(`${addressAlias}.${right}`)}`
  ).join(' AND ')
}

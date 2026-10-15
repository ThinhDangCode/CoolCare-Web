export default function TopupPagination({ page, totalPages, loading, onPage }) {
  const maximum = Math.max(1, totalPages)
  const start = Math.min(Math.max(1, page - 1), Math.max(1, maximum - 2))
  const pages = Array.from({ length: Math.min(3, maximum) }, (_, index) => start + index)
  const go = (value) => {
    if (!loading && value !== page && value >= 1 && value <= maximum) onPage(value)
  }
  return (
    <nav className="topups-pagination" aria-label="Top-up pages">
      <button
        type="button"
        aria-label="Previous page"
        disabled={loading || page <= 1}
        onClick={() => go(page - 1)}
      >
        <img src="/topups/previous.svg" alt="" />
      </button>
      {start > 1 && <span aria-hidden="true">…</span>}
      {pages.map((number) => (
        <button
          key={number}
          type="button"
          aria-current={page === number ? 'page' : undefined}
          disabled={loading}
          onClick={() => go(number)}
        >
          {number}
        </button>
      ))}
      {pages[pages.length - 1] < maximum && (
        <>
          {pages[pages.length - 1] < maximum - 1 && <span aria-hidden="true">…</span>}
          <button type="button" disabled={loading} onClick={() => go(maximum)}>
            {maximum}
          </button>
        </>
      )}
      <button
        type="button"
        aria-label="Next page"
        disabled={loading || page >= maximum}
        onClick={() => go(page + 1)}
      >
        <img src="/topups/next.svg" alt="" />
      </button>
    </nav>
  )
}

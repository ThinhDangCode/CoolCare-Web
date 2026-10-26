import { useCallback, useEffect, useRef, useState } from 'react'
import { downloadInvoicePdf } from '../api/invoicesApi.js'
import { invoicePdfErrorMessage, saveInvoicePdf } from '../invoicePdfDownload.js'

export default function useInvoicePdfDownload(token, clearSession, scopeKey = '') {
  const requestRef = useRef(null)
  const [outcome, setOutcome] = useState(null)
  const current = outcome?.token === token && outcome.scopeKey === scopeKey ? outcome : null

  useEffect(
    () => () => {
      requestRef.current?.abort()
      requestRef.current = null
    },
    [token, scopeKey]
  )

  const download = useCallback(
    async (invoice) => {
      if (requestRef.current) return
      const controller = new AbortController()
      requestRef.current = controller
      const state = { token, scopeKey, busyId: invoice.id, error: '', notice: '' }
      setOutcome(state)
      try {
        const result = await downloadInvoicePdf(
          invoice.id,
          token,
          controller.signal,
          invoice.invoiceNumber
        )
        if (controller.signal.aborted || requestRef.current !== controller) return
        saveInvoicePdf(result.blob, result.filename)
        setOutcome({ ...state, busyId: null, notice: 'Invoice PDF download started.' })
      } catch (error) {
        if (controller.signal.aborted || requestRef.current !== controller) return
        setOutcome({ ...state, busyId: null, error: invoicePdfErrorMessage(error) })
        if (error.status === 401) clearSession()
      } finally {
        if (requestRef.current === controller) requestRef.current = null
      }
    },
    [token, scopeKey, clearSession]
  )

  return {
    download,
    busyId: current?.busyId ?? null,
    busy: Boolean(current?.busyId),
    error: current?.error ?? '',
    notice: current?.notice ?? '',
  }
}

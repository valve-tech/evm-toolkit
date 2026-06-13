import { useMemo, useState } from 'react'

import type { ChainConfig } from '../config'
import type { TxRow } from '../lib/rpc'
import { shortHash, shortAddr, formatValue } from '../lib/format'

type Cell = TxRow | 'pending' | 'error'
type SortKey = 'block' | 'value'

interface Props {
  chain: ChainConfig
  self: string
  order: string[]
  rows: Map<string, Cell>
}

export const ResultsTable = ({ chain, self, order, rows }: Props) => {
  const [sortKey, setSortKey] = useState<SortKey>('block')
  const [desc, setDesc] = useState(true)

  const hydratedCount = useMemo(
    () => order.filter((k) => typeof rows.get(k) === 'object').length,
    [order, rows],
  )

  const sorted = useMemo(() => {
    const keys = [...order]
    keys.sort((ka, kb) => {
      const a = rows.get(ka)
      const b = rows.get(kb)
      let cmp = 0
      if (sortKey === 'block') {
        const [ba, ta] = ka.split(':').map(BigInt)
        const [bb, tb] = kb.split(':').map(BigInt)
        cmp = ba !== bb ? (ba < bb ? -1 : 1) : ta < tb ? -1 : ta > tb ? 1 : 0
      } else {
        const va = typeof a === 'object' ? a.value : -1n
        const vb = typeof b === 'object' ? b.value : -1n
        cmp = va < vb ? -1 : va > vb ? 1 : 0
      }
      return desc ? -cmp : cmp
    })
    return keys
  }, [order, rows, sortKey, desc])

  const toggle = (k: SortKey) => {
    if (k === sortKey) setDesc((d) => !d)
    else {
      setSortKey(k)
      setDesc(true)
    }
  }
  const arrow = (k: SortKey) => (k === sortKey ? <span className="arrow">{desc ? '↓' : '↑'}</span> : null)

  const exLink = (path: string, label: string, cls = '') => (
    <a
      className={`ex-link ${cls}`.trim()}
      href={`${chain.explorerUrl}/${path}`}
      target="_blank"
      rel="noreferrer"
    >
      {label}
    </a>
  )

  const addrCell = (a: string | null) => {
    if (!a) return <span className="addr-pill">— (contract creation)</span>
    const isSelf = a.toLowerCase() === self
    return exLink(`address/${a}`, shortAddr(a), `addr-pill${isSelf ? ' self' : ''}`)
  }

  return (
    <section className="results">
      <div className="results-head">
        <h2>Appearances</h2>
        <span className="count">
          {hydratedCount.toLocaleString()} of {order.length.toLocaleString()} loaded
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th onClick={() => toggle('block')}>Block {arrow('block')}</th>
            <th className="hide-sm">Tx idx</th>
            <th>Tx hash</th>
            <th>From</th>
            <th>To</th>
            <th onClick={() => toggle('value')} style={{ textAlign: 'right' }}>
              Value {arrow('value')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((k) => {
            const [block, idx] = k.split(':')
            const cell = rows.get(k)
            const hashCell =
              cell === 'pending' ? (
                <span className="pending">fetching…</span>
              ) : cell === 'error' ? (
                <span className="row-error">unavailable</span>
              ) : cell ? (
                exLink(`tx/${cell.hash}`, shortHash(cell.hash))
              ) : null
            const row = typeof cell === 'object' && cell ? cell : null
            return (
              <tr key={k}>
                <td className="num">{exLink(`block/${block}`, block)}</td>
                <td className="num hide-sm">{idx}</td>
                <td className="hash">{hashCell}</td>
                <td>{row ? addrCell(row.from) : <span className="pending">…</span>}</td>
                <td>{row ? addrCell(row.to) : <span className="pending">…</span>}</td>
                <td className="val">
                  {row ? `${formatValue(row.value)} ${chain.symbol}` : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

import { useState } from 'react'
import { t } from '../../../../shared/strings'
import type { OutlineNode, OutlineTarget } from './outline'

interface OutlinePanelProps {
  nodes: OutlineNode[] | null
  onNavigate(target: OutlineTarget): void
}

export function OutlinePanel({ nodes, onNavigate }: OutlinePanelProps) {
  if (nodes === null) return <p className="panel-empty">{t.reader.loading}</p>
  if (nodes.length === 0) return <p className="panel-empty">{t.outline.empty}</p>
  return (
    <ul className="outline-tree">
      {nodes.map((node, index) => (
        <OutlineItem key={index} node={node} onNavigate={onNavigate} />
      ))}
    </ul>
  )
}

function OutlineItem({ node, onNavigate }: { node: OutlineNode; onNavigate(target: OutlineTarget): void }) {
  const [open, setOpen] = useState(false)
  const hasChildren = node.children.length > 0
  return (
    <li>
      <div className="outline-row">
        {hasChildren ? (
          <button
            className="outline-toggle"
            aria-expanded={open}
            title={open ? t.outline.collapse : t.outline.expand}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="outline-toggle" />
        )}
        <button
          className="outline-title"
          disabled={!node.target}
          onClick={() => {
            if (node.target) onNavigate(node.target)
          }}
        >
          {node.title}
        </button>
      </div>
      {open && hasChildren && (
        <ul className="outline-tree">
          {node.children.map((child, index) => (
            <OutlineItem key={index} node={child} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
    </li>
  )
}

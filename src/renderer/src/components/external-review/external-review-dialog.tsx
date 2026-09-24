import React, { useEffect, useState } from 'react'
import type {
  PluginOpenedReview,
  PluginReviewContents
} from '../../../../shared/plugins/plugin-review-contract'
import { pluginReviewContentsSchema } from '../../../../shared/plugins/plugin-review-contract'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import DiffViewer from '../editor/DiffViewer'
import { DiffNavigationProvider } from '../editor/diff-navigation-context'
import { detectLanguage } from '@/lib/language-detect'

type Props = { opened: PluginOpenedReview; onClose(): void }
export function ExternalReviewDialog({ opened, onClose }: Props): React.JSX.Element {
  const [index, setIndex] = useState(0)
  const [sideBySide, setSideBySide] = useState(true)
  const [contents, setContents] = useState<PluginReviewContents | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const file = opened.review.files[index]
  useEffect(() => {
    let active = true
    setContents(null)
    setError(null)
    if (!file) {
      return
    }
    const read = window.api.plugins.readReviewFile
    if (!read) {
      setError('Native plugin reviews require an updated desktop host.')
      return
    }
    void read({ reviewId: opened.reviewId, index })
      .then((value) => {
        if (active) {
          setContents(pluginReviewContentsSchema.parse(value))
        }
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'File unavailable')
        }
      })
    return () => {
      active = false
    }
  }, [opened.reviewId, index, file, retry])
  useEffect(
    () => () => {
      void window.api.plugins.closeReview?.({ reviewId: opened.reviewId }).catch(() => undefined)
    },
    [opened.reviewId]
  )
  const renderable =
    contents &&
    ['text', 'absent'].includes(contents.original.kind) &&
    ['text', 'absent'].includes(contents.modified.kind)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <DialogContent className="flex h-[85vh] max-w-[95vw] flex-col sm:max-w-[95vw]">
        <DialogTitle>{opened.review.title}</DialogTitle>
        <DialogDescription>Read-only snapshot · {opened.review.revision}</DialogDescription>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSideBySide((value) => !value)}>
            {sideBySide ? 'Unified view' : 'Side-by-side view'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={index === 0}
            onClick={() => setIndex((value) => value - 1)}
          >
            Previous file
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={index >= opened.review.files.length - 1}
            onClick={() => setIndex((value) => value + 1)}
          >
            Next file
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 gap-4">
          <nav
            aria-label="Changed files"
            className="w-64 shrink-0 overflow-auto scrollbar-sleek border-r pr-2"
          >
            {opened.review.files.map((entry, position) => (
              <Button
                key={entry.path}
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                aria-current={position === index ? 'true' : undefined}
                onClick={() => setIndex(position)}
                title={`${entry.status}: ${entry.oldPath ? `${entry.oldPath} → ` : ''}${entry.path}`}
              >
                <span className="truncate">
                  {entry.path} (+{entry.additions} −{entry.deletions})
                </span>
              </Button>
            ))}
          </nav>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {!file ? (
              <p>No changed files.</p>
            ) : error ? (
              <div role="alert">
                <p>{error}</p>
                <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>
                  Retry
                </Button>
              </div>
            ) : !contents ? (
              <p role="status">Loading file…</p>
            ) : renderable ? (
              <DiffNavigationProvider>
                <DiffViewer
                  key={`${opened.reviewId}:${index}:${retry}`}
                  modelKey={`plugin-review:${opened.reviewId}:${index}:${retry}`}
                  originalContent={
                    contents.original.kind === 'text' ? contents.original.content : ''
                  }
                  modifiedContent={
                    contents.modified.kind === 'text' ? contents.modified.content : ''
                  }
                  filePath={file.path}
                  relativePath={file.path}
                  language={detectLanguage(file.path)}
                  sideBySide={sideBySide}
                  editable={false}
                  keepModels={false}
                />
              </DiffNavigationProvider>
            ) : (
              <div role="status">
                {(['original', 'modified'] as const).map((side) => (
                  <p key={side}>
                    {side}: {contents[side].kind}
                    {contents[side].kind === 'error'
                      ? ` — ${contents[side].message}`
                      : contents[side].kind === 'limited'
                        ? ` — ${contents[side].reason}`
                        : ''}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

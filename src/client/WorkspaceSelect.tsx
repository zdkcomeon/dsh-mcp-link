/** 工作区多选下拉：直接使用 DSH 已登记的工作区列表。 */
import { useState } from 'react'
import {
  Button,
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  Input,
  Menu,
  MenuItemButton,
  Modal,
  Pill,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceOption } from './controller.js'
import type { McpSettingsSectionProps } from './Section.js'

/** 工作区多选组件的 props。 */
export interface WorkspaceSelectProps {
  readonly workspaces: readonly WorkspaceOption[]
  readonly state: 'loading' | 'ready' | 'error'
  readonly busy: boolean
  readonly t: McpSettingsSectionProps['t']
  readonly onToggle: (path: string, selected: boolean) => void
  readonly onClear: () => void
  readonly onAddCustom: (path: string) => Promise<boolean>
}

const CUSTOM_PATH = '::custom-path'
const CLEAR_SELECTION = '::clear-selection'

/**
 * 渲染工作区多选下拉。
 * @param props - 工作区列表、选中状态与动作。
 * @returns 下拉触发器、已选标签和菜单。
 */
export function WorkspaceSelect(props: WorkspaceSelectProps) {
  const { workspaces, state, busy, t, onToggle, onClear, onAddCustom } = props
  const [open, setOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [customPath, setCustomPath] = useState('')
  const [customError, setCustomError] = useState('')
  const selected = workspaces.filter(item => item.selected)
  const triggerLabel = selected.length === 0
    ? t('selectWorkspaces')
    : `${String(selected.length)} ${t('workspacesSelected')}`
  const footer: MenuEntry[] = [
    { id: CUSTOM_PATH, label: t('addCustomPath') },
    { id: CLEAR_SELECTION, label: t('clearSelection'), disabled: busy || selected.length === 0 },
  ]
  const closeCustom = () => {
    setCustomOpen(false)
    setCustomPath('')
    setCustomError('')
  }
  const submitCustom = async () => {
    const path = customPath.trim()
    if (path === '') return
    const ok = await onAddCustom(path)
    if (ok) closeCustom()
    else setCustomError(t('error'))
  }
  return (
    <div className="dsh-mcp-select">
      <Menu
        open={open}
        portal
        side="top"
        align="start"
        className="dsh-mcp-select-anchor"
        listClassName="dsh-mcp-select-menu"
        onClose={() => { setOpen(false) }}
        footer={footer}
        onSelect={id => {
          if (id === CUSTOM_PATH) {
            setOpen(false)
            setCustomOpen(true)
          } else if (id === CLEAR_SELECTION) {
            onClear()
          }
        }}
        anchor={(
          <Button
            variant="outline"
            className="dsh-mcp-select-trigger"
            aria-expanded={open}
            aria-haspopup="true"
            onClick={() => { setOpen(value => !value) }}
          >
            <span>{busy ? t('scanningProject') : triggerLabel}</span>
            <IconChevronDownOutlineRegular size={14} />
          </Button>
        )}
      >
        <div className="dsh-mcp-select-head">
          <span>{t('selectWorkspaces')}</span>
          <span className="dsh-mcp-select-count">{selected.length} / {workspaces.length}</span>
        </div>
        {state === 'loading' && <div className="dsh-mcp-select-empty">{t('workspaceLoading')}</div>}
        {state === 'error' && <div className="dsh-mcp-select-empty dsh-mcp-select-error">{t('workspaceLoadFailed')}</div>}
        {state === 'ready' && workspaces.length === 0 && (
          <div className="dsh-mcp-select-empty">{t('noWorkspaces')}</div>
        )}
        {workspaces.map(item => (
          <MenuItemButton
            key={item.id}
            icon={item.selected
              ? <IconCheckOutlineRegular size={16} />
              : <span className="dsh-mcp-select-check-empty" />}
            onSelect={() => { onToggle(item.path, !item.selected) }}
          >
            <span className="dsh-mcp-select-copy">
              <span className="dsh-mcp-select-title">
                {item.title}
                {item.custom ? <Tag tone="quiet">{t('customPath')}</Tag> : null}
              </span>
              <span className="dsh-mcp-select-path" title={item.path}>{item.path}</span>
            </span>
          </MenuItemButton>
        ))}
      </Menu>
      {selected.length > 0 && (
        <div className="dsh-mcp-selected-list">
          {selected.map(item => (
            <Pill
              key={item.id}
              className="dsh-mcp-selected-pill"
              title={t('deselectProject')}
              onClick={() => { onToggle(item.path, false) }}
            >
              {item.title}
            </Pill>
          ))}
        </div>
      )}
      <Modal
        open={customOpen}
        onClose={closeCustom}
        title={t('addCustomPath')}
        closeLabel={t('close')}
        footer={(
          <div className="dsh-mcp-dialog-actions">
            <Button size="md" variant="outline" onClick={closeCustom}>{t('cancel')}</Button>
            <Button
              size="md"
              variant="primary"
              disabled={busy || customPath.trim() === ''}
              onClick={() => { void submitCustom() }}
            >
              {t('add')}
            </Button>
          </div>
        )}
      >
        <div className="dsh-mcp-dialog-body">
          <label className="dsh-mcp-dialog-label" htmlFor="dsh-mcp-custom-path">{t('customPathPlaceholder')}</label>
          <Input
            id="dsh-mcp-custom-path"
            value={customPath}
            placeholder={t('customPathPlaceholder')}
            onChange={event => { setCustomPath(event.currentTarget.value) }}
            onKeyDown={event => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void submitCustom()
            }}
          />
          <span className="dsh-mcp-dialog-hint">{t('projectHint')}</span>
          {customError !== '' && <span className="dsh-mcp-dialog-error">{customError}</span>}
        </div>
      </Modal>
    </div>
  )
}

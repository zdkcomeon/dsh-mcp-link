/** MCP links sidebar entry icon. */
import type { ReactNode } from 'react'
import { IconLinkOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the link glyph at the size the sidebar asks for.
 * @param props - sidebar icon share: requested edge and selection state.
 * @returns the icon element.
 */
export function McpPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconLinkOutlineRegular size={size} />
}

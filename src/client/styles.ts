/** 设置页样式。作为插件自有 style 标签注入，随 fiber 释放移除。 */
export const STYLE_TEXT = `
.dsh-mcp-panel {
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  padding: 24px 32px 40px;
}
.dsh-mcp-panel .dsh-mcp-page { width: 100%; max-width: 960px; margin: 0 auto; }
.dsh-mcp-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 8px 0 24px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
}
.dsh-mcp-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.dsh-mcp-head > button { flex: none; white-space: nowrap; }
.dsh-mcp-head-copy { display: flex; flex-direction: column; gap: 4px; }
.dsh-mcp-title { margin: 0; font-size: 16px; font-weight: 600; line-height: 24px; }
.dsh-mcp-desc { margin: 0; color: var(--dsw-alias-label-tertiary); max-width: 560px; }
.dsh-mcp-stats { display: flex; flex-wrap: wrap; gap: 8px; }
.dsh-mcp-stat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-settings-card-fill);
}
.dsh-mcp-stat strong { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dsh-mcp-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh-mcp-select { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.dsh-mcp-select-anchor { display: inline-flex; }
.dsh-mcp-select-trigger { display: inline-flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 190px; }
.dsh-mcp-selected-list { display: flex; flex-wrap: wrap; gap: 6px; max-width: 100%; }
.dsh-mcp-selected-pill { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-mcp-select-menu { width: min(460px, calc(100vw - 48px)); max-height: 360px; }
.dsh-mcp-select-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
}
.dsh-mcp-select-count { flex: none; }
.dsh-mcp-select-empty { padding: 12px 10px; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh-mcp-select-error { color: var(--dsw-alias-state-error-primary); }
.dsh-mcp-select-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; text-align: left; }
.dsh-mcp-select-title { display: flex; align-items: center; gap: 6px; font-weight: 500; }
.dsh-mcp-select-path {
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 380px;
}
.dsh-mcp-select-check-empty { display: inline-block; width: 16px; height: 16px; }
@media (max-width: 640px) {
  .dsh-mcp-select { align-items: stretch; }
  .dsh-mcp-select-menu { width: calc(100vw - 56px); }
  .dsh-mcp-select-path { max-width: 240px; }
}
.dsh-mcp-section { display: flex; flex-direction: column; gap: 10px; }
.dsh-mcp-section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dsh-mcp-section-title { margin: 0; font-size: 14px; font-weight: 600; line-height: 22px; }
.dsh-mcp-section-count { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh-mcp-card {
  border: 0.5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill);
  overflow: hidden;
}
.dsh-mcp-source { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.dsh-mcp-source:first-child { border-top: none; }
.dsh-mcp-source > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.dsh-mcp-source > summary::-webkit-details-marker { display: none; }
.dsh-mcp-source > summary:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-mcp-source[open] > summary { border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.dsh-mcp-source-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-mcp-source-name { font-weight: 500; }
.dsh-mcp-source-path {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  max-width: 420px;
}
.dsh-mcp-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-mcp-row:first-of-type { border-top: none; }
.dsh-mcp-row-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dsh-mcp-row-title { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.dsh-mcp-name { font-weight: 500; font-size: 13px; overflow-wrap: anywhere; }
.dsh-mcp-row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
}
.dsh-mcp-row-actions { display: flex; align-items: center; gap: 8px; flex: none; }
.dsh-mcp-code {
  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
.dsh-mcp-empty {
  padding: 18px 16px;
  color: var(--dsw-alias-label-tertiary);
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-xl);
}
.dsh-mcp-warning {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 0.5px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent);
  border-radius: var(--dsw-radius-md);
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 6%, transparent);
  font-size: 12px;
}
.dsh-mcp-notice {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--dsw-radius-md);
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-settings-card-fill);
}
.dsh-mcp-notice[data-kind='error'] { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent); }
.dsh-mcp-notice[data-kind='success'] { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 35%, transparent); }
.dsh-mcp-notice-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.dsh-mcp-project-block { display: flex; flex-direction: column; gap: 8px; }
.dsh-mcp-project-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dsh-mcp-project-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-mcp-project-name { font-weight: 500; }
.dsh-mcp-section-actions { display: flex; align-items: center; gap: 10px; }
.dsh-mcp-add-choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.dsh-mcp-add-choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 16px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill);
  color: var(--dsw-alias-label-primary);
  text-align: left;
  cursor: pointer;
}
.dsh-mcp-add-choice:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-mcp-add-choice-title { font-size: 14px; font-weight: 600; }
.dsh-mcp-add-choice-desc { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dsh-mcp-json-input { min-height: 160px; }
.dsh-mcp-import-preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-skeleton);
}
@media (max-width: 640px) {
  .dsh-mcp-add-choices { grid-template-columns: 1fr; }
}
.dsh-mcp-editor-content { max-height: min(68vh, 620px); overflow-y: auto; }
.dsh-mcp-editor { display: flex; flex-direction: column; gap: 14px; }
.dsh-mcp-field { display: flex; flex-direction: column; gap: 6px; }
.dsh-mcp-field-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dsh-mcp-field-label { font-weight: 500; font-size: 13px; }
.dsh-mcp-field-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh-mcp-textarea {
  width: 100%;
  min-height: 82px;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  line-height: 18px;
  resize: vertical;
}
.dsh-mcp-textarea:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dsh-mcp-pair-list { display: flex; flex-direction: column; gap: 6px; }
.dsh-mcp-pair-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) auto auto;
  align-items: center;
  gap: 6px;
}
@media (max-width: 640px) {
  .dsh-mcp-pair-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
}
.dsh-mcp-dialog-body { display: flex; flex-direction: column; gap: 12px; }
.dsh-mcp-dialog-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-skeleton);
}
.dsh-mcp-dialog-label { font-weight: 500; }
.dsh-mcp-dialog-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh-mcp-dialog-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; }
.dsh-mcp-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
.dsh-mcp-search { flex: 1 1 240px; }
.dsh-mcp-toolbar-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dsh-mcp-loading { display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-tertiary); padding: 12px 0; }
.dsh-mcp-spinner {
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid var(--dsw-alias-border-l3);
  border-top-color: var(--dsw-alias-state-business-primary);
  animation: dsh-mcp-spin 0.8s linear infinite;
}
@keyframes dsh-mcp-spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) {
  .dsh-mcp-row { flex-direction: column; align-items: stretch; }
  .dsh-mcp-row-actions { justify-content: flex-end; }
  .dsh-mcp-source-path { max-width: 180px; }
}
`

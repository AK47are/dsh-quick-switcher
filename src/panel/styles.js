/* Panel styles injected by the dialog. */

export const STYLE = `
      .dqs-overlay {
        position: fixed;
        inset: 0;
        z-index: 10000;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: clamp(56px, 12vh, 128px) 16px 16px;
        background: rgba(0, 0, 0, 0.28);
        pointer-events: auto;
      }
      .dqs-card {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        width: min(560px, calc(100vw - 32px));
        max-height: min(560px, 72vh);
        overflow: hidden;
        border: 0.5px solid var(--dsw-alias-border-l1);
        border-radius: 16px;
        background: var(--dsw-alias-bg-overlay);
        color: var(--dsw-alias-label-primary);
        box-shadow: 0 0 1px rgba(0, 0, 0, 0.2), 0 12px 40px rgba(0, 0, 0, 0.2);
      }
      .dqs-card:focus {
        outline: none;
      }
      .dqs-search {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 10px;
        min-height: 56px;
        padding: 0 12px 0 18px;
        border-bottom: 0.5px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-secondary);
      }
      .dqs-search-icon {
        flex: 0 0 auto;
        opacity: 0.7;
      }
      .dqs-input {
        flex: 1 1 auto;
        min-width: 0;
        height: 40px;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 15px;
        line-height: 22px;
      }
      .dqs-input::placeholder {
        color: var(--dsw-alias-label-secondary);
        opacity: 0.75;
      }
      .dqs-close {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
      }
      .dqs-close:hover {
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
      }
      .dqs-list {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        padding: 6px;
      }
      .dqs-row {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 48px;
        padding: 6px 10px;
        border-radius: 10px;
        cursor: pointer;
      }
      .dqs-row-selected {
        background: var(--dsw-alias-bg-layer-2);
      }
      .dqs-row-main {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .dqs-title {
        overflow: hidden;
        color: var(--dsw-alias-label-primary);
        font-size: 14px;
        line-height: 21px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dqs-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 17px;
      }
      .dqs-workspace {
        overflow: hidden;
        max-width: 45%;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dqs-workspace-path {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dqs-trailing {
        flex: 0 0 auto;
        color: var(--dsw-alias-label-tertiary);
        font-size: 11px;
        white-space: nowrap;
      }
      .dqs-create-main {
        flex-direction: row;
        align-items: center;
        gap: 8px;
      }
      .dqs-create-icon {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border: 0.5px solid var(--dsw-alias-border-l1);
        border-radius: 6px;
        color: var(--dsw-alias-label-secondary);
        font-size: 13px;
        line-height: 1;
      }
      .dqs-create-label {
        color: var(--dsw-alias-label-primary);
      }
      .dqs-time {
        flex: 0 0 auto;
        opacity: 0.8;
      }
      .dqs-time-compact {
        color: var(--dsw-alias-label-tertiary);
        opacity: 1;
      }
      .dqs-status {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 8px;
      }
      .dqs-state {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
      }
      .dqs-badge {
        padding: 1px 6px;
        border-radius: 999px;
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
        line-height: 17px;
      }
      .dqs-mark {
        background: transparent;
        color: var(--dsw-alias-brand-primary);
        font-weight: 600;
      }
      .dqs-empty {
        padding: 32px 16px;
        color: var(--dsw-alias-label-secondary);
        font-size: 13px;
        text-align: center;
      }
      .dqs-error {
        flex: 0 0 auto;
        padding: 6px 18px;
        color: var(--dsw-alias-state-error-primary);
        font-size: 12px;
      }
      .dqs-footer {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 36px;
        padding: 4px 14px;
        border-top: 0.5px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
      }
      .dqs-hints {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .dqs-hint {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
      }
      .dqs-keycap {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 4px;
        border: 0.5px solid var(--dsw-alias-border-l1);
        border-radius: 5px;
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-secondary);
        font: inherit;
        font-size: 10px;
        line-height: 1;
      }
      .dqs-count {
        flex: 0 0 auto;
        white-space: nowrap;
        opacity: 0.75;
      }
      .dqs-sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
`;

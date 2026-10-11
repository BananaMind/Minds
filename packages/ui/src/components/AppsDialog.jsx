import { AppsPanel } from './AppsPanel.jsx';

export function AppsDialog({ state, api, dispatch, onClose }) {
  return (
    <div class="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal">
        <header><h3>Connect apps</h3><button class="x" aria-label="Close" onClick={onClose}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button></header>
        <AppsPanel state={state} api={api} dispatch={dispatch} />
      </div>
    </div>
  );
}

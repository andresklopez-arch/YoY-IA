'use client';

export default function ToastContainer({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <i className={`ri-${
            t.type === 'success' ? 'checkbox-circle' :
            t.type === 'error'   ? 'error-warning' :
            t.type === 'warning' ? 'alert' :
            'information'
          }-line`} style={{ fontSize: 17, flexShrink: 0 }} />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

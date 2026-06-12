import { useEffect } from 'react';

export function useBodyScrollLock(lock = true) {
  useEffect(() => {
    if (!lock) return;

    document.body.classList.add('modal-open');

    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [lock]);
}

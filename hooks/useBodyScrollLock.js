import { useEffect } from 'react';

let lockCount = 0;
let originalBodyOverflow = '';
let originalBodyPadding = '';
let originalPageContentOverflow = '';
let originalPageContentPadding = '';

export function useBodyScrollLock(lock = true) {
  useEffect(() => {
    if (!lock) return;

    lockCount++;

    if (lockCount === 1) {
      // Calculate scrollbar width
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

      // Lock body scroll
      originalBodyOverflow = document.body.style.overflow;
      originalBodyPadding = document.body.style.paddingRight;
      
      document.body.style.overflow = 'hidden';
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${parseFloat(originalBodyPadding || 0) + scrollbarWidth}px`;
      }

      // Lock main page content scroll (.page-content is the scrollable container)
      const pageContent = document.querySelector('.page-content');
      if (pageContent) {
        originalPageContentOverflow = pageContent.style.overflow;
        originalPageContentPadding = pageContent.style.paddingRight;
        
        pageContent.style.overflow = 'hidden';
        if (scrollbarWidth > 0) {
          pageContent.style.paddingRight = `${parseFloat(originalPageContentPadding || 0) + scrollbarWidth}px`;
        }
      }
    }

    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        // Restore body scroll
        document.body.style.overflow = originalBodyOverflow;
        document.body.style.paddingRight = originalBodyPadding;

        // Restore page content scroll
        const pageContent = document.querySelector('.page-content');
        if (pageContent) {
          pageContent.style.overflow = originalPageContentOverflow;
          pageContent.style.paddingRight = originalPageContentPadding;
        }
      }
    };
  }, [lock]);
}

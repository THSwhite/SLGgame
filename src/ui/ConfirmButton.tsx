import { useEffect, useState, type ReactNode } from 'react';

/**
 * Two-step confirmation inside the page (browser confirm() dialogs are not
 * available everywhere, e.g. inside claude.ai pages): the first click arms the
 * button, the second within a few seconds performs the action.
 */
export function ConfirmButton({
  children,
  confirmText,
  onConfirm,
  className,
}: {
  children: ReactNode;
  confirmText: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button
      className={`${className ?? ''} ${armed ? 'armed' : ''}`}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
      onBlur={() => setArmed(false)}
    >
      {armed ? confirmText : children}
    </button>
  );
}

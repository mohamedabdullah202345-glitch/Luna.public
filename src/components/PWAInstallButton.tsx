import { useState } from 'react';
import { Download, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-[#F8F4F6] whitespace-nowrap shrink-0 transition-colors"
      >
        <Download className="w-3.5 h-3.5 text-[#F3C677]" aria-hidden="true" />
        <span>Install</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-[#F8F4F6] whitespace-nowrap shrink-0 transition-colors"
        >
          <Download className="w-3.5 h-3.5 text-[#F3C677]" aria-hidden="true" />
          <span>Add App</span>
        </button>

        {showIOSGuide && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Install Luna on iPhone"
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#050814]/75 backdrop-blur-sm p-4"
          >
            <div className="w-full max-w-sm rounded-3xl bg-[#131A2E] border border-[#F48FB1]/15 p-6">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-medium text-[#F8F4F6]">
                  Install on iPhone
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Close"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#A6B0C9] hover:text-[#F8F4F6]"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
              <p className="mt-2 text-sm text-[#A6B0C9] leading-relaxed">
                1. Tap the <strong className="text-[#F8F4F6]">Share</strong>{' '}
                icon in Safari.
                <br />
                2. Tap{' '}
                <strong className="text-[#F8F4F6]">Add to Home Screen</strong>.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full min-h-[44px] rounded-xl bg-[#F48FB1] hover:bg-[#F7A3C0] text-[#0B1020] text-sm font-semibold transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}

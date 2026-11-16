import { X } from 'lucide-react';
import type { LegalPageKind } from './Header.tsx';

interface LegalModalProps {
  page: LegalPageKind | null;
  dmcaContactEmail: string;
  onClose: () => void;
}

export function LegalModal({ page, dmcaContactEmail, onClose }: LegalModalProps) {
  if (!page) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-4">
          <h2 id="legal-dialog-title" className="font-display text-xl font-bold text-zinc-950 dark:text-zinc-50">
            {page === 'terms'
              ? 'Terms of Use'
              : page === 'privacy'
                ? 'Privacy Policy'
                : 'DMCA & Copyright Takedown'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close legal dialog"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 space-y-4 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {page === 'terms' && (
            <>
              <p>
                ClipShort is a self-hosted formatting utility that converts user-selected time ranges into vertical 9:16 MP4 files. By using ClipShort, you confirm that you own the copyright to the source video, have explicit permission from the rights holder, or are clipping material licensed for reuse (such as Creative Commons).
              </p>
              <p>
                You are solely responsible for all content you process and publish. Do not use ClipShort to infringe copyrights, bypass paywalls, or redistribute private or restricted media.
              </p>
              <p>
                Service availability is provided as-is without warranty. Abuse, automated scraping, or attempts to circumvent rate limits may result in temporary or permanent IP blocking.
              </p>
            </>
          )}

          {page === 'privacy' && (
            <>
              <p>
                ClipShort is designed to minimize data retention. Temporary video segments and rendered MP4 outputs are stored solely on ephemeral local storage and are automatically deleted shortly after download or within 30 minutes of creation, whichever comes first.
              </p>
              <p>
                We do not build user profiles, require accounts, or store full video URLs permanently. Standard server access logs include request IDs, video IDs, and rate-limiting IP hashes for operational reliability and abuse prevention.
              </p>
            </>
          )}

          {page === 'dmca' && (
            <>
              <p>
                ClipShort does not host a public library or permanently store user clips. All temporary files expire automatically within 30 minutes.
              </p>
              <p>
                If you are a copyright owner and believe this instance is being used to process infringing material, please send a takedown notice with the relevant details to{' '}
                <a
                  href={`mailto:${dmcaContactEmail}`}
                  className="font-medium text-red-600 dark:text-red-400 underline underline-offset-2"
                >
                  {dmcaContactEmail}
                </a>
                .
              </p>
              <p>
                Please include identification of the copyrighted work, the specific URL or job reference if applicable, and your contact information.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

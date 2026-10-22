import Script from 'next/script';
import { markup } from './markup';

/**
 * Step 1 of the move to Next.js: the approved design runs exactly as it was.
 *  - app/globals.css  = the mock's CSS, unchanged
 *  - app/markup.ts    = the mock's HTML, unchanged
 *  - public/legacy/app.js = the mock's JavaScript, unchanged
 * Later steps turn each screen (Home, Map, Wallet, Profile, sheets) into React components one at a time,
 * checking each against docs/customer-mock.html.
 */
export default function Page() {
  return (
    <>
      {/* display: contents keeps the page layout identical to the original (no extra box around #app) */}
      <div style={{ display: 'contents' }} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: markup }} />
      <Script src="/legacy/gate.js" strategy="afterInteractive" />
      <Script src="/legacy/app.js" strategy="afterInteractive" />
    </>
  );
}

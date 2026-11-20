import type { Metadata } from "next";

import { LegalShell } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  description:
    "Open-source attribution and licence notices for Spire, Quick Search and Vercel.",
  title: "Legal & licenses — Spire",
};

const MIT_TEXT = `MIT License

Copyright (c) 2025 Teja Karlapudi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export default function LegalPage() {
  return (
    <LegalShell title="Legal & licenses" updated="20 November 2026">
      <h2>Spire</h2>
      <p>
        Spire is an independent product operated by Superior. It is not
        affiliated with, endorsed by, or sponsored by Vercel, Inc. or Teja
        Karlapudi.
      </p>

      <h2>Quick Search (Android app)</h2>
      <p>
        The Spire Android app is a modified and rebranded version of{" "}
        <strong>Quick Search</strong>, originally created by{" "}
        <strong>Teja Karlapudi</strong>. The original project is licensed under
        the MIT License. We have changed the app name, package identity,
        branding, links, permissions copy, and other parts of the app. The
        original copyright and permission notice is reproduced below and is also
        available in the app&rsquo;s open-source licences screen.
      </p>
      <pre className="overflow-x-auto rounded-lg border border-border/50 bg-muted/40 p-4 text-xs leading-relaxed whitespace-pre-wrap">
        {MIT_TEXT}
      </pre>
      <p>
        A copy of the MIT licence is also available at{" "}
        <a href="/licenses/quick-search-mit.txt">
          /licenses/quick-search-mit.txt
        </a>
        .
      </p>

      <h2>Web application (Vercel)</h2>
      <p>
        The Spire web application includes software developed by{" "}
        <strong>Vercel, Inc.</strong>, licensed under the Apache License,
        Version 2.0. We have modified and rebranded the web application. The
        original copyright notice is preserved in the repository and in the
        licence file below.
      </p>
      <p>
        Licensed under the Apache License, Version 2.0. You may obtain a copy of
        the License at{" "}
        <a
          href="https://www.apache.org/licenses/LICENSE-2.0"
          rel="noreferrer"
          target="_blank"
        >
          apache.org/licenses/LICENSE-2.0
        </a>
        . A local copy is available at{" "}
        <a href="/licenses/apache-2.0-full.txt">
          /licenses/apache-2.0-full.txt
        </a>
        .
      </p>

      <h2>Other dependencies</h2>
      <p>
        Spire uses open-source libraries for Android, web, PDF, image, audio,
        document, and spreadsheet processing. Their licence notices are listed
        in the Android app under Settings → Open Source Licenses and in the web
        app&rsquo;s dependency lockfile. If you need a specific notice, contact
        us and we will provide it.
      </p>

      <h2>Trademarks</h2>
      <p>
        &ldquo;Spire&rdquo; and the Spire logo are the branding of Superior.
        &ldquo;Quick Search&rdquo; and the Quick Search name/logo belong to
        their respective owner. The open-source licences above do not grant
        trademark rights.
      </p>

      <h2>Contact</h2>
      <p>
        Licence or attribution questions:{" "}
        <a href="mailto:support@thesuperior.in">support@thesuperior.in</a>.
      </p>
    </LegalShell>
  );
}

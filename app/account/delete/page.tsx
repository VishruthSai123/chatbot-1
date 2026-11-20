import type { Metadata } from "next";
import Link from "next/link";

import { LegalShell } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  description:
    "How to delete your Spire account and the data associated with it.",
  title: "Delete your account — Spire",
};

export default function DeleteAccountPage() {
  return (
    <LegalShell title="Delete your account" updated="20 November 2026">
      <p>
        You can delete your Spire account and the content associated with it at
        any time. Deletion is permanent and cannot be undone.
      </p>

      <h2>In the app or on the web</h2>
      <ol>
        <li>Sign in to Spire.</li>
        <li>
          Open <strong>Settings → Account &amp; data</strong>.
        </li>
        <li>
          Choose <strong>Delete my account</strong> and confirm.
        </li>
      </ol>
      <p>
        The web page is <Link href="/settings/account">/settings/account</Link>.
        The Android app opens the same account screen inside Spire.
      </p>

      <h2>If you cannot sign in</h2>
      <p>
        Email{" "}
        <a href="mailto:support@thesuperior.in?subject=Spire%20account%20deletion%20request">
          support@thesuperior.in
        </a>{" "}
        with the subject &ldquo;Spire account deletion request&rdquo; and the
        email address on the account. We may ask you to verify that you control
        the account. Once verified, we will delete the account and its content
        within 30 days, except records we must keep for legal, tax, fraud
        prevention, or dispute-resolution purposes.
      </p>

      <h2>What is deleted</h2>
      <ul>
        <li>Your account and profile.</li>
        <li>Your chats, messages, and generated artifacts.</li>
        <li>Your uploaded files and stored objects.</li>
        <li>
          Your usage counters and plan records, subject to legal retention.
        </li>
      </ul>
      <p>
        Some backups may persist for a limited period before they are rotated
        out. AI providers process requests under their own retention policies;
        see our <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>Questions</h2>
      <p>
        Contact{" "}
        <a href="mailto:support@thesuperior.in">support@thesuperior.in</a>. See
        also our <Link href="/privacy">Privacy Policy</Link> and{" "}
        <Link href="/terms">Terms of Service</Link>.
      </p>
    </LegalShell>
  );
}

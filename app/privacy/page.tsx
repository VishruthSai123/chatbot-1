import type { Metadata } from "next";

import { LegalShell } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  description:
    "How Spire handles account data, files, AI requests, payments and on-device permissions.",
  title: "Privacy Policy — Spire",
};

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="20 November 2026">
      <p>
        This policy explains how <strong>Superior</strong> (&ldquo;we&rdquo;,
        &ldquo;us&rdquo;) handles information in <strong>Spire</strong>,
        including the Spire website, the Spire web app, and the Spire Android
        app. It also explains the permissions the Android app requests and what
        stays on your device.
      </p>

      <h2>1. Who we are</h2>
      <p>
        Spire is operated by Superior, India. For privacy questions, contact{" "}
        <a href="mailto:support@thesuperior.in">support@thesuperior.in</a>. If
        you need our registered postal address for a legal notice, email us and
        we will provide it.
      </p>

      <h2>2. What we collect</h2>
      <ul>
        <li>
          <strong>Account information.</strong> Your email address, password
          hash, email-verification status, session information, and the plan
          attached to your account. If you continue as a guest, we create a
          temporary guest account so your work can be saved.
        </li>
        <li>
          <strong>Content you submit.</strong> Chats, prompts, messages,
          documents, images, PDFs, spreadsheets, audio, notebooks, slides, and
          other files you upload or create. This content is stored so you can
          reopen it in your library and studios.
        </li>
        <li>
          <strong>Usage and billing information.</strong> Task counts, search
          counts, storage usage, plan status, and purchase or subscription
          status. Card and payment details are handled by the payment provider;
          we do not store full card numbers.
        </li>
        <li>
          <strong>Technical information.</strong> IP address, browser or device
          type, user agent, timestamps, error logs, and security events needed
          to operate and protect the service.
        </li>
        <li>
          <strong>Cookies and local storage.</strong> Session cookies, theme and
          layout preferences, and similar storage needed to keep you signed in
          and remember your settings.
        </li>
      </ul>

      <h2>3. What stays on your Android device</h2>
      <p>
        The Android app&rsquo;s local search is designed to work on your device.
        The following data is read locally to show search results and is not
        uploaded to Spire unless you choose to share it in a chat or file:
      </p>
      <ul>
        <li>
          <strong>Apps and usage access.</strong> Installed app names, package
          names, launch counts, and recent-use timestamps, used to rank search
          results and suggestions.
        </li>
        <li>
          <strong>Contacts.</strong> Names, phone numbers, and contact details,
          only if you grant contact access, used to search and act on contacts.
        </li>
        <li>
          <strong>Calendar.</strong> Event titles and times, read-only, only if
          you grant calendar access.
        </li>
        <li>
          <strong>Files.</strong> File names, types, and basic metadata, only if
          you grant file access. Spire does not read file contents for local
          search.
        </li>
        <li>
          <strong>Notifications.</strong> Notification titles and text, only if
          you grant notification access, used for notification dots, searchable
          notification history, and At a Glance. This stays in a local database
          on your device.
        </li>
        <li>
          <strong>Accessibility.</strong> If you enable the lock-screen gesture,
          the accessibility service is used only to perform the system lock
          action. It does not read, collect, or share screen content.
        </li>
        <li>
          <strong>Notes, reminders, and preferences.</strong> Stored locally on
          your device. Some preferences may be included in Android device
          backups if you have backups enabled; sensitive keys and notification
          history are excluded.
        </li>
      </ul>
      <p>
        You can revoke any Android permission in Android Settings. Revoking a
        permission disables only the feature that depends on it; the rest of the
        app keeps working.
      </p>

      <h2>4. Spire AI and third-party processing</h2>
      <p>
        When you use Spire AI, the content you submit (for example a prompt, a
        chat message, or a file you attach) is sent to our servers and to the AI
        model provider that generates the response. We currently use Google
        Gemini through the Google Generative AI API, with OpenRouter as a
        configured fallback provider where enabled. Those providers process the
        request under their own terms and privacy policies. We do not control
        their retention or training practices; review their policies before
        submitting sensitive content.
      </p>
      <p>
        Do not submit information you are not allowed to share, including other
        people&rsquo;s confidential data, government identifiers, financial
        account numbers, or health records, unless you have the right to do so.
      </p>

      <h2>5. Service providers</h2>
      <p>We use service providers to run Spire, including:</p>
      <ul>
        <li>
          <strong>Hosting and infrastructure:</strong> Vercel for the web
          application and serverless functions.
        </li>
        <li>
          <strong>Database and file storage:</strong> a managed PostgreSQL
          database and object storage for your account, chats, and files.
        </li>
        <li>
          <strong>AI providers:</strong> Google Gemini and, where configured,
          OpenRouter.
        </li>
        <li>
          <strong>Email:</strong> a transactional email provider for
          verification, password reset, and account notices.
        </li>
        <li>
          <strong>Payments:</strong> the payment provider used for web
          purchases, and Google Play Billing for Android in-app purchases where
          offered.
        </li>
      </ul>
      <p>
        These providers receive only the information needed to perform their
        service. We do not sell your personal information.
      </p>

      <h2>6. How we use information</h2>
      <ul>
        <li>To create and secure your account, and to keep you signed in.</li>
        <li>
          To provide search, AI answers, file tools, studios, notebooks, and
          other features you request.
        </li>
        <li>To store your content and make it available in your library.</li>
        <li>
          To measure usage, enforce plan limits, prevent abuse, and troubleshoot
          errors.
        </li>
        <li>
          To process purchases, renewals, cancellations, refunds, and plan
          changes.
        </li>
        <li>To comply with legal obligations and enforce our Terms.</li>
      </ul>

      <h2>7. Legal bases</h2>
      <p>
        Where required by law, we rely on one or more of these bases:
        performance of our contract with you (providing Spire), your consent
        (for optional permissions and certain processing), our legitimate
        interests (security, abuse prevention, and service improvement), and
        legal obligations.
      </p>

      <h2>8. Retention</h2>
      <p>
        Account data and content are kept until you delete them or delete your
        account, unless we need to keep specific records for legal, tax, fraud
        prevention, or dispute-resolution purposes. Backups may persist for a
        limited period after deletion. Usage counters are kept for the periods
        shown in your plan. AI provider retention is governed by the
        provider&rsquo;s policy.
      </p>

      <h2>9. Security</h2>
      <p>
        We use encryption in transit, access controls, hashed passwords, and
        signed storage URLs. No service is completely secure; protect your
        password, use a unique password, and contact us immediately if you
        suspect unauthorized access.
      </p>

      <h2>10. Your choices and rights</h2>
      <ul>
        <li>
          <strong>Access and export.</strong> You can export your account data
          from Settings → Account &amp; data.
        </li>
        <li>
          <strong>Correction.</strong> You can update account details in
          Settings.
        </li>
        <li>
          <strong>Deletion.</strong> You can delete chats, files, and your
          account from Settings → Account &amp; data. You can also use the{" "}
          <a href="/account/delete">account deletion page</a> or email{" "}
          <a href="mailto:support@thesuperior.in">support@thesuperior.in</a>.
        </li>
        <li>
          <strong>Permissions.</strong> You can revoke Android permissions in
          Android Settings at any time.
        </li>
        <li>
          <strong>Objection and restriction.</strong> Contact us to request a
          restriction or to object to processing based on legitimate interests.
        </li>
      </ul>
      <p>
        Depending on your location, you may have additional rights under the
        GDPR, UK GDPR, India&rsquo;s Digital Personal Data Protection Act, or
        other laws. We will respond to verified requests within the time
        required by applicable law.
      </p>

      <h2>11. Children</h2>
      <p>
        Spire is not directed to children under 13 (or the minimum age required
        in your country). Do not create an account or submit personal
        information if you are below that age. If we learn that a child has
        provided personal information, we will delete it.
      </p>

      <h2>12. International transfers</h2>
      <p>
        Our providers may process information in countries other than yours. We
        use appropriate safeguards where required, such as standard contractual
        clauses or equivalent transfer mechanisms offered by the provider.
      </p>

      <h2>13. Cookies and analytics</h2>
      <p>
        We use essential cookies for authentication and preferences. If we
        enable product analytics or advertising in the future, we will update
        this policy and, where required, ask for consent before using
        non-essential cookies.
      </p>

      <h2>14. Changes</h2>
      <p>
        We may update this policy as Spire changes. We will post the new version
        here and update the date at the top. Material changes will be notified
        in the app or by email where appropriate.
      </p>

      <h2>15. Contact</h2>
      <p>
        Privacy questions, deletion requests, and legal notices:{" "}
        <a href="mailto:support@thesuperior.in">support@thesuperior.in</a>.
      </p>
    </LegalShell>
  );
}

import type { Metadata } from "next";

import { LegalShell } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  description:
    "The terms that govern your use of Spire, including accounts, AI output, plans and payments.",
  title: "Terms of Service — Spire",
};

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="20 November 2026">
      <p>
        These Terms govern your use of <strong>Spire</strong>, operated by{" "}
        <strong>Superior</strong> (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By
        creating an account, using Spire, or purchasing a plan, you agree to
        these Terms. If you do not agree, do not use Spire.
      </p>

      <h2>1. Eligibility</h2>
      <p>
        You must be at least 13 years old (or the minimum age required in your
        country) to use Spire. If you use Spire on behalf of an organization,
        you confirm that you have authority to bind that organization.
      </p>

      <h2>2. Accounts</h2>
      <ul>
        <li>
          Provide accurate account information and keep your password secure.
        </li>
        <li>
          You are responsible for activity under your account, including
          purchases made through it.
        </li>
        <li>
          Do not share your account, sell access, or use another person&rsquo;s
          account without permission.
        </li>
        <li>
          Tell us promptly if you believe your account has been compromised.
        </li>
      </ul>

      <h2>3. Your content</h2>
      <p>
        You keep ownership of the content you submit. You grant us a limited
        licence to host, process, transmit, and display that content solely to
        provide Spire, including sending it to the AI providers and storage
        providers described in our Privacy Policy. You confirm that you have the
        rights needed to submit the content.
      </p>
      <p>
        You are responsible for the content you submit and for the results you
        create from it. Do not submit content that infringes intellectual
        property, privacy, or other rights.
      </p>

      <h2>4. Acceptable use</h2>
      <p>You must not use Spire to:</p>
      <ul>
        <li>Break the law, infringe rights, or facilitate harm.</li>
        <li>
          Generate or distribute malware, phishing, fraud, or deceptive content.
        </li>
        <li>
          Harass, threaten, or expose another person&rsquo;s private
          information.
        </li>
        <li>
          Circumvent plan limits, quotas, authentication, or security controls.
        </li>
        <li>
          Scrape, reverse engineer, or overload the service, except as permitted
          by law or an open-source licence.
        </li>
        <li>
          Use the service to build a competing product from our non-public
          systems or data.
        </li>
      </ul>
      <p>
        We may suspend or terminate access if we reasonably believe these rules
        have been broken, or if required by law or a platform.
      </p>

      <h2>5. AI features and output</h2>
      <p>
        Spire uses generative AI. AI output can be inaccurate, incomplete,
        outdated, or offensive. It is not professional advice (legal, medical,
        financial, or otherwise). Verify important information before relying on
        it. You are responsible for how you use AI output and for reviewing it
        before publishing or acting on it.
      </p>

      <h2>6. Plans, payments, renewals and refunds</h2>
      <ul>
        <li>
          Paid plans and add-ons are described in the app or on the website.
          Prices and limits may change with notice where required by law.
        </li>
        <li>
          Web purchases are processed by our payment provider. Android in-app
          purchases are processed by Google Play Billing and are subject to
          Google Play&rsquo;s terms.
        </li>
        <li>
          Subscriptions renew automatically until cancelled. Cancel through the
          provider or store you used (for example, Google Play subscriptions).
        </li>
        <li>
          Refunds are governed by the applicable provider or store policy and
          applicable law. We do not control Google Play refund decisions.
        </li>
        <li>
          If a payment fails, we may suspend paid features until the balance is
          settled.
        </li>
      </ul>

      <h2>7. Third-party services</h2>
      <p>
        Spire links to and uses third-party services, including AI providers,
        hosting, storage, email, and payment providers. Their terms and privacy
        policies apply to their services. We are not responsible for third-party
        services we do not control.
      </p>

      <h2>8. Intellectual property</h2>
      <p>
        Spire&rsquo;s software, design, branding, and documentation are owned by
        us or our licensors and are protected by intellectual-property laws. The
        Android app is based on Quick Search by Teja Karlapudi, used under the
        MIT License. The web app includes software developed by Vercel, Inc.,
        used under the Apache License 2.0. See the Legal &amp; licenses page for
        the notices and licence texts.
      </p>
      <p>
        &ldquo;Spire&rdquo; and the Spire logo are our branding. The licences
        above do not grant trademark rights.
      </p>

      <h2>9. Availability and changes</h2>
      <p>
        We aim to keep Spire available, but we do not guarantee uninterrupted or
        error-free service. We may change, suspend, or discontinue features,
        including when a provider changes its model or pricing. We will give
        reasonable notice of material changes where practicable.
      </p>

      <h2>10. Disclaimers</h2>
      <p>
        To the maximum extent permitted by law, Spire is provided &ldquo;as
        is&rdquo; and &ldquo;as available&rdquo; without warranties of
        merchantability, fitness for a particular purpose, non-infringement, or
        uninterrupted availability. Nothing in these Terms excludes a warranty
        or right that cannot be excluded by law.
      </p>

      <h2>11. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, we are not liable for indirect,
        incidental, special, consequential, or punitive damages, or for lost
        profits, data, or goodwill. Our aggregate liability for claims relating
        to Spire will not exceed the greater of the amount you paid us in the 12
        months before the claim or INR 5,000. This does not limit liability that
        cannot be limited by law.
      </p>

      <h2>12. Indemnity</h2>
      <p>
        You agree to indemnify us against claims, losses, and costs arising from
        your content, your use of Spire in violation of these Terms, or your
        violation of another person&rsquo;s rights, to the extent permitted by
        law.
      </p>

      <h2>13. Termination</h2>
      <p>
        You may stop using Spire and delete your account at any time. We may
        suspend or terminate access for violations, security risks, legal
        requirements, or non-payment. On termination, your right to use Spire
        ends; provisions that by nature should survive (including ownership,
        disclaimers, and liability limits) will survive.
      </p>

      <h2>14. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of India. Subject to applicable
        consumer protections, the courts located in India will have jurisdiction
        over disputes. Before filing a claim, contact us at{" "}
        <a href="mailto:support@thesuperior.in">support@thesuperior.in</a> so we
        can try to resolve the issue informally.
      </p>

      <h2>15. Changes to these Terms</h2>
      <p>
        We may update these Terms. We will post the new version here and update
        the date. Material changes will be notified in the app or by email where
        appropriate. Continued use after the effective date means you accept the
        updated Terms.
      </p>

      <h2>16. Contact</h2>
      <p>
        Questions about these Terms:{" "}
        <a href="mailto:support@thesuperior.in">support@thesuperior.in</a>.
      </p>
    </LegalShell>
  );
}

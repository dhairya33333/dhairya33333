// Starting texts for the three legal pages. They are TEMPLATES, not legal advice: every [bracketed] item must be replaced and
// the whole text should be reviewed by a lawyer before launch. The admin screen and dashboard warn while [brackets] remain.
export const LEGAL_TITLES = { privacy: 'Privacy Policy', terms: 'Terms of Use', refunds: 'Refund and Cancellation Policy' };

export const LEGAL_DEFAULTS = {
  privacy: `## Who we are
This website is operated by [Legal name of the person or company running the site] ("we", "us"), contactable at [email address] and [postal address].

## What we collect
- **Account details:** your name, email address and, if you sign in with Google, your Google account identifier. Passwords are stored only as a one-way hash.
- **Purchase details:** which film you bought, the amount, the date and the payment reference. We do not receive or store your card, UPI or bank details; these are handled by our payment provider.
- **Messages:** what you type into the contact form (name, email, optional phone and organisation, topic and message).
- **Mobile number:** only where the payment provider requires it at checkout.
- **Viewing position:** where you stopped watching, so you can continue later.
- **Technical data:** a login cookie that keeps you signed in. We keep simple, anonymous counts of page and film views to understand what works; these are not linked to you.

## Why we use it
To run your account, deliver the film you paid for, take and confirm payments, answer your messages, prevent fraud and misuse, and meet legal and tax obligations.

## Who else handles data
- **Razorpay** (payments) [replace if you use another provider].
- **Google** (optional sign-in, and fonts loaded from Google Fonts, which means your browser contacts Google's servers).
- **Instagram / Meta** (when you open an Instagram post on our Social page, Instagram's own player loads and applies its own policies).
- **Our hosting provider** [name of the VPS provider] and **email provider** [name], who store or transmit data for us.
We do not sell your personal data.

## How long we keep it
Account and purchase records are kept for as long as your account exists and for the period required for accounting and tax law [state period, for example 8 years]. Contact messages are deleted when no longer needed [state period].

## Your rights
You can ask to see, correct or delete your personal data, or withdraw consent, by writing to [email address]. Deleting purchase records may be limited where the law requires us to keep them. If you are not satisfied you may complain to the relevant data-protection authority.

## Children
This site is not directed at children under 18, and we do not knowingly collect their data.

## Changes
We will update this page when our practices change and show the date it was last updated.`,

  terms: `## Using this site
By creating an account, buying a film or using this website you agree to these terms. If you do not agree, please do not use the site.

## The films
The first part of each film (shown on the film page) can be watched free of charge without paying. A one-time payment unlocks the full film for your personal account.

## What your purchase gives you
- A personal, non-transferable licence to stream the full film for your own private, non-commercial viewing, on any device you sign in to.
- Access for as long as the film remains available on this site and your account stays in good standing [state, for example "and in any case for at least X years"].
It does not give you ownership of the film or any right to copy, download, record, share, publicly show, sell or redistribute it.

## Your account
Keep your password secret and tell us if you suspect misuse. You are responsible for activity on your account. We may suspend accounts used to share or copy the film, to abuse the site, or for fraud.

## Payments
Prices are shown in Indian rupees (INR) and include [state whether taxes are included]. Payments are processed by [Razorpay]; their terms also apply. Access is granted after the payment is confirmed. See the Refund and Cancellation Policy for refunds.

## Availability
We aim to keep the site and films available, but they may be interrupted for maintenance or reasons outside our control. We are not liable for loss caused by interruptions, to the extent permitted by law.

## Intellectual property
All films, text, images and the site design belong to [owner name] or its licensors and are protected by copyright.

## Liability
Nothing in these terms limits liability that cannot be limited by law. Otherwise, our total liability to you for any claim about a purchase is limited to the amount you paid for it.

## Governing law
These terms are governed by the laws of India. Courts at [city, state] have jurisdiction, unless the law gives you the right to bring a claim elsewhere.

## Contact
[email address], [postal address].`,

  refunds: `## Digital film, instant access
Your purchase unlocks the full film immediately after payment is confirmed. Because it is digital content, the rules below apply.

## When we refund
- **You were charged but did not get access** and we cannot fix it: full refund.
- **You were charged twice** for the same film: the duplicate payment is refunded in full.
- **The film cannot be played** on your device or connection after reasonable help from us [add any additional conditions, for example a number of days]: full refund.
- **Other requests** made within [number] days of purchase, before the film has been substantially watched: considered individually [business decision: confirm or remove this line].

## When we do not refund
After you have watched a substantial part of the film, or where the film played normally, a change of mind is not a reason for a refund [business decision: confirm]. The first part of every film can be watched free beforehand so you can judge before paying.

## How to ask
Write to [email address] from the email on your account, with the date of purchase. We will reply within [number] working days.

## How refunds are paid
Approved refunds go back to the original payment method through our payment provider. Banks usually take [5 to 10] working days to show the money. When a refund is completed in full, access to the film is withdrawn.

## Cancellation
You cannot cancel after payment is confirmed, except as set out above. If you leave the payment window before paying, no money is taken.

## Failed or pending payments
If money left your account but access did not appear, wait a few minutes (it can take a short while for the bank to confirm) and check "My account". If it still has not appeared, contact us with your payment reference; you will not need to pay again.`,
};

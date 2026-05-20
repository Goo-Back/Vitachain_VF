# Notification templates

AUTH-06 ships the **content** for the three KYC notification types. NOT-01
owns the dispatcher: it polls `public.notifications_outbox`, loads the
matching template tuple `{type}.{locale}.{subject,txt,html}` from this
directory, renders Jinja2-style placeholders against
`profiles + outbox.context`, and POSTs to Brevo.

Template tuple per (type, locale):

```
{type}.{locale}.subject.txt   — one-line subject (no template variables)
{type}.{locale}.txt           — plain-text body
{type}.{locale}.html          — HTML body
```

## Variables

* `full_name`         — recipient name from `public.profiles.full_name`
* `reviewer_note`     — only for `kyc.rejected`; from outbox `context.note`
* `verification_url`  — public URL to `/onboarding/verification`

## Coverage in MVD

Per PRD §5.2 the MVD ships **fr** as the only fully-translated locale; AR
and EN files in this directory are the responsibility of I18N-02. The
dispatcher falls back to `fr` when a non-existing locale tuple is requested
— guard documented in `docs/runbook.md` §NOT-01.

## Types (AUTH-06)

| Type            | Fired when                                              |
|-----------------|---------------------------------------------------------|
| `kyc.submitted` | User submitted a document (POST /api/v1/kyc/submit).    |
| `kyc.approved`  | Admin clicked Approve in the verification queue.        |
| `kyc.rejected`  | Admin clicked Reject + note in the verification queue.  |

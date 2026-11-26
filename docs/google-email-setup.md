# Sending quotation emails from Google Workspace (Gmail)

For a company whose email is on **Google Workspace** (the domain is at Google, mail is Gmail, and staff may read it in Outlook).
The **Send Email** button on a quotation sends the PDF from `sales@` or `info@` (chosen in a **From** list in the dialog) through
the Gmail API. The sent email is saved in that mailbox's **Sent** folder, so it also shows in Outlook after it syncs, and replies
come back to the same mailbox.

The app can only **send** mail (scope `gmail.send`). It cannot read, search or delete anything in the mailbox.

Until the settings below are in Vercel, the button stays in "simulated" mode (nothing is sent).

Who does what:
- **A Google Workspace admin** (super admin) does Parts A and B (about 15 minutes).
- **The owner of each mailbox** (`sales@`, `info@`), or the admin who can sign in as them, does Part C once per mailbox.
- **You** do Part D (Vercel).

If the company's domain is not `techniconservices.com`, also add `MAIL_SENDERS` in Part D.

---

## Part A. A Google Cloud project with the Gmail API (admin)

1. Open https://console.cloud.google.com, signed in as the **Workspace admin**.
2. Top bar > project list > **New project**. Name `Technicon ERP mail`, organization = the company's domain > **Create**.
3. **APIs & Services > Library**, search **Gmail API** > **Enable**.

## Part B. The sign-in screen and the OAuth client (admin)

1. **APIs & Services > OAuth consent screen** (now also called **Google Auth Platform**).
   - User type / Audience: **Internal**. This is the important one: with Internal, the approval never expires. (External apps in
     testing mode lose their approval after 7 days.)
   - App name `Technicon ERP mail`, support email = the admin's address > save.
2. **Data access** (or "Scopes") > **Add or remove scopes** > add `https://www.googleapis.com/auth/gmail.send` > save.
3. **Credentials > Create credentials > OAuth client ID**.
   - Application type: **Web application**, name `ERP mail`.
   - **Authorized redirect URIs**: add `https://developers.google.com/oauthplayground`
   - **Create**. Copy the **Client ID** and the **Client secret**.

## Part C. Approve each mailbox once (mailbox owner, or the admin signed in as them)

Repeat for `sales@` and again for `info@`.

1. Open https://developers.google.com/oauthplayground
2. Click the **gear icon** (top right) > tick **Use your own OAuth credentials** > paste the **Client ID** and **Client secret** from Part B > Close.
3. In the left box ("Input your own scopes") type `https://www.googleapis.com/auth/gmail.send` > **Authorize APIs**.
4. Sign in **as that mailbox** (for example `sales@techniconservices.com`) > **Allow**.
5. Back in the Playground click **Exchange authorization code for tokens**.
6. Copy the **Refresh token**. Keep it private: whoever has it can send email as that mailbox.

Do this signed in as the mailbox itself. Approving as another person gives a token for the wrong mailbox.

## Part D. Add the settings in Vercel (you)

Vercel > the project > **Settings > Environment Variables** (Production):

| Name | Value |
|---|---|
| `MAIL_PROVIDER` | `gmail` |
| `GMAIL_CLIENT_ID` | Client ID from Part B |
| `GMAIL_CLIENT_SECRET` | Client secret from Part B |
| `GMAIL_REFRESH_TOKEN_SALES` | refresh token of `sales@` |
| `GMAIL_REFRESH_TOKEN_INFO` | refresh token of `info@` |
| `MAIL_FROM_NAME` | `Technicon Services` (the name shown next to the address) |
| `MAIL_SENDERS` | only if the domain is not `techniconservices.com`, e.g. `sales@theirdomain.com,info@theirdomain.com` (the first is the default). The token name is the part before the @, in capitals: `GMAIL_REFRESH_TOKEN_SALES`, `GMAIL_REFRESH_TOKEN_INFO`. |

Then **Deployments > the latest > Redeploy**.

If you only want one address, add only `sales@`'s token (the other then shows "not connected yet" in the list).

## Part E. Test

1. Open a quotation > **Send Email**. The **From** list shows `Sales (sales@...)` and `Info (info@...)`.
2. Send it to your own address. You should see "Email sent.", the email arrives with the PDF attached, and it is in the
   mailbox's **Sent** folder.
3. Check the spam folder once, and mark "not spam" if needed. For better delivery the company's domain should have SPF, DKIM and
   DMARC set up in Google Admin (Apps > Google Workspace > Gmail > Authenticate email); Google sends from its own servers, so
   this is normally already done.

## If it fails
The ERP shows "The email could not be sent". The Vercel function log has a short reason:
- `Google sign-in failed (400 invalid_grant)`: the mailbox's approval is gone. It happens if the mailbox **password was changed**
  (Google revokes Gmail approvals then), or the OAuth screen was External. Repeat Part C for that mailbox and replace its token in Vercel.
- `Google sign-in failed (401 invalid_client)`: wrong client ID or secret.
- `Gmail refused the message (403 PERMISSION_DENIED)`: the Gmail API is not enabled (Part A) or the scope `gmail.send` was not approved.
- `... is not connected yet` in the From list: that mailbox's refresh token is missing in Vercel.
- "Email sending is not configured yet": `MAIL_PROVIDER`, `GMAIL_CLIENT_ID` or `GMAIL_CLIENT_SECRET` is missing.
- Gmail limits: a Workspace mailbox can send about 2,000 emails a day; this is far above normal quotation use.

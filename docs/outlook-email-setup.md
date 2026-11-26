# Sending quotation emails from Outlook (Microsoft 365)

> Use this only when the company's mailboxes are on **Microsoft 365**. If the mail is on Google Workspace (Gmail), even when staff read it in the Outlook app, use `docs/google-email-setup.md` instead.

The **Send Email** button on a quotation sends the quotation PDF from one shared company mailbox in Microsoft 365. The email
is sent through Microsoft Graph and is saved in that mailbox's **Sent Items**, so it shows in Outlook like any other email.
Until the settings below are in Vercel, the button keeps working in "simulated" mode (nothing is sent).

This needs someone with **Global Administrator** (or Application Administrator + Exchange Administrator) rights in the
company's Microsoft 365. It takes about 10 minutes and is done once.

## 1. Register the ERP in Microsoft Entra
1. Open https://entra.microsoft.com and sign in as the Microsoft 365 admin.
2. **Identity > Applications > App registrations > New registration.**
   - Name: `Technicon ERP mail`
   - Supported account types: **Accounts in this organizational directory only**
   - Redirect URI: leave empty. Click **Register**.
3. On the app's **Overview** page copy:
   - **Application (client) ID** -> `OUTLOOK_CLIENT_ID`
   - **Directory (tenant) ID** -> `OUTLOOK_TENANT_ID`

## 2. Give it permission to send mail
1. In the app: **API permissions > Add a permission > Microsoft Graph > Application permissions**.
2. Search `Mail.Send`, tick it, **Add permissions**.
3. Click **Grant admin consent for <your company>** and confirm. The status must show a green tick.

## 3. Create a client secret
1. **Certificates & secrets > Client secrets > New client secret.** Description `Vercel`, expiry 24 months.
2. Copy the **Value** straight away (it is shown once) -> `OUTLOOK_CLIENT_SECRET`.
3. Put a reminder in the calendar a few weeks before it expires: create a new secret and replace it in Vercel.

## 4. (Recommended) Let the app send only from the shared mailbox
By default `Mail.Send` lets the app send from **any** mailbox in the company. Limit it to the shared mailbox in
Exchange Online PowerShell (as the Exchange admin):

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser
Connect-ExchangeOnline
New-DistributionGroup -Name "ERP mail senders" -Type Security -Members sales@yourcompany.com
New-ApplicationAccessPolicy -AppId <OUTLOOK_CLIENT_ID> -PolicyScopeGroupId "ERP mail senders" -AccessRight RestrictAccess -Description "Technicon ERP sends only as the shared mailbox"
Test-ApplicationAccessPolicy -AppId <OUTLOOK_CLIENT_ID> -Identity sales@yourcompany.com
```
The test must say `AccessCheckResult : Granted`. Changes can take up to an hour to apply.

## 5. Add the settings in Vercel
Vercel > the project > **Settings > Environment Variables** (Production):

| Name | Value |
|---|---|
| `MAIL_PROVIDER` | `outlook` |
| `MAIL_FROM_ADDRESS` | the shared mailbox, e.g. `sales@yourcompany.com` |
| `OUTLOOK_TENANT_ID` | Directory (tenant) ID |
| `OUTLOOK_CLIENT_ID` | Application (client) ID |
| `OUTLOOK_CLIENT_SECRET` | the secret's Value |

Then **Deployments > the latest > Redeploy** so the new settings are used.

## 6. Test
Open a quotation, **Send Email** to your own address. The message should say "Email sent.", the email arrives with the
PDF attached, and it appears in the shared mailbox's Sent Items. The sender name shown is the mailbox's own display name
in Microsoft 365 (`MAIL_FROM_NAME` is not used by Outlook).

## If it fails
The ERP shows "The email could not be sent". The Vercel function log has a short reason:
- `Microsoft sign-in failed (401 invalid_client)`: wrong or expired `OUTLOOK_CLIENT_SECRET`, or wrong client/tenant ID.
- `Outlook refused the message (403 ErrorAccessDenied)`: admin consent not granted, or the access policy (step 4) does not include the mailbox.
- `Outlook refused the message (404 ...)`: `MAIL_FROM_ADDRESS` is not a mailbox in this Microsoft 365.
- "Email sending is not configured yet": one of the five settings is missing in Vercel.

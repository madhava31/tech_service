# Local PE Funnel import

Loaded on 7 November 2026 from `PE Funnel-26 (2).xlsx` into the local SQLite database only.

- Database file: `app/server/data/technicon.db` (gitignored)
- Importer: `app/server/scripts/import-pe-funnel.mjs`
- Supabase / `DATABASE_URL`: not used. The script opens the SQLite file directly and never reads `DATABASE_URL`.
- GitHub: the workbook and the `.db` file are not committed. This document and the importer are.

## How to repeat it

Stop anything listening on port 4000, then:

```powershell
cd app/server
npm install
npm run import:funnel -- "C:\path\to\PE Funnel-26 (2).xlsx"
npm start
```

In another terminal:

```powershell
cd app/client
npm run dev
```

Open http://127.0.0.1:5173 and sign in with the local admin account. Re-running the importer deletes previous rows whose quotation notes start with `[PE Funnel]` and loads the workbook again. Companies and products that are still referenced are kept.

Do not start `node app/api/local-dev.js` for this test. That process reads `app/client/.env` and connects to Postgres.

## Workbook sheets

| Sheet | What happened |
|---|---|
| PE Quotes | Companies, products, quotations, line items, sales person, contact, and comments. |
| PE Instr Quotes | Same. Prices in columns 10–13 are used. If those cells are empty, columns 26–27 are the line price. |
| PE RECEIVED POS | Customer purchase orders. Linked to a quotation when the row has a `TSQOT…` id. |
| Sheet2 | More received PO lines, merged with the sheet above when the company and PO number match. |
| PE Instr Received Pos | Instrument POs. A price on the row is kept when the quote was not already priced. |
| Sheet1 | Not imported. It is a loose contact list, not quotes. |
| Sheet3 | Not imported. Invoice rows do not follow one layout. |

## How a row becomes a record

- One quotation per `QUOTATION ID`. Line items with the same part, description, and quantity collapse to the latest priced line so a revision does not double the total.
- A row labelled Total, Grand Total, or Subtotal is not added on top of priced lines. If the quote has no priced lines, the largest total row is kept as a single line named “Quoted package total”.
- Company names are trimmed. A trailing comma is removed, so `Virchow laboratories ltd,` matches `Virchow laboratories ltd`. Different spellings such as `Virchow` and `Virchows` stay separate, matching the sheet.
- Sales-person spellings are folded together: `Obulpathi` and `Obupathi` become Obulapathi. Names found in the sheet include TS, PE, Obulapathi, Madhu, Perkin, Achyut, Achuth, Ganesh, Mahendra, Naveen, G.Ramesh, and Obulu/Madhu.
- The four seeded sample engineers (`ENG-001` through `ENG-004`: Rahul Kumar, Priya Sharma, Amit Patel, Suresh Reddy) are removed when no quotation points at them.
- Line amounts are the sheet amounts. `tax_percent` is stored as 0 so the quotation total is not inflated with an extra 18% GST.
- Quotation notes start with `[PE Funnel]`. Comments from the sheet are in the notes. Open quotes also get a follow-up whose note is that comment. `created_by` is the first local user.

## Status

| Situation | `quotation.status` |
|---|---|
| Still in the funnel | `sent` |
| A received-PO row names that quotation id, or the order exists only on a PO sheet | `accepted` |
| Every comment on the quote matches lost / not required / bought direct / cancelled | `rejected` |

A mixed quote (one line “not required”, another still expected) stays `sent`. The comment text remains on the quotation.

Purchase orders use the app number sequence (`PO/2526/0001`, `PO/2627/0001`, financial year from the PO date). The customer’s PO number is `client_po_ref`. Creating the PO sets the linked quotation to `accepted`.

PO rows that have no quotation id and no matching quote become a quotation numbered from the PO (`PO-…`) so the purchase-order screen can still open them. Those rows often have no price in the sheet, so the total can be 0.

## Counts after the 7 November 2026 load

| | |
|---|---|
| Companies | 375 |
| Products | 861 |
| Quotations | 890 |
| Sent | 481 |
| Accepted | 404 |
| Rejected | 5 |
| Quotation lines | 2,304 |
| Purchase orders | 403 |
| Sales people | 12 |
| Follow-ups | 254 |
| Sum of quotation totals | ₹24,54,24,185.75 |

Checked example: `TSQOT2526/747` is Virchow laboratories ltd, 2 January 2026, sent, ₹2,86,762.50, contact Vijayalakshmi, email materials@virchows.com.

## What you see in the app

- **Quotations** lists every imported quote. The date filter defaults to all dates.
- **Companies** and **Products** are the masters created from the lines.
- **Purchase orders** lists the received POs. The customer PO number is in the reference column.
- **Engineers** lists the people from the workbook, not the old sample names.
- **Follow-ups** lists the 254 open comments.
- **Dashboard** default range is Oct 2025–Sep 2026 (`app/client/src/lib/date-presets.ts`). Quotes dated in October 2026 show under **This Year** or **All Time**.

The website reads this data through the API. There is no separate mock dataset in the React pages for these records.

-- Migration 017 (optional): indexes on the columns the ERP filters, joins and sorts by.
--
-- Run it by hand in the Supabase SQL Editor whenever convenient. Nothing in the app depends on it: it only adds
-- indexes (so lists, filters, joins and reports stay fast as the data grows). Each one is IF NOT EXISTS, so running it
-- twice is harmless. Primary keys, UNIQUE columns (quotation.number, company.name, product.part_no ...) and the
-- indexes from earlier migrations already exist and are not repeated here.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Quotations: the list filters by status / sales engineer / branch / firm and sorts by date.
CREATE INDEX IF NOT EXISTS idx_quotation_status ON quotation (status);
CREATE INDEX IF NOT EXISTS idx_quotation_date ON quotation (date DESC);
CREATE INDEX IF NOT EXISTS idx_quotation_sales_engineer ON quotation (sales_engineer_id);
CREATE INDEX IF NOT EXISTS idx_quotation_branch ON quotation (branch_id);
CREATE INDEX IF NOT EXISTS idx_quotation_firm ON quotation (firm_id);
CREATE INDEX IF NOT EXISTS idx_quotation_item_product ON quotation_item (product_id);

-- Purchase orders and performa invoices are looked up by their quotation (every quotation row checks them).
CREATE INDEX IF NOT EXISTS idx_purchase_order_quotation ON purchase_order (quotation_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_status ON purchase_order (status);
CREATE INDEX IF NOT EXISTS idx_purchase_order_supplier ON purchase_order (supplier_id);
CREATE INDEX IF NOT EXISTS idx_performa_invoice_quotation ON performa_invoice (quotation_id);
CREATE INDEX IF NOT EXISTS idx_performa_invoice_po ON performa_invoice (purchase_order_id);

-- Sale reports and their lines.
CREATE INDEX IF NOT EXISTS idx_sale_report_item_report ON sale_report_item (sale_report_id);
CREATE INDEX IF NOT EXISTS idx_sale_report_item_product ON sale_report_item (product_id);
CREATE INDEX IF NOT EXISTS idx_sale_report_source_quotation ON sale_report (source_quotation_id);
CREATE INDEX IF NOT EXISTS idx_sale_report_source_po ON sale_report (source_po_id);
CREATE INDEX IF NOT EXISTS idx_sale_report_engineer ON sale_report (sales_engineer_id);

-- Stock receipts' lines.
CREATE INDEX IF NOT EXISTS idx_stock_receipt_item_receipt ON stock_receipt_item (receipt_id);
CREATE INDEX IF NOT EXISTS idx_stock_receipt_item_product ON stock_receipt_item (product_id);

COMMIT;

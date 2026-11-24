/**
 * The units offered on a quotation line, most used first. The box also accepts any unit typed (for example "Pack of 250");
 * the server keeps at most 30 characters.
 */
export const QUOTATION_UNITS: string[] = [
  // count
  'Nos', 'Pcs', 'Set', 'Pair', 'Kit', 'Unit', 'Lot',
  // packs
  'Box', 'Pack', 'Pack of 10', 'Pack of 25', 'Pack of 50', 'Pack of 100', 'Pack of 500', 'Pack of 1000', 'Packet', 'Carton', 'Case', 'Dozen',
  // containers
  'Bottle', 'Vial', 'Ampoule', 'Tube', 'Jar', 'Can', 'Drum', 'Bag',
  // rolls and sheets
  'Roll', 'Sheet', 'Reel',
  // weight
  'Kg', 'Gm', 'Mg',
  // volume
  'Ltr', 'ml',
  // length and area
  'Meter', 'cm', 'mm', 'Ft', 'Sq.m',
  // services and time
  'Test', 'Job', 'Service', 'Hour', 'Day', 'Month', 'Year',
];

/** The unit options for a combo box, with the current value first when it is a unit of its own. */
export function unitOptions(current?: string | null) {
  const list = current && !QUOTATION_UNITS.some((u) => u.toLowerCase() === current.trim().toLowerCase()) ? [current.trim(), ...QUOTATION_UNITS] : QUOTATION_UNITS;
  return list.map((u) => ({ value: u, label: u }));
}

/** The Business Unit rules (the QA scenarios SC03 to SC05), in one place so the form
 *  and the CSV import say the same thing. Keys are the form's field ids, in the order
 *  the fields appear, so the first one can be focused. */

import type { Company } from '../api/types'
import { isGst, isMobile } from './party'
import { companyPhoneProblem } from './phone'
import { findDuplicate, isCurrency, isEmail, isPan, nameKey, nameProblem, panMatchesGst, requireText, type FieldErrors } from './validate'

export interface CompanyRuleInput {
  name: string
  email: string
  mobile: string
  trade_name?: string
  legal_name?: string
  phone_1: string
  phone_2: string
  phone_3: string
  address: string
  tax_id: string
  bank_account_1: string
  pan_number: string
  short_name: string
  ref_prefix: string
  currency: string
}

const up = (v: string | null | undefined) => (v ?? '').trim().toUpperCase()

export function companyErrors(input: CompanyRuleInput, others: readonly Company[], selfId: string | null | undefined): FieldErrors {
  const e: FieldErrors = {}

  requireText(e, 'c-name', input.name, 'Name is required.')
  if (!e['c-name'] && findDuplicate(others, selfId, (c) => c.name, input.name, nameKey)) {
    e['c-name'] = 'A business unit with this name already exists.'
  }
  if (!e['c-name']) { const m = nameProblem('Name', input.name); if (m) e['c-name'] = m }
  { const m = nameProblem('Trade Name', input.trade_name); if (m) e['c-trade'] = m }
  { const m = nameProblem('Legal Name', input.legal_name); if (m) e['c-legal'] = m }

  requireText(e, 'c-email', input.email, 'Email is required.')
  if (!e['c-email'] && !isEmail(input.email)) e['c-email'] = 'Enter a valid email, like name@company.com.'

  if (input.mobile.trim() && !isMobile(input.mobile)) e['c-mobile'] = 'Mobile numbers are 10 digits, without +91 or a leading 0.'
  ;(['phone_1', 'phone_2', 'phone_3'] as const).forEach((k, i) => {
    const problem = companyPhoneProblem(input[k])
    if (problem) e[`c-phone${i + 1}`] = problem
  })

  requireText(e, 'c-address', input.address, 'Address is required.')

  const gst = up(input.tax_id)
  if (gst) {
    if (!isGst(gst)) e['c-tax'] = 'Enter a complete GST number (15 characters, like 33AHFPS5121G2ZK).'
    else if (findDuplicate(others, selfId, (c) => c.tax_id, gst, up)) e['c-tax'] = 'Another business unit already has this GST number.'
  }

  requireText(e, 'c-bank1', input.bank_account_1, 'Bank Account Details 1 is required.')

  const pan = up(input.pan_number)
  if (pan) {
    if (!isPan(pan)) e['c-pan'] = 'Enter a valid PAN: 5 letters, 4 digits, 1 letter (like AHFPS5121G).'
    else if (!panMatchesGst(gst, pan)) e['c-pan'] = 'The PAN does not match the GST number (it is characters 3 to 12 of the GST).'
    else if (findDuplicate(others, selfId, (c) => c.pan_number, pan, up)) e['c-pan'] = 'Another business unit already has this PAN.'
  }

  requireText(e, 'c-short', input.short_name, 'Short name is required.')
  requireText(e, 'c-ref', input.ref_prefix, 'Reference number prefix is required.')
  if (!e['c-ref'] && findDuplicate(others, selfId, (c) => c.ref_prefix, input.ref_prefix, up)) {
    e['c-ref'] = 'This reference prefix is already used by another business unit.'
  }
  if (!isCurrency(up(input.currency))) e['c-currency'] = 'Enter a 3-letter currency code, for example INR.'

  return e
}

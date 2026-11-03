import { type LegalPage, openLegalPage } from '@/web/edition/legal/legal-doc'

const PAGE: LegalPage = {
  title: 'ui.office.edition.legal.terms.title',
  sections: [
    'ui.office.edition.legal.terms.s1',
    'ui.office.edition.legal.terms.s2',
    'ui.office.edition.legal.terms.s3',
    'ui.office.edition.legal.terms.s4',
    'ui.office.edition.legal.terms.s5',
    'ui.office.edition.legal.terms.s6',
    'ui.office.edition.legal.terms.s7',
    'ui.office.edition.legal.terms.s8',
    'ui.office.edition.legal.terms.s9',
  ],
}

/** The terms of use page. */
export function openTerms(options: { readonly back?: (() => void) | undefined } = {}): void {
  openLegalPage(PAGE, options)
}

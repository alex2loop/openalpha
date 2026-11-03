import { type LegalPage, openLegalPage } from '@/web/edition/legal/legal-doc'

const PAGE: LegalPage = {
  title: 'ui.office.edition.legal.privacy.title',
  sections: [
    'ui.office.edition.legal.privacy.s1',
    'ui.office.edition.legal.privacy.s2',
    'ui.office.edition.legal.privacy.s3',
    'ui.office.edition.legal.privacy.s4',
    'ui.office.edition.legal.privacy.s5',
    'ui.office.edition.legal.privacy.s6',
    'ui.office.edition.legal.privacy.s7',
    'ui.office.edition.legal.privacy.s8',
    'ui.office.edition.legal.privacy.s9',
    'ui.office.edition.legal.privacy.s10',
    'ui.office.edition.legal.privacy.s11',
    'ui.office.edition.legal.privacy.s12',
    'ui.office.edition.legal.privacy.s13',
  ],
}

/** The privacy policy page. */
export function openPrivacy(options: { readonly back?: (() => void) | undefined } = {}): void {
  openLegalPage(PAGE, options)
}

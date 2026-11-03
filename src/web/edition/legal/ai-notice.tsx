import { type LegalPage, openLegalPage } from '@/web/edition/legal/legal-doc'

const PAGE: LegalPage = {
  title: 'ui.office.edition.legal.ai.title',
  sections: [
    'ui.office.edition.legal.ai.s1',
    'ui.office.edition.legal.ai.s2',
    'ui.office.edition.legal.ai.s3',
    'ui.office.edition.legal.ai.s4',
    'ui.office.edition.legal.ai.s5',
    'ui.office.edition.legal.ai.s6',
    'ui.office.edition.legal.ai.s7',
    'ui.office.edition.legal.ai.s8',
  ],
}

/** The AI notice page. */
export function openAiNotice(options: { readonly back?: (() => void) | undefined } = {}): void {
  openLegalPage(PAGE, options)
}

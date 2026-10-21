import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { cashFlowToDateSource } from '@/trading/sources/adapters/cafef/cash-flow'
import { proprietaryFlowsSource } from '@/trading/sources/adapters/cafef/desk'

export function createCafefSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [proprietaryFlowsSource(options), cashFlowToDateSource(options)]
}
